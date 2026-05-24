# okColor

[![npm](https://img.shields.io/npm/v/okcolor)](https://www.npmjs.com/package/okcolor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Zero-config build-time color modernizer. Converts legacy Hex, RGB, HSL, HWB, and named colors to perceptually uniform **OKLCH** before they reach the browser. Conversions use **W3C-exact matrices** with sign-preserving gamma correction for sub-5e-5 accuracy against the Culori reference.

## Install

```bash
npm install -D okcolor
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

Place it **before** the Tailwind CSS v4 plugin so Oxide receives wide-gamut source variables.

### CLI

```bash
# Audit color debt
npx okcolor audit
npx okcolor audit ./src/styles --format=json

# Gate CI pipelines
npx okcolor check --max-legacy-colors=10

# Diagnose malformed colors
npx okcolor doctor ./src/styles
```

### Programmatic API

```ts
import { transformCss, auditCss } from 'okcolor/core'

const transformed = transformCss(`
  .btn { color: #ff0000; }
`)
// .btn { color: oklch(62.8% 0.2577 29.23); }

const stats = auditCss(cssSource)
console.log(stats.legacy_count) // 1
```

## Examples

**Input CSS**

```css
.card {
  color: #ff0000;
  background: hsl(0, 100%, 50%);
  border: 1px solid rgb(255, 0, 0);
}

.gradient {
  background: linear-gradient(red, blue);
}
```

**Output CSS**

```css
.card {
  color: oklch(62.8% 0.2577 29.23);
  background: oklch(62.8% 0.2577 29.23);
  border: 1px solid oklch(62.8% 0.2577 29.23);
}

.gradient {
  background: linear-gradient(in oklch, oklch(62.8% 0.2577 29.23), oklch(45.2% 0.3132 264.05));
}
```

### Supported conversions

| Input | Example | Output |
|-------|---------|--------|
| Hex | `#ff0000` | `oklch(62.8% 0.2577 29.23)` |
| RGB | `rgb(255, 0, 0)` | `oklch(62.8% 0.2577 29.23)` |
| HSL | `hsl(0, 100%, 50%)` | `oklch(62.8% 0.2577 29.23)` |
| HWB | `hwb(0 0% 0%)` | `oklch(62.8% 0.2577 29.23)` |
| Named | `red` | `oklch(62.8% 0.2577 29.23)` |
| Gradient | `linear-gradient(red, blue)` | `linear-gradient(in oklch, oklch(...), oklch(...))` |

Modern colors (`oklch()`, `oklab()`, `color(display-p3 ...)`, `color-mix()`, `light-dark()`, `relative-color()`) pass through untouched.

## Escape hatch

```css
.retro-badge {
  background-color: #ff0000; /* oklch-ignore */
}
```

The scanner skips any color on a line containing `/* oklch-ignore */`.

## Documentation

Full docs and API reference: **[tonyblu331.github.io/okcolor](https://tonyblu331.github.io/okcolor)**

## License

MIT © okcolor contributors
