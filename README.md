# okcolor

[![npm](https://img.shields.io/npm/v/okcolor?label=okcolor&color=16a34a)](https://www.npmjs.com/package/okcolor)
[![License: MIT](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

Zero-config, build-time color modernizer for **Vite** and **Tailwind CSS**. Converts legacy Hex, RGB, HSL, HWB, and named colors to perceptually uniform **OKLCH** at build time. Zero runtime overhead.

- **Rust/WASM engine** — ~145 KB total
- **W3C-exact matrices** (Ottosson 2020, CSS Color 4) — sub-5e-5 error vs Culori
- **Idempotent** — second pass is a no-op
- **Cache** — 4096-slot direct-mapped: `#ff0000`, `rgb(255,0,0)`, and `red` hit the same slot

## Why okcolor?

The web is modernizing. Design tokens are shifting from Hex and `rgb()` to perceptually uniform spaces like **OKLCH** and **Oklab** — spaces where lightness maps to what humans actually see, where interpolation doesn't turn muddy, and where gamut boundaries make sense.

AI agents still emit Hex. Most color pickers still default to `#`. Established workflows are built on decades of sRGB hex codes. And that's fine — Hex is human-readable, compact, and universal. But when you're targeting modern displays (Display P3, Rec2020) with wider gamuts and extended ranges, Hex locks you into sRGB.

okcolor breaks that lock. Write your colors however you want — **Hex**, **RGB**, **HSL**, **HWB**, named, modern — and okcolor converts them to **OKLCH at build time**. Work in the space that makes sense for your intent, then compile to modern CSS. Zero runtime cost, zero lock-in.

## Compared to alternatives

| Feature | okcolor | Culori | color.js | PostCSS |
|---------|---------|--------|----------|---------|
| Hex → OKLCH | ✓ | ✓ | ✓ | — |
| RGB/HSL/HWB → OKLCH | ✓ | ✓ | ✓ | — |
| Named colors → OKLCH | ✓ | ✓ | ✓ | — |
| Full CSS parse (comments, strings, var()) | ✓ | ✗ | ✗ | ✓ |
| color-mix() pass-through | ✓ | ✗ | ✓ | ✓ |
| light-dark() pass-through | ✓ | ✗ | ✓ | — |
| Display-P3 / Rec2020 pass-through | ✓ | ✓ | ✓ | ✓ |
| auto-detect legacy colors | ✓ | ✗ | ✗ | — |
| oklch-ignore escape hatch | ✓ | ✗ | ✗ | — |
| Build-time only (zero runtime) | ✓ | ✗ | ✗ | ✓ |
| CLI with audit / check / doctor | ✓ | ✗ | ✗ | — |
| WASM engine | ✓ | ✗ | ✗ | — |
| 4096-slot color cache | ✓ | ✗ | ✗ | — |
| Idempotent (no-op on modern CSS) | ✓ | ✗ | ✗ | — |

## Install

```bash
npm install -D okcolor
pnpm add -D okcolor
bun add -D okcolor
```

## Usage

### Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { okColor } from 'okcolor'

export default defineConfig({
  plugins: [okColor()],
})
```

### CLI

```bash
# Transform files
npx okcolor input.css -o output.css

# Audit color debt
npx okcolor audit ./src
npx okcolor audit --format=json

# CI gate
npx okcolor check --max-legacy-colors=10

# Diagnose issues
npx okcolor doctor ./src
```

### Programmatic

```ts
import { transformCss, auditCss } from 'okcolor/core'

const result = transformCss(`
  .btn { color: #ff0000; }
`)
// .btn { color: oklch(62.8% 0.25768 29.23); }

const stats = auditCss(source)
console.log(stats.legacy_count) // number of legacy colors
```

## Examples

| Input | Output |
|-------|--------|
| `#ff0000` | `oklch(62.8% 0.25768 29.23)` |
| `rgb(255, 0, 0)` | `oklch(62.8% 0.25768 29.23)` |
| `hsl(0, 100%, 50%)` | `oklch(62.8% 0.25768 29.23)` |
| `hwb(0 0% 0%)` | `oklch(62.8% 0.25768 29.23)` |
| `red` | `oklch(62.8% 0.25768 29.23)` |
| `linear-gradient(red, blue)` | `linear-gradient(in oklch, oklch(62.8% 0.25768 29.23), oklch(45.2% 0.31321 264.05))` |

Modern colors (`oklch()`, `oklab()`, `color(display-p3 ...)`, `color-mix()`, `light-dark()`) pass through untouched.

## Escape hatch

```css
.retro-badge {
  background-color: #ff0000; /* oklch-ignore */
}
```

## Benchmarks

| Metric | okcolor | Culori | color.js |
|--------|---------|--------|----------|
| Per-color (cached) | **0.68 µs** | — | — |
| Per-color (cold) | **0.77 µs** | 0.83 µs | 20.6 µs |
| CSS transform (100 KB) | **45 MB/s** | 66 MB/s¹ | 4.4 MB/s¹ |
| Bundle size | **145 KB** | 134 KB | 198 KB |

¹ Culori and color.js use regex-based CSS scanning (fewer edge cases handled — no named color support, no comment/string awareness). okcolor does full lexical analysis.

Measured on Intel Core i9-13900H, Node.js 26. The full 5-stage pipeline (parse, gamma decode, matrix, cache, format) runs in a single WASM pass. Per-color averages across 10 different color values.
## Documentation

Full docs and interactive playground: **[tonyblu331.github.io/okcolor](https://tonyblu331.github.io/okcolor)**

## License

MIT &copy; Antonio Bonet
