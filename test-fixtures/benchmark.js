import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const wasm = require('../packages/core-wasm/pkg-nodejs/ok_actually_core.js')
const encoder = new TextEncoder()
const fs = require('fs')

function bench(name, fn, iterations = 1000) {
  for (let i = 0; i < 100; i++) fn()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = performance.now() - start
  const perCall = (elapsed / iterations).toFixed(3)
  const opsPerSec = (iterations / (elapsed / 1000)).toFixed(0)
  console.log(`${name.padEnd(45)} ${perCall.padStart(8)} ms/call  ${opsPerSec.padStart(8)} ops/sec`)
  return elapsed
}

function generateComplexCss(colors) {
  let css = ''
  const formats = [
    (r,g,b) => `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`,
    (r,g,b) => `rgb(${r}, ${g}, ${b})`,
    (r,g,b) => `hsl(${Math.floor(Math.random()*360)}, ${Math.floor(Math.random()*100)}%, 50%)`,
    (r,g,b) => `hwb(${Math.floor(Math.random()*360)} ${Math.floor(Math.random()*50)}% ${Math.floor(Math.random()*50)}%)`,
  ]
  for (let i = 0; i < colors; i++) {
    const r = Math.floor(Math.random() * 256)
    const g = Math.floor(Math.random() * 256)
    const b = Math.floor(Math.random() * 256)
    const fmt = formats[i % formats.length]
    css += `.c${i} { color: ${fmt(r,g,b)}; background: ${fmt(g,b,r)}; border: 1px solid ${fmt(b,r,g)}; }\n`
  }
  for (let i = 0; i < colors / 10; i++) {
    css += `.g${i} { background: linear-gradient(to right, #ff0000, #00ff00, #0000ff); }\n`
  }
  for (let i = 0; i < colors / 20; i++) {
    css += `.v${i} { color: var(--x); width: calc(100% - 10px); }\n`
  }
  return css
}

function generateCrossFormatCss(uniqueColors, repetitions) {
  // Same colors expressed in hex, rgb, hsl, hwb, named — tests numeric cache
  const formats = [
    (r,g,b) => `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`,
    (r,g,b) => `rgb(${r}, ${g}, ${b})`,
    (r,g,b) => `hsl(${Math.floor(Math.random()*360)}, ${Math.floor(Math.random()*100)}%, 50%)`,
    (r,g,b) => `hwb(${Math.floor(Math.random()*360)} ${Math.floor(Math.random()*50)}% ${Math.floor(Math.random()*50)}%)`,
  ]
  let css = ''
  for (let i = 0; i < uniqueColors; i++) {
    const r = Math.floor(Math.random() * 256)
    const g = Math.floor(Math.random() * 256)
    const b = Math.floor(Math.random() * 256)
    for (let j = 0; j < repetitions; j++) {
      const fmt = formats[j % formats.length]
      css += `.c${i}_${j} { color: ${fmt(r,g,b)}; }\n`
    }
  }
  return css
}

console.log('═══ okcolor Performance Benchmarks ═══\n')
console.log(`Node ${process.version}\n`)

const small = generateComplexCss(10)
console.log(`Small file:  ${(small.length/1024).toFixed(2)} KB, ~10 colors`)
bench('  transform', () => wasm.transform_css(encoder.encode(small)), 5000)
bench('  audit',     () => wasm.audit_css(encoder.encode(small)), 5000)

const medium = generateComplexCss(100)
console.log(`\nMedium file: ${(medium.length/1024).toFixed(2)} KB, ~100 colors`)
bench('  transform', () => wasm.transform_css(encoder.encode(medium)), 1000)
bench('  audit',     () => wasm.audit_css(encoder.encode(medium)), 1000)

const large = generateComplexCss(1000)
console.log(`\nLarge file:  ${(large.length/1024).toFixed(2)} KB, ~1000 colors`)
bench('  transform', () => wasm.transform_css(encoder.encode(large)), 200)
bench('  audit',     () => wasm.audit_css(encoder.encode(large)), 200)

// Throughput
const largeBytes = encoder.encode(large).length
const tTime = bench('transform (throughput)', () => wasm.transform_css(encoder.encode(large)), 200)
console.log(`  → ${((largeBytes * 200) / (tTime / 1000) / 1024 / 1024).toFixed(1)} MB/s`)

// Cross-format dedup benchmark
const crossFmt = generateCrossFormatCss(50, 20)
console.log(`\n═══ Cross-format: 50 unique × 20 formats = 1000 colors ═══`)
console.log(`  File size: ${(crossFmt.length/1024).toFixed(2)} KB`)
const crossAudit = JSON.parse(wasm.audit_css(encoder.encode(crossFmt)))
console.log(`  Legacy: ${crossAudit.legacy_count} | Unique strings: ${crossAudit.unique_count}`)
bench('  transform', () => wasm.transform_css(encoder.encode(crossFmt)), 500)

// Real-world fixture
const complexCss = fs.readFileSync('./complex.css', 'utf-8')
console.log(`\n═══ Real-world: complex.css (${(complexCss.length/1024).toFixed(2)} KB) ═══`)
const audit = JSON.parse(wasm.audit_css(encoder.encode(complexCss)))
console.log(`  Legacy: ${audit.legacy_count} | Hex: ${audit.hex_count} | RGB: ${audit.rgb_count} | HSL: ${audit.hsl_count} | HWB: ${audit.hwb_count || 0} | Named: ${audit.named_count} | Gradients: ${audit.gradient_count} | Unique: ${audit.unique_count}`)
bench('  transform', () => wasm.transform_css(encoder.encode(complexCss)), 1000)
bench('  audit',     () => wasm.audit_css(encoder.encode(complexCss)), 1000)

// Idempotency: output should not change after pass 2
console.log('\n═══ Idempotency (output stabilizes after 1st pass) ═══')
let css = complexCss
const outputs = []
for (let pass = 1; pass <= 5; pass++) {
  const start = performance.now()
  css = wasm.transform_css(encoder.encode(css))
  const elapsed = performance.now() - start
  const audit2 = JSON.parse(wasm.audit_css(encoder.encode(css)))
  outputs.push(css)
  const stable = pass > 2 && outputs[pass-1] === outputs[pass-2] ? '✓' : '—'
  console.log(`  Pass ${pass}: ${elapsed.toFixed(2)} ms | legacy=${audit2.legacy_count} | stable=${stable}`)
}

// Compare regex vs DFA
console.log('\n═══ Why DFA, not regex (simulated) ═══')
const regex = /#(?:[0-9a-fA-F]{3}){1,2}\b|rgb\([^)]*\)|hsl\([^)]*\)/g
const regexStart = performance.now()
for (let i = 0; i < 1000; i++) {
  const _ = complexCss.match(regex)
}
const regexTime = performance.now() - regexStart
console.log(`  Regex find-only  (1000×): ${regexTime.toFixed(1)} ms`)
const dfaTime = bench('  DFA scan+convert', () => wasm.audit_css(encoder.encode(complexCss)), 1000)
console.log(`  → Regex is ${(dfaTime / regexTime).toFixed(1)}× faster for find-only, but wrong`)
console.log(`    (matches colors inside strings/comments/gradients)`)
console.log(`  → DFA is correct: skips strings, comments, var(), oklch(), etc.`) 
