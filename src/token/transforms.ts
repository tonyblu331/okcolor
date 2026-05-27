import { expandOklchChroma, fitOklchGamut, oklchChromaMax, oklchInGamut } from '../wasm.js'
import { clamp01, formatOklch, normalizeHue, parseColor, round, roundOklch } from './color.js'
import type { Gamut, GradeOptions, Oklch, ParsedColor, RecipeName, TargetOptions, TransformResult } from './types.js'
import { DEFAULT_AMOUNT, NEUTRAL_CHROMA_THRESHOLD } from './types.js'

export function findChromaMax(l: number, h: number, gamut: Gamut = 'p3'): number {
  return required(oklchChromaMax(l, h, toWasmGamut(gamut)), `Unsupported gamut: ${gamut}`)
}

export function expandChroma(input: ParsedColor | string, options: TargetOptions = {}): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'p3'
  const amount = clamp01(options.amount ?? DEFAULT_AMOUNT)
  const result = required(
    expandOklchChroma(source.oklch.l, source.oklch.c, source.oklch.h, toWasmGamut(gamut), amount),
    `Unsupported gamut: ${gamut}`,
  )

  return makeTransformResult(source, { l: result.l, c: result.c, h: result.h }, gamut, result.cMax, amount, result.neutralSkipped)
}

export function fitGamut(input: ParsedColor | string, options: TargetOptions = {}): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'srgb'
  const result = required(
    fitOklchGamut(source.oklch.l, source.oklch.c, source.oklch.h, toWasmGamut(gamut)),
    `Unsupported gamut: ${gamut}`,
  )

  return makeTransformResult(source, { l: result.l, c: result.c, h: result.h }, gamut, result.cMax, 0, result.neutralSkipped)
}

export function gradeColor(input: ParsedColor | string, options: GradeOptions): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'p3'
  const recipe = options.recipe
  if (recipe === 'literal') return makeTransformResult(source, source.oklch, gamut, findChromaMax(source.oklch.l, source.oklch.h, gamut), 0)

  const amount = clamp01(options.amount ?? recipeDefaultAmount(recipe))
  let next = { ...source.oklch }

  if (recipe === 'muted') next.c *= 0.72
  else if (recipe === 'softer') {
    next.c *= 0.78
    next.l = clamp01(next.l + 0.025)
  } else if (recipe === 'deeper') {
    next.l = clamp01(next.l - 0.05)
    next = expandOklch(next, gamut, amount * 0.7)
  } else if (recipe === 'premium') {
    next.l = clamp01(next.l - 0.015)
    next = expandOklch(next, gamut, amount * 0.65)
  } else if (recipe === 'vivid') {
    next = expandOklch(next, gamut, amount)
  } else if (recipe === 'warmer') {
    next.h = rotateTowardWarm(next.h)
  } else if (recipe === 'cooler') {
    next.h = rotateTowardCool(next.h)
  }

  const cMax = findChromaMax(next.l, next.h, gamut)
  next.c = Math.min(next.c, cMax)
  return makeTransformResult(source, roundOklch(next), gamut, cMax, amount)
}

export function describeColor(input: string, options: TargetOptions = {}) {
  const source = parseColor(input)
  const gamut = options.gamut ?? 'p3'
  const amount = options.amount ?? DEFAULT_AMOUNT
  const cMax = findChromaMax(source.oklch.l, source.oklch.h, gamut)
  const expanded = expandChroma(source, { gamut, amount })
  const premium = gradeColor(source, { recipe: 'premium', gamut, amount: 0.6 })

  return {
    source,
    target: {
      gamut,
      cMax,
      availableChromaBudget: round(Math.max(0, cMax - source.oklch.c), 5),
    },
    suggestions: {
      literal: formatOklch(source.oklch),
      [`${gamut} expand ${Math.round(amount * 100)}%`]: expanded.css,
      premium: premium.css,
    },
  }
}

export function formatDescription(input: string, options: TargetOptions = {}): string {
  const description = describeColor(input, options)
  const source = description.source.oklch
  const amountLabel = `${description.target.gamut} expand ${Math.round((options.amount ?? DEFAULT_AMOUNT) * 100)}%`

  return [
    'Source',
    `  input: ${description.source.input}`,
    `  source gamut: ${description.source.sourceGamut}`,
    `  OKLCH identity: L=${round(source.l, 4)} C=${source.c} h=${source.h}`,
    '',
    'Target',
    `  target gamut: ${description.target.gamut}`,
    `  max chroma at same L/h: ${description.target.cMax}`,
    `  available chroma budget: +${description.target.availableChromaBudget}`,
    '',
    'Suggestions',
    `  literal: ${description.suggestions.literal}`,
    `  ${amountLabel}: ${description.suggestions[amountLabel]}`,
    `  premium: ${description.suggestions.premium}`,
  ].join('\n')
}

function makeTransformResult(
  source: ParsedColor,
  oklch: Oklch,
  gamut: Gamut,
  cMax: number,
  amount: number,
  neutralSkipped = false,
): TransformResult {
  const rounded = roundOklch(oklch)
  const inGamut = required(oklchInGamut(rounded.l, rounded.c, rounded.h, toWasmGamut(gamut)), `Unsupported gamut: ${gamut}`)
  return {
    source,
    oklch: rounded,
    css: formatOklch(rounded),
    cMax,
    amount,
    gamut,
    inGamut,
    syntaxValid: true,
    displaySafe: inGamut,
    neutralSkipped,
  }
}

function expandOklch(source: Oklch, gamut: Gamut, amount: number): Oklch {
  if (source.c < NEUTRAL_CHROMA_THRESHOLD) return source
  const result = required(expandOklchChroma(source.l, source.c, source.h, toWasmGamut(gamut), amount), `Unsupported gamut: ${gamut}`)
  return { l: result.l, c: result.c, h: result.h }
}

function toParsedColor(input: ParsedColor | string): ParsedColor {
  return typeof input === 'string' ? parseColor(input) : input
}

function toWasmGamut(gamut: Gamut): string {
  return gamut === 'p3' ? 'p3' : 'srgb'
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function recipeDefaultAmount(recipe: RecipeName): number {
  if (recipe === 'vivid') return 0.85
  if (recipe === 'premium') return 0.6
  if (recipe === 'deeper') return 0.7
  return DEFAULT_AMOUNT
}

function rotateTowardWarm(hue: number): number {
  return normalizeHue(hue + (hue > 210 && hue < 330 ? -8 : 8))
}

function rotateTowardCool(hue: number): number {
  return normalizeHue(hue + (hue > 30 && hue < 210 ? 8 : -8))
}
