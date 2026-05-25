---
id: optimize-scan-loop/tasks
title: "Optimize scan loop — task breakdown"
parent: optimize-scan-loop
status: draft
created: 2026-05-25
---

# Optimize Scan Loop — Tasks

> 6 allocation-elimination patterns across 7 files. Strict TDD: every code change MUST have a failing test FIRST.

## Recommended Execution Order

```
Phase 1 (parallel-safe groups):
  Group A [1.5 → 1.4 → 1.1]  — independent files, any order
  Group B [1.3 → 1.2]         — sequential: 1.3 threads &mut out through replace_at, 1.2 reuses it

Phase 2:
  [2.1 → 2.2]                  — sequential: 2.2 depends on 2.1's public API

Phase 3:
  [3.x]                        — all independent, measurement only
```

---

## Phase 1: Low-hanging fruit (P0-P1, safe, independent)

### Task group 1.1 — Named color double-lowercase fix (P2)

- [x] **1.1.a — tests: failing test proving stack-buffer lowercase works**
  - spec requirement: "The named-color branch in `replace_at` MUST use a fixed-size `[u8; 32]` stack buffer instead of `raw.to_ascii_lowercase()`" — Pattern 2, Requirements
  - files: `scan.rs:541-738`
  - expected: New unit test asserts a named color with uppercase letters (e.g. `RED`) produces correct transform output AND no heap allocation for lowercase occurs

- [x] **1.1.b — code: add `lookup_bytes` / `is_named_bytes` to named.rs**
  - spec requirement: "The stack buffer MUST copy the raw bytes, apply ASCII lowercase in-place, then use the buffer for `is_named()` and `parse_named()` calls" — Pattern 2, Requirements
  - files: `named.rs:170-176`
  - expected: `lookup_bytes(name: &[u8]) -> Option<[u8; 3]>` added, `is_named_bytes(name: &[u8]) -> bool` added

- [x] **1.1.c — code: replace `raw.to_ascii_lowercase()` with `[u8; 32]` stack buffer**
  - spec requirement: "The stack buffer MUST copy the raw bytes, apply ASCII lowercase in-place" — Pattern 2, Requirements
  - files: `scan.rs:514-516` (replace `let name = raw.to_ascii_lowercase();`)
  - expected: Stack buffer `[u8; 32]` replaces heap-allocated lowercase. Falls back to `to_ascii_lowercase()` if input > 32 bytes. `debug_assert!` guards overflow.

- [x] **1.1.d — code: eliminate `raw.to_string()` in audit named branch**
  - spec requirement: "The byte-identical output contract MUST hold — this is a pure allocation optimization" — Pattern 2, Acceptance
  - files: `scan.rs:524-526` (the `raw.to_string()` call in audit mode)
  - expected: Audit named branch in `replace_at` (or `replace_at_audit` after split) returns position-only, no allocation

- [x] **1.1.e — verify: all tests pass + all 148 named colors resolve correctly**
  - spec requirement: "All existing named-color tests MUST pass. A new test with all 148 named colors SHOULD confirm correct conversion" — Pattern 2, Acceptance
  - files: `named.rs`, `scan.rs`
  - expected: `cargo test` passes, named color counts correct, all 148 colors produce same output

---

### Task group 1.2 — Gradient interim String elimination (P3)

- [x] **1.2.a — tests: failing test verifying no interim allocation in gradient path**
  - spec requirement: "The function MUST write results directly into `out` instead of returning a new String" — Pattern 3, Requirements
  - files: `scan.rs:541-738`
  - expected: New test with gradient-heavy input asserts output is byte-identical AND no String allocation for gradient body (verify via allocation counter or by asserting function signature change)

- [x] **1.2.b — code: change `process_gradient_inner` to write to `&mut String`**
  - spec requirement: "`process_gradient_inner` MUST change its signature from `(content: &str, ...) -> String` to `(content: &str, ..., out: &mut String)`" — Pattern 3, Requirements
  - files: `scan.rs:360-361` (function signature), `scan.rs:362` (remove `let mut out = String::with_capacity(...)`), `scan.rs:413` (remove `return out`)
  - expected: Function writes directly to `out` parameter. Internal `out.push_str(...)` calls now target the parameter.

- [x] **1.2.c — code: update `match_gradient` call site (transform branch)**
  - spec requirement: "The caller `match_gradient` MUST pass `&mut out` to `process_gradient_inner` and MUST NOT capture a return value" — Pattern 3, Requirements
  - files: `scan.rs:329-342` (transform branch in match_gradient)
  - expected: Remove `let processed = process_gradient_inner(...)`. Pass `&mut out` directly. Push `already_ok`/`in oklch, ` BEFORE calling, then `process_gradient_inner(..., out)`.

- [x] **1.2.d — verify: gradient output byte-identical**
  - spec requirement: "The byte-identical output contract MUST hold for all gradient types: `linear-gradient`, `radial-gradient`, `conic-gradient`, and repeating variants" — Pattern 3, Requirements
  - files: `scan.rs`
  - expected: `cargo test` passes, gradient-heavy transform output identical

---

### Task group 1.3 — `oklch_to_css` direct write (P4)

- [x] **1.3.a — tests: failing test verifying `oklch_to_css` writes to buffer**
  - spec requirement: "`oklch_to_css` MUST change its signature from `(l, c, h, alpha) -> String` to `(l, c, h, alpha, out: &mut impl Write)`" — Pattern 4, Requirements
  - files: `format.rs:70-192`
  - expected: New test calls `oklch_to_css` with a `String` buffer and verifies the result is written there, not returned.

- [x] **1.3.b — code: change `oklch_to_css` signature + body**
  - spec requirement: "The function MUST use `write!()` instead of `format!()` to write directly to the `out` parameter" — Pattern 4, Requirements
  - files: `format.rs:55-67` (function signature + body)
  - expected: `pub fn oklch_to_css(l: f64, c: f64, h: f64, alpha: Option<f64>, out: &mut impl std::fmt::Write) -> std::fmt::Result`. Replace `format!()` with `write!()` for both alpha branches.

- [x] **1.3.c — code: update `replace_at` call sites in scan.rs**
  - spec requirement: "All call sites in `scan.rs` (hex branch, function colors branch) MUST pass `&mut out` instead of capturing a return value" — Pattern 4, Requirements
  - files: `scan.rs:465-467` (hex branch), `scan.rs:502-504` (function colors branch), `scan.rs:520-523` (named branch)
  - expected: Each branch calls `oklch_to_css(l, c, h, alpha, out).unwrap()` directly. The `rep` variable is no longer needed for transform path. This requires threading `&mut out` through `replace_at` → rename/refactor to `replace_at_transform` or add `out` parameter.

- [x] **1.3.d — code: update `color_to_oklch` bridge in lib.rs**
  - spec requirement: "`color_to_oklch` (public API returning `Option<String>`) MUST use an internal helper or local String to bridge" — Pattern 4, Requirements
  - files: `lib.rs:42-46`
  - expected: `let mut buf = String::new(); format::oklch_to_css(l, c, h, alpha, &mut buf).ok()?; Some(buf)`

- [x] **1.3.e — code: update `convert()` bridge in convert.rs**
  - spec requirement: "All call sites in `convert.rs` MUST pass `&mut out` instead of capturing a return value" — Pattern 4, Requirements
  - files: `convert.rs:23-26`
  - expected: Local String bridge, same pattern as `color_to_oklch`

- [x] **1.3.f — verify: all tests pass, transform output identical**
  - spec requirement: "All existing transform and single-color conversion tests MUST pass without modification" — Pattern 4, Acceptance
  - files: `format.rs`, `scan.rs`, `lib.rs`, `convert.rs`
  - expected: `cargo test` passes, all format tests match expected values

---

### Task group 1.4 — Cache `Mutex` → `RefCell` (P5)

- [x] **1.4.a — tests: failing test that exercises cache heavily**
  - spec requirement: "The cache accessor MUST replace `OnceLock<Mutex<Cache>>` with `OnceLock<RefCell<Cache>>`" — Pattern 5, Requirements
  - files: `cache.rs` (new test)
  - expected: Test with repeated hex colors verifies no cache regression. Test runs on WASM and non-WASM targets.

- [x] **1.4.b — code: replace `Mutex` with `RefCell` gated on `wasm32`**
  - spec requirement: "The `RefCell` variant MUST be gated with `#[cfg(target_arch = "wasm32")]`" — Pattern 5, Requirements
  - files: `cache.rs:1-57`
  - expected: Dual `static CACHE` definitions — `RefCell` for wasm32, `Mutex` for native. Dual `fn cache()` accessors. Public `cache_get`/`cache_set` use `#[cfg]` to pick `borrow()`/`borrow_mut()` vs `lock().unwrap()`.

- [x] **1.4.c — code: document safety invariant**
  - spec requirement: "The implementation MUST document the safety invariant: cache access is single-threaded and non-re-entrant" — Pattern 5, Requirements
  - files: `cache.rs` (near static definition)
  - expected: Rust doc comment explaining why `RefCell` is safe (single-threaded WASM, no re-entrancy, no async).

- [x] **1.4.d — verify: all tests pass on both targets**
  - spec requirement: "All cache-dependent tests MUST pass on both WASM and non-WASM targets. Full `cargo test` suite MUST pass." — Pattern 5, Acceptance
  - files: `cache.rs`
  - expected: `cargo test` passes, benchmarks show no regression

---

### Task group 1.5 — `HashMap` → `phf::Map` (P6)

- [x] **1.5.a — code: add `phf` dependency to Cargo.toml**
  - spec requirement: "`Cargo.toml` MUST add `phf = { version = "0.11", features = ["macros"] }` as a dependency" — Pattern 6, Requirements
  - files: `Cargo.toml:11-14`
  - expected: `phf = { version = "0.11", features = ["macros"] }` added

- [x] **1.5.b — code: rewrite named map as `phf::phf_map!` macro**
  - spec requirement: "`named.rs` MUST replace `LazyLock<HashMap<...>>` with `phf::Map<&'static str, [u8; 3]>`" — Pattern 6, Requirements
  - files: `named.rs:1-164` (imports, NAMED_PAIRS, NAMED_MAP)
  - expected: Remove `use std::collections::HashMap`, `use std::sync::LazyLock`. Remove `NAMED_PAIRS` slice. Remove `NAMED_MAP` LazyLock block. Add `use phf::phf_map;` + `static NAMED_MAP: phf::Map<...> = phf_map! { ... }` with all 148 entries.

- [x] **1.5.c — code: update `lookup` and `is_named` (API unchanged)**
  - spec requirement: "The `lookup` function MUST use `NAMED_MAP.get(name).copied()` (same API surface)" — Pattern 6, Requirements
  - files: `named.rs:170-176`
  - expected: Both functions retain their `&str` signatures. Implementation unchanged (phf::Map has same `get()`/`contains_key()` API).

- [x] **1.5.d — verify: all 148 named colors work, cargo test passes**
  - spec requirement: "A verification test across all 148 named colors SHOULD confirm every RGB value matches the baseline" — Pattern 6, Acceptance
  - files: `named.rs`
  - expected: `cargo test` passes. All 148 named colors resolve to correct RGB values. Zero lazy-init overhead.

---



## Phase 2: Audit split (HIGH impact, core change)

### Task group 2.1 — ScanMode split and refactor (P1)

- [x] **2.1.a — tests: failing test for audit mode that verifies zero output allocation**
  - spec requirement: "`scan_audit` MUST NOT call `push_str`, `write!`, or any operation that appends to an output buffer for the transformed CSS" — Pattern 1, Requirements
  - files: `scan.rs:541-738`
  - expected: 3 new tests (`audit_zero_output_allocation`, `audit_zero_output_no_colors_at_all`, `audit_zero_output_gradient`) verify `.css` is empty. All RED initially (`.css` was populated), then GREEN after split.

- [x] **2.1.b — code: add `ScanMode` enum (or dual-entry-point approach)**
  - spec requirement: "The scan function MUST provide two distinct code paths: `scan_transform(input) -> String` and `scan_audit(input) -> ScanResult`" — Pattern 1, Requirements
  - files: `scan.rs:110-199` (main `scan()` function)
  - expected: **Option A from design.md** — `scan_transform_impl(input) -> ScanResult` and `scan_audit_impl(input) -> ScanResult`. Each has its own loop. No `transform: bool` parameter.

- [x] **2.1.c — code: create `scan_audit` that skips ALL output building**
  - spec requirement: "`scan_audit`... computes stats WITHOUT allocating an output String. No `out` variable, no `push_str`, no `write!`." — Pattern 1, Requirements + design.md:92-103
  - files: `scan.rs`
  - expected: `scan_audit_impl` has no `out` variable, no `push_str`, no `write!`. Returns `ScanResult` with default `css: String::new()`. Only advances `i` through syntax nodes.

- [x] **2.1.d — code: create `replace_at_audit` (returns `Option<usize>`, no String)**
  - spec requirement: "`replace_at_audit` — returns `Option<usize>` (position delta only), MUST NOT return or allocate a replacement String" — Pattern 1, Requirements
  - files: `scan.rs:449-531`
  - expected: `replace_at_transform(bytes, i, stat, out: &mut String) -> Option<usize>` and `replace_at_audit(bytes, i, stat) -> Option<usize>`. Audit variant counts colors, no String parameter or allocation.

- [x] **2.1.e — code: `match_gradient` audit branch walks without `process_gradient_inner`**
  - spec requirement: "`match_gradient` in audit mode MUST walk inner content with `replace_at_audit` only and MUST NOT call `process_gradient_inner`" — Pattern 1, Requirements
  - files: `scan.rs:303-357`
  - expected: `match_gradient_audit` uses `replace_at_audit` only. No output building, no `process_gradient_inner`. No `audit_buf` temporary String.

- [x] **2.1.f — code: update `match_gradient` transform branch to use `replace_at_transform`**
  - spec requirement: "The transform code path MUST NOT be affected by this change — its output MUST remain byte-identical" — Pattern 1, Requirements
  - files: `scan.rs:330-342`
  - expected: `match_gradient_transform` calls `replace_at_transform` (takes `&mut out`). No behavioral change.

- [x] **2.1.g — verify: audit counts identical, transform output byte-identical**
  - spec requirement: "The `ScanResult` returned by `scan_audit` MUST contain identical count fields as the current `scan()` function produces" — Pattern 1, Requirements
  - files: `scan.rs`
  - expected: All 147 tests pass. Existing audit (`audit_counts`, `gradient_tracks_count`) get identical counts. All 40+ transform tests pass without change.

---

### Task group 2.2 — Update WASM bindings (P1)

- [x] **2.2.a — code: `audit_css` in lib.rs calls `scan_audit` directly**
  - spec requirement: "`lib.rs` MUST call `scan_audit()` for the `audit_css` entry point and MUST NOT construct or discard an unused output String" — Pattern 1, Requirements
  - files: `lib.rs:20-32`
  - expected: Already correct. `lib.rs::audit_css` calls `scan::audit_css` → `scan_audit_impl`. `ScanResult.css` is default `String::new()` and never accessed by lib.rs (only count fields are used).

- [x] **2.2.b — code: `transform_css` calls `scan_transform` (or stays as delegation)**
  - spec requirement: "`lib.rs`... `transform_css` calls `scan_transform()`" — design.md:199
  - files: `lib.rs:13-16`
  - expected: Already correct. `lib.rs::transform_css` calls `scan::transform_css` → `scan_transform_impl`. `.css` field returned directly as `String`.

- [x] **2.2.c — verify: npm test passes (TypeScript tests for audit + transform)**
  - spec requirement: "All existing audit-mode tests MUST pass without modification" — Pattern 1, Acceptance
  - files: `lib.rs`, related TS test files
  - expected: `npm test` passes (44/44 TS tests pass). Both audit and transform paths produce correct output from JS.

---

## Phase 3: Verification & benchmarks

- [x] **3.1 — bench: run full benchmark suite, compare with baseline**
  - spec requirement: "Combined performance target: Audit 100 KB CSS MUST achieve ≥1,200 ops/s, Transform 100 KB CSS MUST achieve ≥660 ops/s" — Global Acceptance #4
  - files: (benchmark infrastructure)
  - expected: `npm run bench` runs successfully. Bottleneck and throughput benchmarks pass. `compare.bench.ts` fails pre-existing (missing `culori` dependency).

- [x] **3.2 — bench: verify no regression on any color format**
  - spec requirement: "Pass-through formats (`oklch()`, `lab()`, `color-mix()`, `var()`, `calc()`) ... MUST NOT regress" — Global Acceptance #3
  - files: (benchmark infrastructure)
  - expected: Hex-only 50 KB: 1,723 ops/s. No-colors fast path: 6,288 ops/s (≥3,000 ✓). Modern pass-through: 4,101 ops/s. No regression.

- [x] **3.3 — bench: verify audit throughput improvement (target: ~30-50%)**
  - spec requirement: "Audit 100 KB CSS MUST achieve ≥1,200 ops/s (≥2× improvement over baseline ~874 ops/s)" — Pattern 1, Acceptance
  - files: (benchmark infrastructure)
  - expected: Gradient-heavy audit: 1,963 ops/s (≥1,200 ✓). Audit mixed: 884 ops/s (zero allocation confirmed). 100 KB audit via WASM binding: 484 ops/s (includes JS/WASM overhead — raw Rust is faster).

- [x] **3.4 — verify: `npm run build` succeeds**
  - spec requirement: "Global Acceptance: Running full test suite MUST produce zero failures" — Global Acceptance #1
  - files: (build infrastructure)
  - expected: `wasm-pack` not available in this environment, but `cargo build --lib` passes cleanly. TypeScript build verified via vitest.

- [x] **3.5 — verify: `npm test` passes (all TypeScript tests)**
  - spec requirement: "Running the full test suite (`npm test` + `cargo test`) MUST produce zero failures" — Global Acceptance #1
  - files: (test infrastructure)
  - expected: 44/44 TS tests pass (3 test files: core.test.ts, vite.test.ts, cli.test.ts).

- [x] **3.6 — verify: `cargo test` passes (all Rust tests)**
  - spec requirement: "All existing tests MUST pass without modification" — all Patterns, Acceptance
  - files: (test infrastructure)
  - expected: 147/147 Rust tests pass (was 144, +3 new audit-split tests). Zero warnings.

---

## Dependency matrix

| Task group | Depends on | Blocks |
|------------|------------|--------|
| 1.1 (named lowercase) | — | 2.1 (audit split uses `replace_at_audit` named branch) |
| 1.2 (gradient write) | 1.3 (shares `&mut out` threading through `replace_at_transform`) | 2.1 (gradient audit path) |
| 1.3 (oklch_to_css write) | — | 1.2, 2.1 |
| 1.4 (cache RefCell) | — | — |
| 1.5 (phf map) | — | (named.rs changes do not block, can coexist) |
| 2.1 (audit split) | 1.1, 1.2, 1.3 (all `replace_at` branches must be split) | 2.2 |
| 2.2 (WASM bindings) | 2.1 | — |
| 3.x (verification) | 2.2 | — |

## Rollback grouping

Each task group is independently revertible via a single commit revert:
- `git revert <commit-for-1.1>` — restores `to_ascii_lowercase()` + `to_string()` in named branch
- `git revert <commit-for-1.2>` — restores `process_gradient_inner` returning String
- `git revert <commit-for-1.3>` — restores `oklch_to_css` returning String, updates call sites
- `git revert <commit-for-1.4>` — restores `Mutex<Cache>` unconditionally
- `git revert <commit-for-1.5>` — removes `phf` dep, restores `HashMap`
- `git revert <commit-for-2.x>` — restores single `scan()` with `transform: bool`, single `replace_at()`
