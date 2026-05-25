import { describe, it, expect } from 'vitest'
import { transformCss, auditCss, convertColor, colorToOklch } from '../src/wasm.js'

describe('JS engine core', () => {
  it('transforms hex red to oklch', () => {
    const out = transformCss('color: #ff0000;')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('#ff0000')
  })

  it('transforms rgb red to oklch', () => {
    const out = transformCss('color: rgb(255, 0, 0);')
    expect(out).toContain('oklch(')
  })

  it('transforms hsl red to oklch', () => {
    const out = transformCss('color: hsl(0, 100%, 50%);')
    expect(out).toContain('oklch(')
  })

  it('transforms named red to oklch', () => {
    const out = transformCss('color: red;')
    expect(out).toContain('oklch(')
  })

  it('respects /* oklch-ignore */', () => {
    const out = transformCss('color: #ff0000; /* oklch-ignore */')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('oklch(')
  })

  it('passes through var()', () => {
    const out = transformCss('color: var(--primary);')
    expect(out).toContain('var(--primary)')
    expect(out).not.toContain('oklch(')
  })

  it('passes through currentColor', () => {
    const out = transformCss('border-color: currentColor;')
    expect(out).toContain('currentColor')
    expect(out).not.toContain('oklch(')
  })

  it('passes through calc()', () => {
    const out = transformCss('width: calc(100% - 20px);')
    expect(out).toContain('calc(100% - 20px)')
  })

  it('does not transform hex inside strings', () => {
    const out = transformCss('content: "#ff0000";')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('oklch(')
  })

  it('does not transform id selectors', () => {
    const out = transformCss('#main { color: red; }')
    expect(out).toContain('#main')
    expect(out).toContain('oklch(')
  })

  it('audits css correctly', () => {
    const stats = auditCss('color: #ff0000; background: rgb(0, 255, 0);')
    expect(stats.legacy_count).toBe(2)
    expect(stats.hex_count).toBe(1)
    expect(stats.rgb_count).toBe(1)
  })

  it('transforms gradient colors and injects in oklch', () => {
    const out = transformCss('background: linear-gradient(to right, #ff0000, #00ff00);')
    expect(out).toContain('linear-gradient(in oklch, to right,')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('#ff0000')
  })

  it('preserves existing gradient interpolation hint', () => {
    const out = transformCss('background: linear-gradient(in oklab, #ff0000, blue);')
    expect(out).toContain('linear-gradient(in oklab,')
    expect(out).not.toContain('in oklch')
  })

  it('skips var() inside gradients', () => {
    const out = transformCss('background: linear-gradient(to bottom, var(--start), blue);')
    expect(out).toContain('linear-gradient(in oklch, to bottom,')
    expect(out).toContain('var(--start)')
  })

  it('preserves alpha from rgba', () => {
    const out = transformCss('color: rgba(255, 0, 0, 0.5);')
    expect(out).toContain('oklch(')
    expect(out).toContain('/ 0.5')
  })

  it('preserves alpha from hex8', () => {
    const out = transformCss('color: #ff000080;')
    expect(out).toContain('oklch(')
    expect(out).toContain('/ 0.502')
  })

  it('transforms hwb to oklch', () => {
    const out = transformCss('color: hwb(0 0% 0%);')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('hwb(')
  })

  it('transforms color(srgb) to oklch', () => {
    const out = transformCss('color: color(srgb 1 0 0);')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('color(srgb')
  })

  it('colorToOklch converts hex', () => {
    expect(colorToOklch('#ff0000')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('colorToOklch converts named', () => {
    expect(colorToOklch('red')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('colorToOklch returns undefined for unknown', () => {
    expect(colorToOklch('not-a-color')).toBeUndefined()
  })

  it('convertColor converts hex to hsl', () => {
    expect(convertColor('#ff0000', 'hsl')).toBe('hsl(0 100% 50%)')
  })

  it('convertColor converts hex to hex', () => {
    expect(convertColor('#ff0000', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts hex to rgb', () => {
    expect(convertColor('#ff0000', 'rgb')).toBe('rgb(255 0 0)')
  })

  it('convertColor converts hsl to hex', () => {
    expect(convertColor('hsl(0 100% 50%)', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts named to hwb', () => {
    expect(convertColor('red', 'hwb')).toBe('hwb(0 0% 0%)')
  })

  it('convertColor converts oklch to hex', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts oklch to hsl', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'hsl')).toBe('hsl(0 100% 50%)')
  })

  it('convertColor converts oklch to oklch', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'oklch')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('convertColor returns undefined for unknown', () => {
    expect(convertColor('not-a-color', 'oklch')).toBeUndefined()
  })

  it('passes through oklch()', () => {
    const out = transformCss('color: oklch(62.8% 0.2577 29.23);')
    expect(out).toContain('oklch(62.8% 0.2577 29.23)')
  })

  it('passes through oklab()', () => {
    const out = transformCss('color: oklab(0.628 0.224 0.126);')
    expect(out).toContain('oklab(0.628 0.224 0.126)')
  })

  it('passes through lab()', () => {
    const out = transformCss('color: lab(53.2% 80.1 67.5);')
    expect(out).toContain('lab(53.2% 80.1 67.5)')
  })

  it('passes through lch()', () => {
    const out = transformCss('color: lch(53.2% 105.0 42.6);')
    expect(out).toContain('lch(53.2% 105.0 42.6)')
  })
})
