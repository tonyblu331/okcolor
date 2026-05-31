import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { formatOklch, isRecord, parseColor, tokenNameToCssVar } from './color.js'
import { auditContrastPair, extractDeclaredContrastPairs } from './contrast.js'
import { expandChroma, fitGamut, gradeColor } from './transforms.js'
import type {
  AuditFailureKind,
  CompiledTokenReport,
  CompileAuditFailure,
  CompileResult,
  OkColorCompileOptions,
  OkColorTargetConfig,
  Oklch,
  ParsedColor,
  RecipeName,
  TransformResult,
} from './types.js'
import { DEFAULT_AMOUNT, isRecipeName, RECIPE_NAMES } from './types.js'

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
  const colorsByToken: Record<string, { srgb: Oklch; p3?: Oklch }> = {}
  const designTokens: Record<string, unknown> = {}

  for (const [name, token] of Object.entries(tokens)) {
    const value = extractTokenColor(token)
    if (!value) continue

    const source = parseColor(value)
    const cssVar = tokenNameToCssVar(name)
    baseLines.push(`  ${cssVar}: ${source.hex};`)
    literalLines.push(`  ${cssVar}-oklch: ${formatOklch(source.oklch)};`)

    const targetReports: CompiledTokenReport['targets'] = {
      srgb: toFallbackTargetReport(source),
    }
    colorsByToken[name] = { srgb: source.oklch }

    const p3Config = targets.p3
    if (p3Config) {
      const transform = transformForConfig(name, source, p3Config, extractTokenRecipe(token), options)
      p3Lines.push(`  ${cssVar}: ${transform.css};`)
      targetReports.p3 = toTargetReport(transform)
      colorsByToken[name].p3 = transform.oklch
    }

    designTokens[name] = toDesignToken(token, source)
    const report = {
      token: name,
      source: source.hex,
      sourceGamut: 'srgb',
      oklch: source.oklch,
      targets: targetReports,
      contrast: { wcag2: {}, apca: {} },
    } satisfies CompiledTokenReport
    reports.push(report)
    reportByToken.set(name, report)
  }

  applyContrastAudits(tokens, colorsByToken, reportByToken)

  const failures = collectAuditFailures(reports)

  return {
    css: renderLayeredCss(baseLines, literalLines, p3Lines),
    report: {
      tokens: reports,
      summary: {
        contrastPassed: !failures.some((failure) => failure.kind === 'wcag2-regression'),
        failureCount: failures.length,
        failures,
      },
    },
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

function collectAuditFailures(reports: CompiledTokenReport[]): CompileAuditFailure[] {
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
          message: `${report.token} contrast ${key} failed WCAG 2 AA (${contrast.ratio}:1 < ${contrast.required}:1)`,
        })
      }
    }
  }
  return failures
}

function defaultFailOn(): AuditFailureKind[] {
  return ['invalid-css', 'out-of-gamut', 'wcag2-regression']
}

function applyContrastAudits(
  tokens: Record<string, unknown>,
  colorsByToken: Record<string, { srgb: Oklch; p3?: Oklch }>,
  reportByToken: Map<string, CompiledTokenReport>,
): void {
  for (const pair of extractDeclaredContrastPairs(tokens)) {
    const report = reportByToken.get(pair.background)
    if (!report) continue

    for (const target of ['srgb', 'p3'] as const) {
      const result = auditContrastPair(pair, colorsByToken, target)
      if (!result) continue
      report.contrast.wcag2[result.key] = result.wcag2
      report.contrast.apca[result.key] = result.apca
    }
  }
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
  const recipeConfig = resolveTokenRecipeConfig(tokenName, tokenRecipe, options)
  const merged = { ...config, ...recipeConfig }
  const strategy = merged.strategy ?? 'expand'
  const recipe = resolveConfiguredRecipe(merged.recipe ?? merged.intent, tokenName)

  if (strategy === 'convert') return toLiteralTransform(source, merged)
  if (strategy === 'fit') return fitGamut(source, merged)
  if (strategy === 'grade') return gradeColor(source, { ...merged, recipe: recipe ?? 'premium' })
  return expandChroma(source, merged)
}

function resolveTokenRecipeConfig(
  tokenName: string,
  tokenRecipe: string | undefined,
  options: OkColorCompileOptions,
): Partial<OkColorTargetConfig & { intent?: RecipeName; recipe?: RecipeName; lightness?: number }> | undefined {
  if (!tokenRecipe) return undefined
  const configured = options.recipes?.[tokenRecipe]
  if (configured) return configured
  if (!isRecipeName(tokenRecipe)) {
    throw new Error(
      `Unknown okcolor recipe "${tokenRecipe}" for token "${tokenName}". Define options.recipes["${tokenRecipe}"] or use: ${RECIPE_NAMES.join(', ')}`,
    )
  }
  if (tokenRecipe === 'literal') return { strategy: 'convert', recipe: tokenRecipe }
  return { strategy: 'grade', recipe: tokenRecipe }
}

function resolveConfiguredRecipe(value: unknown, tokenName: string): RecipeName | undefined {
  if (value == null) return undefined
  if (isRecipeName(value)) return value
  throw new Error(`Unsupported okcolor recipe "${String(value)}" for token "${tokenName}". Use: ${RECIPE_NAMES.join(', ')}`)
}

function toLiteralTransform(source: ParsedColor, config: OkColorTargetConfig): TransformResult {
  return {
    source,
    oklch: source.oklch,
    css: formatOklch(source.oklch),
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

function toTargetReport(transform: TransformResult): CompiledTokenReport['targets'][string] {
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

function toFallbackTargetReport(source: ParsedColor): CompiledTokenReport['targets'][string] {
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

function zeroDelta() {
  return { lightness: 0, chroma: 0, hue: 0 }
}

function defaultTargets(): NonNullable<OkColorCompileOptions['targets']> {
  return {
    base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
    p3: { gamut: 'p3', strategy: 'expand', amount: DEFAULT_AMOUNT, format: 'oklch' },
  }
}

function renderLayeredCss(baseLines: string[], literalLines: string[], p3Lines: string[]): string {
  return [
    ':root {',
    ...baseLines,
    '}',
    '',
    '@supports (color: oklch(0.5 0.1 40)) {',
    '  :root {',
    ...literalLines,
    '  }',
    '}',
    '',
    '@media (color-gamut: p3) {',
    '  @supports (color: oklch(0.5 0.1 40)) {',
    '    :root {',
    ...p3Lines.map((line) => `  ${line}`),
    '    }',
    '  }',
    '}',
    '',
  ].join('\n')
}

function extractTokenColor(token: unknown): string | undefined {
  if (typeof token === 'string') return token
  if (!isRecord(token)) return undefined
  const value = token.$value
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  if (typeof value.hex === 'string') return value.hex
  return colorSpaceComponentsToRgb(value)
}

function colorSpaceComponentsToRgb(value: Record<string, unknown>): string | undefined {
  if (value.colorSpace !== 'srgb' || !Array.isArray(value.components) || value.components.length < 3) return undefined
  const components = value.components.slice(0, 3)
  if (!components.every((component) => typeof component === 'number' && Number.isFinite(component))) return undefined
  const [r, g, b] = components
  return `rgb(${Math.round(clamp01(r) * 255)} ${Math.round(clamp01(g) * 255)} ${Math.round(clamp01(b) * 255)})`
}

function extractTokenRecipe(token: unknown): string | undefined {
  if (!isRecord(token) || !isRecord(token.okcolor) || typeof token.okcolor.recipe !== 'string') return undefined
  return token.okcolor.recipe
}

function toDesignToken(original: unknown, source: ParsedColor): unknown {
  const value = {
    colorSpace: 'srgb',
    components: hexToComponents(source.hex),
    alpha: extractTokenAlpha(original),
    hex: source.hex,
  }
  if (isRecord(original)) return { ...original, $type: original.$type ?? 'color', $value: value }
  return { $type: 'color', $value: value }
}

function extractTokenAlpha(original: unknown): number {
  if (!isRecord(original) || !isRecord(original.$value) || typeof original.$value.alpha !== 'number') return 1
  return clamp01(original.$value.alpha)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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
