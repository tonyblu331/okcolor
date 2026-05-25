# Token Scanner — Task Checklist

> Change: `token-scanner`
> Phase: Tasks
> Total: 17 tasks across 4 groups

## Dependencies

```
T1.1 ─┬─ T1.2 ─┐
      └─ T1.3 ─┤         ┌─ T3.1 ─┬─ T4.1 ─┐
               ├─ T3.x ──┤        │         ├─ T4.2
T2.1 ── T2.2 ──┘        ├─ T3.2 ─┤         │
      └─ T2.3 ──────────┘  ... ──┘         ├─ T4.3
                                            ├─ T4.4
                                            ├─ T4.5
                                            └─ T4.6
```

**Verification independence**: T ✓ = independently verifiable (specific test), T ⚡ = only verifiable after full change or benchmark.

---

## Task Group 1: AC Automaton Setup (foundational)

### T1.1 — Define `SCAN_AHO` static with 161 patterns
- **Depends on**: nothing
- **Verify**: ✓ independently (unit test: `SCAN_AHO.find_iter(b"#ff0000").count() == 1`)
- **Work**:
  1. Make `named::NAMED_PAIRS` `pub(crate)` (currently `const` in `named.rs:7`)
  2. Construct `SCAN_AHO` in `scan.rs` as a `static LazyLock<AhoCorasick>`
  3. Build pattern vector:
     - `b"#"` (index 0, hex)
     - `b"rgb("`, `b"rgba("`, `b"hsl("`, `b"hsla("`, `b"hwb("`, `b"color("` (indices 1–6, func prefixes)
     - Gradient patterns from `GRADIENT_NAMES` with `b"("` appended (indices 7–12)
     - Named colour bytes from `named::NAMED_PAIRS` (indices 13–160)
  4. Config: `.ascii_case_insensitive(true).match_kind(MatchKind::Standard)` (DFA default)
  5. Define `MatchKind` enum and `PATTERN_KINDS: &[MatchKind; 161]` dispatch table
  6. **File**: `named.rs` (make NAMED_PAIRS visible) + `scan.rs` (new static)

### T1.2 — Replace `has_legacy_indicators` with `SCAN_AHO.is_match()`
- **Depends on**: T1.1
- **Verify**: ✓ independently (test: `has_legacy_indicators(b"color: red;") == true`, `has_legacy_indicators(b"oklch(50% 0.2 180)") == false`)
- **Work**:
  1. Remove individual calls to `memchr(b'#')`, `FUNC_FINDERS.iter().any(...)`, `named::has_named()`
  2. Single call: `SCAN_AHO.is_match(bytes)`
  3. Remove `FUNC_FINDERS` static (dead now)
  4. Remove `use memchr::{memchr, memchr_iter, memmem};` (only `memchr_iter` may remain for T1.3)
  5. **File**: `scan.rs`

### T1.3 — Replace `count_legacy_indicators` with AC-based counting
- **Depends on**: T1.1
- **Verify**: ✓ independently (test: confirm count bounds are still conservative upper bounds)
- **Work**:
  1. Compute hex count via `memchr_iter(b'#', bytes).count()` (kept for fast hex-only counting)
  2. Compute total match count via `SCAN_AHO.find_iter(bytes).count()`
  3. `(hex, total - hex)` as estimate (conservative upper bound is fine — over-allocate by at most a few bytes)
  4. Note: `FUNC_FINDERS` iteration removed, `named::count_named()` removed
  5. **File**: `scan.rs`

---

## Task Group 2: Skip Range Pre-scan (parallel with T1.x)

### T2.1 — Implement `SkipRanges` type and `pre_scan_skip_ranges()`
- **Depends on**: nothing
- **Verify**: ✓ independently (test: `pre_scan_skip_ranges(b"/* comment */")` covers `0..14`, `pre_scan_skip_ranges(b"\"string\"")` covers `0..8`)
- **Work**:
  1. Define `#[derive(Debug, Clone)] struct Span { start: usize, end: usize }`
  2. Define `struct SkipRanges { spans: Vec<Span> }`
  3. Implement `SkipRanges::contains(&self, pos: usize) -> bool` with cursor walk (not binary search — per design decision, cursor walk is O(1) amortized)
  4. The walk uses `&mut sk_idx: usize` passed from the main loop, advancing forward through spans

### T2.2 — Handle all comment/string cases
- **Depends on**: T2.1
- **Verify**: ✓ independently (test each: block comment, line comment, string, escaped quote, unterminated string)
- **Work**:
  1. `/* ... */` — scan for `*/`; unterminated → span to end
  2. `// ... \n` — scan to newline or end
  3. `"..."` / `'...'` — handle `\\` escapes, unterminated → span to end
  4. **Edge cases**: adjacent spans (non-overlapping, non-adjacent invariant), empty comments, consecutive strings
  5. **File**: `scan.rs` (new function block)

### T2.3 — Hook pre-scan into scan loop entry points
- **Depends on**: T2.2
- **Verify**: ⚡ only after full change (integrated behavior)
- **Work**:
  1. In both `scan_transform_impl` and `scan_audit_impl`: call `pre_scan_skip_ranges()` only when `SCAN_AHO.is_match()` is true (fast path skips pre-scan entirely)
  2. Pass `&SkipRanges` to the main loop as a check for each AC match
  3. **File**: `scan.rs`

---

## Task Group 3: Match-Driven Scan Loop (depends on T1.x + T2.x)

### T3.1 — Implement AC-driven `scan_transform_impl`
- **Depends on**: T1.1, T1.2, T1.3, T2.3
- **Verify**: ⚡ all existing transform tests must pass
- **Work**: Replace byte-by-byte `while i < len` loop with:
  ```rust
  let mut cursor = 0;
  let mut sk_idx = 0;
  for m in SCAN_AHO.find_iter(bytes) {
      if m.start() < cursor { continue; }           // overlap guard
      // skip range check via cursor walk (T2.x)
      // word boundary check for named patterns
      // bulk copy: out.push_str(&input[cursor..m.start()])
      // dispatch via PATTERN_KINDS[m.pattern()] → cursor
  }
  // tail copy: out.push_str(&input[cursor..])
  ```
  - The `oklch-ignore` line skipping is handled before the loop (keep `find_ignore_ranges` as-is)
  - Bulk copy replaces per-byte `push(bytes[i] as char)`
  - **Dispatch per match kind**:
    - **Hex (index 0)**: call existing `replace_at_transform` logic (hex path) — it already handles hex from `bytes[i] == b'#'` 
    - **Func (indices 1–6)**: call existing `replace_at_transform` func path
    - **Named (indices 13–160)**: call existing `replace_at_transform` named path (but skip the `named_at` boundary scan since AC already found the match; still need word boundary check)
    - **Gradient (indices 7–12)**: call existing gradient logic — bulk-copy gradient name + `(` to output, call `process_gradient_inner`
  - Keep `process_gradient_inner`, `replace_at_transform`, `find_close_paren`, `in_value_context`, `is_word_boundary` untouched
  - **File**: `scan.rs` (main loop rewrite)

### T3.2 — Implement AC-driven `scan_audit_impl`
- **Depends on**: T1.1, T1.2, T2.3
- **Verify**: ⚡ all existing audit tests must pass
- **Work**: Same AC-driven loop as T3.1 but:
  - No `out` buffer allocation (or `String::new()` minimal buffer)
  - Dispatch calls `replace_at_audit` instead of `replace_at_transform`
  - Gradient dispatch calls `match_gradient_audit` instead of `match_gradient_transform`
  - Tail copy is skipped (no output)
  - **File**: `scan.rs`

### T3.3 — Bulk copy between matches with `push_str`
- **Depends on**: T3.1
- **Verify**: ✓ independently already covered by T3.1 tests
- **Work**: 
  - The `for m in SCAN_AHO.find_iter(bytes)` loop body starts with `out.push_str(&input[cursor..m.start()])`
  - No per-byte `push(char)` needed between matches
  - All non-match text is copied in `O(chunks)` instead of `O(bytes)` 
  - **File**: `scan.rs` (inline in main loop)

### T3.4 — Dispatch to existing `replace_at_transform`/`replace_at_audit` per match
- **Depends on**: T3.1, T3.2
- **Verify**: ✓ independently (test each: hex match → transform ok, rgb match → transform ok, named match with word boundary → transform ok, named match without boundary → skip)
- **Work**:
  1. `PATTERN_KINDS[m.pattern()]` gives `MatchKind` variant
  2. Match on `MatchKind::Hex` → call hex branch of `replace_at_transform` (pass `m.start()`, `m.end()`)
  3. Match on `MatchKind::FuncRgb | FuncHsl | FuncHwb | FuncColor` → call func branch
  4. Match on `MatchKind::Named` → call named branch (with pre-verified word boundary)
  5. For **named colours**: the AC match gives `m.start()..m.end()` but the actual name might extend beyond the matched pattern (e.g. AC matches "red" but input has "rebeccapurple"). Need to handle: check `is_word_boundary` at `m.start()`, then rely on existing `named_at` / `skip_alpha` to find the full name boundary, then look up via `named::is_named` / `parse_named_lowered`.
  6. **File**: `scan.rs` (dispatch table + `process_match` function)

### T3.5 — Gradient detection via AC match
- **Depends on**: T3.1
- **Verify**: ✓ independently (test: `linear-gradient(red, blue)` → AC match at pattern index 7 → dispatches to gradient handler → output contains `in oklch`)
- **Work**:
  1. When `PATTERN_KINDS[m.pattern()]` is `MatchKind::Grad(idx)`, extract gradient name from `bytes[m.start()..m.end() - 1]` (strip `(`)
  2. Find `)` via `find_close_paren(bytes, m.end() - 1)`
  3. Extract inner slice
  4. Call existing gradient logic: bulk-copy gradient name, push `(`, optionally inject `in oklch, `, call `process_gradient_inner`, push `)`
  5. Return `close + 1` as new cursor
  6. **Note**: the AC matches the gradient name *with* `(` suffix, so `m.end()` is after the `(` — the gradient handler needs `m.start()` to extract the gradient name exclusively
  7. **File**: `scan.rs` (dispatch + gradient match handler)

---

## Task Group 4: Cleanup & Verification

### T4.1 — Remove dead code
- **Depends on**: T3.1, T3.2
- **Verify**: ✓ independently (compilation check — `cargo build` succeeds with no warnings)
- **Work**:
  1. Remove `FUNC_FINDERS` static
  2. Remove `use memchr::{memchr, memmem}` — keep `memchr_iter` if still used in T1.3
  3. Remove `has_legacy_indicators` function body (or redirect to `SCAN_AHO.is_match`)
  5. Confirm no `#[allow(dead_code)]` needed for surviving functions
  6. **File**: `scan.rs`

### T4.2 — Run full Rust test suite
- **Depends on**: T4.1
- **Verify**: ⚡ all 147 Rust tests pass
- **Command**: `cargo test` in `packages/core-wasm/`
- **Action**: Fix any regressions. Key edge cases:
  - `ignore_id_selector` (#myId prefix → not a colour)
  - `string_content_untouched` (#ff0000 in string → not modified)
  - `gradient_does_not_double_inject` (already has `in oklch` → no double injection)
  - `multiple_colors_in_line` (both red and #00f → both transformed)

### T4.3 — Run npm test suite
- **Depends on**: T4.2
- **Verify**: ⚡ all 44 TS tests pass
- **Command**: `npm test` in project root
- **Action**: Fix WASM binding regressions if any

### T4.4 — Run benchmarks
- **Depends on**: T4.3
- **Verify**: ⚡ ≥2× improvement on scan-heavy workloads
- **Action**: Run `npm run bench` before/after. Compare:
  - Scan-heavy workload (many legacy colours): expected 2–4×
  - Gradient-heavy workload: expected ≥1.3×
  - Modern-only (fast path): expected no regression
  - If target not met: optimize (consider NFA mode, inline hot paths)

### T4.5 — Check WASM binary size
- **Depends on**: T4.3
- **Verify**: ⚡ increase < 10 KB compared to baseline
- **Action**: `wasm-pack build --release`, compare `.wasm` sizes. If > 10 KB increase:
  - Switch to NFA (`.dfa(false)`) on SCAN_AHO
  - Or review pattern set for redundancy
  - Or remove `memchr` dependency entirely if `SCAN_AHO` subsumes it

### T4.6 — `cargo clippy` clean, no unsafe
- **Depends on**: T4.1
- **Verify**: ✓ independently (clippy passes with no warnings, grep for `unsafe` returns only known FFI in other files)
- **Command**: `cargo clippy --all-targets`
- **Action**: Ensure zero `unsafe` blocks in scan.rs (design requires this). Fix any clippy warnings.

---

## Summary

| Group | Tasks | Independent verification | Full-change verification |
|-------|-------|------------------------|-------------------------|
| T1: AC Setup | 3 | T1.1, T1.2, T1.3 | — |
| T2: Skip Range | 3 | T2.1, T2.2 | T2.3 |
| T3: Main Loop | 5 | T3.4 standalone, T3.5 standalone | T3.1, T3.2, T3.3 |
| T4: Cleanup | 6 | T4.1, T4.6 | T4.2, T4.3, T4.4, T4.5 |
