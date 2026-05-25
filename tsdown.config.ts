import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/core.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['vite', 'node:fs', 'node:fs/promises', 'node:path', 'node:url'],
})
