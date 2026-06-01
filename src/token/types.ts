import type { ColorMathPort } from './color-math-port.js'
export type Gamut = 'srgb' | 'p3'
export type AuditFailureKind = 'invalid-css' | 'out-of-gamut' | 'wcag2-regression'
export type Wcag2Level = 'aa' | 'aaa'
export type Strategy = 'convert' | 'expand' | 'grade' | 'fit'
export type TokenFormat = 'hex' | 'oklch'
export const RECIPE_NAMES = ['literal', 'vivid', 'deeper', 'premium', 'muted', 'softer', 'warmer', 'cooler'] as const
export type RecipeName = (typeof RECIPE_NAMES)[number]

export function isRecipeName(value: unknown): value is RecipeName {
  return typeof value === 'string' && (RECIPE_NAMES as readonly string[]).includes(value)
}

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
  alpha: number
  sourceGamut: 'srgb'
}

export interface TargetOptions {
  gamut?: Gamut
  strategy?: Strategy
  amount?: number
  format?: TokenFormat
  math?: ColorMathPort
}

export interface GradeOptions extends TargetOptions {
  recipe: RecipeName
}

export interface TransformResult {
  source: ParsedColor
  oklch: Oklch
  alpha: number
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
  math?: ColorMathPort
}

export interface OkColorCompileOptions {
  targets?: Record<string, OkColorTargetConfig>
  recipes?: Record<string, OkColorTargetConfig & { intent?: RecipeName; recipe?: RecipeName; lightness?: number }>
  audit?: {
    failOn?: AuditFailureKind[]
    wcag2?: {
      /** Default is the token's declared requirement, falling back to AA. */
      level?: Wcag2Level
      /** Overrides level and token requirement when set. */
      requiredRatio?: number
    }
  }
}

export interface WcagContrastResult {
  foreground: string
  background: string
  target: Gamut
  ratio: number
  required: number
  requirement: `wcag2-${Wcag2Level}` | 'custom'
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

export type ContrastPairStatus = 'evaluated' | 'skipped'
export type ContrastPairSkippedReason = 'missing-background' | 'missing-foreground' | 'missing-target' | 'alpha-unsupported'

export interface ContrastPairReport {
  foreground: string
  background: string
  target: Gamut
  status: ContrastPairStatus
  wcag2Key?: string
  apcaKey?: string
  skippedReason?: ContrastPairSkippedReason
  message?: string
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


export type TokenParseDiagnosticKind =
  | 'unsupported-token-shape'
  | 'unsupported-color-space'
  | 'invalid-color-components'

export interface TokenParseDiagnostic {
  token: string
  kind: TokenParseDiagnosticKind
  severity: 'warning'
  path: string
  message: string
}

export interface CompileAuditFailure {
  kind: AuditFailureKind
  token: string
  target?: string
  message: string
}

export const COMPILE_REPORT_SCHEMA_VERSION = 1 as const
export type CompileReportSchemaVersion = typeof COMPILE_REPORT_SCHEMA_VERSION

export interface CompileReport {
  schemaVersion: CompileReportSchemaVersion
  tokens: CompiledTokenReport[]
  diagnostics: TokenParseDiagnostic[]
  contrastPairs: ContrastPairReport[]
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
