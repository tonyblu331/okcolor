# ok-actually

[![CI](https://github.com/ok-actually/ok-actually/actions/workflows/ci.yml/badge.svg)](https://github.com/ok-actually/ok-actually/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ok-actually)](https://www.npmjs.com/package/ok-actually)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Zero-config build-time color modernizer. Converts legacy Hex, RGB, HSL, HWB, and named colors to perceptually uniform **OKLCH** before they reach the browser.

## Install

```bash
npm install -D ok-actually
```

## Usage

### Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { okActually } from 'ok-actually'

export default defineConfig({
  plugins: [okActually()],
})
```

Place it **before** the Tailwind CSS v4 plugin so Oxide receives wide-gamut source variables.

### CLI

```bash
# Audit color debt
npx ok-actually audit
npx ok-actually audit ./src/styles --format=json

# Gate CI pipelines
npx ok-actually check --max-legacy-colors=10

# Diagnose malformed colors
npx ok-actually doctor ./src/styles
```

### Programmatic API

```ts
import { transformCss, auditCss } from 'ok-actually/core'

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

Modern colors (`oklch()`, `oklab()`, `color(display-p3 ...)`, `color-mix()`, `light-dark()`, `relative-color()`) pass through untouched.

## Escape hatch

```css
.retro-badge {
  background-color: #ff0000; /* oklch-ignore */
}
```

The scanner skips any color on a line containing `/* oklch-ignore */`.

## Documentation

Full docs and API reference: **[ok-actually.github.io/ok-actually](https://ok-actually.github.io/ok-actually)**

## License

MIT © ok-actually contributors
