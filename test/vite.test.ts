import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { okColor } from '../src/vite.js'
import * as wasm from '../src/wasm.js'

describe('Vite plugin', () => {
  it('has correct plugin name and enforce order', () => {
    const plugin = okColor()
    expect(plugin.name).toBe('okcolor')
    expect(plugin.enforce).toBe('pre')
  })

  it('transforms CSS content', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.('color: #ff0000;', 'test.css')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
  })

  it('transforms CSS ids with Vite query suffixes', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.('color: #ff0000;', 'test.css?direct')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
  })

  it('transforms Vite virtual SFC style modules as CSS', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.(
      '.red { color: #ff0000; }',
      '/src/App.vue?vue&type=style&index=0&scoped=true&lang.css',
    )
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
  })

  it('skips non-style Vite SFC virtual modules', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.(
      'export default "<style>.red { color: #ff0000; }</style>"',
      '/src/App.vue?vue&type=script&lang.ts',
    )
    expect(result).toBeUndefined()
  })

  it('does not let lang.css override a non-style Vite SFC virtual module type', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.(
      '<template><div style="color: #ff0000"></div></template>',
      '/src/App.vue?vue&type=template&lang.css',
    )
    expect(result).toBeUndefined()
  })

  it('transforms Vue style blocks', async () => {
    const plugin = okColor()
    const source = `<template><div>hi</div></template>\n<style>\n.red { color: #ff0000; }\n</style>`
    const result = await plugin.transform?.(source, 'test.vue')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
    expect(result).toContain('<template>')
  })

  it('returns undefined for files without colors', async () => {
    const plugin = okColor()
    const result = await plugin.transform?.('/* no colors here */', 'test.css')
    expect(result).toBeUndefined()
  })

  it('returns cached result on cache hit (same code, same id, no WASM call)', async () => {
    const spy = vi.spyOn(wasm, 'transformCss')
    const plugin = okColor()

    const first = await plugin.transform?.('color: #ff0000;', 'test.css')
    expect(spy).toHaveBeenCalledTimes(1)

    const second = await plugin.transform?.('color: #ff0000;', 'test.css')
    expect(second).toBe(first) // same transformed string
    expect(spy).toHaveBeenCalledTimes(1) // didn't call WASM again

    spy.mockRestore()
  })

  it('re-transforms on cache miss (different code)', async () => {
    const spy = vi.spyOn(wasm, 'transformCss')
    const plugin = okColor()

    await plugin.transform?.('color: #ff0000;', 'test.css')
    await plugin.transform?.('color: #00ff00;', 'test.css')
    expect(spy).toHaveBeenCalledTimes(2)

    spy.mockRestore()
  })

  it('caches per file id independently', async () => {
    const spy = vi.spyOn(wasm, 'transformCss')
    const plugin = okColor()

    await plugin.transform?.('color: #ff0000;', 'a.css')
    await plugin.transform?.('color: #ff0000;', 'b.css')
    expect(spy).toHaveBeenCalledTimes(2)

    await plugin.transform?.('color: #ff0000;', 'a.css')
    expect(spy).toHaveBeenCalledTimes(2) // cache hit for a.css

    spy.mockRestore()
  })

  it('warns when an embedded style transform fails', async () => {
    const transformSpy = vi.spyOn(wasm, 'transformCss').mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = okColor()

    const result = await plugin.transform?.('<style>.red { color: #ff0000; }</style>', 'test.vue')

    expect(result).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[okcolor] transform failed for test.vue:'), 'boom')

    warnSpy.mockRestore()
    transformSpy.mockRestore()
  })

  it('compiles token input to output CSS during buildStart without breaking transform mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'okcolor-vite-'))
    const input = join(dir, 'tokens.json')
    const output = join(dir, 'colors.css')
    await writeFile(input, JSON.stringify({ 'brand.orange': '#ff5a00' }))

    try {
      const plugin = okColor({
        input,
        output,
        targets: {
          base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
          p3: { gamut: 'p3', strategy: 'expand', amount: 0.75, format: 'oklch' },
        },
      })

      await plugin.buildStart?.({} as never)
      const css = await readFile(output, 'utf-8')
      expect(css).toContain('--brand-orange: #ff5a00;')
      expect(css).toContain('@media (color-gamut: p3)')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
