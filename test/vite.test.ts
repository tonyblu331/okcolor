import { describe, it, expect } from 'vitest'
import { okActually } from '../src/vite.js'

describe('Vite plugin', () => {
  it('has correct plugin name and enforce order', () => {
    const plugin = okActually()
    expect(plugin.name).toBe('ok-actually')
    expect(plugin.enforce).toBe('pre')
  })

  it('transforms CSS content', async () => {
    const plugin = okActually()
    const result = await plugin.transform?.('color: #ff0000;', 'test.css')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
  })

  it('transforms Vue style blocks', async () => {
    const plugin = okActually()
    const source = `<template><div>hi</div></template>\n<style>\n.red { color: #ff0000; }\n</style>`
    const result = await plugin.transform?.(source, 'test.vue')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('oklch(')
    expect(result).toContain('<template>')
  })

  it('returns undefined for unchanged files', async () => {
    const plugin = okActually()
    const result = await plugin.transform?.('/* no colors here */', 'test.css')
    expect(result).toBeUndefined()
  })
})
