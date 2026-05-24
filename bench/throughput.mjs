// Quick benchmark for the WASM color engine
// Run: node bench/throughput.mjs

const { transformCss, auditCss } = await import('../src/wasm.js')

// 17 KB realistic CSS (like a full tailwind.css)
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

// Repeat to build up realistic file sizes
const sm = css  // 1.3 KB
const md = Array(9).fill(css).join('\n')  // ~12 KB
const lg = Array(74).fill(css).join('\n')  // ~100 KB
const xl = Array(740).fill(css).join('\n')  // ~1 MB

function bench(label, source, iterations = 100) {
  // Warmup
  for (let i = 0; i < 5; i++) transformCss(source)

  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) transformCss(source)
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6  // ms

  const bytes = source.length * iterations
  const mb = bytes / 1024 / 1024
  const rate = (mb / (elapsed / 1000)).toFixed(1)

  console.log(`${label}:`)
  console.log(`  ${source.length.toLocaleString()} bytes × ${iterations} = ${(source.length * iterations / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  ${elapsed.toFixed(2)} ms total, ${(elapsed / iterations).toFixed(3)} ms/op`)
  console.log(`  ${rate} MB/s`)
  console.log()

  return { elapsed, rate }
}

console.log('═'.repeat(48))
console.log('  okcolor WASM Engine Benchmark')
console.log('═'.repeat(48))
console.log()

bench('Small file (1.3 KB)', sm, 1000)
bench('Medium file (12 KB)', md, 100)
bench('Large file (100 KB)', lg, 20)
bench('XL file (1 MB)', xl, 5)

// Audit benchmark
console.log('── Audit ──')
const start = process.hrtime.bigint()
for (let i = 0; i < 500; i++) auditCss(lg)
const elapsed = Number(process.hrtime.bigint() - start) / 1e6
console.log(`Audit 100 KB × 500: ${elapsed.toFixed(1)} ms, ${(50 / (elapsed / 1000)).toFixed(1)} MB/s`)
console.log()

// Color counts
const result = transformCss(xl)
const audits = auditCss(xl)
console.log(`Transformed ${audits.legacy_count} legacy colors across ${xl.length.toLocaleString()} bytes`)
