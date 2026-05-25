import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'packages/core-wasm/pkg/okcolor_core_bg.wasm')

const before = statSync(src).size
execSync(`npx wasm-opt -O4 -Oz --all-features "${src}" -o "${src}"`, { stdio: 'inherit', cwd: root })
const after = statSync(src).size
console.log(`wasm-opt: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (${((1 - after / before) * 100).toFixed(1)}% smaller)`)
