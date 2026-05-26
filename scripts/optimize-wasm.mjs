import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'packages/core-wasm/pkg/okcolor_core_bg.wasm')
const wasmOpt = resolve(root, 'node_modules/binaryen/bin/wasm-opt')
const wasmOptArgs = ['-O4', '-Oz', '--all-features', src, '-o', src]

const before = statSync(src).size
execFileSync(process.execPath, [wasmOpt, ...wasmOptArgs], { stdio: 'inherit', cwd: root })
const after = statSync(src).size
console.log(`wasm-opt: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (${((1 - after / before) * 100).toFixed(1)}% smaller)`)
