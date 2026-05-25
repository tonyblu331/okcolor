---
id: optimize-scan-loop/performance
title: "Optimize scan loop — delta spec"
parent: optimization-goals
status: draft
created: 2026-05-25
---

# Optimize Scan Loop — Delta Spec

> Delta spec for the 6 allocation-elimination patterns detailed in `proposal.md`.
> References performance targets from `openspec/specs/optimization-goals/spec.md:30-37`.
> Behavioral contract: output MUST be byte-identical in transform mode, and audit counts MUST be identical before and after.

---

## Pattern 1: Audit mode output elimination

### Requirements

The scan function MUST provide two distinct code paths:
  - `scan_transform(input) -> String` — builds the full transformed output (current behavior).
  - `scan_audit(input) -> ScanResult` — computes stats WITHOUT allocating an output String.

`scan_audit` MUST NOT call `push_str`, `write!`, or any operation that appends to an output buffer for the transformed CSS.

`replace_at` MUST be split into:
  - `replace_at_transform` — returns `(usize, String)` as today.
  - `replace_at_audit` — returns `Option<usize>` (position delta only), MUST NOT return or allocate a replacement String.

`match_gradient` in audit mode MUST walk inner content with `replace_at_audit` only and MUST NOT call `process_gradient_inner`.

The `ScanResult` returned by `scan_audit` MUST contain identical count fields (`total`, `converted`, `skipped`, etc.) as the current `scan()` function produces.

`lib.rs` MUST call `scan_audit()` for the `audit_css` entry point and MUST NOT construct or discard an unused output String.

The transform code path (`scan_transform`) MUST NOT be affected by this change — its output MUST remain byte-identical to the current implementation.

### Scenarios

**Scenario 1: Audit mode returns correct counts with no output**
Given a CSS string containing 10 legacy colors
When `scan_audit` is called
Then the returned `ScanResult.total` MUST equal 10
And the function MUST NOT allocate a String for transformed output

**Scenario 2: Transform mode unchanged**
Given a CSS string with legacy colors
When `scan_transform` is called
Then the returned String MUST be byte-identical to the current `scan(input, transform=true)` output

**Scenario 3: Audit mode with gradients**
Given a CSS string containing `linear-gradient(...)` with 4 legacy colors inside
When `scan_audit` is called
Then the returned `ScanResult.total` MUST equal 4
And `match_gradient` MUST walk the gradient body without calling `process_gradient_inner`

**Scenario 4: No-legacy-color fast path**
Given a CSS string with zero legacy colors (all `oklch()` or pass-through)
When `scan_audit` is called
Then the returned `ScanResult.total` MUST equal 0
And the function MUST complete without entering any color-processing branches

### Acceptance criteria

**Tests:** All existing audit-mode tests MUST pass without modification. No test SHOULD fail due to the function signature change.

**Benchmarks:** `audit 100 KB CSS` MUST achieve ≥1,200 ops/s (≥2× improvement over baseline ~874 ops/s from `optimization-goals/spec.md:54`). The transform benchmark MUST NOT regress below 600 ops/s.

---

## Pattern 2: Named color stack-buffer lowercase

### Requirements

The named-color branch in `replace_at` MUST use a fixed-size `[u8; 32]` stack buffer instead of `raw.to_ascii_lowercase()` to avoid heap allocation.

The stack buffer MUST copy the raw bytes, apply ASCII lowercase in-place, then use `core::str::from_utf8` on the buffer for the `is_named()` and `parse_named()` calls.

The implementation MUST include a fallback: if the raw input exceeds 32 bytes at the color boundary, it MUST fall back to dynamic allocation (heap-allocated `String::to_ascii_lowercase()`).

The fallback MUST be gated by an explicit `debug_assert!(raw.len() <= 32)` to catch violations in debug builds.

The byte-identical output contract MUST hold — this is a pure allocation optimization with zero observable behavior change.

### Scenarios

**Scenario 1: Named color in transform mode**
Given a CSS string containing `color: red;`
When `scan_transform` is called
Then the output MUST contain the OKLCH equivalent of `red`
And the allocation for lowercase conversion MUST be a stack buffer, not a heap String

**Scenario 2: Named color in audit mode**
Given a CSS string containing `color: blue;`
When `scan_audit` is called
Then the count for named colors MUST increment correctly
And zero heap allocations for lowercase conversion MUST occur (the audit path uses the same `replace_at` split)

**Scenario 3: Input exceeding stack buffer size**
Given a CSS input with a 33+ byte word at a color boundary (non-CSS input, malformed)
When `replace_at` processes it
Then it MUST NOT panic
And it MUST fall back to heap-allocated lowercase

### Acceptance criteria

**Tests:** All existing named-color tests MUST pass. A new test with all 148 named colors SHOULD confirm correct conversion.

**Benchmarks:** Named-color throughput MUST NOT regress. The overall transform benchmark MUST show no measurable regression (expected gain is <1% of total time per `proposal.md:79`).

---

## Pattern 3: Gradient interim String elimination

### Requirements

`process_gradient_inner` MUST change its signature from `(content: &str, ...) -> String` to `(content: &str, ..., out: &mut String)`.

The function MUST write results directly into `out` instead of returning a new String.

The caller `match_gradient` MUST pass `&mut out` to `process_gradient_inner` and MUST NOT capture a return value.

The `already_oklch` branch (no colors to convert inside gradient) MUST push the original content to `out` directly — no interim String is needed.

The byte-identical output contract MUST hold for all gradient types: `linear-gradient`, `radial-gradient`, `conic-gradient`, and repeating variants.

### Scenarios

**Scenario 1: Gradient with mixed colors in transform mode**
Given a CSS string containing `linear-gradient(45deg, red, #ff0, oklch(60% 0.15 180))`
When `scan_transform` is called
Then the output gradient MUST have `red` and `#ff0` converted to OKLCH, `oklch(...)` preserved as-is
And the output MUST be byte-identical to the current implementation

**Scenario 2: Gradient with zero legacy colors (already OKLCH)**
Given a CSS string containing `linear-gradient(45deg, oklch(50% 0.2 120), oklch(70% 0.1 200))`
When `scan_transform` is called
Then `process_gradient_inner` MUST push the gradient body directly without transformation
And zero heap allocations for gradient processing MUST occur

**Scenario 3: Multiple gradients in one file**
Given a CSS string containing 100 `linear-gradient(...)` calls each with 2 legacy colors
When `scan_transform` is called
Then the output MUST be byte-identical to the current implementation
And 100 fewer heap allocations MUST occur (one per `process_gradient_inner` call)

### Acceptance criteria

**Tests:** All existing gradient tests MUST pass without modification.

**Benchmarks:** Gradient-heavy file processing (50+ gradients) MUST show ≥10% throughput improvement, consistent with the `optimization-goals/spec.md:37` target of ~10-15% for gradient-heavy files. Non-gradient benchmarks MUST NOT regress.

---

## Pattern 4: `oklch_to_css` direct write

### Requirements

`oklch_to_css` MUST change its signature from `(l: f64, c: f64, h: f64, alpha: f64) -> String` to `(l: f64, c: f64, h: f64, alpha: f64, out: &mut impl Write)`.

The function MUST use `write!()` instead of `format!()` to write directly to the `out` parameter.

All call sites in `scan.rs` (hex branch, function colors branch), `lib.rs` (`color_to_oklch`), and `convert.rs` MUST pass `&mut out` instead of capturing a return value.

`color_to_oklch` (public API returning `Option<String>`) MUST use an internal helper or local String to bridge between the new `&mut impl Write` signature and its existing `-> Option<String>` contract.

The `write!()` calls MUST be safe — `unwrap()` on String writes is acceptable since writes to `String` are infallible.

The byte-identical output contract MUST hold for all color formats.

### Scenarios

**Scenario 1: Hex color in transform mode**
Given a CSS string containing `#ff6600`
When `scan_transform` processes it
Then `oklch_to_css` MUST write the result directly into the output buffer
And the output MUST be byte-identical to the current implementation

**Scenario 2: `color_to_oklch` single-color API**
Given a call to `color_to_oklch("#ff6600")`
When the function executes
Then it MUST return `Some("oklch(...)")` with the same value as today
And internally it MUST use a local String for the `oklch_to_css` write target

**Scenario 3: No regression on pass-through colors**
Given a CSS string containing only `oklch()` colors
When `scan_transform` processes it
Then `oklch_to_css` MUST NOT be called at all (pass-through behavior preserved)
And throughput MUST match current baseline

### Acceptance criteria

**Tests:** All existing transform and single-color conversion tests MUST pass without modification.

**Benchmarks:** Transform throughput for mixed CSS MUST improve by ≥3% (consistent with `optimization-goals/spec.md:36` target of ~3-5%). A 100 KB mixed CSS file MUST show measurable allocation reduction. Pass-through scenarios MUST NOT regress below baseline.

---

## Pattern 5: Cache `Mutex` → `RefCell`

### Requirements

The cache accessor in `cache.rs` MUST replace `OnceLock<Mutex<Cache>>` with `OnceLock<RefCell<Cache>>`.

Cache `get` operations MUST use `cache().borrow().get(...)` instead of `cache().lock().unwrap().get(...)`.

Cache `set` operations MUST use `cache().borrow_mut().set(...)` instead of `cache().lock().unwrap().set(...)`.

The `RefCell` variant MUST be gated with `#[cfg(target_arch = "wasm32")]` to prevent use on multi-threaded targets.

On non-WASM targets, the existing `Mutex` implementation MUST be preserved.

The cache behavior (hit rate, correctness, eviction) MUST NOT change — this is a synchronization primitive swap only.

The implementation MUST document the safety invariant: `RefCell` is safe here because cache access is single-threaded and non-re-entrant in the WASM context.

### Scenarios

**Scenario 1: Cache hit — WASM target**
Given a processed hex color `#ff6600` that was previously cached
When `scan_transform` processes a second occurrence
Then the cached OKLCH value MUST be returned without re-computation
And the `RefCell::borrow()` call MUST succeed (no panic)

**Scenario 2: Cache hit — non-WASM target**
Given the same scenario compiled for native (non-WASM)
When the cache is accessed
Then `Mutex` locking MUST be used
And the cached value MUST be returned correctly

**Scenario 3: Cache miss and set**
Given a new hex color `#aabbcc` not previously seen
When `scan_transform` computes and caches it
Then `cache().borrow_mut().set(...)` MUST succeed
And subsequent lookups for the same color MUST hit the cache

**Scenario 4: No re-entrancy violation**
Given any valid CSS input
When either `scan_transform` or `scan_audit` processes it
Then no `RefCell` double-borrow panic MUST occur (verified by running the full test suite)

### Acceptance criteria

**Tests:** All cache-dependent tests MUST pass on both WASM and non-WASM targets. The full `cargo test` suite MUST pass.

**Benchmarks:** Cache-heavy benchmarks (hex-only files) MUST show no regression. A ~1-3% total transform time improvement is expected per `proposal.md:141`. Atomic acquire/release overhead MUST be eliminated on WASM.

---

## Pattern 6: Named `HashMap` → `phf::Map`

### Requirements

`Cargo.toml` MUST add `phf = { version = "0.11", features = ["macros"] }` as a dependency.

`named.rs` MUST replace `LazyLock<HashMap<&'static str, [u8; 3]>>` with `phf::Map<&'static str, [u8; 3]>`.

The `lookup` function MUST use `NAMED_MAP.get(name).copied()` instead of `NAMED_MAP.get(name).copied()` (same API surface, different backing structure).

The `is_named` function MUST use `NAMED_MAP.contains_key(name)` instead of iterating or HashMap lookup.

The `LazyLock` import and initialization code MUST be removed.

`HashMap` imports that are no longer needed MUST be removed.

The `phf::Map` MUST be defined with `phf_map!` macro at module level (no lazy init).

The lookup behavior MUST be identical — all 148 named colors MUST resolve to the same `[u8; 3]` RGB values as before.

### Scenarios

**Scenario 1: Named color lookup in transform mode**
Given a CSS string containing `color: mediumseagreen;`
When `scan_transform` processes it
Then `is_named("mediumseagreen")` MUST return `true`
And `lookup("mediumseagreen")` MUST return `Some([0x3c, 0xb3, 0x71])` (the correct RGB)
And the conversion output MUST be byte-identical to the current implementation

**Scenario 2: All 148 named colors resolve correctly**
Given each of the 148 CSS named color strings
When `lookup` is called for each
Then every color MUST return `Some(...)` with the correct RGB values
And the values MUST match the current `HashMap`-based implementation

**Scenario 3: Non-named string returns None**
Given any string that is NOT a CSS named color (e.g., `"notacolor"`, `"#ff0"`)
When `is_named` and `lookup` are called
Then `is_named` MUST return `false`
And `lookup` MUST return `None`

**Scenario 4: Zero lazy-init cost on first access**
Given a freshly initialized module
When `lookup` is called for the first time
Then no lazy initialization code MUST execute (the `phf::Map` is a static)
And the lookup MUST return the correct value immediately

### Acceptance criteria

**Tests:** All named-color tests MUST pass. A verification test across all 148 named colors SHOULD confirm every RGB value matches the baseline (this is a data-structure swap, not a data change).

**Benchmarks:** Named-color lookup throughput MUST match or exceed the `HashMap` baseline. The `LazyLock` initialization cost MUST be eliminated (zero-cost on first access). Overall benchmark impact is expected to be <1% of total time per `proposal.md:164`.

---

## Global Acceptance Criteria

The following MUST hold for ALL patterns combined:

1. **Byte-identical output**: Running the full test suite (`npm test` + `cargo test`) MUST produce zero failures. All transform outputs MUST be byte-identical to the baseline.

2. **Audit count accuracy**: All audit scenarios MUST produce identical counts (`total`, `converted`, `skipped`, `by_format`, `by_category`) to the baseline implementation.

3. **No regression on untargeted formats**: Pass-through formats (`oklch()`, `lab()`, `color-mix()`, `var()`, `calc()`), comment handling, and string handling MUST NOT regress. The no-colors fast path benchmark MUST remain above the `optimization-goals/spec.md:55` target of ≥3,000 ops/s.

4. **Combined performance target**: The combined 6 patterns MUST achieve the minimum targets from `optimization-goals/spec.md:30-37`:
   - Audit 100 KB CSS: ≥1,200 ops/s (P0 must-satisfy)
   - Transform 100 KB CSS: ≥660 ops/s (P1+P2 must-satisfy, 5% improvement)
   - Hex-only 50 KB: no regression below 2,500 ops/s (P3 acceptable)
   - No-colors fast path: no regression below 3,000 ops/s
