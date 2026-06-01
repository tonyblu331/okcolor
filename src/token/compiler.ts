import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { formatOklch, isRecord, parseColor, tokenNameToCssVar, withAlpha } from './color.js'
import { auditContrastPair, extractDeclaredContrastPairs } from './contrast.js'
import type { CompiledColorTargets, Wcag2AuditPolicy } from './contrast.js'
import { renderLayeredCss } from './css-emitter.js'
import { parseTokenInputs } from './parser.js'
import { resolveTokenRecipePolicy } from './recipe-policy.js'
import {
  buildCompileReport,
  createCompiledTokenReport,
  toFallbackTargetReport,
  toTransformTargetReport,
} from './report-builder.js'
import { expandChroma, fitGamut, gradeColor } from './transforms.js'
import type {
  AuditFailureKind,
  CompiledTokenReport,
  CompileAuditFailure,
  CompileResult,
  ContrastPairReport,
  ContrastPairSkippedReason,
  Gamut,
  OkColorCompileOptions,
  OkColorTargetConfig,
  ParsedColor,
  TransformResult,
} from './types.js'
import { DEFAULT_AMOUNT } from './types.js'

export async function compileTokens(inputPath: string, options: OkColorCompileOptions = {}): Promise<CompileResult> {
  const raw = JSON.parse(await readFile(inputPath, 'utf-8')) as Record<string, unknown>
  return compileTokenObject(raw, options)
}

export function compileTokenObject(
  tokens: Record<string, unknown>,
  options: OkColorCompileOptions = {},
): CompileResult {
  const targets = options.targets ?? defaultTargets()
  const baseLines: string[] = []
  const literalLines: string[] = []
  const p3Lines: string[] = []
  const reports: CompiledTokenReport[] = []
  const reportByToken = new Map<string, CompiledTokenReport>()
  const colorsByToken: Record<string, CompiledColorTargets> = {}
  const designTokens: Record<string, unknown> = {}
  const parsedTokens = parseTokenInputs(tokens)

  for (const tokenInput of parsedTokens.colors) {
    const { name, original, color, recipe, alpha } = tokenInput
    const parsedSource = parseColor(color)
    const source = withAlpha(parsedSource, alpha ?? parsedSource.alpha)
    const cssVar = tokenNameToCssVar(name)
    const baseConfig = targets.base ?? { gamut: 'srgb', strategy: 'convert', format: 'hex' }
    const baseTransform =
      baseConfig.strategy && baseConfig.strategy !== 'convert'
        ? transformForConfig(name, source, baseConfig, recipe, options)
        : undefined

    baseLines.push(`  ${cssVar}: ${source.hex};`)
    if (baseTransform) {
      literalLines.push(`  ${cssVar}: ${baseTransform.css};`)
      literalLines.push(`  ${cssVar}-oklch: ${baseTransform.css};`)
    } else {
      literalLines.push(`  ${cssVar}-oklch: ${formatOklch(source.oklch, source.alpha)};`)
    }

    const targetReports: CompiledTokenReport['targets'] = {
      srgb: baseTransform ? toTransformTargetReport(baseTransform) : toFallbackTargetReport(source),
    }
    colorsByToken[name] = {
      srgb: { oklch: baseTransform?.oklch ?? source.oklch, alpha: source.alpha },
    }

    const p3Config = targets.p3
    if (p3Config) {
      const transform = transformForConfig(name, source, p3Config, recipe, options)
      p3Lines.push(`  ${cssVar}: ${transform.css};`)
      targetReports.p3 = toTransformTargetReport(transform)
      colorsByToken[name].p3 = { oklch: transform.oklch, alpha: source.alpha }
    }

    designTokens[name] = toDesignToken(original, source)
    const report = createCompiledTokenReport({ token: name, source, targets: targetReports })
    reports.push(report)
    reportByToken.set(name, report)
  }

  const auditTargets: Gamut[] = Object.values(colorsByToken).some((targets) => targets.p3) ? ['srgb', 'p3'] : ['srgb']
  const contrastPairs = applyContrastAudits(tokens, colorsByToken, reportByToken, auditTargets, options.audit?.wcag2)

  return {
    css: renderLayeredCss({ base: baseLines, literal: literalLines, p3: p3Lines }),
    report: buildCompileReport({ tokens: reports, diagnostics: parsedTokens.diagnostics, contrastPairs }),
    designTokens,
  }
}

export function collectBlockingFailures(
  result: CompileResult,
  failOn: readonly AuditFailureKind[] = defaultFailOn(),
): CompileAuditFailure[] {
  const selected = new Set(failOn)
  return result.report.summary.failures.filter((failure) => selected.has(failure.kind))
}

export function assertNoBlockingFailures(
  result: CompileResult,
  failOn: readonly AuditFailureKind[] = defaultFailOn(),
): void {
  const failures = collectBlockingFailures(result, failOn)
  if (failures.length === 0) return
  const preview = failures
    .slice(0, 3)
    .map((failure) => failure.message)
    .join('; ')
  throw new Error(`okcolor audit failed (${failures.length}): ${preview}`)
}

function defaultFailOn(): AuditFailureKind[] {
  return ['invalid-css', 'out-of-gamut', 'wcag2-regression']
}

function applyContrastAudits(
  tokens: Record<string, unknown>,
  colorsByToken: Record<string, CompiledColorTargets>,
  reportByToken: Map<string, CompiledTokenReport>,
  auditTargets: readonly Gamut[],
  wcag2Policy: Wcag2AuditPolicy | undefined,
): ContrastPairReport[] {
  const pairReports: ContrastPairReport[] = []

  for (const pair of extractDeclaredContrastPairs(tokens)) {
    const report = reportByToken.get(pair.background)

    for (const target of auditTargets) {
      const skippedReason = getContrastPairSkippedReason(pair.background, pair.foreground, target, colorsByToken)
      if (skippedReason) {
        pairReports.push(toSkippedContrastPair(pair.background, pair.foreground, target, skippedReason))
        continue
      }

      const result = auditContrastPair(pair, colorsByToken, target, wcag2Policy)
      if (!result) continue
      pairReports.push({
        background: pair.background,
        foreground: pair.foreground,
        target,
        status: 'evaluated',
        wcag2Key: result.key,
        apcaKey: result.key,
      })
      if (report) {
        report.contrast.wcag2[result.key] = result.wcag2
        report.contrast.apca[result.key] = result.apca
      }
    }
  }

  return pairReports
}

function getContrastPairSkippedReason(
  background: string,
  foreground: string,
  target: Gamut,
  colorsByToken: Record<string, CompiledColorTargets>,
): ContrastPairSkippedReason | undefined {
  const backgroundTargets = colorsByToken[background]
  const foregroundTargets = colorsByToken[foreground]
  if (!backgroundTargets) return 'missing-background'
  if (!foregroundTargets) return 'missing-foreground'
  if (!backgroundTargets[target] || !foregroundTargets[target]) return 'missing-target'
  if (backgroundTargets[target].alpha < 1 || foregroundTargets[target].alpha < 1) return 'alpha-unsupported'
  return undefined
}

function toSkippedContrastPair(
  background: string,
  foreground: string,
  target: Gamut,
  skippedReason: ContrastPairSkippedReason,
): ContrastPairReport {
  return {
    background,
    foreground,
    target,
    status: 'skipped',
    skippedReason,
    message: skippedContrastPairMessage(background, foreground, target, skippedReason),
  }
}

function skippedContrastPairMessage(
  background: string,
  foreground: string,
  target: Gamut,
  skippedReason: ContrastPairSkippedReason,
): string {
  if (skippedReason === 'missing-background') return `${background}@${target} is missing or could not be compiled`
  if (skippedReason === 'missing-foreground') return `${foreground}@${target} is missing or could not be compiled`
  if (skippedReason === 'alpha-unsupported') {
    return `${background}/${foreground}@${target} uses alpha; contrast compositing is not supported yet`
  }
  return `${background}/${foreground}@${target} is missing a compiled target`
}

export async function writeCompileResult(
  inputPath: string,
  options: OkColorCompileOptions & { output?: string; reportPath?: string } = {},
): Promise<CompileResult> {
  const result = await compileTokens(inputPath, options)
  if (options.output) await writeOutput(options.output, result.css)
  if (options.reportPath) await writeOutput(options.reportPath, JSON.stringify(result.report, null, 2))
  assertNoBlockingFailures(result, options.audit?.failOn)
  return result
}

function transformForConfig(
  tokenName: string,
  source: ParsedColor,
  config: OkColorTargetConfig,
  tokenRecipe: string | undefined,
  options: OkColorCompileOptions,
): TransformResult {
  const policy = resolveTokenRecipePolicy({
    tokenName,
    tokenRecipe,
    targetConfig: config,
    recipes: options.recipes,
  })
  const strategy = policy.config.strategy ?? 'expand'

  if (strategy === 'convert') return toLiteralTransform(source, policy.config)
  if (strategy === 'fit') return fitGamut(source, policy.config)
  if (strategy === 'grade') return gradeColor(source, { ...policy.config, recipe: policy.gradeRecipe })
  return expandChroma(source, policy.config)
}

function toLiteralTransform(source: ParsedColor, config: OkColorTargetConfig): TransformResult {
  return {
    source,
    oklch: source.oklch,
    alpha: source.alpha,
    css: formatOklch(source.oklch, source.alpha),
    cMax: source.oklch.c,
    amount: 0,
    gamut: config.gamut ?? 'srgb',
    strategy: 'convert',
    delta: zeroDelta(),
    inGamut: true,
    syntaxValid: true,
    displaySafe: true,
  }
}

function zeroDelta() {
  return { lightness: 0, chroma: 0, hue: 0 }
}

function defaultTargets(): NonNullable<OkColorCompileOptions['targets']> {
  return {
    base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
    p3: { gamut: 'p3', strategy: 'expand', amount: DEFAULT_AMOUNT, format: 'oklch' },
  }
}

function toDesignToken(original: unknown, source: ParsedColor): unknown {
  const value = {
    colorSpace: 'srgb',
    components: hexToComponents(source.hex),
    alpha: source.alpha,
    hex: source.hex,
  }
  if (isRecord(original)) return { ...original, $type: original.$type ?? 'color', $value: value }
  return { $type: 'color', $value: value }
}

function hexToComponents(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ]
}

async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
