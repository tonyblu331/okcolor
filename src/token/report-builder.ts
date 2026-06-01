import type {
  CompileAuditFailure,
  CompiledTokenReport,
  CompileReport,
  ContrastPairReport,
  ParsedColor,
  TokenParseDiagnostic,
  TransformResult,
} from './types.js'
import { COMPILE_REPORT_SCHEMA_VERSION } from './types.js'

export function createCompiledTokenReport(input: {
  token: string
  source: ParsedColor
  targets: CompiledTokenReport['targets']
}): CompiledTokenReport {
  return {
    token: input.token,
    source: input.source.hex,
    sourceGamut: 'srgb',
    oklch: input.source.oklch,
    targets: input.targets,
    contrast: { wcag2: {}, apca: {} },
  }
}

export function toTransformTargetReport(transform: TransformResult): CompiledTokenReport['targets'][string] {
  return {
    gamut: transform.gamut,
    strategy: transform.strategy,
    recipe: transform.recipe,
    delta: transform.delta,
    inGamut: transform.inGamut,
    syntaxValid: transform.syntaxValid,
    displaySafe: transform.displaySafe,
    css: transform.css,
    cMax: transform.cMax,
    amount: transform.amount,
    neutralSkipped: transform.neutralSkipped,
    skippedReason: transform.skippedReason,
  }
}

export function toFallbackTargetReport(source: ParsedColor): CompiledTokenReport['targets'][string] {
  return {
    gamut: 'srgb',
    strategy: 'convert',
    delta: zeroDelta(),
    inGamut: true,
    syntaxValid: true,
    displaySafe: true,
    css: source.hex,
    cMax: source.oklch.c,
    amount: 0,
  }
}

export function buildCompileReport(input: {
  tokens: CompiledTokenReport[]
  diagnostics: TokenParseDiagnostic[]
  contrastPairs?: ContrastPairReport[]
}): CompileReport {
  const failures = collectAuditFailures(input.tokens)

  return {
    schemaVersion: COMPILE_REPORT_SCHEMA_VERSION,
    tokens: input.tokens,
    diagnostics: input.diagnostics,
    contrastPairs: input.contrastPairs ?? [],
    summary: {
      contrastPassed: !failures.some((failure) => failure.kind === 'wcag2-regression'),
      failureCount: failures.length,
      failures,
    },
  }
}

export function collectAuditFailures(reports: CompiledTokenReport[]): CompileAuditFailure[] {
  const failures: CompileAuditFailure[] = []
  for (const report of reports) {
    for (const [target, result] of Object.entries(report.targets)) {
      if (!result.syntaxValid) {
        failures.push({
          kind: 'invalid-css',
          token: report.token,
          target,
          message: `${report.token}@${target} emitted invalid CSS`,
        })
      }
      if (!result.inGamut || !result.displaySafe) {
        failures.push({
          kind: 'out-of-gamut',
          token: report.token,
          target,
          message: `${report.token}@${target} is outside the target gamut`,
        })
      }
    }

    for (const [key, contrast] of Object.entries(report.contrast.wcag2)) {
      if (contrast.status === 'fail') {
        failures.push({
          kind: 'wcag2-regression',
          token: report.token,
          target: contrast.target,
          message: `${report.token} contrast ${key} failed ${formatWcagRequirement(contrast.requirement)} (${contrast.ratio}:1 < ${contrast.required}:1)`,
        })
      }
    }
  }
  return failures
}

function formatWcagRequirement(requirement: string): string {
  if (requirement === 'custom') return 'custom WCAG 2 gate'
  return requirement.toUpperCase().replace('WCAG2-', 'WCAG 2 ')
}

function zeroDelta() {
  return { lightness: 0, chroma: 0, hue: 0 }
}
