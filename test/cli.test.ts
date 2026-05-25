import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { auditCss, colorToOklch, convertColor } from '../src/wasm.js'
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

  it('audit gradient counts are isolated', () => {
    const stats = auditCss('background: linear-gradient(red, blue);')
    expect(stats.legacy_count).toBe(2)
    expect(stats.gradient_count).toBe(1)
    expect(stats.named_count).toBe(2)
  })

  it('colorToOklch returns undefined for invalid input', () => {
    expect(colorToOklch('not-a-color')).toBeUndefined()
  })

  it('convertColor roundtrips hex to hsl', () => {
    expect(convertColor('#ff0000', 'hsl')).toBe('hsl(0 100% 50%)')
    expect(convertColor('#0000ff', 'hsl')).toBe('hsl(240 100% 50%)')
  })

  it('convertColor rejects unsupported spaces', () => {
    expect(convertColor('#ff0000', 'cmyk')).toBeUndefined()
  })

  it('audit named-only CSS works via bypass', () => {
    const stats = auditCss('color: red;')
    expect(stats.legacy_count).toBe(1)
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
    expect(elapsed).toBeLessThan(5000)
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

  it('auditCss handles empty CSS gracefully', async () => {
    const stats = auditCss('')
    expect(stats.legacy_count).toBe(0)
    expect(stats.hex_count).toBe(0)
  })

  it('files that do not exist throw ENOENT at filesystem level', () => {
    const bogusPath = resolve(tmpDir, 'does-not-exist.css')
    expect(() => readFileSync(bogusPath, 'utf-8')).toThrow('ENOENT')
  })
})
