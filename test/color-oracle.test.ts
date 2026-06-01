import { describe, expect, it } from 'vitest'
import { expandChroma, findChromaMax, fitGamut, parseColor } from '../src/token-engine.js'
import { oklchInGamut } from '../src/wasm.js'
import colorAideFixtures from './oracles/color-aide-fixtures.json'
import {
  colorJsOracle,
  expectOklchClose,
  expectOklchWithin,
  GAMUT_FIXTURES,
  ORACLE_TOLERANCES,
  W3C_RGB_FIXTURES,
  w3cSrgb8ToOklch,
} from './oracles/color-math-oracles.js'
import type { Gamut, Oklch } from '../src/token-engine.js'

describe('color math oracle fixtures', () => {
  it('keeps sRGB to OKLCH conversion aligned with the W3C/Oklab matrix fixtures', () => {
    for (const fixture of W3C_RGB_FIXTURES) {
      const ours = parseColor(fixture.input).oklch
      const oracle = w3cSrgb8ToOklch(fixture.rgb)
      expectOklchClose(ours, oracle)
    }
  })

  it('keeps sRGB to OKLCH conversion aligned with the Color.js oracle', () => {
    for (const fixture of W3C_RGB_FIXTURES) {
      const ours = parseColor(fixture.input).oklch
      const oracle = colorJsOracle.toOklch(fixture.input)
      expectOklchClose(ours, oracle)
    }
  })

  it('keeps chroma ceilings on the target gamut boundary according to Color.js', () => {
    for (const fixture of GAMUT_FIXTURES) {
      const cMax = findChromaMax(fixture.oklch.l, fixture.oklch.h, fixture.gamut)
      const inside = { ...fixture.oklch, c: Math.max(0, cMax - ORACLE_TOLERANCES.gamutBoundary.chromaInsideStep) }
      const outside = { ...fixture.oklch, c: cMax + ORACLE_TOLERANCES.gamutBoundary.chromaOutsideStep }

      expect(colorJsOracle.inGamut(inside, fixture.gamut)).toBe(true)
      expect(colorJsOracle.inGamut(outside, fixture.gamut)).toBe(false)
    }
  })

  it('keeps fit output display-safe while documenting that CSS MINDE fit is a different policy', () => {
    const source = { l: 0.7, c: 0.35, h: 145 }
    const ours = fitGamut('oklch(70% 0.35 145)', { gamut: 'srgb' })
    const cssMinde = colorJsOracle.fitToGamut(source, 'srgb')

    expect(ours.inGamut).toBe(true)
    expect(oklchInGamut(ours.oklch.l, ours.oklch.c, ours.oklch.h, 'srgb')).toBe(true)
    expect(colorJsOracle.inGamut(ours.oklch, 'srgb')).toBe(true)
    expect(ours.oklch.l).toBeCloseTo(source.l, 4)
    expect(ours.oklch.h).toBeCloseTo(source.h, 2)

    // CSS Color 4's local MINDE mapping may change lightness/hue. okcolor's current
    // policy is fixed-L/fixed-h chroma reduction; this assertion makes that difference
    // explicit instead of pretending the algorithms are identical.
    expect(Math.abs(cssMinde.l - ours.oklch.l)).toBeGreaterThan(0.001)
  })

  it('keeps expand output inside target gamut and inside the reported chroma budget', () => {
    const source = parseColor('#ff5a00')
    const expanded = expandChroma(source, { gamut: 'p3', amount: 0.75 })

    expect(expanded.oklch.l).toBeCloseTo(source.oklch.l, 4)
    expect(expanded.oklch.h).toBeCloseTo(source.oklch.h, 2)
    expect(expanded.oklch.c).toBeGreaterThanOrEqual(source.oklch.c)
    expect(expanded.oklch.c).toBeLessThanOrEqual(expanded.cMax)
    expect(expanded.inGamut).toBe(true)
    expect(colorJsOracle.inGamut(expanded.oklch, 'p3')).toBe(true)
  })

  it('keeps fixed-L/fixed-h fit aligned with ColorAide raytrace fixtures', () => {
    expect(colorAideFixtures.oracle.version).toBe('8.8.1')

    for (const fixture of colorAideFixtures.fixtures) {
      const gamut = toOkcolorGamut(fixture.gamut)
      const source = fixture.oklch
      const fitted = fitGamut(toOklchCss(source), { gamut })

      expect(fitted.inGamut).toBe(true)
      expectOklchWithin(fitted.oklch, fixture.methods.raytrace.oklch, ORACLE_TOLERANCES.colorAideRaytrace)
    }
  })

  it('documents ColorAide MINDE/chroma mapping as a comparison policy, not okcolor fit policy', () => {
    for (const fixture of colorAideFixtures.fixtures) {
      const raytrace = fixture.methods.raytrace.oklch
      const minde = fixture.methods['minde-chroma'].oklch
      const lDelta = Math.abs(raytrace.l - minde.l)
      const hDelta = Math.abs(shortestHueDelta(raytrace.h, minde.h))

      expect(lDelta + hDelta).toBeGreaterThan(0.0001)
    }
  })
})

function toOklchCss(color: Oklch): string {
  return `oklch(${color.l * 100}% ${color.c} ${color.h})`
}

function toOkcolorGamut(gamut: string): Gamut {
  if (gamut === 'display-p3') return 'p3'
  if (gamut === 'srgb') return 'srgb'
  throw new Error(`Unsupported fixture gamut: ${gamut}`)
}

function shortestHueDelta(from: number, to: number): number {
  return Math.abs(((to - from + 540) % 360) - 180)
}
