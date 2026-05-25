---
id: optimize-scan-loop
title: "Optimize scan loop — technical design"
parent: optimize-scan-loop
status: draft
created: 2026-05-25
---

# Optimize Scan Loop — Technical Design

## Overview

Six independent allocation-elimination patterns targeting the hottest code path in okcolor: the CSS scan loop at `scan.rs:110`. The loop costs ~7 branches/byte for CSS with legacy colors, with `String` allocation being the dominant overhead. All patterns preserve byte-identical output in transform mode and identical audit counts.

---

## Pattern 1: Audit mode output elimination

### Design decision

**Option A** (two separate functions): `scan_transform()` and `scan_audit()` with duplicated scan loop logic.

**Option B** (enum parameter): `scan(input, ScanMode)` where `ScanMode = enum { Transform, Audit }`, eliminates the `bool` in favor of a named enum but still branches per-color to decide whether to build output.

**Decision: Option A** — split into `scan_transform()` and `scan_audit()`.

**Why:**

1. The audit path's control flow is a **strict subset** of transform: it skips all `out` buffer operations, never calls `process_gradient_inner` (walks gradient bodies with `replace_at_audit` only), and returns a `ScanResult` with no `.css` field. A single function with branches would still pay the branch cost per color and per byte — and the compiler cannot eliminate the dead `push_str`/`write!` paths at runtime.
2. The shared logic (comment skipping, string literal handling, ignore-range handling) can be extracted into a **private helper** (`scan_body` or inlined via a macro) that both paths call. This avoids duplication without polluting the hot path.
3. Option B would require `replace_at` to still return a `String` in audit mode (or force a dummy allocation) to maintain a unified return type. Option A lets `replace_at_audit` return `Option<usize>` — zero String traffic in audit mode.

### Interface changes

#### Current (before)

```rust
// scan.rs
fn scan(input: &str, transform: bool) -> ScanResult {
    // ...
    let mut out = String::with_capacity(len);
    // ... loop with ...
    if let Some((end, rep)) = replace_at(bytes, i, &mut stat, transform) {
        out.push_str(&rep);
        // ...
    }
    // ...
    stat.css = out; // ALWAYS allocated, even in audit
    stat
}

fn replace_at(bytes: &[u8], i: usize, stat: &mut ScanResult, transform: bool) -> Option<(usize, String)>
```

#### After (transform)

```rust
// scan.rs
pub fn scan_transform(input: &str) -> String {
    let result = scan(input, true);
    result.css // single-field extraction
}

// Internal — the actual transform loop
fn scan_transform_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(bytes.len());
    // ... same loop but calls replace_at_transform ...
    if let Some((end, rep)) = replace_at_transform(bytes, i, &mut stat) {
        out.push_str(&rep);
        // ...
    }
    // ...
    stat.css = out;
    stat
}

fn replace_at_transform(bytes: &[u8], i: usize, stat: &mut ScanResult) -> Option<(usize, String)>
```

#### After (audit)

```rust
// scan.rs
pub fn scan_audit(input: &str) -> ScanResult {
    // Quick bail-out: if no legacy indicators and no oklch-ignore, short-circuit
    let bytes = input.as_bytes();
    let has_ignore = bytes.windows(12).any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    if !has_ignore && !has_legacy_indicators(bytes) {
        return ScanResult::default(); // no .css allocated
    }

    let mut stat = ScanResult::default();
    // ... same outer loop (comments, strings, ignore ranges, gradients, colors) ...
    // but NO `out` variable, NO `push_str`, NO `write!`
    // gradient branch: calls replace_at_audit only, never process_gradient_inner
    // color branch: calls replace_at_audit, discards the returned ()
    // ...
    stat
}

fn replace_at_audit(bytes: &[u8], i: usize, stat: &mut ScanResult) -> Option<usize>
```

### ScanResult change

```rust
// Before
pub struct ScanResult {
    pub css: String,              // ← filled in transform mode, allocated + discarded in audit
    pub legacy_count: u32,
    pub hex_count: u32,
    // ...
}

// After
pub struct ScanResult {
    pub css: String,              // kept for scan_transform_impl
    // all count fields unchanged
}

// BUT: scan_audit() returns a ScanResult where .css is never allocated:
// in the fast path (no legacy indicators), it returns ScanResult::default()
// and .css is String::new() — zero allocation.
// In the slow path, .css is simply never written (String::new() default).
```

### `match_gradient` audit path

```rust
// Current (lines 343-354)
} else {
    // Audit: walk inner content counting colours via replace_at
    let mut j = 0;
    while j < inner.len() {
        if let Some((end, _)) = replace_at(inner, j, stat, false) {
            j = end;
        } else {
            j += 1;
        }
    }
    out.push_str(full_s); // ← still pushes to out in audit!
}

// After
} else { // audit branch in match_gradient
    let mut j = 0;
    while j < inner.len() {
        if let Some(end) = replace_at_audit(inner, j, stat) {
            j = end;
        } else {
            j += 1;
        }
    }
    // No out.push_str(full_s) — audit mode doesn't build output
}
```

### Control flow diagram

```
BEFORE (scan):
  input → has_legacy_indicators? → no → ✓ return input as .css (one alloc)
                                  → yes → allocate out → loop → {
                                    comment? → push_str → continue
                                    string?  → push_str → continue
                                    gradient? → match_gradient → push gradient to out
                                    color?   → replace_at(transform=false) → format!(...) → push_str → continue
                                    else     → push byte → continue
                                  }
                                  → stat.css = out → return

AFTER (scan_audit):
  input → has_legacy_indicators? → no → return ScanResult::default() (ZERO alloc)
                                  → yes → loop → {
                                    comment? → skip (count & advance) → continue
                                    string?  → skip → continue
                                    gradient? → match_gradient_audit → replace_at_audit only → continue
                                    color?   → replace_at_audit → count only → continue
                                    else     → advance → continue
                                  }
                                  → return stat (no .css allocated)

AFTER (scan_transform):
  input → has_legacy_indicators? → no → return input as String (one alloc, unchanged)
                                  → yes → allocate out → loop → {
                                    (same as before — unchanged)
                                  }
                                  → stat.css = out → return
```

### File changes

| File | Change | Lines | Risk |
|------|--------|-------|------|
| `scan.rs` | Split `scan()` into `scan_transform_impl()` + `scan_audit()` + shared `scan_body()` or inlined helpers | ~+60 / ~-30 | Medium — logic duplication risk |
| `scan.rs` | Add `replace_at_transform()`, `replace_at_audit()` from `replace_at()` | ~+30 / ~-20 | Low — mechanical split |
| `scan.rs` | `match_gradient` audit branch uses `replace_at_audit`, no `out.push_str` | ~+5 / ~-3 | Low |
| `lib.rs` | `transform_css` calls `scan_transform()`, `audit_css` calls `scan_audit()` | ~+2 / ~-1 | Low |
| `lib.rs` | Remove unused `.css` field read in `audit_css` | No change needed | — |

### Performance expectation

- Audit: **~1.5-2× throughput** (~2,000 ops/s from baseline ~874 ops/s).
- Transform: **no regression** (< 1% variation, likely within noise).
- Allocation elimination: 100% of `out` String + per-color `format!()` / `to_string()` in audit mode.

---

## Pattern 2: Named color stack-buffer lowercase

### Design decision

Replace the heap-allocated `raw.to_ascii_lowercase()` call (scan.rs:515) with a fixed-size `[u8; 32]` stack buffer. Copy raw bytes into the buffer, apply ASCII lowercase in-place, then use `core::str::from_utf8` for the `is_named()` and `parse_named()` calls.

**Why `[u8; 32]`?** The longest CSS named color (`mediumaquamarine` = 16 chars, `lightgoldenrodyellow` = 18 chars) fits comfortably with room to spare. 32 bytes covers all 148 named colors.

### Fallback strategy

If the raw input exceeds 32 bytes at the color boundary (impossible for valid CSS, but defensive), fall back to the heap-allocated `raw.to_ascii_lowercase()`. Guard with `debug_assert!` for debug builds.

### Changed code

#### Current (scan.rs:514-526)

```rust
let raw  = std::str::from_utf8(&bytes[i..end]).ok()?;
let name = raw.to_ascii_lowercase();       // ← heap allocation
if !named::is_named(&name) { return None; }

stat.named_count += 1;

let rep = if transform {
    let raw = parse::parse_named(name.as_bytes())?;
    let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
    oklch_to_css(l, c, h, alpha)
} else {
    raw.to_string()                         // ← second allocation (audit mode)
};
```

Note: `parse_named` takes `&[u8]`, not `&str`, so we can pass the stack buffer bytes directly without creating a `&str` first.

#### After

```rust
let raw  = std::str::from_utf8(&bytes[i..end]).ok()?;

// Stack-buffer lowercase: avoids heap allocation
let lowered: [u8; 32] = {
    let src = bytes[i..end].as_ref();
    let mut buf = [0u8; 32];
    if src.len() > 32 {
        debug_assert!(false, "named color > 32 bytes: {}", raw);
        // Fallback: heap-allocated lowercase
        // (continues below with raw.to_ascii_lowercase())
    } else {
        for (j, &b) in src.iter().enumerate() {
            buf[j] = b.to_ascii_lowercase();
        }
        buf
    }
};

// Use buf[..raw.len()] for lookup
let name_bytes = if raw.len() > 32 {
    // fallback path
    let s = raw.to_ascii_lowercase();
    // ... rest of function uses s ...
} else {
    &lowered[..raw.len()]
};

if !named::is_named_bytes(name_bytes) { ... }
```

Wait — `is_named` and `lookup` currently take `&str`. We need to either:
- (a) Change `is_named`/`lookup` to accept `&[u8]` — more general, avoids utf8 validation of already-valid ASCII
- (b) Call `core::str::from_utf8` on the stack buffer

The cleanest approach is to add `is_named_bytes(&[u8])` and `lookup_bytes(&[u8])` variants in `named.rs` (or change the existing functions — they only need `AsRef<[u8]>`). Since all named colors are ASCII and we already validated the input is valid UTF-8 when we parsed it, we can safely use `unsafe { str::from_utf8_unchecked(&lowered[..raw.len()]) }`.

**Decision**: Add `lookup_bytes(name: &[u8]) -> Option<[u8; 3]>` to `named.rs`. The `phf::Map` keys are `&'static str` but `get` can be called with any type implementing `PhfHash` — phf's `Map::get` takes `T: PhfHash + Equivalent<K>`. Since `&[u8]` != `&str`, we need a wrapper or use `str::from_utf8_unchecked`. Given all CSS named colors are ASCII and the input bytes were already validated as UTF-8 by `scan()`, the `unsafe` is justified with a clear safety comment.

### File changes

| File | Change | Lines | Risk |
|------|--------|-------|------|
| `scan.rs` | Replace `to_ascii_lowercase()` with `[u8; 32]` stack buffer + fallback | ~+20 / ~-3 | Low |
| `named.rs` | Add `lookup_bytes(&[u8])` and `is_named_bytes(&[u8])` | ~+10 | Low |

### `unsafe` safety invariant

```rust
/// SAFETY: `name` must be valid UTF-8 containing only ASCII characters.
/// This invariant holds because:
/// 1. The input to `scan()` is validated as UTF-8 (Rust `&str`).
/// 2. `named_at()` extracts a byte range at a word boundary.
/// 3. All CSS named colors use only ASCII lowercase letters.
/// 4. `to_ascii_lowercase()` on ASCII bytes preserves UTF-8 validity.
let name_str = unsafe { std::str::from_utf8_unchecked(&lowered[..raw.len()]) };
```

### Performance expectation

- Zero heap allocations per named color instead of 1.
- Gain is modest in absolute terms (~1-2% of total time) because named colors are ~5-10% of legacy colors.
- The `unsafe` block is trivially verifiable — no runtime overhead.

---

## Pattern 3: Gradient interim String elimination

### Design decision

Change `process_gradient_inner` from allocating a new `String` and returning it, to writing directly into an `&mut String` provided by the caller.

### Interface change

#### Before

```rust
fn process_gradient_inner(content: &str, stat: &mut ScanResult, transform: bool) -> String
```

#### After

```rust
fn process_gradient_inner(content: &str, stat: &mut ScanResult, transform: bool, out: &mut String)
```

### Call site changes

#### Before (match_gradient, scan.rs:331)

```rust
let processed = process_gradient_inner(inner_s, stat, transform);
out.push_str(gradient_name);
out.push('(');
if already_ok {
    out.push_str(&processed);
} else {
    out.push_str("in oklch, ");
    out.push_str(&processed);
}
out.push(')');
```

#### After

```rust
out.push_str(gradient_name);
out.push('(');
if !already_ok {
    out.push_str("in oklch, ");
}
process_gradient_inner(inner_s, stat, transform, out);
out.push(')');
```

Note: the `already_ok` + `in oklch` injection is now pushed to `out` BEFORE calling `process_gradient_inner`, so the gradient body content is contiguous after the injection. This eliminates the interim `processed` String entirely.

### Inside `process_gradient_inner`

Every `out.push_str(...)` and `out.push(...)` call remains the same — the only change is removing the `let mut out = String::with_capacity(...)` at the top and the `return out` at the bottom, and using the `out` parameter directly.

### Interaction with the audit split

In `scan_audit`, `match_gradient` does NOT call `process_gradient_inner` at all — it walks the gradient body with `replace_at_audit` only. So this pattern is transform-mode only.

### File changes

| File | Change | Lines | Risk |
|------|--------|-------|------|
| `scan.rs` | Change `process_gradient_inner` signature + update body | ~+5 / ~-5 | Low |
| `scan.rs` | Update `match_gradient` call site | ~+5 / ~-4 | Low |

### Performance expectation

- 1 fewer allocation per gradient in transform mode.
- ~10-15% improvement for gradient-heavy files.

---

## Pattern 4: `oklch_to_css` direct write

### Design decision

Change `oklch_to_css` from `-> String` (allocates via `format!()`) to `(..., out: &mut impl Write) -> fmt::Result` (writes directly via `write!()`).

### Interface change

#### Before

```rust
pub fn oklch_to_css(l: f64, c: f64, h: f64, alpha: Option<f64>) -> String
```

#### After

```rust
pub fn oklch_to_css(l: f64, c: f64, h: f64, alpha: Option<f64>, out: &mut impl std::fmt::Write) -> std::fmt::Result
```

### Implementation

```rust
pub fn oklch_to_css(l: f64, c: f64, h: f64, alpha: Option<f64>, out: &mut impl std::fmt::Write) -> std::fmt::Result {
    let l_rounded = (l * 100.0 * 100.0).round() / 100.0;
    let c_rounded = (c * 100_000.0).round() / 100_000.0;
    let h_rounded = if c_rounded < 0.0002 { 0.0 } else { (h * 100.0).round() / 100.0 };

    match alpha {
        Some(a) => {
            let a_rounded = (a * 10_000.0).round() / 10_000.0;
            write!(out, "oklch({l_rounded}% {c_rounded} {h_rounded} / {a_rounded})")
        }
        None => write!(out, "oklch({l_rounded}% {c_rounded} {h_rounded})"),
    }
}
```

### Call site changes in `scan.rs`

#### Before (hex branch, line 465-467)

```rust
let rep = if transform {
    let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
    oklch_to_css(l, c, h, alpha)
} else {
    format!("#{}", ...)
};
```

#### After — `replace_at_transform`

```rust
// hex branch in replace_at_transform:
let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
let mut rep = String::new();
oklch_to_css(l, c, h, alpha, &mut rep).unwrap();
return Some((end, rep));
```

Wait — this still allocates `rep` as a `String`. The goal is to eliminate the String entirely. In `replace_at_transform`, the `out` (from `scan_transform_impl`) is available... but `replace_at_transform` returns `(usize, String)` which is then pushed into `out` at the call site.

The real optimization is: **inline the oklch_to_css write into the scan loop's `out` directly** — but that requires threading `out` through `replace_at_transform`.

**Revised design**: Change `replace_at_transform` to take `&mut String` instead of returning `(usize, String)`:

#### Before

```rust
fn replace_at_transform(bytes: &[u8], i: usize, stat: &mut ScanResult) -> Option<(usize, String)>
```

#### After

```rust
fn replace_at_transform(bytes: &[u8], i: usize, stat: &mut ScanResult, out: &mut String) -> Option<usize>
```

And within the function:

```rust
// hex branch
let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
oklch_to_css(l, c, h, alpha, out).unwrap();
return Some(end);
```

Similarly for function colors and named colors:

```rust
// function color branch
let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
oklch_to_css(l, c, h, alpha, out).unwrap();
return Some(close + 1);

// named color branch
let raw = parse::parse_named(name_bytes)?;
let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
oklch_to_css(l, c, h, alpha, out).unwrap();
return Some(end);
```

### Bridge for `color_to_oklch` (lib.rs)

`color_to_oklch` is a public API returning `Option<String>`. It needs a local String:

```rust
pub fn color_to_oklch(input: &str) -> Option<String> {
    let raw = parse::parse_single_color(input.trim())?;
    let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
    let mut out = String::new();
    format::oklch_to_css(l, c, h, alpha, &mut out).ok()?;
    Some(out)
}
```

### Bridge for `convert.rs`

`convert()` also returns `Option<String>`:

```rust
Space::Oklch => {
    let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
    let mut out = String::new();
    format::oklch_to_css(l, c, h, alpha, &mut out).unwrap();
    Some(out)
}
```

### Note on error handling

`write!(out, ...)` is infallible when `out: &mut String` (it only returns `Err` for `fmt::Error`, which `String`'s Write implementation never produces). The `.unwrap()` is safe. For the `&mut impl Write` generic signature, callers that use `String` call `.unwrap()`. If a custom writer (e.g., `Vec<u8>`) could fail, the caller handles the error.

### File changes

| File | Change | Lines | Risk |
|------|--------|-------|------|
| `format.rs` | Change `oklch_to_css` signature, replace `format!()` with `write!()` | ~+5 / ~-5 | Low |
| `scan.rs` | `replace_at_transform` takes `&mut out`, writes directly | ~+15 / ~-10 | Low |
| `lib.rs` | `color_to_oklch` uses local String bridge | ~+2 / ~-1 | Low |
| `convert.rs` | `convert()` Oklch branch uses local String bridge | ~+2 / ~-1 | Low |

### Performance expectation

- 1 fewer allocation per legacy color in transform mode (the `oklch_to_css` return value).
- ~3-5% total transform throughput improvement.

---

## Pattern 5: Cache `Mutex` → `RefCell`

### Design decision

Replace `OnceLock<Mutex<Cache>>` with `OnceLock<RefCell<Cache>>` on WASM targets, preserving the `Mutex` variant on native (multi-threaded) targets.

### Why `RefCell` is safe here

The scan loop is single-threaded on WASM (JavaScript is single-threaded, and WASM runs on the main JS thread or a Worker). The cache is accessed during color processing:
- `cache_get()` at `math.rs` (called from `raw_to_oklch` via the 256-entry cache)
- `cache_set()` after computing OKLCH for a new color

There is no re-entrancy: the cache is accessed linearly during the scan loop, never recursively. No borrow exists across an `await` point (there are no `await` points in the scan loop).

### Code change

```rust
// cache.rs

// Current:
use std::sync::{Mutex, OnceLock};
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
fn cache() -> &'static Mutex<Cache> {
    CACHE.get_or_init(|| Mutex::new(Cache::new()))
}

// After:
use std::sync::OnceLock;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Mutex;

#[cfg(target_arch = "wasm32")]
static CACHE: OnceLock<RefCell<Cache>> = OnceLock::new();
#[cfg(not(target_arch = "wasm32"))]
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

#[cfg(target_arch = "wasm32")]
fn cache() -> &'static RefCell<Cache> {
    CACHE.get_or_init(|| RefCell::new(Cache::new()))
}
#[cfg(not(target_arch = "wasm32"))]
fn cache() -> &'static Mutex<Cache> {
    CACHE.get_or_init(|| Mutex::new(Cache::new()))
}
```

And the public functions:

```rust
pub fn cache_get(r: u8, g: u8, b: u8, a: u8) -> Option<(f64, f64, f64)> {
    #[cfg(target_arch = "wasm32")]
    { cache().borrow().get(r, g, b, a) }
    #[cfg(not(target_arch = "wasm32"))]
    { cache().lock().unwrap().get(r, g, b, a) }
}

pub fn cache_set(r: u8, g: u8, b: u8, a: u8, oklch: (f64, f64, f64)) {
    #[cfg(target_arch = "wasm32")]
    { cache().borrow_mut().set(r, g, b, a, oklch); }
    #[cfg(not(target_arch = "wasm32"))]
    { cache().lock().unwrap().set(r, g, b, a, oklch); }
}
```

### Alternative: `UnsafeCell` wrapper

An `UnsafeCell`-based approach would be slightly faster (no runtime borrow check) but requires `unsafe`. The `RefCell` approach is preferred because:

1. It's still faster than `Mutex` (no atomic acquire/release).
2. The runtime borrow check is negligible (~1 branch per cache access).
3. No `unsafe` code needed.
4. If a re-entrancy bug is introduced, `RefCell` catches it with a panic rather than UB.

### Safety documentation

```rust
// SAFETY: On WASM, cache access is single-threaded and non-re-entrant.
// The scan loop processes bytes linearly with no recursion into the cache.
// No borrow exists across an await point (no async in the scan loop).
// If this invariant is violated, RefCell will panic (safe, no UB).
```

### File changes

| File | Change | Lines | Risk |
|------|--------|-------|------|
| `cache.rs` | Gate with `#[cfg(target_arch = "wasm32")]`, add `RefCell` branch | ~+20 / ~-5 | Low-medium |

### Performance expectation

- Atomic acquire/release eliminated per cache hit (every hex color in a file with repeated colors).
- ~1-3% total transform time improvement (modest because cache hits are not on the absolute hottest path — the math path is the hot path).

---

## Pattern 6: Named `HashMap` → `phf::Map`

### Design decision

Replace the runtime `LazyLock<HashMap<&'static str, [u8; 3]>>` with a compile-time `phf::Map<&'static str, [u8; 3]>` using the `phf::phf_map!` macro.

### Why `phf`

- `phf` (Perfect Hash Function) generates a minimal perfect hash at compile time — zero runtime hashing cost.
- `phf::Map` is `const`-constructible, so no `LazyLock` overhead on first access.
- Used by rustc itself for Unicode tables — battle-tested.
- Pure Rust, no platform dependencies — works everywhere including WASM.

### Exact macro invocation

```rust
use phf::phf_map;

static NAMED_MAP: phf::Map<&'static str, [u8; 3]> = phf_map! {
    "aliceblue" => [240, 248, 255],
    "antiquewhite" => [250, 235, 215],
    "aqua" => [0, 255, 255],
    // ... all 148 pairs ...
    "yellowgreen" => [154, 205, 50],
};
```

The exact same 148 entries from the current `NAMED_PAIRS` slice, copied verbatim into the macro. No data changes — this is a data-structure swap only.

### Function changes

```rust
// Before
pub fn lookup(name: &str) -> Option<[u8; 3]> {
    NAMED_MAP.get(name).copied()
}

pub fn is_named(name: &str) -> bool {
    NAMED_MAP.contains_key(name)
}

// After — same signatures, but no lazy init overhead
pub fn lookup(name: &str) -> Option<[u8; 3]> {
    NAMED_MAP.get(name).copied()
}

pub fn is_named(name: &str) -> bool {
    NAMED_MAP.contains_key(name)
}
```

The `phf::Map::get()` returns `Option<&V>`, so `.copied()` still works identically. `contains_key()` also has `phf::Map` equivalent.

### Removal

- Remove `use std::collections::HashMap;`
- Remove `use std::sync::LazyLock;`
- Remove the entire `NAMED_PAIRS` slice (replaced by inline entries in `phf_map!`)
- Remove the `NAMED_MAP` `LazyLock` initialization block

### The `NAMED_AC` (Aho-Corasick) stays

The `NAMED_AC` automaton at `named.rs:181` is used for the pre-scan bail-out (`has_named`). It is NOT replaced by this change — it's a different concern (substring matching vs. lookup). Only the `HashMap` based lookup is replaced.

### Cargo.toml change

```toml
[dependencies]
phf = { version = "0.11", features = ["macros"] }
```

Note: With the `"macros"` feature, the `phf_map!` macro uses procedural macros that run at compile time. This adds ~1-2s to initial build time but zero runtime cost.

### `lookup_bytes` addition

For Pattern 2 (stack-buffer lowercase), we need a byte-based lookup. Since `phf::Map` keys are `&str`, we need to either:
- (a) Convert the byte slice to `&str` via `from_utf8_unchecked` (safe because the bytes are ASCII)
- (b) Stay with `&str`-based lookup and convert at the call site

**Decision**: Use `from_utf8_unchecked` in the scan.rs call site, not in `named.rs`. Keep `lookup(&str)` as the named.rs API.

---

## Architecture Diagram

```
BEFORE (scan, transform=true):
  ┌─────────┐    ┌──────────────────────────────────────────────────────┐
  │ input   │───→│ scan(input, transform=true)                          │
  │ &str    │    │                                                      │
  └─────────┘    │  out = String::with_capacity()     ← 1 alloc         │
                 │  loop bytes {                                       │
                 │    color? → replace_at(… transform)                  │
                 │              ├─ hex:    oklch_to_css() → String      │ ← 1 alloc
                 │              ├─ func:   oklch_to_css() → String      │ ← 1 alloc
                 │              └─ named:  to_ascii_lowercase() → String│ ← 1 alloc
                 │                       → parse_named()                 │
                 │                       → oklch_to_css() → String      │ ← 1 alloc
                 │    gradient? → process_gradient_inner() → String     │ ← 1 alloc
                 │  }                                                   │
                 │  out.push_str(color_replacement)                     │
                 │  out.push_str(gradient_result)                       │
                 │  stat.css = out                                      │
                 └──────────────────────────┬───────────────────────────┘
                                            ↓
                                      ┌──────────┐
                                      │  String   │
                                      └──────────┘

BEFORE (scan, transform=false):
  ┌─────────┐    ┌──────────────────────────────────────────────────────┐
  │ input   │───→│ scan(input, transform=false)                         │
  │ &str    │    │                                                      │
  └─────────┘    │  out = String::with_capacity()     ← 1 alloc (WASTED)│
                 │  loop bytes {                                       │
                 │    color? → replace_at(… transform=false)            │
                 │              ├─ hex:    format!("#{}") → String      │ ← 1 alloc (DISCARDED)
                 │              ├─ func:   input_slice() → String       │ ← 1 alloc (DISCARDED)
                 │              └─ named:  to_ascii_lowercase() → String│ ← 1 alloc (DISCARDED)
                 │                       → raw.to_string() → String     │ ← 1 alloc (DISCARDED)
                 │    gradient? → process_gradient_inner() → String     │ ← 1 alloc (DISCARDED)
                 │  }                                                   │
                 │  out.push_str(...)                                   │
                 │  stat.css = out         ← String allocated, NEVER READ│
                 └──────────────────────────┬───────────────────────────┘
                                            ↓
                                      ┌──────────┐
                                      │ ScanResult│
                                      │ .css →   │ (lib.rs reads counts only)
                                      │ ignored  │
                                      └──────────┘


AFTER (scan_transform):
  ┌─────────┐    ┌──────────────────────────────────────────────────────┐
  │ input   │───→│ scan_transform(input)                                │
  │ &str    │    │                                                      │
  └─────────┘    │  out = String::with_capacity()     ← 1 alloc         │
                 │  loop bytes {                                       │
                 │    color? → replace_at_transform(… &mut out)         │
                 │              ├─ hex:    oklch_to_css(… &mut out)     │ ← direct write: 0 allocs
                 │              ├─ func:   oklch_to_css(… &mut out)     │ ← direct write: 0 allocs
                 │              └─ named:  [u8;32] stack_buf             │ ← stack: 0 allocs
                 │                       → parse_named(stack_buf)        │
                 │                       → oklch_to_css(… &mut out)     │ ← direct write: 0 allocs
                 │    gradient? → process_gradient_inner(… &mut out)    │ ← direct write: 0 allocs
                 │  }                                                   │
                 │  stat.css = out                                      │
                 └──────────────────────────┬───────────────────────────┘
                                            ↓
                                      ┌──────────┐
                                      │  String   │
                                      └──────────┘

AFTER (scan_audit):
  ┌─────────┐    ┌──────────────────────────────────────────────────────┐
  │ input   │───→│ scan_audit(input)                                    │
  │ &str    │    │                                                      │
  └─────────┘    │  NO out allocation                                  │
                 │  loop bytes {                                       │
                 │    color? → replace_at_audit(bytes, i, &mut stat)    │
                 │              ├─ hex:    0 allocs (count only)        │
                 │              ├─ func:   0 allocs (count only)        │
                 │              └─ named:  [u8;32] stack_buf             │ ← stack: 0 allocs
                 │                       → count only                   │
                 │    gradient? → walk inner with replace_at_audit only │ ← 0 allocs
                 │  }                                                   │
                 │  return ScanResult { .css = String::new() }          │
                 └──────────────────────────┬───────────────────────────┘
                                            ↓
                                      ┌──────────┐
                                      │ ScanResult│
                                      │ .css = "" │ (zero-cost default)
                                      └──────────┘
```

### Allocation comparison (per color in audit mode)

| Format | Before (audit) | After (audit) |
|--------|----------------|---------------|
| Hex `#ff0000` | 1 (format `String`) | 0 |
| Function `rgb(...)` | 1 (input_slice `String`) | 0 |
| Named `red` | 2 (`to_ascii_lowercase` + `to_string`) | 0 |
| Gradient (4 colors inside) | 5 (1 gradient + 4 colors) | 0 |

---

## File Change Summary

| File | Patterns | Change description | Lines Δ | Risk |
|------|----------|-------------------|---------|------|
| `packages/core-wasm/Cargo.toml` | P6 | Add `phf` dependency | +1 | Low |
| `packages/core-wasm/src/format.rs` | P4 | `oklch_to_css` → `&mut impl Write` | ~+7 / ~-5 | Low |
| `packages/core-wasm/src/scan.rs` | P1, P2, P3, P4 | Major restructure: split `scan()`, `replace_at()`; stack-buffer lowercase; `process_gradient_inner` takes `&mut`; `replace_at_transform` takes `&mut out` | ~+80 / ~-40 | Medium |
| `packages/core-wasm/src/lib.rs` | P1, P4 | `transform_css`/`audit_css` call new fns; `color_to_oklch` bridge | ~+5 / ~-3 | Low |
| `packages/core-wasm/src/convert.rs` | P4 | `convert()` Oklch bridge | ~+2 / ~-1 | Low |
| `packages/core-wasm/src/cache.rs` | P5 | `#[cfg]`-gated `RefCell`/`Mutex` | ~+20 / ~-5 | Low |
| `packages/core-wasm/src/named.rs` | P6 | `HashMap` → `phf::Map` | ~+150 / ~-15 | Low |

### Total estimated delta

- Lines added: ~+265
- Lines removed: ~-69
- Net: ~+196
- Files touched: 7

### Risk ratings

| File | Risk | Rationale |
|------|------|-----------|
| `scan.rs` | Medium | Logic duplication between transform/audit paths; must keep both in sync. The shared outer loop (comments, strings, ignore ranges) must be identical. |
| `cache.rs` | Low-Medium | `RefCell` panic on re-entrancy — but no re-entrancy exists. `#[cfg]` gates are mechanical. |
| All others | Low | Mechanical signature changes, data-structure swaps. Existing tests validate correctness. |

---

## Implementation order

Based on the proposal's recommended order:

```
1. phf::Map (P6)         — named.rs + Cargo.toml, independent
2. Cache RefCell (P5)    — cache.rs, independent
3. Stack-buffer (P2)     — scan.rs named branch + named.rs helpers, independent
4. oklch_to_css write (P4) — format.rs + scan.rs + lib.rs + convert.rs, touches many files
5. Gradient write (P3)   — scan.rs process_gradient_inner, depends on P4 (out threading)
6. Audit split (P1)      — scan.rs + lib.rs, last (heaviest change, depends on P2/P4 patterns)
```

Steps 1-2 can be done in parallel. Steps 3-5 can be done in parallel after 1-2. Step 6 depends on all previous steps.

### Non-goals (explicitly deferred)

- **Token-based scanner**: Higher risk, more reward. Deferred to separate change.
- **Find-then-verify scan architecture**: Pre-scan for positions then batch-replace. Deferred.
- **Output size precomputation**: Pre-count output size to pre-allocate `out` exactly. Marginal gain.
- **`in_value_context` optimization**: Detect `#id` selectors vs `#hex` colors more efficiently. Independent.
