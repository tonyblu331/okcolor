# okcolor Input and Output Examples

This document shows the main okcolor surfaces with concrete inputs and representative outputs.

> Values are generated from the current local build. Tiny numeric changes can happen if the color math or rounding policy changes.

## 1. Vite CSS transform

### Input CSS

```css
.button {
  color: #ff0000;
  background: rgb(0 85 255);
  border-color: rebeccapurple;
}
```

### Output CSS

```css
.button {
  color: oklch(62.8% 0.25768 29.23);
  background: oklch(53.32% 0.25964 262.64);
  border-color: oklch(44.03% 0.1603 303.37);
}
```

Use this through the Vite plugin:

```ts
import { defineConfig } from 'vite'
import { okColor } from 'okcolor'

export default defineConfig({
  plugins: [okColor()],
})
```

## 2. Programmatic CSS audit

### Input

```ts
import { auditCss } from 'okcolor/core'

const stats = auditCss(`
.button {
  color: #ff0000;
  background: rgb(0 85 255);
  border-color: rebeccapurple;
}
`)
```

### Output

```json
{
  "legacy_count": 3,
  "hex_count": 1,
  "rgb_count": 1,
  "hsl_count": 0,
  "hwb_count": 0,
  "named_count": 1,
  "gradient_count": 0,
  "unique_count": 0
}
```

## 3. Single color conversion

### Input

```ts
import { colorToOklch } from 'okcolor/core'

colorToOklch('#ff5a00')
```

### Output

```txt
oklch(68.14% 0.21359 40.06)
```

## 4. P3 chroma expansion

### Input

```ts
import { expandChroma } from 'okcolor/core'

expandChroma('#ff5a00', { gamut: 'p3', amount: 0.75 })
```

### Output shape

```json
{
  "source": {
    "input": "#ff5a00",
    "hex": "#ff5a00",
    "oklch": { "l": 0.6814, "c": 0.21359, "h": 40.06 },
    "sourceGamut": "srgb"
  },
  "oklch": { "l": 0.6814, "c": 0.23439, "h": 40.06 },
  "css": "oklch(68.14% 0.23439 40.06)",
  "cMax": 0.24132,
  "amount": 0.75,
  "gamut": "p3",
  "strategy": "expand",
  "delta": { "lightness": 0, "chroma": 0.0208, "hue": 0 },
  "inGamut": true,
  "syntaxValid": true,
  "displaySafe": true,
  "neutralSkipped": false
}
```

## 5. Art-directed grade recipe

### Input

```ts
import { gradeColor } from 'okcolor/core'

gradeColor('#0055ff', { recipe: 'premium', gamut: 'p3' })
```

### Output shape

```json
{
  "source": {
    "input": "#0055ff",
    "hex": "#0055ff",
    "oklch": { "l": 0.5332, "c": 0.25964, "h": 262.64 },
    "sourceGamut": "srgb"
  },
  "oklch": { "l": 0.5182, "c": 0.27066, "h": 262.64 },
  "css": "oklch(51.82% 0.27066 262.64)",
  "gamut": "p3",
  "strategy": "grade",
  "recipe": "premium",
  "delta": { "lightness": -0.015, "chroma": 0.01102, "hue": 0 },
  "inGamut": true,
  "syntaxValid": true,
  "displaySafe": true
}
```

## 6. Gamut fit

### Input

```ts
import { fitGamut } from 'okcolor/core'

fitGamut('oklch(70% 0.35 145)', { gamut: 'srgb' })
```

### Output shape

```json
{
  "source": {
    "input": "oklch(70% 0.35 145)",
    "hex": "#00cd00",
    "oklch": { "l": 0.7, "c": 0.35, "h": 145 },
    "sourceGamut": "srgb"
  },
  "oklch": { "l": 0.7, "c": 0.22016, "h": 145 },
  "css": "oklch(70% 0.22016 145)",
  "cMax": 0.22016,
  "strategy": "fit",
  "delta": { "lightness": 0, "chroma": -0.12984, "hue": 0 },
  "inGamut": true,
  "syntaxValid": true,
  "displaySafe": true
}
```

## 7. Color description

### Input

```ts
import { describeColor } from 'okcolor/core'

describeColor('#ff5a00', { gamut: 'p3' })
```

### Output

```json
{
  "source": {
    "input": "#ff5a00",
    "hex": "#ff5a00",
    "oklch": { "l": 0.6814, "c": 0.21359, "h": 40.06 },
    "sourceGamut": "srgb"
  },
  "target": {
    "gamut": "p3",
    "cMax": 0.24132,
    "availableChromaBudget": 0.02773
  },
  "suggestions": {
    "literal": "oklch(68.14% 0.21359 40.06)",
    "p3 expand 75%": "oklch(68.14% 0.23439 40.06)",
    "premium": "oklch(66.64% 0.22233 40.06)"
  }
}
```

## 8. Token compiler input

### Input tokens

```json
{
  "color.action.primary.bg": {
    "$type": "color",
    "$value": "#0055ff",
    "okcolor": {
      "text": "color.action.primary.fg",
      "contrast": "wcag2-aa"
    }
  },
  "color.action.primary.fg": "#ffffff",
  "brand.orange": {
    "$type": "color",
    "$value": "#ff5a00",
    "okcolor": { "recipe": "premium" }
  },
  "bad.components": {
    "$type": "color",
    "$value": {
      "colorSpace": "srgb",
      "components": [1, "none", 0]
    }
  }
}
```

### Compile call

```ts
import { compileTokenObject } from 'okcolor/core'

const result = compileTokenObject(tokens, {
  targets: {
    base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
    p3: { gamut: 'p3', strategy: 'expand', amount: 0.75, format: 'oklch' },
  },
})
```

### Output CSS

```css
:root {
  --color-action-primary-bg: #0055ff;
  --color-action-primary-fg: #ffffff;
  --brand-orange: #ff5a00;
}

@supports (color: oklch(0.5 0.1 40)) {
  :root {
  --color-action-primary-bg-oklch: oklch(53.32% 0.25964 262.64);
  --color-action-primary-fg-oklch: oklch(100% 0 0);
  --brand-orange-oklch: oklch(68.14% 0.21359 40.06);
  }
}

@media (color-gamut: p3) {
  @supports (color: oklch(0.5 0.1 40)) {
    :root {
    --color-action-primary-bg: oklch(53.32% 0.2732 262.64);
    --color-action-primary-fg: oklch(100% 0 0);
    --brand-orange: oklch(66.64% 0.22451 40.06);
    }
  }
}
```

### Output report, shortened

```json
{
  "schemaVersion": 1,
  "tokens": [
    {
      "token": "color.action.primary.bg",
      "source": "#0055ff",
      "targets": {
        "srgb": { "css": "#0055ff", "strategy": "convert" },
        "p3": { "css": "oklch(53.32% 0.2732 262.64)", "strategy": "expand" }
      },
      "contrast": {
        "wcag2": {
          "color.action.primary.fg@srgb": {
            "ratio": 5.61,
            "required": 4.5,
            "requirement": "wcag2-aa",
            "status": "pass"
          },
          "color.action.primary.fg@p3": {
            "ratio": 5.66,
            "required": 4.5,
            "requirement": "wcag2-aa",
            "status": "pass"
          }
        },
        "apca": {
          "color.action.primary.fg@srgb": { "lc": -80, "polarity": "reverse", "advisory": "pass-body" },
          "color.action.primary.fg@p3": { "lc": -80.2, "polarity": "reverse", "advisory": "pass-body" }
        }
      }
    },
    {
      "token": "brand.orange",
      "source": "#ff5a00",
      "targets": {
        "srgb": { "css": "#ff5a00", "strategy": "convert" },
        "p3": { "css": "oklch(66.64% 0.22451 40.06)", "strategy": "grade", "recipe": "premium" }
      }
    }
  ],
  "diagnostics": [
    {
      "token": "bad.components",
      "kind": "invalid-color-components",
      "severity": "warning",
      "path": "$value.components",
      "message": "sRGB token color components must be finite numbers."
    }
  ],
  "contrastPairs": [
    {
      "background": "color.action.primary.bg",
      "foreground": "color.action.primary.fg",
      "target": "srgb",
      "status": "evaluated",
      "wcag2Key": "color.action.primary.fg@srgb",
      "apcaKey": "color.action.primary.fg@srgb"
    },
    {
      "background": "color.action.primary.bg",
      "foreground": "color.action.primary.fg",
      "target": "p3",
      "status": "evaluated",
      "wcag2Key": "color.action.primary.fg@p3",
      "apcaKey": "color.action.primary.fg@p3"
    }
  ],
  "summary": {
    "contrastPassed": true,
    "failureCount": 0,
    "failures": []
  }
}
```

## 9. CLI examples

### Single color

```bash
npx okcolor convert "#ff5a00" --to oklch
```

```txt
oklch(68.14% 0.21359 40.06)
```

### Token compile

```bash
npx okcolor expand ./tokens.json --gamut p3 --amount 0.75 --out ./colors.css --report ./okcolor.report.json
```

Outputs:

- `colors.css`: fallback-first CSS with optional P3 overrides.
- `okcolor.report.json`: versioned report with `schemaVersion`, token diagnostics, pair-level contrast results, and summary failures.

## 10. Advanced browser runtime adapter

Use this only for playgrounds, inspectors, color pickers, and design-system UIs. For normal app CSS, prefer the Vite plugin so conversion stays build-time and okcolor is not shipped in your app bundle.

### Input

```ts
import { colorToOklch, initOkColorBrowser, transformCss } from 'okcolor/browser'

await initOkColorBrowser()

const color = colorToOklch('#ff5a00')
const css = transformCss('.swatch { background: #ff5a00; }')
```

### Output

```ts
color
// 'oklch(68.14% 0.21359 40.06)'

css
// '.swatch { background: oklch(68.14% 0.21359 40.06); }'
```
