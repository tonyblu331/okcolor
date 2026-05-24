# okcolor

[![npm](https://img.shields.io/npm/v/okcolor?label=okcolor&color=16a34a)](https://www.npmjs.com/package/okcolor)
[![License: MIT](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

Zero-config, build-time color modernizer for **Vite** and **Tailwind CSS**. Converts legacy Hex, RGB, HSL, HWB, and named colors to perceptually uniform **OKLCH** at build time. Zero runtime overhead.

- **Rust/WASM engine** compiles to ~80 KB — processes **55 MB/s**
- **W3C-exact matrices** (Ottosson 2020, CSS Color 4) — sub-5e-5 error vs Culori
- **Idempotent** — second pass is a no-op
- **Cache** — 4096-slot direct-mapped: `#ff0000`, `rgb(255,0,0)`, and `red` hit the same slot

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

| Metric | okcolor (WASM) | Culori | color.js |
|--------|---------------|--------|----------|
| Throughput | **55 MB/s** | ~12 µs/color | ~18 µs/color |
| Per-color (cached) | **0.24 µs** | — | — |
| Per-color (cold) | 0.31 µs | — | — |
| Bundle | **80 KB** | — | — |

Measured on AMD Ryzen 7 5800X, Node.js 26. The full 5-stage pipeline (parse, gamma decode, matrix, cache, format) runs in a single pass.

## Documentation

Full docs and interactive playground: **[tonyblu331.github.io/okcolor](https://tonyblu331.github.io/okcolor)**

## License

MIT &copy; Antonio Bonet
