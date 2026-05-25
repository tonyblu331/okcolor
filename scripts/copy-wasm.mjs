import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

copyFileSync(
  resolve(root, 'packages/core-wasm/pkg/okcolor_core_bg.wasm'),
  resolve(root, 'dist/okcolor_core_bg.wasm'),
)
copyFileSync(
  resolve(root, 'packages/core-wasm/pkg/okcolor_core.js'),
  resolve(root, 'dist/okcolor_core.js'),
)
