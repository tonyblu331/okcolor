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
})
