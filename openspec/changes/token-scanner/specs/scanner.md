# Token Scanner Spec — Delta for `token-scanner` change

> Changes the byte-by-byte main scan loop to an Aho-Corasick token-based scanner.
> Depends on: proposal (complete)
> Status: DRAFT

## Overview

Replace the byte-by-byte walk in `scan.rs` with a single Aho-Corasick automaton
that matches ALL legacy color indicators in one linear pass. The AC automaton
drives the scan: matches are yielded by the automaton, false positives inside
comments/strings are suppressed via pre-computed skip ranges, and text between
matches is bulk-copied with `push_str`.

Gradient inner content continues to use the existing byte-walk (`process_gradient_inner`).

## Functional Requirements

### FR1 — AC-driven detection

The scanner MUST use a single `AhoCorasick` automaton that detects ALL of the
following patterns in one linear pass:

- `#` (hex indicator — single byte pattern for AC)
- `rgb(`, `rgba(`  (rgb function prefix)
- `hsl(`, `hsla(`  (hsl function prefix)
- `hwb(`           (hwb function prefix)
- `color(`         (color() function prefix)
- `linear-gradient(`, `radial-gradient(`, `conic-gradient(`
- `repeating-linear-gradient(`, `repeating-radial-gradient(`, `repeating-conic-gradient(`
- All 148 named colors (case-insensitive, ASCII)

The automaton SHALL be built once via `LazyLock` (as `NAMED_AC` currently is).

Pre-scan bail-out (`has_legacy_indicators`) SHALL be replaced by: build once,
reuse for bail-out check AND main scan loop.

### FR2 — False positive suppression

Matches whose position falls inside any of the following ranges MUST be skipped:

- `/* ... */` block comments (including nested `/* /* */` — though uncommon)
- `//` line comments
- `"..."` double-quoted strings with `\'` escape handling
- `'...'` single-quoted strings with `\"` escape handling
- Unterminated strings (treat from opening quote to end-of-input as a string range)

**Strategy**: A single pre-scan pass identifies all comment and string byte ranges.
These ranges are stored as `Vec<(usize, usize)>`. After each AC match, the scanner
checks `match.start()` against these ranges in O(log n) via binary search or a
cursor-based linear walk.

The pre-scan SHALL be skipped entirely when the bail-out check finds no legacy
indicators (zero-cost fast path preserved).

### FR3 — Gradient detection via AC match + inner byte-walk

When the AC automaton matches a gradient pattern (e.g. `linear-gradient(`), the
scanner SHALL:

1. Skip to after the opening `(` using existing `find_close_paren`
2. Process inner content using the EXISTING `process_gradient_inner` byte-by-byte walk
3. The AC cursor is advanced past the closing `)`

Inner gradient processing is NOT converted to AC — gradient bodies are typically
small (1–20 colors) and dominated by parse/math cost, not scan cost.

### FR4 — Audit mode

Audit mode SHALL use the same AC-driven scan. No output is built (`result.css` stays
empty). Color counts are accumulated identically to transform mode.

The audit-specific pre-scan optimizations (skip `count_legacy_indicators` for output
capacity) SHALL remain as-is: the capacity pre-calculation is only needed for
transform mode.

### FR5 — Named colors

Named color matching SHALL be case-insensitive. The AC automaton SHALL use
`ascii_case_insensitive(true)`.

After an AC match for a named color, the scanner MUST verify the word boundary
BEFORE the name AND AFTER the name using the existing `is_word_boundary` logic.
If the boundary check fails, the match is skipped (e.g. "red" inside "reduce" must
NOT match).

Word boundary check: character before match start is NOT alphanumeric and NOT `-`;
character after match end is NOT alphanumeric and NOT `-`.

### FR6 — Cursor management

The main scan loop maintains a `cursor` position. AC matches whose `start() < cursor`
MUST be skipped (overlap handling — though AC with `MatchKind::Standard` should not
produce overlapping matches, this is a safety measure).

After processing a match (color or gradient), the cursor advances to `match.end()`.
Between-match text is copied via `out.push_str(&input[cursor..match.start()])`.

### FR7 — Bulk copy

Text between matched positions MUST be copied with `String::push_str` (slice copy,
~1 branch per chunk) instead of per-byte `push` (1 branch per byte + char boundary
check). This is the primary throughput improvement.

## Non-functional Requirements

### NFR1 — Throughput

| Scenario | Target (ops/s) | Baseline (2026-05-25) | Δ |
|----------|---------------|----------------------|---|
| Mixed colors transform (50 KB) | ≥ 1,500 | 759 | ≥ 2× |
| Hex-only 50 KB | ≥ 3,000 | 1,904 | ≥ 1.5× |
| No-colors fast path | ≥ 8,900 | 8,927 | No regression |
| Gradient-heavy transform | ≥ 2,000 | 1,537 | ≥ 1.3× |
| Audit mixed (50 KB) | ≥ 2,200 | 1,119 | ≥ 2× |
| Gradient-heavy audit | ≥ 5,000 | 3,521 | ≥ 1.4× |

Measurement: `npm run bench` on the same hardware used for baseline.

### NFR2 — Binary size

WASM binary size increase MUST be < 10 KB compared to the current build.
The single AC automaton replaces the existing `FUNC_FINDERS` (6× `memmem::Finder`),
`named::NAMED_AC` (which already exists), and the `memchr` pre-scans.
The new automaton combines all patterns but the total pattern set is larger.
Expected increase: ~3–6 KB.

Measurement: `npm run build` and compare `packages/core-wasm/pkg/okcolor_bg.wasm` size.

### NFR3 — Zero behavioral change

All existing tests MUST pass unchanged. This is NON-NEGOTIABLE.

147 tests in `cargo test` + `npm test` MUST all pass with zero modifications to
test code.

### NFR4 — No unsafe code

The implementation MUST use zero `unsafe` blocks. Project policy.

### NFR5 — Backward compatibility

JS API surface is unchanged:
- `transformCss(css, ignoreComment?)` → `String`
- `auditCss(css)` → `String` (JSON)
- `colorToOklch(color)` → `Option<String>`
- `okColor(options?)` → Vite plugin

No changes to TS wrapper, CLI, or Vite plugin code.

## Test Scenarios

### TC1 — AC detection of all color formats

**Given** a CSS string containing each color format: hex (`#ff0000`), rgb (`rgb(255,0,0)`),
hsl (`hsl(0,100%,50%)`), hwb (`hwb(0,0%,0%)`), named (`red`), color() (`color(srgb 1 0 0)`)

**When** transformed

**Then** all formats are replaced with `oklch(...)` — 6 occurrences

---

### TC2 — False positive suppression in block comments

**Given** CSS with `/* color: #ff0000; */`

**When** transformed

**Then** the hex color inside the comment MUST NOT be replaced

---

### TC3 — False positive suppression in line comments

**Given** CSS with `// color: #ff0000;` followed by newline

**When** transformed

**Then** the hex color after `//` MUST NOT be replaced

---

### TC4 — False positive suppression in double-quoted strings

**Given** CSS with `content: "#ff0000"`

**When** transformed

**Then** the hex inside the string MUST NOT be replaced
(Existing test: `string_content_untouched`)

---

### TC5 — False positive suppression in single-quoted strings

**Given** CSS with `content: '#ff0000'`

**When** transformed

**Then** the hex inside the string MUST NOT be replaced

---

### TC6 — Nested comments

**Given** CSS with `/* outer /* inner */ still comment */ color: red;`

**When** transformed

**Then** content inside the comment MUST NOT be scanned for colors;
the `red` after the comment MUST be replaced

---

### TC7 — Unterminated strings

**Given** CSS with `content: "#ff0000` (no closing quote) followed by valid code

**When** transformed

**Then** the hex after the unterminated string MUST NOT be replaced
(the remainder of input is treated as string content)

---

### TC8 — Gradient detection via AC match + inner byte-walk

**Given** CSS with `linear-gradient(red, #00f)`

**When** transformed

**Then** `in oklch, ` is injected and both inner colors are replaced
(Existing tests: `gradient_injects_oklch`, `gradient_tracks_count`)

---

### TC9 — Overlapping match handling

**Given** CSS with `#rgb(0,0,0)` — `#` is at position N and `rgb(` starts at N+1

**When** transformed

**Then** the scanner MUST NOT double-process. The `#` alone does not form a valid
hex (no hex digits), and `rgb(` is the actual color. Output MUST be `oklch(...)`.

---

### TC10 — Case-insensitive named color matching

**Given** CSS with `color: RED`, `color: Red`, `color: rebeccapurple`

**When** transformed

**Then** all three are replaced with the corresponding OKLCH value
(Existing tests: `transform_named_uppercase`, `transform_named_mixed_case`)

---

### TC11 — Word boundary verification for named colors

**Given** CSS with `.reduce { color: red; }`

**When** transformed

**Then** `red` in `reduce` MUST NOT match (no word boundary before `r`)
The standalone `red;` MUST be replaced

---

### TC12 — Cursor advance correctness

**Given** CSS with `color: #ff0000; #00ff00;`

**When** transformed

**Then** both hex colors are replaced and no text is duplicated or lost.
Output: `color: oklch(...); oklch(...);`

---

### TC13 — Bulk copy accuracy

**Given** CSS with `a { color: red; } b { color: #00f; }` (non-color text between matches)

**When** transformed

**Then** the exact text `a { color: `, `; } b { color: `, `; }` is preserved verbatim
between the replaced colors. Output: `a { color: oklch(...); } b { color: oklch(...); }`

---

### TC14 — Performance: scan-heavy CSS throughput

**Given** a 50 KB CSS file with 500+ legacy colors (mix of hex, rgb, hsl, named)

**When** benchmarked with `npm run bench`

**Then** mixed colors transform achieves ≥ 1,500 ops/s (≥ 2× baseline of 759 ops/s)

---

### TC15 — Performance: modern-only CSS (no regression)

**Given** a 50 KB CSS file with zero legacy colors (all oklch/modern)

**When** benchmarked with `npm run bench`

**Then** no-colors fast path achieves ≥ 8,900 ops/s (no regression vs 8,927 ops/s baseline)

---

### TC16 — Edge: empty input

**Given** empty string input

**When** transformed

**Then** output is empty string

**When** audited

**Then** all counts are zero
(Existing test: `empty_input`)

---

### TC17 — Edge: very long non-CSS text

**Given** a 100 KB string with no legacy color indicators (plain text, prose)

**When** transformed

**Then** fast path bail-out triggers, output is identical to input, completes in < 1 ms

---

### TC18 — Edge: 100+ colors in single line

**Given** a single line of CSS with 100+ colors: `a { color: red; color: #00f; color: rgb(0,255,0); ... }`

**When** transformed

**Then** all colors are replaced, output line is correct, no buffer overflow or truncation

---

### TC19 — Pre-scan comment range with gradient

**Given** CSS with `/* comment */ linear-gradient(red, blue)`

**When** transformed

**Then** the block comment is skipped, the gradient is detected by AC match,
inner colors are replaced via byte-walk

---

### TC20 — oklch-ignore pragma preserved

**Given** CSS with `#ff0000; /* oklch-ignore */`

**When** transformed

**Then** the color on the oklch-ignore line is kept unchanged
(Existing test: `oklch_ignore_pragma`)
