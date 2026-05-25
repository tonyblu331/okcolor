# Optimization Goals Spec — Source of Truth

> Performance targets and architectural patterns for the color engine.
> Last updated: 2026-05-25

## Bottleneck Hierarchy (measured)

Current hot path cost per byte in scan loop: **~7 branches/byte** for CSS with legacy colors.

### Measured Throughput (2026-05-25 — Baseline)

| Scenario | ops/s | vs fast path | Primary bottleneck |
|----------|-------|-------------|-------------------|
| No-colors fast path | 3,516 | 1.0x baseline | Pre-scan only (memchr + AC + memmem) |
| oklch-ignore heavy | 10,448 | 2.97x faster | Skip loop for ~99% of input |
| Hex-only 50 KB | 2,577 | 0.73x | Scan loop (byte-by-byte) + cache + format |
| RGB-only 50 KB | 1,891 | 0.54x | Scan loop + parse + math + format |
| HSL-only 50 KB | 1,512 | 0.43x | Scan loop + HSL→sRGB→OKLCH chain |
| HWB-only 50 KB | 1,566 | 0.45x | Scan loop + HWB→HSL→sRGB→OKLCH chain |
| Mixed 100 KB | 628 | 0.18x | All bottlenecks combined |

### Measured Throughput (2026-05-25 — Post-optimize-scan-loop)

| Scenario | ops/s | Δ vs baseline | Notes |
|----------|-------|---------------|-------|
| No-colors fast path | 6,288 | **+79%** | Pre-scan only (memchr + AC + memmem) |
| Modern pass-through | 4,101 | — | New metric, pass-through formats |
| Hex-only 50 KB | 1,904 | −26% | Improved from 1,723 after output precomputation |
| Gradient-heavy audit | 3,521 | — | New metric, audit mode |
| Audit mixed | 1,119 | — | New metric, audit mode |
| 100 KB audit (WASM binding) | 692 | — | Includes JS/WASM bridge overhead |

### Post-optimize-scan-loop + output-precomputation (2026-05-25)

| Scenario | ops/s | Notes |
|----------|-------|-------|
| No-colors fast path | 8,927 | +42% vs 6,288 (variance) |
| Hex-only 50 KB | 1,904 | +10.5% from output precomputation |
| Mixed colors transform | 759 | 50 KB mixed |
| Gradient-heavy transform | 1,537 | Zero-allocation gradient processing |
| Gradient-heavy audit | 3,521 | Zero-allocation audit mode |
| Audit no colors | 8,507 | Fast-path bailout works for audit too |
| Transform 100 KB (WASM) | 403 | WASM JS bridge (noisier) |
| Audit 100 KB (WASM) | 692 | WASM JS bridge (noisier) |

### Key Observations

1. **Byte-by-byte loop** dominates: `oklch-ignore` (skips colors) is 3× faster than no-colors (scans whole input)
2. **HSL/HWB math** adds 2.2–2.6× cost over hex (extra srgb_float + gamma decode path)
3. **Pre-scan bail-out** is optimal: modern-only CSS costs ~0
4. **Cache** is effective for hex colors (99% of sRGB space maps to 4K slots)
5. **Gradient recursion** duplicates work: main scan + `process_gradient_inner` re-scan

### Implemented Improvements (optimize-scan-loop)

| # | Pattern | Priority | Status | Actual result |
|---|---------|----------|--------|---------------|
| 1 | Audit mode output elimination | P0 | ✅ | Zero-allocation audit path. 1,963 ops/s gradient-heavy audit (≥1,200 ✓). 884 ops/s mixed audit. |
| 2 | Named color stack-buffer lowercase | P1 | ✅ | `[u8; 32]` stack buffer replaces `to_ascii_lowercase()`. 0 heap allocs per named color. |
| 3 | `oklch_to_css` direct write | P2 | ✅ | `&mut impl Write` signature. `write!()` replaces `format!()`. 0 allocs per color in transform. |
| 4 | Gradient interim String elimination | P2 | ✅ | `process_gradient_inner` writes to `&mut String`. 0 allocs per gradient in transform. |
| 5 | Cache `Mutex` → `RefCell` | P3 | ✅ | WASM: `RefCell` eliminates atomic acquire/release. Native: `Mutex` preserved. |
| 6 | Named `HashMap` → `phf::Map` | P3 | ✅ | Compile-time perfect hashing. Zero runtime hashing + zero lazy-init overhead. |

### Deferred (future changes)

| Pattern | Expected gain | Risk | Priority |
|---------|--------------|------|----------|
| Output size precomputation | ~5-10% transform throughput | Low | P1 |
| Token-based scanner | ~3-5× scan loop reduction | High | P3 |
