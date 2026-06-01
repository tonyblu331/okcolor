import Color from 'colorjs.io'
import type { Gamut, Oklch } from '../../src/token-engine.js'

export interface Rgb8Fixture {
  name: string
  input: string
  rgb: [number, number, number]
  source: string
}

export interface GamutFixture {
  name: string
  oklch: Oklch
  gamut: Gamut
  source: string
}

export interface ColorMathOracle {
  readonly name: string
  toOklch(input: string): Oklch
  inGamut(oklch: Oklch, gamut: Gamut): boolean
  fitToGamut(oklch: Oklch, gamut: Gamut): Oklch
}

export const ORACLE_SOURCES = {
  cssColor4: 'https://www.w3.org/TR/css-color-4/',
  oklab: 'https://bottosson.github.io/posts/oklab/',
  colorJs: 'https://colorjs.io/docs/gamut-mapping.html',
} as const

export const ORACLE_TOLERANCES = {
  conversion: {
    lightness: 0.0005,
    chroma: 0.0005,
    hueDegrees: 0.05,
  },
  colorAideRaytrace: {
    lightness: 0.0002,
    chroma: 0.00003,
    hueDegrees: 0.02,
  },
  gamutBoundary: {
    chromaInsideStep: 0.0005,
    chromaOutsideStep: 0.003,
  },
} as const

export const W3C_RGB_FIXTURES: Rgb8Fixture[] = [
  {
    name: 'sRGB red',
    input: '#ff0000',
    rgb: [255, 0, 0],
    source: `${ORACLE_SOURCES.cssColor4} + ${ORACLE_SOURCES.oklab}`,
  },
  {
    name: 'sRGB green',
    input: '#00ff00',
    rgb: [0, 255, 0],
    source: `${ORACLE_SOURCES.cssColor4} + ${ORACLE_SOURCES.oklab}`,
  },
  {
    name: 'sRGB blue',
    input: '#0000ff',
    rgb: [0, 0, 255],
    source: `${ORACLE_SOURCES.cssColor4} + ${ORACLE_SOURCES.oklab}`,
  },
  {
    name: 'brand orange',
    input: '#ff5a00',
    rgb: [255, 90, 0],
    source: `${ORACLE_SOURCES.cssColor4} + ${ORACLE_SOURCES.oklab}`,
  },
  {
    name: 'neutral gray',
    input: '#808080',
    rgb: [128, 128, 128],
    source: `${ORACLE_SOURCES.cssColor4} + ${ORACLE_SOURCES.oklab}`,
  },
]

export const GAMUT_FIXTURES: GamutFixture[] = [
  {
    name: 'out-of-sRGB green',
    oklch: { l: 0.7, c: 0.35, h: 145 },
    gamut: 'srgb',
    source: ORACLE_SOURCES.colorJs,
  },
  {
    name: 'P3 orange expansion',
    oklch: { l: 0.681, c: 0.211, h: 41.8 },
    gamut: 'p3',
    source: ORACLE_SOURCES.colorJs,
  },
  {
    name: 'P3 blue expansion',
    oklch: { l: 0.55, c: 0.22, h: 260 },
    gamut: 'p3',
    source: ORACLE_SOURCES.colorJs,
  },
]

export const colorJsOracle: ColorMathOracle = {
  name: 'Color.js 0.6.1',

  toOklch(input: string): Oklch {
    return normalizeOklch(new Color(input).to('oklch').coords)
  },

  inGamut(oklch: Oklch, gamut: Gamut): boolean {
    return colorFromOklch(oklch).inGamut(toColorJsGamut(gamut))
  },

  fitToGamut(oklch: Oklch, gamut: Gamut): Oklch {
    return normalizeOklch(
      colorFromOklch(oklch)
        .toGamut({ space: toColorJsGamut(gamut), method: 'css' })
        .to('oklch').coords,
    )
  },
}

export function w3cSrgb8ToOklch([r8, g8, b8]: [number, number, number]): Oklch {
  const r = srgbGammaToLinear(r8 / 255)
  const g = srgbGammaToLinear(g8 / 255)
  const b = srgbGammaToLinear(b8 / 255)

  const lmsL = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const lmsM = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const lmsS = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

  const l_ = Math.cbrt(lmsL)
  const m_ = Math.cbrt(lmsM)
  const s_ = Math.cbrt(lmsS)

  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.sqrt(a * a + bLab * bLab)
  const h = c >= 1e-6 ? normalizeHue((Math.atan2(bLab, a) * 180) / Math.PI) : 0

  return { l, c, h }
}

export function expectOklchClose(actual: Oklch, expected: Oklch): void {
  expect(actual.l).toBeCloseTo(expected.l, decimalPlaces(ORACLE_TOLERANCES.conversion.lightness))
  expect(actual.c).toBeCloseTo(expected.c, decimalPlaces(ORACLE_TOLERANCES.conversion.chroma))
  expect(shortestHueDelta(actual.h, expected.h)).toBeLessThanOrEqual(ORACLE_TOLERANCES.conversion.hueDegrees)
}

export function expectOklchWithin(actual: Oklch, expected: Oklch, tolerance: typeof ORACLE_TOLERANCES.colorAideRaytrace): void {
  expect(Math.abs(actual.l - expected.l)).toBeLessThanOrEqual(tolerance.lightness)
  expect(Math.abs(actual.c - expected.c)).toBeLessThanOrEqual(tolerance.chroma)
  expect(shortestHueDelta(actual.h, expected.h)).toBeLessThanOrEqual(tolerance.hueDegrees)
}

function colorFromOklch(oklch: Oklch): Color {
  return new Color('oklch', [oklch.l, oklch.c, oklch.h])
}

function toColorJsGamut(gamut: Gamut): 'srgb' | 'p3' {
  return gamut === 'p3' ? 'p3' : 'srgb'
}

function normalizeOklch(coords: number[]): Oklch {
  const [l, c, h] = coords
  return { l, c, h: Number.isFinite(h) ? normalizeHue(h) : 0 }
}

function srgbGammaToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function shortestHueDelta(from: number, to: number): number {
  return Math.abs(((to - from + 540) % 360) - 180)
}

function decimalPlaces(tolerance: number): number {
  return Math.max(0, Math.ceil(-Math.log10(tolerance)))
}
