import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Ensure WASM imports resolve correctly in tests
      '../packages/core-wasm/pkg-nodejs/ok_actually_core.js':
        './packages/core-wasm/pkg-nodejs/ok_actually_core.js',
    },
  },
})
