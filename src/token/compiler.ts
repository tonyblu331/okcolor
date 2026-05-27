import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { formatOklch, isRecord, parseColor, tokenNameToCssVar } from './color.js'
import { auditContrastPair, extractDeclaredContrastPairs } from './contrast.js'
import { expandChroma, fitGamut, gradeColor } from './transforms.js'
import type { CompiledTokenReport, CompileResult, OkColorCompileOptions, OkColorTargetConfig, Oklch, ParsedColor, RecipeName, TransformResult } from './types.js'
import { DEFAULT_AMOUNT } from './types.js'

export async function compileTokens(inputPath: string, options: OkColorCompileOptions = {}): Promise<CompileResult> {
  const raw = JSON.parse(await readFile(inputPath, 'utf-8')) as Record<string, unknown>
  return compileTokenObject(raw, options)
}

export function compileTokenObject(tokens: Record<string, unknown>, options: OkColorCompileOptions = {}): CompileResult {
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
      srgb: { inGamut: true, syntaxValid: true, displaySafe: true, css: source.hex },
    }
    colorsByToken[name] = { srgb: source.oklch }

    const p3Config = targets.p3
    if (p3Config) {
      const transform = transformForConfig(source, p3Config, extractTokenRecipe(token), options)
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

  return {
    css: renderLayeredCss(baseLines, literalLines, p3Lines),
    report: { tokens: reports },
    designTokens,
  }
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
  return result
}

function transformForConfig(
  source: ParsedColor,
  config: OkColorTargetConfig,
  tokenRecipe: RecipeName | undefined,
  options: OkColorCompileOptions,
): TransformResult {
  const recipeConfig = tokenRecipe ? options.recipes?.[tokenRecipe] : undefined
  const merged = { ...config, ...recipeConfig }
  const strategy = merged.strategy ?? (tokenRecipe && tokenRecipe !== 'literal' ? 'grade' : 'expand')
  const recipe = (merged.recipe ?? merged.intent ?? tokenRecipe) as RecipeName | undefined

  if (strategy === 'convert') return toLiteralTransform(source, merged)
  if (strategy === 'fit') return fitGamut(source, merged)
  if (strategy === 'grade') return gradeColor(source, { ...merged, recipe: recipe ?? 'premium' })
  return expandChroma(source, merged)
}

function toLiteralTransform(source: ParsedColor, config: OkColorTargetConfig): TransformResult {
  return {
    source,
    oklch: source.oklch,
    css: formatOklch(source.oklch),
    cMax: source.oklch.c,
    amount: 0,
    gamut: config.gamut ?? 'srgb',
    inGamut: true,
    syntaxValid: true,
    displaySafe: true,
  }
}

function toTargetReport(transform: TransformResult): CompiledTokenReport['targets'][string] {
  return {
    inGamut: transform.inGamut,
    syntaxValid: transform.syntaxValid,
    displaySafe: transform.displaySafe,
    css: transform.css,
    cMax: transform.cMax,
    amount: transform.amount,
  }
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
  const [r, g, b] = value.components.map((component) => Number(component))
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
}

function extractTokenRecipe(token: unknown): RecipeName | undefined {
  if (!isRecord(token) || !isRecord(token.okcolor) || typeof token.okcolor.recipe !== 'string') return undefined
  return token.okcolor.recipe as RecipeName
}

function toDesignToken(original: unknown, source: ParsedColor): unknown {
  const value = {
    colorSpace: 'srgb',
    components: hexToComponents(source.hex),
    alpha: 1,
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
