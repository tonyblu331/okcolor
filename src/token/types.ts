export type Gamut = 'srgb' | 'p3'
export type AuditFailureKind = 'invalid-css' | 'out-of-gamut' | 'wcag2-regression'
export type Strategy = 'convert' | 'expand' | 'grade' | 'fit'
export type TokenFormat = 'hex' | 'oklch'
export type RecipeName = 'literal' | 'vivid' | 'deeper' | 'premium' | 'muted' | 'softer' | 'warmer' | 'cooler'

export interface Oklch {
  l: number
  c: number
  h: number
}

export interface TransformDelta {
  lightness: number
  chroma: number
  hue: number
}

export type TransformSkippedReason = 'chroma-below-threshold'

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
  strategy: Strategy
  recipe?: RecipeName
  delta: TransformDelta
  inGamut: boolean
  syntaxValid: boolean
  displaySafe: boolean
  neutralSkipped?: boolean
  skippedReason?: TransformSkippedReason
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
    failOn?: AuditFailureKind[]
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
  lc: number
  polarity: 'normal' | 'reverse' | 'none'
  advisory: 'pass-body' | 'pass-large' | 'fail'
}

export interface CompiledTokenReport {
  token: string
  source: string
  sourceGamut: 'srgb'
  oklch: Oklch
  targets: Record<
    string,
    {
      gamut: Gamut
      strategy: Strategy
      recipe?: RecipeName
      delta: TransformDelta
      inGamut: boolean
      syntaxValid: boolean
      displaySafe: boolean
      css: string
      cMax?: number
      amount?: number
      neutralSkipped?: boolean
      skippedReason?: TransformSkippedReason
    }
  >
  contrast: {
    wcag2: Record<string, WcagContrastResult>
    apca: Record<string, ApcaContrastResult>
  }
}

export interface CompileAuditFailure {
  kind: AuditFailureKind
  token: string
  target?: string
  message: string
}

export interface CompileReport {
  tokens: CompiledTokenReport[]
  summary: {
    contrastPassed: boolean
    failureCount: number
    failures: CompileAuditFailure[]
  }
}

export interface CompileResult {
  css: string
  report: CompileReport
  designTokens: Record<string, unknown>
}

export const DEFAULT_AMOUNT = 0.75
export const NEUTRAL_CHROMA_THRESHOLD = 0.02
