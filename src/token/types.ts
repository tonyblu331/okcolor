export type Gamut = 'srgb' | 'p3'
export type Strategy = 'convert' | 'expand' | 'grade' | 'fit'
export type TokenFormat = 'hex' | 'oklch'
export type RecipeName = 'literal' | 'vivid' | 'deeper' | 'premium' | 'muted' | 'softer' | 'warmer' | 'cooler'

export interface Oklch {
  l: number
  c: number
  h: number
}

export interface ParsedColor {
  input: string
  hex: string
  oklch: Oklch
  sourceGamut: 'srgb'
}

export interface TargetOptions {
  gamut?: Gamut
  strategy?: Strategy
  amount?: number
  format?: TokenFormat
}

export interface GradeOptions extends TargetOptions {
  recipe: RecipeName
}

export interface TransformResult {
  source: ParsedColor
  oklch: Oklch
  css: string
  cMax: number
  amount: number
  gamut: Gamut
  inGamut: boolean
  syntaxValid: boolean
  displaySafe: boolean
  neutralSkipped?: boolean
}

export interface OkColorTargetConfig {
  gamut?: Gamut
  strategy?: Strategy
  amount?: number
  format?: TokenFormat
}

export interface OkColorCompileOptions {
  targets?: Record<string, OkColorTargetConfig>
  recipes?: Record<string, OkColorTargetConfig & { intent?: RecipeName; recipe?: RecipeName; lightness?: number }>
  audit?: {
    contrast?: string[]
    failOn?: string[]
  }
}

export interface WcagContrastResult {
  foreground: string
  background: string
  target: Gamut
  ratio: number
  required: number
  status: 'pass' | 'fail'
}

export interface ApcaContrastResult {
  foreground: string
  background: string
  target: Gamut
  advisory: 'unavailable'
}

export interface CompiledTokenReport {
  token: string
  source: string
  sourceGamut: 'srgb'
  oklch: Oklch
  targets: Record<string, {
    inGamut: boolean
    syntaxValid: boolean
    displaySafe: boolean
    css: string
    cMax?: number
    amount?: number
  }>
  contrast: {
    wcag2: Record<string, WcagContrastResult>
    apca: Record<string, ApcaContrastResult>
  }
}

export interface CompileResult {
  css: string
  report: { tokens: CompiledTokenReport[] }
  designTokens: Record<string, unknown>
}

export const DEFAULT_AMOUNT = 0.75
export const NEUTRAL_CHROMA_THRESHOLD = 0.02
