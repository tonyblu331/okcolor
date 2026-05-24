import { describe, bench } from 'vitest'
import { transformCss, colorToOklch, auditCss } from '../src/wasm.js'
import * as culori from 'culori'
import Color from 'colorjs.io'

const colors = [
  '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000',
  '#1a1a2e', '#e94560', '#16213e', '#0f3460', '#ff6b6b',
]

function culoriToOklch(c: string) {
  return culori.formatCss(culori.converter('oklch')(c))
}

function colorjsToOklch(c: string) {
  return new Color(c).to('oklch').toString()
}

const css = `.btn { color: #ff0000; background: hsl(0, 100%, 50%); }
.card { border: 1px solid rgb(255, 0, 0); }
.badge { color: red; }
.alert { background: hwb(0 0% 0%); }
.grad { background: linear-gradient(to right, #ff0000, #00ff00); }
.ok { color: oklch(62.8% 0.2577 29.23); }
.var { color: var(--primary); }
.str { content: "#ff0000"; }
.alpha { color: rgba(255, 0, 0, 0.5); }
.hex8 { color: #ff000080; }
.color-srgb { color: color(srgb 1 0 0); }
.modern { color: oklab(0.628 0.224 0.126); }
.ignore { color: #ff0000; /* oklch-ignore */ }
.wide { color: #1a1a2e; background: hsl(250 80% 60%); }
.mix { border: 2px solid hsl(145, 63%, 49%); box-shadow: 0 2px 4px rgb(0 0 0 / 20%); }`
const lg = Array(74).fill(css).join('\n')

function culoriTransform(src: string) {
  const converter = culori.converter('oklch')
  return src.replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|hwb\([^)]+\)/gi, (m) => {
    try { return culori.formatCss(converter(m)) || m } catch { return m }
  })
}

function colorjsTransform(src: string) {
  return src.replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|hwb\([^)]+\)/gi, (m) => {
    try { return new Color(m).to('oklch').toString() } catch { return m }
  })
}

describe('okcolor — per-color', () => {
  for (const c of colors) {
    bench(`okcolor: ${c}`, () => colorToOklch(c))
  }
})

describe('okcolor cached — #ff0000 × 100', () => {
  bench('okcolor cached', () => { for (let i = 0; i < 100; i++) colorToOklch('#ff0000') })
})

describe('Culori — per-color', () => {
  for (const c of colors) {
    bench(`Culori: ${c}`, () => culoriToOklch(c))
  }
})

describe('color.js — per-color', () => {
  for (const c of colors) {
    bench(`color.js: ${c}`, () => colorjsToOklch(c))
  }
})

describe('Whole-file transform (100 KB)', () => {
  bench('okcolor', () => transformCss(lg))
  bench('Culori', () => culoriTransform(lg))
  bench('color.js', () => colorjsTransform(lg))
})

describe('CSS Audit', () => {
  bench('okcolor audit (100 KB)', () => auditCss(lg))
})
