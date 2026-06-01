# Color Engine Spec — Source of Truth

> Auto-merged from delta specs on archive. This is the canonical specification.
> Truth-audited: 2026-06-01.

## Overview

okcolor transforms legacy CSS color formats to OKLCH at build time through a
Rust/WASM scanner plus TypeScript adapters for CLI, Vite, token compilation, and
single-color transforms.

The v1 operational color model is OKLCH/OKLab for SDR web colors. CAM16, JzAzBz,
Rec.2020, and HDR workflows are research-track until a separate OpenSpec change adds
oracle fixtures, tolerances, and DX behavior.

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
| `okcolor audit <css-dir|tokens.json> [--mode css|tokens]` | Audit CSS color debt or token gamut/contrast safety | ✅ |
| `okcolor check` | CI gate — fail on excess legacy colors | ✅ |
| `okcolor doctor` | Diagnose malformed colors | ✅ |
| `okcolor convert` | Convert a single color or token file | ✅ |
| `okcolor expand` | Controlled wide-gamut OKLCH enhancement | ✅ |
| `okcolor grade` | Apply named product recipe transform | ✅ |
| `okcolor fit` | Fit color into a target gamut by reducing chroma | ✅ |
| `okcolor describe` | Explain OKLCH identity and available gamut budget | ✅ |

## API

| Function | Purpose | Status |
|----------|---------|--------|
| `transformCss(css, ignoreComment?)` | Transform CSS string to OKLCH | ✅ |
| `auditCss(css)` | Audit CSS, return stats JSON | ✅ |
| `colorToOklch(color)` | Single color value → OKLCH | ✅ |
| `convertColor(color, space)` | Single color conversion | ✅ |
| `okColor(options?)` | Vite plugin factory | ✅ |
| `compileTokens(inputPath, options?)` | Compile design tokens to layered CSS/report/design tokens | ✅ |
| `compileTokenObject(tokens, options?)` | Compile in-memory design token object | ✅ |
| `writeCompileResult(inputPath, options?)` | Compile tokens and optionally write CSS/report files | ✅ |
| `expandChroma(input, options?)` | Increase chroma inside target gamut | ✅ |
| `fitGamut(input, options?)` | Reduce chroma to fit target gamut | ✅ |
| `gradeColor(input, options)` | Apply named recipe transform | ✅ |
| `describeColor(input, options?)` | Return OKLCH identity and gamut budget | ✅ |

## Token Compiler Status

| Capability | Status | Notes |
|------------|--------|-------|
| DTCG-like color token input | ✅ Partial | Supports string `$value`, `$value.hex`, and `$value.colorSpace: "srgb"` with numeric components. Alias resolution is not complete. |
| Layered CSS output | ✅ | Emits base hex, OKLCH `@supports`, and P3 `@media (color-gamut: p3)` layers. |
| Transform report | ✅ | Reports target gamut, strategy, recipe, deltas, neutral skip flags, and failure summary. |
| Recipe validation | ✅ | Built-in recipes and custom aliases fail loudly when invalid. |
| Malformed token diagnostics | ⚠️ Missing | Unsupported token shapes can still be skipped without structured diagnostics. |
| Contrast pairs | ✅ Partial | Declared pairs under `okcolor.text` are audited. Missing/skipped pair diagnostics need hardening. |
| `contrastLock` | ❌ Missing | Requires separate design before implementation. |
| Vite `reportPath` | ❌ Missing | CLI supports `--report`; Vite token mode does not yet expose report output. |

## Contrast Policy

WCAG 2.2 contrast ratio is the blocking compliance gate for declared token pairs. APCA
may be emitted as advisory metadata only; it must not be described as final WCAG 3
compliance because WCAG 3 has not finalized its contrast algorithm.

## Performance and Package Evidence

Do not copy old benchmark claims into release copy without rerunning the current suite.

| Evidence | Current source |
|----------|----------------|
| Scanner regression guard | `npm run bench:ci` compares `.tmp/bench-results.json` against `bench/baseline.json` with noisy high-RME readings reported instead of treated as exact. |
| WASM size target | The old `<100 KB` target is not met by recent evidence; latest recorded e2e build was `wasm-opt: 242 KB → 221 KB`. |
| Package size | Latest recorded `npm pack --dry-run --json`: 163,837 bytes package size, 459,112 bytes unpacked size, 27 files. |
| Install matrix | Ubuntu and Windows are covered; macOS install verification remains missing. |

## Architecture Status

The Rust scanner is split into deep modules under `packages/core-wasm/src/scan/`.
The token compiler still needs architecture deepening: `src/token/compiler.ts` currently
mixes parsing, recipe resolution, transform orchestration, CSS rendering, contrast audit,
report assembly, and file IO. Future work should extract domain modules, application use
cases, ports, and adapters before adding more token features.
