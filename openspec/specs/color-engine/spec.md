# Color Engine Spec — Source of Truth

> Auto-merged from delta specs on archive. This is the canonical specification.
> Last updated: 2026-05-25 (initial creation via sdd-init)

## Overview

okcolor transforms legacy CSS color formats to OKLCH color space at build time, via a Rust/WASM scanner + CLI + Vite plugin pipeline.

## Supported Formats

| Format | Status | Since |
|--------|--------|-------|
| #RGB / #RRGGBB | ✅ Implemented | v1.0.0 |
| #RGBA / #RRGGBBAA | ✅ Implemented | v1.0.0 |
| rgb() / rgba() | ✅ Implemented | v1.0.0 |
| hsl() / hsla() | ✅ Implemented | v1.0.0 |
| hwb() | ✅ Implemented | v1.0.0 |
| color(srgb) | ✅ Implemented | v1.0.0 |
| Named colors (148) | ✅ Implemented | v1.0.0 |
| linear-gradient | ✅ Implemented | v1.0.0 |
| radial-gradient | ✅ Implemented | v1.0.0 |
| conic-gradient | ✅ Implemented | v1.0.0 |
| Repeating gradients | ✅ Implemented | v1.0.0 |
| oklch() / oklab() / lab() / lch() | ✅ Pass-through | v1.0.0 |
| color-mix() | ✅ Pass-through | v1.0.0 |
| light-dark() | ✅ Pass-through | v1.0.0 |
| var() / calc() / env() | ✅ Pass-through | v1.0.0 |
| oklch-ignore pragma | ✅ Implemented | v1.0.0 |
| Single color conversion | ✅ Implemented | v1.0.0 |

## CLI Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `okcolor audit` | Scan files, report color usage stats | ✅ |
| `okcolor check` | CI gate — fail on excess legacy colors | ✅ |
| `okcolor doctor` | Diagnose malformed colors | ✅ |

## API

| Function | Purpose | Status |
|----------|---------|--------|
| `transformCss(css, ignoreComment?)` | Transform CSS string to OKLCH | ✅ |
| `auditCss(css)` | Audit CSS, return stats JSON | ✅ |
| `colorToOklch(color)` | Single color value → OKLCH | ✅ |
| `okColor(options?)` | Vite plugin factory | ✅ |

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Transform 100 KB CSS | >500 ops/s | ~628 ops/s |
| Audit 100 KB CSS | >800 ops/s | ~874 ops/s |
| Hex-only 50 KB | >2,000 ops/s | ~2,577 ops/s |
| No-colors fast path | >3,000 ops/s | ~3,516 ops/s |
| Bundle size (WASM) | <100 KB | ~80 KB |
