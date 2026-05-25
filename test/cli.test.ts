import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { auditCss } from '../src/wasm.js'
import { resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'

describe('CLI integration', () => {
  it('audit counts colors correctly', () => {
    const stats = auditCss('color: #ff0000; background: rgb(0, 255, 0); border: 1px solid red;')
    expect(stats.legacy_count).toBe(3)
    expect(stats.hex_count).toBe(1)
    expect(stats.rgb_count).toBe(1)
    expect(stats.named_count).toBe(1)
  })
})

describe('CLI parallel file processing', () => {
  const tmpDir = resolve(import.meta.dirname, '..', '.tmp-cli-test')

  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
    mkdirSync(tmpDir, { recursive: true })
    for (let i = 0; i < 50; i++) {
      writeFileSync(resolve(tmpDir, `test-${i}.css`),
        `.a-${i} { color: #ff0000; background: rgb(0, 255, 0); }\n`)
    }
  })

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  })

  it('processes multiple files concurrently', async () => {
    const files = Array.from({ length: 50 }, (_, i) => resolve(tmpDir, `test-${i}.css`))
    const start = performance.now()

    const results = await Promise.all(files.map(async (file) => {
      const css = readFileSync(file, 'utf-8')
      return auditCss(css)
    }))

    const elapsed = performance.now() - start
    const total = results.reduce((s, r) => s + r.legacy_count, 0)
    expect(total).toBe(100) // 2 colors x 50 files
    expect(elapsed).toBeLessThan(5000) // sanity: should finish quickly
  })

  it('processes files without colors correctly', async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(resolve(tmpDir, `empty-${i}.css`), '.x { display: flex; }\n')
    }

    const files = Array.from({ length: 10 }, (_, i) => resolve(tmpDir, `empty-${i}.css`))
    const results = await Promise.all(files.map(async (file) => {
      const css = readFileSync(file, 'utf-8')
      return auditCss(css)
    }))

    const total = results.reduce((s, r) => s + r.legacy_count, 0)
    expect(total).toBe(0)
  })
})
