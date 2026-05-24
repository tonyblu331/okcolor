import { createRequire } from 'module'
import { readFileSync } from 'fs'

const require = createRequire(import.meta.url)
const wasm = require('../dist/pkg-nodejs/ok_actually_core.js')

const css = readFileSync('./complex.css', 'utf-8')
const encoder = new TextEncoder()

console.log('═══ TRANSFORMED CSS ═══\n')
const transformed = wasm.transform_css(encoder.encode(css))
console.log(transformed)

console.log('\n\n═══ AUDIT STATS ═══')
const auditJson = wasm.audit_css(encoder.encode(css))
console.log(JSON.parse(auditJson))
