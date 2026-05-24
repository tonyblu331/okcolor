import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const wasm = require('../packages/core-wasm/pkg-nodejs/ok_actually_core.js')
const encoder = new TextEncoder()

// W3C CSS Color Module Level 4 / OKLab paper reference values
const REFERENCES = [
  { name: 'red',     rgb: [255, 0, 0],     oklch: { l: 0.627955, c: 0.257683, h: 29.2339 } },
  { name: 'green',   rgb: [0, 255, 0],     oklch: { l: 0.866440, c: 0.294828, h: 142.513 } },
  { name: 'blue',    rgb: [0, 0, 255],     oklch: { l: 0.452014, c: 0.313215, h: 264.052 } },
  { name: 'white',   rgb: [255, 255, 255], oklch: { l: 1.000000, c: 0.000000, h: 0.0 } },
  { name: 'black',   rgb: [0, 0, 0],       oklch: { l: 0.000000, c: 0.000000, h: 0.0 } },
  { name: 'yellow',  rgb: [255, 255, 0],    oklch: { l: 0.967797, c: 0.211076, h: 109.78 } },
  { name: 'cyan',    rgb: [0, 255, 255],    oklch: { l: 0.905399, c: 0.154549, h: 194.77 } },
  { name: 'magenta', rgb: [255, 0, 255],    oklch: { l: 0.701674, c: 0.322465, h: 328.36 } },
  { name: 'gray50',  rgb: [128, 128, 128],  oklch: { l: 0.599900, c: 0.000000, h: 0.0 } }, // D65 sRGB 128 → OKLab L≈0.5999
]

function parseOklch(css) {
  const m = css.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) return null
  return { l: parseFloat(m[1]) / 100, c: parseFloat(m[2]), h: parseFloat(m[3]) }
}

// Tolerances account for to_css() rounding: L≈0.0001, C≈0.0001, H≈0.01
const TOL = { l: 0.001, c: 0.001, h: 0.5 }

console.log('═══ MATH VERIFICATION vs W3C/CSS Color Module Level 4 ═══\n')
console.log('Tolerance: L < 0.001,  C < 0.001,  H < 0.5° (accounts for to_css() rounding)\n')
console.log('Color     │ L error    │ C error    │ H error   │')
console.log('──────────┼────────────┼────────────┼───────────┤')

let maxErr = { l: 0, c: 0, h: 0 }
let allPass = true

for (const ref of REFERENCES) {
  const css = `color: rgb(${ref.rgb.join(', ')});`
  const out = wasm.transform_css(encoder.encode(css))
  const got = parseOklch(out)

  const errL = Math.abs(got.l - ref.oklch.l)
  const errC = Math.abs(got.c - ref.oklch.c)
  const errH = Math.abs(got.h - ref.oklch.h)
  const pass = errL < TOL.l && errC < TOL.c && errH < TOL.h
  if (!pass) allPass = false

  maxErr.l = Math.max(maxErr.l, errL)
  maxErr.c = Math.max(maxErr.c, errC)
  maxErr.h = Math.max(maxErr.h, errH)

  const status = pass ? '✓' : '✗'
  console.log(
    `${ref.name.padEnd(9)} │ ${errL.toExponential(2).padStart(10)} ${status} │ ` +
    `${errC.toExponential(2).padStart(10)} ${status} │ ` +
    `${errH.toFixed(2).padStart(7)}° ${status} │`
  )
}

console.log(`\nMax errors:  L=${maxErr.l.toExponential(2)}  C=${maxErr.c.toExponential(2)}  H=${maxErr.h.toFixed(2)}°`)
console.log(allPass ? '\n✓ ALL PASS — within tolerance' : '\n✗ SOME FAILED')

// Alpha preservation check
console.log('\n═══ ALPHA CHANNEL VERIFICATION ═══')
const ALPHA_TESTS = [
  { input: 'rgba(255,0,0,0.5)',     expect: '/ 0.5' },
  { input: '#ff000080',             expect: '/ 0.502' },
  { input: 'hsla(0,100%,50%,0.25)', expect: '/ 0.25' },
  { input: 'hwb(0 0% 0% / 0.75)',   expect: '/ 0.75' },
  { input: 'color(srgb 1 0 0 / 0.8)', expect: '/ 0.8' },
]
for (const t of ALPHA_TESTS) {
  const out = wasm.transform_css(encoder.encode(`color: ${t.input};`))
  const pass = out.includes(t.expect)
  console.log(`${t.input.padEnd(28)} → ${pass ? '✓' : '✗'} contains "${t.expect}"`)
}

// Format round-trip: sRGB → OKLCH → CSS → parse should be stable
console.log('\n═══ FORMAT STABILITY ═══')
for (const ref of REFERENCES.slice(0, 3)) {
  const css1 = wasm.transform_css(encoder.encode(`color: rgb(${ref.rgb.join(', ')});`))
  const css2 = wasm.transform_css(encoder.encode(css1))
  const stable = css1.trim() === css2.trim()
  console.log(`${ref.name.padEnd(6)} 1st: ${css1.trim().slice(7)}`)
  console.log(`      2nd: ${css2.trim().slice(7)} ${stable ? '✓ stable' : '✗ drift'}`)
}
