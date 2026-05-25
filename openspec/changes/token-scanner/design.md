# Token Scanner — Technical Design

> Change: `token-scanner`
> Phase: Design
> Status: DRAFT

## 1. Architecture

The core idea: **replace the per-byte main loop with a single Aho-Corasick automaton that detects all legacy colour indicators in one linear pass**. The main loop becomes match-driven instead of byte-driven.

```
┌─────────────────────────────────────────────────────────┐
│                    SCAN_AHO (LazyLock)                   │
│  Single AhoCorasick automaton with ALL patterns:         │
│    • "#" (hex), "rgb(", "rgba(", "hsl(", "hsla(",       │
│      "hwb(", "color("  (functional prefixes)            │
│    • 6 gradient names with "(" suffix                    │
│    • 148 named colours (case-insensitive)                │
│  MatchKind::Standard, ascii_case_insensitive(true)       │
└───────────────────────┬─────────────────────────────────┘
                        │ find_iter(bytes)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    Main Loop (match-driven)               │
│                                                          │
│  cursor = 0                                              │
│  for each match from SCAN_AHO.find_iter(bytes):          │
│    if match.start() < cursor → skip (safety guard)       │
│    if in_skip_range(match.start()) → skip (comment/str)  │
│    if named && !word_boundary_check → skip                │
│    bulk_copy(cursor..match.start()) → push_str            │
│    process_match(bytes, match) → cursor = match.end()    │
│                                                          │
│  bulk_copy(cursor..end) → push_str (tail)               │
└─────────────────────────────────────────────────────────┘
```

### Static automaton

Replace the existing `FUNC_FINDERS` (6× `memmem::Finder`) and `named::NAMED_AC` with a **single `SCAN_AHO`** static that combines ALL patterns:

```rust
static SCAN_AHO: LazyLock<AhoCorasick> = LazyLock::new(|| {
    let mut patterns: Vec<&[u8]> = Vec::with_capacity(1 + 6 + 6 + 148);
    patterns.push(b"#");
    patterns.extend_from_slice(&[b"rgb(", b"rgba(", b"hsl(", b"hsla(", b"hwb(", b"color("]);
    patterns.extend_from_slice(GRADIENT_PATTERNS);  // 6 gradient names
    patterns.extend(NAMED_PAIRS.iter().map(|(n, _)| n.as_bytes()));  // 148 named
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .match_kind(MatchKind::Standard)
        .build(patterns)
        .expect("valid SCAN_AHO patterns")
});
```

The existing `named::NAMED_AC` is kept for `color_to_oklch` and standalone named-color lookup (not part of the scan loop). `named::has_named()` and `named::count_named()` are replaced by the unified automaton.

### How matches drive the main loop

The AC automaton yields `Match { start: usize, end: usize, pattern: usize }`. The `pattern` index identifies WHICH pattern matched, used to dispatch to the correct handler:

| pattern index range | Kind | Handler |
|---|---|---|
| 0 | hex (`#`) | `try_hex_match(bytes, pos)` |
| 1–6 | function prefix | `try_func_match(bytes, pos)` |
| 7–12 | gradient prefix | `try_gradient_match(bytes, pos, out, stat)` |
| 13–160 | named colour | `try_named_match(bytes, pos, stat, out)` |

A `PatternIndex` enum or const-array dispatch maps pattern indices to handler variants via a match-free jump table:

```rust
#[repr(u8)]
enum MatchKind { Hex, FuncRgb, FuncHsl, FuncHwb, FuncColor, Gradient(u8), Named(u16) }
```

Actual dispatch: a const `[Slice<i8>; 161]` indexed by AC pattern ID → function pointer or enum tag. The overhead is one branch per match regardless of pattern count.

## 2. Module structure

### scan.rs — changes

| Change | Detail |
|--------|--------|
| **Remove** | `FUNC_FINDERS` static (6× memmem::Finder) |
| **Add** | `SCAN_AHO` static (single unified AhoCorasick) |
| **Add** | `SkipRange` type, `pre_scan_skip_ranges()` function |
| **Modify** | `has_legacy_indicators()` → use `SCAN_AHO.is_match(bytes)` |
| **Modify** | `count_legacy_indicators()` → use `SCAN_AHO.find_iter(bytes).count()` for hex, combined. Compute hex count separately via memchr (`bytes.iter().filter(\|&\| b == b'#').count()`) for capacity estimation. |
| **Replace** | `scan_transform_impl` main loop body (byte-walk → match-driven) |
| **Replace** | `scan_audit_impl` main loop body (same replacement) |
| **Keep** | `process_gradient_inner`, `match_gradient_transform`, `match_gradient_audit`, `find_close_paren`, `in_value_context`, `is_word_boundary`, `skip_whitespace`, `skip_alpha`, `hex_digit_count`, `func_color_type`, `named_at`, `replace_at_transform`, `replace_at_audit`, `find_ignore_ranges` — all untouched |
| **Add** | `fn try_hex_match(bytes, i)`, `fn try_func_match(bytes, i)`, `fn try_named_match(bytes, i)` — thin wrappers that call the existing `replace_at_*` logic |
| **Remove** | `has_named()`, `count_named()` calls → replaced by unified AC |

### named.rs — changes

| Change | Detail |
|--------|--------|
| **Keep** | `NAMED_AC` static (used by `color_to_oklch`, `has_named`, `count_named` outside scan) |
| **Keep** | `lookup`, `is_named`, `lookup_bytes`, `is_named_bytes` — all remain |
| **Keep** | `NAMED_MAP` phf map — all remains |
| **No changes** | All existing tests pass without modification |

## 3. Key types

```rust
/// A range of bytes that must be skipped during scanning (comments, strings).
#[derive(Debug, Clone, Copy)]
struct Span {
    start: usize,
    end: usize,
}

/// Pre-computed skip ranges for false-positive suppression.
/// Stored in two vecs for simpler binary-search logic.
struct SkipRanges {
    spans: Vec<Span>,  // sorted by start, non-overlapping, non-adjacent
}

impl SkipRanges {
    /// O(log n) check: is `pos` inside any skip range?
    fn contains(&self, pos: usize) -> bool {
        // binary search by start, check if pos < range.end
        self.spans
            .binary_search_by(|s| s.start.cmp(&pos).then(s.end.cmp(&pos)))
            .is_ok()
    }
}
```

### Overlap invariants

- `SkipRanges` spans are **non-overlapping** (mutually exclusive) and **non-adjacent**: there is always at least 1 character between the end of one span and the start of the next.
- This means `binary_search_by_key(pos, |s| s.start)` with `Err(idx)` gives the predecessor directly, so a simple `idx > 0 && pos < spans[idx-1].end` check works. No interval tree needed.

### ColorCandidate — internal representation after a match

```rust
struct ColorCandidate {
    /// Range of the raw colour text in the input.
    range: std::ops::Range<usize>,
    /// Which kind of colour matched.
    kind: MatchKind,
    /// For named colours: the matched slice (for extraction).
    matched: &'static [u8],
}
```

Used only transiently within the loop — not stored across iterations.

## 4. Data flow

### Fast bail-out path (no legacy indicators)

1. Check `SCAN_AHO.is_match(bytes)` — one linear scan of the automaton
2. If false AND no `oklch-ignore` marker: return input unchanged
3. Cost: identical to current `has_legacy_indicators()` (replaces 3 separate scans with 1)

```
has_ignore ← bytes.windows(12).any("oklch-ignore")
ok = !has_ignore && !SCAN_AHO.is_match(bytes)
if ok → return input unchanged
```

### Normal path (transform)

```
1. Pre-scan skip ranges (comments+strings) unless fast-path
2. Pre-compute output capacity: memchr count for '#', SCAN_AHO count for total
3. Allocate out with capacity
4. Main loop:
   for match in SCAN_AHO.find_iter(bytes):
     if match.start() < cursor → continue          // overlap guard
     if skip_ranges.contains(match.start()) → continue  // false positive
     if is_named_pattern(match.pattern()) {
       if !is_word_boundary(bytes, match.start()) → continue
     }
     // bulk-copy text between cursor and match
     if cursor < match.start() {
       out.push_str(&input[cursor..match.start()])
     }
     // dispatch match
     cursor = dispatch_and_process(bytes, match, &mut stat, &mut out)
5. Tail copy: out.push_str(&input[cursor..])
```

### Audit path

Identical loop, but `dispatch_and_process` calls the audit versions (no output). The `out` buffer is never allocated in audit mode — we either skip the entire allocation or use `std::mem::take` to start with an empty string.

```
1. Pre-scan skip ranges (unless fast-path)
2. stat = ScanResult::default()
3. Same main loop, but dispatch uses replace_at_audit (no out buffer)
4. Return stat (result.css stays empty String)
```

## 5. AC automaton design

### Pattern set (161 patterns total)

| Category | Patterns | Count | Notes |
|---|---|---|---|
| Hex | `#` | 1 | Single byte, fastest possible AC pattern |
| Functional prefixes | `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `color(` | 6 | Include the opening `(` to avoid matching "rgb" in `rgba` |
| Gradient names | `linear-gradient(`, `radial-gradient(`, `conic-gradient(`, `repeating-linear-gradient(`, `repeating-radial-gradient(`, `repeating-conic-gradient(` | 6 | Include `(` to match exactly at the function call |
| Named colors | All 148 CSS named colors (lowercase in patterns, `ascii_case_insensitive` handles matching) | 148 | e.g. `red`, `rebeccapurple`, `transparent` is NOT a named color so not included |

**Total: 161 patterns**

### MatchKind::Standard vs LeftmostFirst

| Property | Standard (default) | LeftmostFirst |
|---|---|---|
| Matching behaviour | Reports **all** non-overlapping matches in left-to-right order; prefers **longest** match when multiple match at same position | Reports **first** match found by the automaton at each position (depth-first traversal order) |
| Overlap at same position | Longest pattern wins (e.g. `#` vs `red` → both reported if non-overlapping) | First match in pattern list wins at same position |
| Impact on hex `#` conflicts | `#` is 1 byte — any longer pattern starting at same position would have already consumed it | If `#` is listed before named colors, `#` always wins at position collision |
| Recommendation | **Standard** — matches current behavior where hex `#` and named colors are independent. The match loop handles overlap with cursor guard anyway. | Not needed — cursor guard is sufficient. |

**Decision: `MatchKind::Standard`**. It's the default, produces intuitive left-to-right matches, and the cursor guard handles any overlaps. `LeftmostFirst` would make match order depend on pattern registration order, which is brittle.

### ascii_case_insensitive(true)

Required for named colours: "RED", "Red", "rebeccapurple" must all match the lowercase patterns. The flag is ASCII-only — CSS named colors are all ASCII. It adds ~1–2 KB to the DFA but eliminates the need for case normalization at match time.

### DFA vs NFA

| Property | DFA (default) | NFA |
|---|---|---|
| Memory per automaton | Larger (pre-computed transition table) | Smaller (per-byte state traversal) |
| Throughput | ~1 instruction per byte | ~5–10 instructions per byte |
| Build time | Slower (powerset construction) | Faster |
| Pattern count scaling | State explosion risk at ~200+ patterns | Linear scaling |
| Binary size | Larger (transition table in .rodata) | Smaller |

**Decision: Use the default DFA**. The `aho-corasick` crate's `AhoCorasick::builder()` defaults to DFA when `MatchKind::Standard` is used. For 161 patterns over ASCII text, the DFA's transition table is well within the < 10 KB binary size budget (estimated increase: ~4–7 KB). If binary size is a concern in testing, switch to NFA (`.dfa(false)`) at a throughput cost.

### Pattern definition

```rust
static SCAN_AHO: LazyLock<AhoCorasick> = LazyLock::new(|| {
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .match_kind(MatchKind::Standard)
        .build(SCAN_PATTERNS)
        .expect("valid SCAN_AHO patterns")
});
```

Where `SCAN_PATTERNS` is a `Vec<&[u8]>` constructed at init time from:
- `b"#"`
- `b"rgb("`, `b"rgba("`, `b"hsl("`, `b"hsla("`, `b"hwb("`, `b"color("`
- 6 gradient name patterns
- `named::NAMED_PAIRS.iter().map(|(name, _)| name.as_bytes())`

This makes the pattern list data-driven from the existing `NAMED_PAIRS`, ensuring named colours stay in sync.

Pattern indices are mapped to handlers via a const array:

```rust
const PATTERN_KINDS: &[MatchKind] = &[
    MatchKind::Hex,           // 0: "#"
    MatchKind::FuncRgb,       // 1: "rgb("
    MatchKind::FuncRgb,       // 2: "rgba("
    MatchKind::FuncHsl,       // 3: "hsl("
    MatchKind::FuncHsl,       // 4: "hsla("
    MatchKind::FuncHwb,       // 5: "hwb("
    MatchKind::FuncColor,     // 6: "color("
    MatchKind::Grad(0),       // 7: "linear-gradient("
    MatchKind::Grad(1),       // 8: "radial-gradient("
    MatchKind::Grad(2),       // 9: "conic-gradient("
    MatchKind::Grad(3),       // 10: "repeating-linear-gradient("
    MatchKind::Grad(4),       // 11: "repeating-radial-gradient("
    MatchKind::Grad(5),       // 12: "repeating-conic-gradient("
    // Named colours: indices 13..=160
    MatchKind::Named,         // 13..=160
];
```

## 6. Skip range pre-scan

### Detection

A single O(n) pre-scan finds all comment and string ranges:

```rust
fn pre_scan_skip_ranges(bytes: &[u8]) -> SkipRanges {
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                let start = i;
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 < bytes.len() { i += 2; } else { i = bytes.len(); }
                spans.push(Span { start, end: i });
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                let start = i;
                while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
                spans.push(Span { start, end: i });
            }
            b'"' | b'\'' => {
                let q = bytes[i];
                let start = i;
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' { i += 2; }
                    else if bytes[i] == q { i += 1; break; }
                    else { i += 1; }
                }
                // Unterminated: entire rest of input is the string range
                spans.push(Span { start, end: i });
            }
            _ => { i += 1; }
        }
    }
    SkipRanges { spans }
}
```

### Data structure for O(log n) lookup

`SkipRanges` with binary search:

```rust
impl SkipRanges {
    fn contains(&self, pos: usize) -> bool {
        let idx = self.spans.binary_search_by_key(&pos, |s| s.start);
        match idx {
            Ok(_) => true,               // exact match at start of a span
            Err(0) => false,             // before all spans
            Err(i) => pos < self.spans[i - 1].end,  // inside predecessor span?
        }
    }
}
```

Since spans are non-overlapping and non-adjacent, this is correct:
- `Err(i)` means `spans[i-1].start < pos < spans[i].start`
- If `pos < spans[i-1].end`, it's inside the span; otherwise between spans
- Also check the degenerate case where `pos` is after the last span: `Err(spans.len())` → `pos < spans[last].end` check.

**Alternative: Linear cursor walk.** Since the main loop is already processing matches sequentially, a cursor-based check (advance a pointer through the skip ranges as the match cursor moves forward) avoids the binary search overhead entirely:

```rust
// In main loop, as a side-by-side cursor:
let mut sk_idx = 0;
// When checking a match at `pos`:
while sk_idx < skip.spans.len() && skip.spans[sk_idx].end <= pos {
    sk_idx += 1;  // advance past ranges we've passed
}
if sk_idx < skip.spans.len() && pos >= skip.spans[sk_idx].start {
    // inside current skip range
    // optionally: advance cursor to skip.spans[sk_idx].end to skip ahead
}
```

**Decision: Cursor walk.** Binary search is O(log n) per match with n ≤ total comment/string ranges (usually < 20 for typical CSS). Cursor walk is O(1) amortized — the pointer only advances forward. With both approaches being simple, the cursor walk is preferred for its zero-allocation and predictable branch pattern.

### When the pre-scan is skipped

The pre-scan for skip ranges is only done when `SCAN_AHO.is_match(bytes)` returns true — i.e., when there IS legacy content to scan. On the fast path (no legacy indicators), the function returns early with the input unchanged.

The pre-scan also runs even when named colours match but no `#` or function prefix is found, since named colour detection still needs false positive suppression.

In the **audit path**, the skip range pre-scan is also performed (comments and strings can contain named colours that should not be counted). This is consistent with the current behavior where audit also walks through comments/strings.

## 7. Gradient inner content

Gradient inner content keeps the **existing byte-walk** (`process_gradient_inner`). Rationale:

- Gradient bodies are small: typically 1–20 colours per gradient
- The dominant cost is parse+math in the colour conversions, not the scan loop
- Converting gradient inner content to AC-driven would add complexity without measurable throughput gain (confirmed by NFR1 targets: gradient-heavy only needs 1.3×)
- The existing `process_gradient_inner` already handles comments, strings, and modern function recursion correctly

When the AC automaton matches a gradient pattern (e.g. `linear-gradient(` at index 7–12), the handler:

1. Finds the matching `)` via `find_close_paren`
2. Extracts the inner slice: `&bytes[pos+1..close]`
3. Calls existing `process_gradient_inner(inner_s, stat, out)` for transform, or the equivalent byte-walk for audit
4. Returns `close + 1` as the new cursor position

The gradient name and opening `(` are bulk-copied along with the between-match text (or in the handler itself).

## 8. Cursor management

### Cursor invariant

The `cursor` variable always points to the first byte NOT yet processed (not yet copied to output). The main loop body is:

```rust
let mut cursor = 0;
let mut sk_idx = 0;

for m in SCAN_AHO.find_iter(bytes) {
    // Overlap guard: AC should NOT produce overlapping matches with
    // MatchKind::Standard, but be defensive.
    if m.start() < cursor { continue; }

    // False positive suppression via skip ranges (cursor walk)
    while sk_idx < skip.spans.len() && skip.spans[sk_idx].end <= m.start() {
        sk_idx += 1;
    }
    if sk_idx < skip.spans.len() && m.start() >= skip.spans[sk_idx].start {
        // Match is inside a comment/string — skip it.
        // But we still need to pass through the span on the output.
        // The bulk copy below handles this.
        let span_end = skip.spans[sk_idx].end;
        if cursor < m.start() {
            out.push_str(&input[cursor..m.start()]);
        }
        cursor = span_end;
        continue;
    }

    // Word boundary check for named matches only
    if is_named_pattern(m.pattern()) {
        if !is_word_boundary(bytes, m.start()) { continue; }
    }

    // Bulk copy between-match text
    if cursor < m.start() {
        out.push_str(&input[cursor..m.start()]);
    }

    // Process the match (transform or audit)
    cursor = process_match(bytes, m, &mut stat, &mut out);
}

// Tail copy
if cursor < len {
    out.push_str(&input[cursor..]);
}
```

### Overlap prevention

`MatchKind::Standard` in `aho-corasick` already guarantees non-overlapping matches in left-to-right order. The `m.start() < cursor` check is a **safety guard** for:
1. Skip range advancement (when we were inside a skip range, we may have just advanced cursor past the skip range end — AC could still yield a match that starts inside the span)
2. Future-proofing for pattern modifications

### Text between matches

Bulk copy uses `String::push_str(&input[cursor..m.start()])` — a single slice copy (~1 branch) instead of the current per-byte `push` (~7 branches/byte + char boundary checks). This is the primary throughput improvement.

## 9. Error handling

### When a match doesn't lead to a valid colour

The `process_match` function calls into the existing parsing/math pipeline. If parsing fails (e.g. `#xyz` not a valid hex, `rgb(invalid...)`), the function signals failure and the main loop handles it:

```rust
fn process_match(bytes: &[u8], m: &Match, stat: &mut ScanResult, out: &mut String) -> usize {
    let kind = PATTERN_KINDS[m.pattern()];
    match kind {
        MatchKind::Hex => {
            // Try to parse hex; if invalid, move cursor past '#' + any hex digits
            let hex_end = try_hex(bytes, m.start(), stat, out);
            hex_end.unwrap_or(m.start() + 1)  // advance past '#' at minimum
        }
        MatchKind::FuncRgb => {
            // Try rgb/rgba; if invalid, return match.end() (past the prefix)
            // The function body parsing is inside the existing logic
            try_function(bytes, m.start(), m.end(), "rgb", stat, out)
                .unwrap_or(m.end())
        }
        // ... similar for other kinds
        MatchKind::Named => {
            if try_named(bytes, m.start(), m.end(), stat, out) {
                m.end()
            } else {
                m.start() + 1  // advance past first char of the "name"
            }
        }
        MatchKind::Grad(idx) => {
            try_gradient(bytes, m.start(), m.end(), idx, stat, out)
                .unwrap_or(m.end())
        }
    }
}
```

**Key principle**: Never fail silently or skip bytes. When a match doesn't produce a valid colour, the cursor advances by at minimum 1 byte (or to `m.end()` for function prefixes) to avoid infinite loops. The unmatched bytes are left as-is in the output.

The original text is always preserved on failure — `process_match` only writes to `out` when a *valid* colour is detected. Failed matches fall through to the next iteration where they'll be included in the next bulk copy (cursor is placed before them, so they're copied verbatim).

**This guarantees zero behavioral changes**: false positive AC matches are handled identically to how the current byte loop handles non-colour bytes.

## 10. Migration path

### Step 1 — Add SCAN_AHO alongside existing code

Add `SCAN_AHO` static, `SkipRanges`, and `try_*_match` wrappers. Modify `has_legacy_indicators()` to use the new unified automaton. All existing tests continue to pass because the main loop is unchanged.

### Step 2 — Rewrite main loop body (transform)

Replace the byte-walk in `scan_transform_impl` with the AC-driven loop. Keep ALL helper functions (`process_gradient_inner`, `find_close_paren`, `replace_at_transform`, etc.) unchanged. All 147 tests must pass.

### Step 3 — Rewrite main loop body (audit)

Replace the byte-walk in `scan_audit_impl` with the same AC-driven loop (no output). Same tests pass.

### Step 4 — Cleanup

- Remove `FUNC_FINDERS` static
- Remove `FUNC_FINDERS` references
- Remove `named::has_named()` / `named::count_named()` from the scan path (keep them in named.rs for `color_to_oklch`)

### Step 5 — Bench and verify

Run `npm run bench` to verify throughput targets (NFR1). Run `npm test` to verify all 147 tests pass. Compare WASM binary size.

### Rollback

The old code can be recovered via `git checkout packages/core-wasm/src/scan.rs`. No other files are changed.

### Test strategy

All existing tests must pass without modification. Key scenarios that specifically exercise the AC-driven path:

| Test | What it validates |
|------|-------------------|
| `transform_hex_6` | Hex match → transform → output contains oklch |
| `transform_rgb` | Function match → transform |
| `transform_named_uppercase` | Case-insensitive named match |
| `ignore_id_selector` | `#myId` passes hex digit count check (3+ valid hex) or not |
| `ignore_comment` | Skip range for `/* ... */` suppresses match |
| `string_content_untouched` | Skip range for strings suppresses match |
| `oklch_ignore_pragma` | `oklch-ignore` line-skip still works (unchanged logic) |
| `gradient_injects_oklch` | Gradient AC match → inner byte-walk |
| `audit_counts` | AC-driven loop correctly counts in audit mode |
| `empty_input` | Zero-length fast path |
| `multiple_colors_in_line` | Multiple AC matches processed in sequence, no overlap |
| `preserved_modern_unchanged` | Fast path handles modern CSS |

No new tests are required. The existing tests provide full coverage of the behavioral contract.

### Benchmark preservation

Existing benchmarks in `bench/` (vitest-based, TypeScript) are untouched by this change — they call the WASM API which delegates to the Rust implementation. Running `npm run bench` before and after verifies throughput targets.

---

## Appendix: Performance model

### Throughput analysis

| Operation | Current cost (per byte) | New cost (per byte) |
|---|---|---|
| Byte-walk dispatch | ~7 branches + ~50 instructions | 0 (removed) |
| AC automaton scan | ~1–2 instructions per byte (DFA) | ~1–2 instructions per byte (DFA) |
| Skip range check | 0 (inline in byte-walk) | ~1 branch per match (cursor walk) |
| Text copy | 1 `push(byte)` per byte (O(n)) | 1 `push_str(slice)` per chunk (O(chunks)) |

**Primary gain**: Replacing per-byte `push()` with per-chunk `push_str()` eliminates the ~7 branches/byte dispatch, the UTF-8 char boundary check on every byte, and the per-byte capacity check in `String::push`.

**Secondary gain**: The AC automaton scan is linear in input length with very low constant factor. The current prescan (`has_legacy_indicators`) already does a similar scan, so the total work is comparable.

### Binary size estimate

| Component | Size (approx) |
|---|---|
| AC DFA transition table (161 patterns, ASCII range) | ~5–7 KB |
| Skip range pre-scan code | ~0.5 KB |
| Main loop rewrite | ~0.5 KB |
| Removed: FUNC_FINDERS (6× Finder + memchr) | ~-2 KB |
| Removed: memchr pre-scan calls | ~-0.5 KB |
| **Net increase** | **~3–6 KB** |

Well within the < 10 KB budget.
