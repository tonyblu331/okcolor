import { clamp01, formatOklch, normalizeHue, parseColor, round, roundOklch } from './color.js'
import { wasmColorMath } from './color-math-port.js'
import type { ColorMathPort } from './color-math-port.js'
import type { Gamut, GradeOptions, Oklch, ParsedColor, RecipeName, Strategy, TargetOptions, TransformResult } from './types.js'
import { DEFAULT_AMOUNT, isRecipeName, NEUTRAL_CHROMA_THRESHOLD, RECIPE_NAMES } from './types.js'

export function findChromaMax(l: number, h: number, gamut: Gamut = 'p3', math: ColorMathPort = wasmColorMath): number {
  return required(math.chromaMax(l, h, gamut), `Unsupported gamut: ${gamut}`)
}

export function expandChroma(input: ParsedColor | string, options: TargetOptions = {}): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'p3'
  const amount = clamp01(options.amount ?? DEFAULT_AMOUNT)
  const math = options.math ?? wasmColorMath
  const result = required(math.expandChroma(source.oklch, gamut, amount), `Unsupported gamut: ${gamut}`)

  return makeTransformResult(
    source,
    result.oklch,
    gamut,
    result.cMax,
    amount,
    result.neutralSkipped,
    { strategy: 'expand' },
    math,
  )
}

export function fitGamut(input: ParsedColor | string, options: TargetOptions = {}): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'srgb'
  const math = options.math ?? wasmColorMath
  const result = required(math.fitGamut(source.oklch, gamut), `Unsupported gamut: ${gamut}`)

  return makeTransformResult(
    source,
    result.oklch,
    gamut,
    result.cMax,
    0,
    result.neutralSkipped,
    { strategy: 'fit' },
    math,
  )
}

export function gradeColor(input: ParsedColor | string, options: GradeOptions): TransformResult {
  const source = toParsedColor(input)
  const gamut = options.gamut ?? 'p3'
  const recipe = options.recipe
  const math = options.math ?? wasmColorMath
  assertRecipeName(recipe)
  if (recipe === 'literal') {
    return makeTransformResult(
      source,
      source.oklch,
      gamut,
      findChromaMax(source.oklch.l, source.oklch.h, gamut, math),
      0,
      false,
      { strategy: 'convert', recipe },
      math,
    )
  }

  const amount = clamp01(options.amount ?? recipeDefaultAmount(recipe))
  let next = { ...source.oklch }

  if (recipe === 'muted') next.c *= 0.72
  else if (recipe === 'softer') {
    next.c *= 0.78
    next.l = clamp01(next.l + 0.025)
  } else if (recipe === 'deeper') {
    next.l = clamp01(next.l - 0.05)
    next = expandOklch(next, gamut, amount * 0.7, math)
  } else if (recipe === 'premium') {
    next.l = clamp01(next.l - 0.015)
    next = expandOklch(next, gamut, amount * 0.65, math)
  } else if (recipe === 'vivid') {
    next = expandOklch(next, gamut, amount, math)
  } else if (recipe === 'warmer') {
    next.h = rotateTowardWarm(next.h)
  } else if (recipe === 'cooler') {
    next.h = rotateTowardCool(next.h)
  }

  const cMax = findChromaMax(next.l, next.h, gamut, math)
  next.c = Math.min(next.c, cMax)
  return makeTransformResult(source, roundOklch(next), gamut, cMax, amount, false, { strategy: 'grade', recipe }, math)
}

export function describeColor(input: string, options: TargetOptions = {}) {
  const source = parseColor(input)
  const gamut = options.gamut ?? 'p3'
  const amount = options.amount ?? DEFAULT_AMOUNT
  const math = options.math ?? wasmColorMath
  const cMax = findChromaMax(source.oklch.l, source.oklch.h, gamut, math)
  const expanded = expandChroma(source, { gamut, amount, math })
  const premium = gradeColor(source, { recipe: 'premium', gamut, amount: 0.6, math })

  return {
    source,
    target: {
      gamut,
      cMax,
      availableChromaBudget: round(Math.max(0, cMax - source.oklch.c), 5),
    },
    suggestions: {
      literal: formatOklch(source.oklch, source.alpha),
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
  metadata: { strategy: Strategy; recipe?: RecipeName },
  math: ColorMathPort,
): TransformResult {
  const rounded = roundOklch(oklch)
  const inGamut = required(math.inGamut(rounded, gamut), `Unsupported gamut: ${gamut}`)
  return {
    source,
    oklch: rounded,
    alpha: source.alpha,
    css: formatOklch(rounded, source.alpha),
    cMax,
    amount,
    gamut,
    strategy: metadata.strategy,
    recipe: metadata.recipe,
    delta: transformDelta(source.oklch, rounded),
    inGamut,
    syntaxValid: true,
    displaySafe: inGamut,
    neutralSkipped,
    skippedReason: neutralSkipped ? 'chroma-below-threshold' : undefined,
  }
}

function transformDelta(source: Oklch, target: Oklch) {
  return {
    lightness: round(target.l - source.l, 4),
    chroma: round(target.c - source.c, 5),
    hue: round(shortestHueDelta(source.h, target.h), 2),
  }
}

function shortestHueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

function expandOklch(source: Oklch, gamut: Gamut, amount: number, math: ColorMathPort): Oklch {
  if (source.c < NEUTRAL_CHROMA_THRESHOLD) return source
  const result = required(math.expandChroma(source, gamut, amount), `Unsupported gamut: ${gamut}`)
  return result.oklch
}

function toParsedColor(input: ParsedColor | string): ParsedColor {
  return typeof input === 'string' ? parseColor(input) : input
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

function assertRecipeName(recipe: string): asserts recipe is RecipeName {
  if (!isRecipeName(recipe)) {
    throw new Error(`Unsupported recipe: ${recipe}. Use: ${RECIPE_NAMES.join(', ')}`)
  }
}

function rotateTowardWarm(hue: number): number {
  return normalizeHue(hue + (hue > 210 && hue < 330 ? -8 : 8))
}

function rotateTowardCool(hue: number): number {
  return normalizeHue(hue + (hue > 30 && hue < 210 ? 8 : -8))
}
