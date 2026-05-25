import { describe, bench } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformCss, auditCss, colorToOklch } from '../src/wasm.js'
import { okColor } from '../src/vite.js'

// ── Fixtures ──────────────────────────────────────────────────────────────

const hexOnly = Array(500).fill('.a { color: #ff0000; }').join('\n')
const rgbOnly = Array(500).fill('.a { color: rgb(255, 0, 0); }').join('\n')
const hslOnly = Array(500).fill('.a { color: hsl(0, 100%, 50%); }').join('\n')
const hwbOnly = Array(500).fill('.a { color: hwb(0 0% 0%); }').join('\n')
const namedOnly = Array(500).fill('.a { color: red; }').join('\n')
const mixedModern = Array(500).fill('.a { color: oklch(50% 0.2 180); }').join('\n')
const noColors = Array(500).fill('.a { display: flex; }').join('\n')
const mixedColors = Array(200)
  .fill('.x { color: #ff0000; background: rgb(0,255,0); border: 1px solid hsl(200,50%,50%); box-shadow: 0 0 red; }')
  .join('\n')
const ignoreHeavy = Array(500).fill('.a { color: #ff0000; /* oklch-ignore */ }').join('\n')

const gradients = Array(200)
  .fill('.g { background: linear-gradient(to right, #ff0000, #00ff00, blue); }')
  .join('\n')

const realWorldCss = readFileSync(resolve(import.meta.dirname, '..', 'complex.css'), 'utf-8')

// ── Benchmarks ────────────────────────────────────────────────────────────

describe('Color format throughput (50 KB each)', () => {
  bench('hex only transform', () => transformCss(hexOnly))
  bench('rgb only transform', () => transformCss(rgbOnly))
  bench('hsl only transform', () => transformCss(hslOnly))
  bench('hwb only transform', () => transformCss(hwbOnly))
  bench('named only transform', () => transformCss(namedOnly))
  bench('modern (no-op) transform', () => transformCss(mixedModern))
  bench('no colors (fast path) transform', () => transformCss(noColors))
  bench('mixed colors transform', () => transformCss(mixedColors))
  bench('oklch-ignore heavy transform', () => transformCss(ignoreHeavy))
})

describe('Gradient throughput', () => {
  bench('gradient-heavy transform', () => transformCss(gradients))
  bench('gradient-heavy audit', () => auditCss(gradients))
})

describe('Single color operations', () => {
  bench('single hex -> oklch', () => colorToOklch('#ff0000'))
  bench('single rgb -> oklch', () => colorToOklch('rgb(255, 0, 0)'))
  bench('single hsl -> oklch', () => colorToOklch('hsl(0, 100%, 50%)'))
  bench('single named -> oklch', () => colorToOklch('rebeccapurple'))
  bench('single modern (pass-through)', () => colorToOklch('oklch(50% 0.2 180)'))
})

describe('Audit benchmarks', () => {
  bench('audit mixed colors', () => auditCss(mixedColors))
  bench('audit hex only', () => auditCss(hexOnly))
  bench('audit no colors', () => auditCss(noColors))
  bench('audit gradients', () => auditCss(gradients))
})

describe('Vite plugin overhead', () => {
  const plugin = okColor()
  const css = '.a { color: #ff0000; }'

  bench('plugin transform .css file', async () => {
    await plugin.transform!(css, 'test.css')
  })

  bench('plugin transform .vue file', async () => {
    await plugin.transform!('<style>.a { color: #ff0000; }</style>', 'test.vue')
  })

  bench('plugin transform .astro file', async () => {
    await plugin.transform!('<style>.a { color: #ff0000; }</style>', 'test.astro')
  })

  bench('plugin no-op (no colors)', async () => {
    await plugin.transform!('.a { display: flex; }', 'test.css')
  })
})

describe('Idempotency (second pass)', () => {
  const alreadyModern = transformCss(mixedColors)

  bench('second pass transform (should be no-op)', () => {
    transformCss(alreadyModern)
  })
})
