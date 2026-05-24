import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const wasm = require('../packages/core-wasm/pkg-nodejs/ok_actually_core.js')
const encoder = new TextEncoder()

console.log('=== Alpha tests ===')
console.log('rgba:', wasm.transform_css(encoder.encode('color: rgba(255,0,0,0.5);')))
console.log('hex8:', wasm.transform_css(encoder.encode('color: #ff000080;')))

console.log('\n=== ID selector test ===')
console.log('id1:', wasm.transform_css(encoder.encode('#ff0000 { display: none; }')))
console.log('id2:', wasm.transform_css(encoder.encode('.foo #bar { color: red; }')))
console.log('id3:', wasm.transform_css(encoder.encode('#main { background: #333; }')))

console.log('\n=== Gradient var() test ===')
console.log('grad1:', wasm.transform_css(encoder.encode('background: linear-gradient(to bottom, var(--start), var(--end));')))
console.log('grad2:', wasm.transform_css(encoder.encode('background: linear-gradient(to bottom, #f00, var(--end));')))

console.log('\n=== HWB + color(srgb) ===')
console.log('hwb:', wasm.transform_css(encoder.encode('color: hwb(0 0% 0%);')))
console.log('csrgb:', wasm.transform_css(encoder.encode('color: color(srgb 1 0 0);')))
