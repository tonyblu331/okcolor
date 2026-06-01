import { expandOklchChroma, fitOklchGamut, oklchChromaMax, oklchInGamut } from '../wasm.js'
import type { Gamut, Oklch } from './types.js'

export interface ChromaTransformResult {
  oklch: Oklch
  cMax: number
  neutralSkipped: boolean
}

export interface ColorMathPort {
  chromaMax(l: number, h: number, gamut: Gamut): number | undefined
  inGamut(oklch: Oklch, gamut: Gamut): boolean | undefined
  expandChroma(oklch: Oklch, gamut: Gamut, amount: number): ChromaTransformResult | undefined
  fitGamut(oklch: Oklch, gamut: Gamut): ChromaTransformResult | undefined
}

export const wasmColorMath: ColorMathPort = {
  chromaMax(l, h, gamut) {
    return oklchChromaMax(l, h, toWasmGamut(gamut))
  },
  inGamut(oklch, gamut) {
    return oklchInGamut(oklch.l, oklch.c, oklch.h, toWasmGamut(gamut))
  },
  expandChroma(oklch, gamut, amount) {
    const result = expandOklchChroma(oklch.l, oklch.c, oklch.h, toWasmGamut(gamut), amount)
    if (!result) return undefined
    return { oklch: { l: result.l, c: result.c, h: result.h }, cMax: result.cMax, neutralSkipped: result.neutralSkipped }
  },
  fitGamut(oklch, gamut) {
    const result = fitOklchGamut(oklch.l, oklch.c, oklch.h, toWasmGamut(gamut))
    if (!result) return undefined
    return { oklch: { l: result.l, c: result.c, h: result.h }, cMax: result.cMax, neutralSkipped: result.neutralSkipped }
  },
}

function toWasmGamut(gamut: Gamut): string {
  return gamut === 'p3' ? 'p3' : 'srgb'
}
