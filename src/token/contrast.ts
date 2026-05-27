import { oklchRelativeLuminance } from '../wasm.js'
import { isRecord } from './color.js'
import type { ApcaContrastResult, Gamut, Oklch, WcagContrastResult } from './types.js'

export interface CompiledColorTargets {
  srgb: Oklch
  p3?: Oklch
}

export interface DeclaredContrastPair {
  background: string
  foreground: string
  requirement: 'wcag2-aa'
}

export function extractDeclaredContrastPairs(tokens: Record<string, unknown>): DeclaredContrastPair[] {
  const pairs: DeclaredContrastPair[] = []
  for (const [background, token] of Object.entries(tokens)) {
    if (!isRecord(token) || !isRecord(token.okcolor) || typeof token.okcolor.text !== 'string') continue
    pairs.push({
      background,
      foreground: token.okcolor.text,
      requirement: normalizeRequirement(token.okcolor.contrast),
    })
  }
  return pairs
}

export function auditContrastPair(
  pair: DeclaredContrastPair,
  colors: Record<string, CompiledColorTargets>,
  target: Gamut,
): { key: string; wcag2: WcagContrastResult; apca: ApcaContrastResult } | undefined {
  const foreground = colors[pair.foreground]?.[target]
  const background = colors[pair.background]?.[target]
  if (!foreground || !background) return undefined

  const ratio = wcagContrastRatio(relativeLuminance(foreground), relativeLuminance(background))
  const key = `${pair.foreground}@${target}`
  return {
    key,
    wcag2: {
      foreground: pair.foreground,
      background: pair.background,
      target,
      ratio,
      required: requiredRatio(pair.requirement),
      status: ratio >= requiredRatio(pair.requirement) ? 'pass' : 'fail',
    },
    apca: apcaContrast(
      relativeLuminance(foreground),
      relativeLuminance(background),
      pair.foreground,
      pair.background,
      target,
    ),
  }
}

export function apcaContrast(
  foregroundY: number,
  backgroundY: number,
  foreground: string,
  background: string,
  target: Gamut,
): ApcaContrastResult {
  const lc = round(apcaLc(foregroundY, backgroundY), 1)
  const absLc = Math.abs(lc)
  return {
    foreground,
    background,
    target,
    lc,
    polarity: lc > 0 ? 'normal' : lc < 0 ? 'reverse' : 'none',
    advisory: absLc >= 60 ? 'pass-body' : absLc >= 45 ? 'pass-large' : 'fail',
  }
}

function apcaLc(foregroundY: number, backgroundY: number): number {
  const normalBgExponent = 0.56
  const normalTextExponent = 0.57
  const reverseTextExponent = 0.62
  const reverseBgExponent = 0.65
  const scale = 1.14
  const lowContrastOffset = 0.027
  const lowContrastClip = 0.1
  const deltaYMin = 0.0005

  const foreground = softClampBlack(foregroundY)
  const background = softClampBlack(backgroundY)
  if (Math.abs(background - foreground) < deltaYMin) return 0

  if (background > foreground) {
    const sapc = (background ** normalBgExponent - foreground ** normalTextExponent) * scale
    return sapc < lowContrastClip ? 0 : (sapc - lowContrastOffset) * 100
  }

  const sapc = (background ** reverseBgExponent - foreground ** reverseTextExponent) * scale
  return sapc > -lowContrastClip ? 0 : (sapc + lowContrastOffset) * 100
}

function softClampBlack(y: number): number {
  const threshold = 0.022
  if (y >= threshold) return y
  return y + (threshold - y) ** 1.414
}

export function wcagContrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return round((lighter + 0.05) / (darker + 0.05), 2)
}

function relativeLuminance(color: Oklch): number {
  return oklchRelativeLuminance(color.l, color.c, color.h)
}

function normalizeRequirement(value: unknown): 'wcag2-aa' {
  return value === 'wcag2-aa' ? 'wcag2-aa' : 'wcag2-aa'
}

function requiredRatio(requirement: 'wcag2-aa'): number {
  if (requirement === 'wcag2-aa') return 4.5
  return 4.5
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round((value + Number.EPSILON) * factor) / factor
}
