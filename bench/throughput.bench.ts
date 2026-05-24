import { describe, bench } from 'vitest'
import { transformCss, auditCss } from '../src/wasm.js'

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

const sm = css
const md = Array(9).fill(css).join('\n')
const lg = Array(74).fill(css).join('\n')

describe('WASM engine throughput', () => {
  bench('transform: 1.3 KB file', () => {
    transformCss(sm)
  })

  bench('transform: 12 KB file', () => {
    transformCss(md)
  })

  bench('transform: 100 KB file', () => {
    transformCss(lg)
  })

  bench('audit: 100 KB file', () => {
    auditCss(lg)
  })
})
