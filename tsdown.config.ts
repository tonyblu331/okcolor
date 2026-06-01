import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/core.ts', 'src/browser.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: ['vite', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', './okcolor_core.js'],
  },
})
