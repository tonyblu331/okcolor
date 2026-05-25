---
id: optimize-scan-loop
title: "Optimize scan loop — eliminate wasteful allocations"
status: proposal
created: 2026-05-25
---

# Optimize Scan Loop

## Intent

The scan loop (`scan.rs`) is the hottest code path in okcolor. Profiling data from `sdd-init` shows the loop costs ~7 branches/byte for CSS with legacy colors, with **String allocation** being the dominant overhead — not parsing or math.

This change eliminates every **provably unnecessary allocation** in the scan loop, targeting a **~30-50% reduction in audit time** and **~10-15% improvement in transform throughput** without changing the scanner architecture or introducing risky refactors.

**User impact:** faster `okcolor audit` and `okcolor check` CI gates, snappier builds for large CSS files. No observable behavioral changes — output is byte-identical.

## Scope

### IN scope (6 patterns)

| # | Pattern | Priority | Target mode | Expected gain |
|---|---------|----------|-------------|---------------|
| 1 | Split scan into `scan_transform` / `scan_audit` | P0 | Audit | ~30-50% audit time reduction |
| 2 | Named color stack-buffer lowercase | P1 | Both | 1 fewer allocation per named color |
| 3 | `process_gradient_inner` accept `&mut String` | P2 | Transform | 1 fewer allocation per gradient |
| 4 | `oklch_to_css` accept `&mut impl Write` | P2 | Transform | 1 fewer allocation per color |
| 5 | Cache `Mutex` → `RefCell` | P3 | Both | Atomic barrier removed per cache hit |
| 6 | Named `HashMap` → `phf::Map` | P3 | Both | Zero runtime hashing cost |

### OUT scope

- **Token-based scanner** — defer to separate change (high risk, high reward)
- **Find-then-verify scan architecture** — defer to separate change
- **Output size precomputation** — marginal gain, defer
- **Pre-scan pre-allocation** — cherry on top
- **`in_value_context` optimization** — independent, can be done anywhere
- **Comment/string helper extraction** — maintainability only

## Approach

### P1: Audit mode output elimination

**Problem:** The single `scan()` function always builds `out: String`, even in audit mode. At `scan.rs:194`, `stat.css = out` stores a full output String that `lib.rs` never reads (audit returns JSON from stat counters only). Additionally, `replace_at(..., transform=false)` at lines 466-469, 505-507, 519-526 still allocates replacement Strings (`format!("#{}")`, `input_slice()`, `raw.to_string()`) that are immediately discarded.

**What changes:**
- Split `scan()` into `scan_transform(input) -> String` and `scan_audit(input) -> ScanResult`.
- `scan_audit` skips all `out` buffer operations — no `push_str`, no `String::with_capacity`.
- `replace_at` is split into `replace_at_transform` (returns `(usize, String)`) and `replace_at_audit` (returns `Option<usize>`, returns no String).
- The audit variant of `match_gradient` no longer calls `process_gradient_inner` (which builds a String) — instead it walks inner content with `replace_at_audit` only (already the pattern at lines 345-352, but currently still pushes to `out`).

**Files affected:**
- `packages/core-wasm/src/scan.rs` — major restructure of `scan()`, `replace_at()`, `match_gradient()`.
- `packages/core-wasm/src/lib.rs` — calls `scan_audit()` instead of `scan()` for `audit_css`.

**Tradeoffs considered:**
- Duplicated logic between transform/audit paths is acceptable because audit mode's control flow is strictly a subset of transform mode (it skips all output building). A macro or closure could reduce duplication, but inlining makes the hot path easier to optimize for the compiler.
- The `match_gradient` audit path (lines 345-352) already does this correctly — the proposal just formalizes the split at the function level.

**Performance expectation:**
- Eliminates ~50% of all allocations in audit mode (the full output String + per-color replacement Strings). Expected ~1.5-2× audit throughput improvement, consistent with the spec target of ~2× audit speed (P0 pattern).

### P1: Named color stack-buffer lowercase

**Problem:** `scan.rs:515` calls `raw.to_ascii_lowercase()` which allocates a new `String`. The longest named color is ~18 bytes — well within stack buffer territory.

**What changes:**
- Replace `raw.to_ascii_lowercase()` with a fixed-size `[u8; 32]` stack buffer that copies the bytes and lowercases them in-place.
- Use `core::str::from_utf8` on the stack buffer for the `is_named()` check and `parse_named()` call.

**Files affected:**
- `packages/core-wasm/src/scan.rs` — replace 3 lines in `replace_at()` named-color branch.

**Tradeoffs considered:**
- Stack buffer size (32) covers all 148 named colors with room to spare.
- Edge case: if input has > 32 alpha chars at a word boundary (impossible for CSS named colors, but defensive check needed).

**Performance expectation:**
- Zero heap allocations per named color instead of 1. Named colors are the least common format (~5-10% of legacy colors in typical CSS), so absolute gain is modest (~1-2% of total time). Minimal risk.

### P2: Gradient interim String elimination

**Problem:** `process_gradient_inner` (line 360) returns `String`. The caller `match_gradient` (line 331) then pushes that String into `out`. This means: (a) an interim String is allocated for the gradient body, (b) the content is copied into `out`, (c) the interim String is dropped.

**What changes:**
- Change `process_gradient_inner` signature from `(content: &str, ...) -> String` to `(content: &str, ..., out: &mut String)`.
- Replace `return out` with nothing — results are pushed directly into `out`.
- Update call site in `match_gradient` to pass `&mut out` instead of capturing return value.

**Files affected:**
- `packages/core-wasm/src/scan.rs` — `process_gradient_inner` function and call site.
- `match_gradient` needs the `out` reference available — it already has one.

**Tradeoffs considered:**
- Could also return a `Cow<'static, str>` for gradient bodies with no colors (fast path). Not worth the complexity for now.
- The `already_ok` branch (line 336-337) and `in oklch` injection branch (339-341) both push to `out` before the processed content — this becomes seamless with `&mut out`.

**Performance expectation:**
- 1 fewer allocation per gradient. For files with 50+ gradients (themed design systems), this adds up. ~10-15% reduction in gradient-heavy file processing.

### P2: `oklch_to_css` direct write

**Problem:** `oklch_to_css` (line 55) uses `format!()` which allocates a new `String`. Every color in transform mode calls this once. The caller at line 467 (`replace_at` hex branch) and lines 503-504 (function colors) then push the result into `out`.

**What changes:**
- Change `oklch_to_css` signature from `(l, c, h, alpha) -> String` to `(l, c, h, alpha, out: &mut impl Write)`.
- Replace `format!()` with `write!()` calls.
- Update call sites to pass `&mut out` instead of capturing return value.

**Files affected:**
- `packages/core-wasm/src/format.rs` — `oklch_to_css` function.
- `packages/core-wasm/src/scan.rs` — call sites in `replace_at`.
- `packages/core-wasm/src/lib.rs` — `color_to_oklch` and `convert_color` call `oklch_to_css` too.
- `packages/core-wasm/src/convert.rs` — may call `oklch_to_css`.

**Tradeoffs considered:**
- `&mut impl Write` is more general than `&mut String`, allowing flexibility for callers.
- The `color_to_oklch` function in `lib.rs` currently returns `Option<String>` — it would need a private helper that writes to a local String (or change its return strategy).
- This is a mechanical change: `format!("oklch({l_rounded}% {c_rounded} {h_rounded})")` → `write!(out, "oklch({l_rounded}% {c_rounded} {h_rounded})")`.

**Performance expectation:**
- 1 fewer allocation per color in transform mode. For a 100 KB mixed CSS file with ~200 colors, that's 200 allocations eliminated. ~3-5% transform throughput improvement, consistent with spec target.

### P3: Cache `Mutex` → `RefCell`

**Problem:** `cache.rs:45` uses `OnceLock<Mutex<Cache>>`. In WASM (single-threaded), every cache `get/set` acquires and releases a Mutex — atomic operations are not free, even without contention.

**What changes:**
- Replace `Mutex<Cache>` with `RefCell<Cache>` inside a `OnceLock`.
- Cache access changes from `cache().lock().unwrap().get(...)` to `cache().borrow().get(...)` (panics on re-entrancy — but cache is never re-entered in practice).
- Alternatively, use `std::cell::UnsafeCell` with a safe wrapper and a documented safety invariant (only called from the single WASM thread).

**Files affected:**
- `packages/core-wasm/src/cache.rs` — type and accessors.

**Tradeoffs considered:**
- `RefCell` panics on double-borrow (runtime check). Safe in practice since no re-entrancy exists. `UnsafeCell` is faster but requires `unsafe` — acceptable with clear safety comment.
- This is WASM-only. If okcolor ever runs in multi-threaded Rust (e.g., CLI with rayon), this breaks. Mitigation: `#[cfg(target_arch = "wasm32")]` for the RefCell variant, fall through to Mutex for native.
- Performance gain is small (~1-3% of transform time) because the hot path is the scan loop, not cache lookups.

**Performance expectation:**
- Atomic acquire/release removed per cache hit (every hex color). ~1-3% total transform time improvement.

### P3: Named `HashMap` → `phf::Map`

**Problem:** `named.rs:158` uses `HashMap<&'static str, [u8; 3]>` with `LazyLock` initialization. Every lookup computes a runtime hash. The `phf` crate provides compile-time perfect hashing with zero runtime overhead.

**What changes:**
- Add `phf` dependency to `Cargo.toml`.
- Replace `LazyLock<HashMap<...>>` with `phf::Map<&'static str, [u8; 3]>`.
- Remove the `LazyLock` and `HashMap` import.
- `lookup` and `is_named` become simple map lookups with no lazy init.

**Files affected:**
- `packages/core-wasm/Cargo.toml` — add `phf = { version = "0.11", features = ["macros"] }`.
- `packages/core-wasm/src/named.rs` — replace data structure.

**Tradeoffs considered:**
- `phf` adds a build-time dependency. It's a well-established crate (used by rustc itself for Unicode tables).
- WASM compatibility: `phf` is pure Rust, no platform deps — works everywhere.
- Binary size: `phf::Map` embeds a perfect-hash table, which may be slightly larger than `HashMap`'s runtime-allocated table. But it also removes the `HashMap` code from the WASM binary, which may be a net size reduction.
- The `NAMED_MAP` HashMap is only ~2KB (148 entries). Even with runtime hashing, the absolute cost is negligible. The value is mostly in removing `LazyLock` initialization cost on first access and simplifying the code.

**Performance expectation:**
- Zero runtime hashing + zero lazy-init overhead. Probably a wash in absolute terms (< 1% of total time), but a code simplification win.

## Rollback Plan

Each pattern is independently revertible. If a pattern causes issues:

1. **Audit split**: Revert to single `scan(input, transform)`. The old API is still present and working.
2. **Stack-buffer lowercase**: Revert to `to_ascii_lowercase()`. Identical behavior.
3. **Gradient direct write**: Revert `process_gradient_inner` signature. Call site changes are mechanical.
4. **`oklch_to_css` direct write**: Revert signature. Change call sites back to capture + push.
5. **Cache `RefCell`**: Revert to `Mutex`. Simple 5-line change.
6. **`phf::Map`**: Revert to `HashMap`. Remove `phf` dep from Cargo.toml.

**Recommended revert order (worst-case):** If all patterns fail, revert the entire commit. Each pattern is additive — there are no cross-cutting dependency issues that prevent partial revert.

## Dependencies

### Execution order (recommended)

The patterns can be implemented independently but have a **suggested order** to minimize merge conflicts:

```
P1a: Named stack-buffer lowercase    ← no deps, quick win
P3a: HashMap → phf::Map             ← no deps, mechanical
P2a: oklch_to_css direct write      ← changes format.rs + many call sites
P2b: Gradient direct write           ← changes scan.rs (touches process_gradient_inner)
P1b: Audit mode split                ← changes scan.rs heavily (do last)
P3b: Cache Mutex → RefCell          ← no deps, isolated
```

### Parallelizable groups

The following groups can be done in parallel by different developers:
- **Group A**: Named stack-buffer + `phf::Map` + Cache → all independent files.
- **Group B**: `oklch_to_css` + Gradient write → both touch `scan.rs` call sites, best done sequentially.
- **Group C**: Audit split → standalone, touches `scan.rs` and `lib.rs`.

## Risks

| Pattern | Risk | Mitigation |
|---------|------|------------|
| Audit split (P1) | **Medium** — logic duplication could introduce drift between transform/audit paths. Missing a code path in audit that's in transform could silently undercount. | Keep a single internal `scan_body()` that both paths call for shared logic (comment/string walking). Only the color-handling branches differ. Cargo test checks audit counts against known inputs. |
| Named lowercase (P1) | **Low** — edge case: named color with > 32 chars (impossible but defensive check needed). | Add `debug_assert!` for buffer size. Fall back to dynamic allocation if overflow. |
| Gradient write (P2) | **Low** — mechanical API change. | All existing tests pass without modification since output is identical. |
| `oklch_to_css` write (P2) | **Low** — `write!()` can fail (std::fmt::Error). | `.unwrap()` is safe with String writes (infallible). For `&mut impl Write`, callers must handle errors. |
| Cache `RefCell` (P3) | **Low-medium** — `RefCell` panics on double-borrow. Not `Send` (breaks multi-thread). | Safe because WASM is single-threaded. Gate with `#[cfg(target_arch = "wasm32")]`. |
| `phf::Map` (P3) | **Low** — new dependency, `phf` compile-time macro. | `phf` is widely used. If issues arise, revert to HashMap — trivial change. |

### Non-risks (patterns that look risky but aren't)

- **Audit split does NOT change any output** — the JSON format in `lib.rs` reads the same `ScanResult` fields. Only the internal allocation behavior changes.
- **None of these patterns change the CSS output** — transform mode output is byte-identical before and after.
