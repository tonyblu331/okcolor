import { afterEach, describe, expect, it, vi } from 'vitest'

describe('WASM initialization errors', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
  })

  it('does not mask non-missing filesystem errors while probing WASM files', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        accessSync: () => {
          const error = new Error('permission denied')
          ;(error as NodeJS.ErrnoException).code = 'EACCES'
          throw error
        },
      }
    })

    const wasm = await import('../src/wasm.js')

    expect(() => wasm.transformCss('color: red;')).toThrow('permission denied')
  })
})
