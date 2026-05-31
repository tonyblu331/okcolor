#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readdirSync, realpathSync, statSync, existsSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { dirname, resolve, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditCss, convertColor, colorToOklch } from './wasm.js'
import {
  assertNoBlockingFailures,
  compileTokens,
  expandChroma,
  fitGamut,
  formatDescription,
  gradeColor,
  parseColor,
} from './token-engine.js'
import type { ScanResult } from './types.js'
import type { AuditFailureKind, Gamut, RecipeName, Strategy } from './token-engine.js'

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.vue', '.svelte', '.astro'])
const EMBEDDED_STYLE_EXTS = new Set(['.vue', '.svelte', '.astro'])
const STYLE_BLOCK_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi
const CONCURRENCY = 32

const SPACES = ['hex', 'rgb', 'hsl', 'hwb', 'oklch'] as const

function showHelp(): void {
  console.log(`
  okcolor — build-time color modernizer

  Usage:
    okcolor audit <css-dir|tokens.json> [--mode css|tokens] [--format json]
      Audit CSS color debt or token gamut/contrast safety.

    okcolor check <path> [--max-legacy-colors N] [--allow-named]
      CI gate — exit 1 if legacy colors exceed threshold.

    okcolor doctor <path> [--format json]
      Find color issues (malformed hex, low contrast, etc.).

    okcolor convert <color|tokens.json> [--to <space>] [--out <file>]
      Convert a single color between spaces.
      Supported spaces: hex, rgb, hsl, hwb, oklch

    okcolor expand <color|tokens.json> [--gamut p3] [--amount 0.75] [--format json] [--out <file>]
      Create controlled wide-gamut OKLCH enhancement.

    okcolor grade <color|tokens.json> [--recipe premium] [--gamut p3] [--format json] [--out <file>]
      Apply art-directed OKLCH transform.

    okcolor fit <color|tokens.json> [--gamut srgb] [--format json] [--out <file>]
      Fit color into a target gamut by reducing chroma.

    okcolor describe <color> [--gamut p3]
      Explain OKLCH identity and available gamut budget.

  Examples:
    npx okcolor audit ./src
    npx okcolor check . --max-legacy-colors 10
    npx okcolor doctor ./src --format json
    npx okcolor convert "#ff0000" --to hsl
    npx okcolor expand ./tokens.json --gamut p3 --amount 0.75 --out colors.css
`)
}

interface CliArgs {
  command: 'help' | 'audit' | 'check' | 'doctor' | 'convert' | 'expand' | 'grade' | 'fit' | 'describe'
  path?: string
  format: 'pretty' | 'json'
  auditMode?: AuditMode
  maxLegacyColors?: number
  allowNamed?: boolean
  color?: string
  toSpace?: string
  gamut?: Gamut
  amount?: number
  recipe?: RecipeName
  out?: string
  report?: string
  contrast?: string[]
  failOn?: AuditFailureKind[]
  exitCode?: number
}

export type AuditMode = 'css' | 'tokens'

function die(msg: string): CliArgs {
  console.error(msg)
  showHelp()
  return { command: 'help', format: 'pretty', exitCode: 1 }
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2)
  if (!args[0] || args[0] === '--help' || args[0] === '-h') {
    return { command: 'help', format: 'pretty' }
  }

  const command = args[0] as CliArgs['command']
  if (!['help', 'audit', 'check', 'doctor', 'convert', 'expand', 'grade', 'fit', 'describe'].includes(command)) {
    return die(`Unknown command: ${command}`)
  }

  let path: string | undefined
  let format: 'pretty' | 'json' = 'pretty'
  let auditMode: AuditMode | undefined
  let maxLegacyColors: number | undefined
  let allowNamed = false
  let color: string | undefined
  let toSpace: string | undefined
  let gamut: Gamut | undefined
  let amount: number | undefined
  let recipe: RecipeName | undefined
  let out: string | undefined
  let report: string | undefined
  let contrast: string[] | undefined
  let failOn: AuditFailureKind[] | undefined

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    const peek = args[i + 1]

    if (arg === '--format' && peek === 'json') {
      format = 'json'
      i++
    } else if (arg === '--format=json') format = 'json'
    else if (arg === '--mode' && peek) {
      if (command !== 'audit') return die(`--mode is only supported by audit`)
      const mode = parseAuditMode(peek)
      if (!mode) return die(`Invalid audit mode: ${peek}. Use: css, tokens`)
      auditMode = mode
      i++
    } else if (arg.startsWith('--mode=')) {
      if (command !== 'audit') return die(`--mode is only supported by audit`)
      const value = arg.slice(7)
      const mode = parseAuditMode(value)
      if (!mode) return die(`Invalid audit mode: ${value}. Use: css, tokens`)
      auditMode = mode
    } else if (arg === '--to' && peek) {
      toSpace = peek
      i++
    } else if (arg.startsWith('--to=')) toSpace = arg.slice(5)
    else if (arg === '--gamut' && peek) {
      gamut = peek as Gamut
      i++
    } else if (arg.startsWith('--gamut=')) gamut = arg.slice(8) as Gamut
    else if (arg === '--amount' && peek) {
      const n = Number(peek)
      if (Number.isNaN(n)) return die(`Invalid amount: ${peek}`)
      amount = n
      i++
    } else if (arg.startsWith('--amount=')) {
      const n = Number(arg.slice(9))
      if (Number.isNaN(n)) return die(`Invalid amount: ${arg.slice(9)}`)
      amount = n
    } else if (arg === '--recipe' && peek) {
      recipe = peek as RecipeName
      i++
    } else if (arg.startsWith('--recipe=')) recipe = arg.slice(9) as RecipeName
    else if (arg === '--out' && peek) {
      out = peek
      i++
    } else if (arg.startsWith('--out=')) out = arg.slice(6)
    else if (arg === '--report' && peek) {
      report = peek
      i++
    } else if (arg.startsWith('--report=')) report = arg.slice(9)
    else if (arg === '--contrast' && peek) {
      contrast = splitCsv(peek)
      i++
    } else if (arg.startsWith('--contrast=')) contrast = splitCsv(arg.slice(11))
    else if (arg === '--fail-on' && peek) {
      failOn = splitCsv(peek) as AuditFailureKind[]
      i++
    } else if (arg.startsWith('--fail-on=')) failOn = splitCsv(arg.slice(10)) as AuditFailureKind[]
    else if (arg === '--max-legacy-colors' && peek) {
      const n = parseInt(peek, 10)
      if (Number.isNaN(n)) return die(`Invalid number: ${peek}`)
      maxLegacyColors = n
      i++
    } else if (arg.startsWith('--max-legacy-colors=')) {
      const n = parseInt(arg.split('=')[1], 10)
      if (Number.isNaN(n)) return die(`Invalid number: ${arg.split('=')[1]}`)
      maxLegacyColors = n
    } else if (arg === '--allow-named') {
      allowNamed = true
    } else if (arg.startsWith('-') && arg !== '--') {
      return die(`Unknown option: ${arg}`)
    } else {
      if (isColorCommand(command) && !color && !looksLikeTokenPath(arg)) color = arg
      else path = arg
    }
  }

  return {
    command,
    path,
    format,
    auditMode,
    maxLegacyColors,
    allowNamed,
    color,
    toSpace,
    gamut,
    amount,
    recipe,
    out,
    report,
    contrast,
    failOn,
  }
}

function parseAuditMode(value: string): AuditMode | undefined {
  if (value === 'css' || value === 'tokens') return value
  return undefined
}

export function resolveAuditMode(path: string, requested?: AuditMode): AuditMode {
  const inferred: AuditMode = isJsonPath(path) ? 'tokens' : 'css'
  if (!requested) return inferred
  if (requested === 'tokens' && !isJsonPath(path)) {
    throw new Error(`Token audit mode expects a .json token file: ${path}`)
  }
  if (requested === 'css' && isJsonPath(path)) {
    throw new Error(`CSS audit mode expects a CSS directory, not token JSON: ${path}`)
  }
  return requested
}

function isColorCommand(command: CliArgs['command']): boolean {
  return (
    command === 'convert' || command === 'expand' || command === 'grade' || command === 'fit' || command === 'describe'
  )
}

function looksLikeTokenPath(value: string): boolean {
  return /\.json$/i.test(value) || value.includes('/') || value.includes('\\')
}

function validatePath(raw: string): string {
  const dir = resolve(raw)
  if (!existsSync(dir)) {
    throw new Error(`Path not found: ${dir}`)
  }
  const st = statSync(dir)
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`)
  }
  return dir
}

function isSkippedDirectory(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.')
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function validateGamut(gamut: Gamut | undefined, fallback: Gamut): Gamut {
  const resolved = gamut ?? fallback
  if (resolved !== 'srgb' && resolved !== 'p3') {
    throw new Error(`Unsupported gamut: ${resolved}. Use: srgb, p3`)
  }
  return resolved
}

function validateRecipe(recipe: RecipeName | undefined): RecipeName {
  const resolved = recipe ?? 'premium'
  if (!['literal', 'vivid', 'deeper', 'premium', 'muted', 'softer', 'warmer', 'cooler'].includes(resolved)) {
    throw new Error(`Unsupported recipe: ${resolved}`)
  }
  return resolved
}

function isJsonPath(path: string | undefined): path is string {
  return !!path && /\.json$/i.test(path)
}

function isCssFileName(name: string): boolean {
  return CSS_EXTS.has(extname(name).toLowerCase())
}

function warnSkippedPath(path: string, reason: unknown): void {
  console.warn(`Warning: skipped ${path}:`, reason instanceof Error ? reason.message : String(reason))
}

export function findCssFiles(dir: string, results: string[] = [], visitedDirs = new Set<string>()): string[] {
  let realDir: string
  try {
    realDir = realpathSync(dir)
  } catch (e) {
    warnSkippedPath(dir, e)
    return results
  }

  if (visitedDirs.has(realDir)) return results
  visitedDirs.add(realDir)

  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    warnSkippedPath(dir, e)
    return results
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!isSkippedDirectory(entry.name)) findCssFiles(full, results, visitedDirs)
    } else if (entry.isFile() && isCssFileName(entry.name)) {
      results.push(full)
    } else if (entry.isSymbolicLink()) {
      let st: Stats
      try {
        st = statSync(full)
      } catch (e) {
        warnSkippedPath(full, e)
        continue
      }
      if (st.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) findCssFiles(full, results, visitedDirs)
      } else if (st.isFile() && isCssFileName(entry.name)) {
        results.push(full)
      }
    }
  }
  return results
}

function extractStyles(content: string, file: string): string {
  if (EMBEDDED_STYLE_EXTS.has(extname(file).toLowerCase())) {
    const styles: string[] = []
    let m: RegExpExecArray | null
    STYLE_BLOCK_RE.lastIndex = 0
    while ((m = STYLE_BLOCK_RE.exec(content)) !== null) {
      styles.push(m[1])
    }
    return styles.join('\n')
  }
  return content
}

function getReasonPath(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'path' in reason) {
    const path = reason.path
    if (typeof path === 'string') return path
  }
  return 'unknown file'
}

async function processFiles<T>(
  files: string[],
  fn: (css: string, file: string) => T,
): Promise<Array<{ file: string; result: T }>> {
  const results: Array<{ file: string; result: T }> = []
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY)
    const batch = await Promise.allSettled(
      chunk.map(async (file) => {
        const css = extractStyles(await readFile(file, 'utf-8'), file)
        if (!css.trim()) return null
        return { file, result: fn(css, file) }
      }),
    )
    for (const item of batch) {
      if (item.status === 'fulfilled' && item.value) {
        results.push(item.value)
      } else if (item.status === 'rejected') {
        console.warn(
          `Warning: failed to process ${getReasonPath(item.reason)}:`,
          item.reason instanceof Error ? item.reason.message : String(item.reason),
        )
      }
    }
  }
  return results
}

async function runAudit(args: CliArgs): Promise<number> {
  let auditMode: AuditMode
  try {
    auditMode = resolveAuditMode(args.path!, args.auditMode)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }

  if (auditMode === 'tokens') {
    const result = await compileTokens(resolve(args.path!), {
      audit: { contrast: args.contrast, failOn: args.failOn },
    })
    const json = JSON.stringify({ mode: 'token-contrast', ...result.report }, null, 2)
    if (args.report) await writeTextFile(resolve(args.report), json)
    try {
      assertNoBlockingFailures(result, args.failOn)
      console.log(args.format === 'json' ? json : `✓ Token audit passed (${result.report.tokens.length} token(s))`)
      return 0
    } catch (e) {
      if (args.format === 'json') console.log(json)
      else console.error(e instanceof Error ? e.message : String(e))
      return 1
    }
  }

  const files = findCssFiles(validatePath(args.path!))
  const entries = await processFiles(files, (css) => auditCss(css))
  const fileStats: Array<{ file: string; stats: ScanResult }> = []
  let legacyCount = 0,
    hexCount = 0,
    rgbCount = 0,
    hslCount = 0
  let hwbCount = 0,
    namedCount = 0,
    gradientCount = 0
  for (const { file, result: stats } of entries) {
    fileStats.push({ file, stats })
    legacyCount += stats.legacy_count
    hexCount += stats.hex_count
    rgbCount += stats.rgb_count
    hslCount += stats.hsl_count
    hwbCount += stats.hwb_count
    namedCount += stats.named_count
    gradientCount += stats.gradient_count
  }

  if (args.format === 'json') {
    console.log(
      JSON.stringify(
        {
          mode: 'css-debt',
          totals: { legacyCount, hexCount, rgbCount, hslCount, hwbCount, namedCount, gradientCount },
          files: fileStats,
        },
        null,
        2,
      ),
    )
    return 0
  }

  console.log('\n  📊  okcolor CSS audit\n')
  console.log(`  Scanned ${files.length} file(s)`)
  console.log(`  ──────────────────────────────`)
  console.log(`  Total legacy colors : ${legacyCount}`)
  console.log(`  Hex                 : ${hexCount}`)
  console.log(`  RGB / RGBA          : ${rgbCount}`)
  console.log(`  HSL / HSLA          : ${hslCount}`)
  console.log(`  HWB                 : ${hwbCount}`)
  console.log(`  Named               : ${namedCount}`)
  console.log(`  Gradients upgraded  : ${gradientCount}`)

  if (fileStats.length > 0) {
    console.log(`\n  Top offenders:`)
    const sorted = fileStats
      .filter((f) => f.stats.legacy_count > 0)
      .sort((a, b) => b.stats.legacy_count - a.stats.legacy_count)
      .slice(0, 10)
    for (const { file, stats } of sorted) {
      console.log(`    ${file}  →  ${stats.legacy_count} legacy`)
    }
  }
  console.log()
  return 0
}

async function runCheck(args: CliArgs): Promise<number> {
  const files = findCssFiles(validatePath(args.path!))
  const entries = await processFiles(files, (css) => auditCss(css))
  let totalLegacy = 0
  const offenders: Array<{ file: string; count: number }> = []
  for (const { file, result: stats } of entries) {
    const count = args.allowNamed ? stats.legacy_count - stats.named_count : stats.legacy_count
    if (count > 0) {
      totalLegacy += count
      offenders.push({ file, count })
    }
  }

  const max = args.maxLegacyColors ?? Number.MAX_SAFE_INTEGER
  const passed = totalLegacy <= max

  if (args.format === 'json') {
    console.log(JSON.stringify({ passed, totalLegacy, max, offenders }, null, 2))
    return passed ? 0 : 1
  }

  if (passed) {
    console.log(`✓ Color check passed (${totalLegacy} legacy colors)`)
    return 0
  } else {
    console.log(`✗ Color check failed: ${totalLegacy} legacy colors found (max: ${max})`)
    for (const o of offenders) {
      console.log(`  ${o.file}: ${o.count}`)
    }
    return 1
  }
}

async function runDoctor(args: CliArgs): Promise<number> {
  const files = findCssFiles(validatePath(args.path!))
  const issues: Array<{ file: string; line: number; message: string; severity: 'warn' | 'error' }> = []

  const entries = await processFiles(files, (css) => css.split('\n'))
  for (const { file, result: lines } of entries) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1

      // Only check property values (after `:`) for bad hex to avoid id selector false positives
      const propValue = /[^;{}]*:([^;{}]*)/.exec(line)
      const hexTarget = propValue ? propValue[1] : line
      const badHex = hexTarget.match(
        /#[a-fA-F0-9]{1,2}(?![a-fA-F0-9])|[#][a-fA-F0-9]{5}(?![a-fA-F0-9])|[#][a-fA-F0-9]{7}(?![a-fA-F0-9])/g,
      )
      if (badHex) {
        issues.push({ file, line: lineNum, message: `Malformed hex color: ${badHex[0]}`, severity: 'error' })
      }

      if (
        /rgb\([^)]*\d+%?[^)]*\d+\)/.test(line) &&
        !/rgb\(\s*\d+(\s*,\s*\d+){2,3}\s*\)/.test(line) &&
        !/rgb\(\s*\d+(\s+\d+){2,3}\s*\)/.test(line) &&
        !/calc\(/i.test(line)
      ) {
        issues.push({ file, line: lineNum, message: 'Potentially malformed rgb() syntax', severity: 'warn' })
      }

      const lowContrast = /color:\s*#ffffff.*background(?:-color)?:\s*#f{1,3}/i.test(line)
      if (lowContrast) {
        issues.push({ file, line: lineNum, message: 'Potentially low-contrast color combination', severity: 'warn' })
      }
    }
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({ filesScanned: files.length, issues }, null, 2))
    return issues.some((i) => i.severity === 'error') ? 1 : 0
  }

  console.log('\n  🔬  okcolor doctor\n')
  console.log(`  Scanned ${files.length} file(s)`)

  if (issues.length === 0) {
    console.log('  ✓ No issues found')
  } else {
    const errors = issues.filter((i) => i.severity === 'error')
    const warns = issues.filter((i) => i.severity === 'warn')
    console.log(`  ${errors.length} error(s), ${warns.length} warning(s)\n`)
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '✗' : '⚠'
      console.log(`  ${icon} ${issue.file}:${issue.line}`)
      console.log(`     ${issue.message}`)
    }
  }
  console.log()
  return issues.some((i) => i.severity === 'error') ? 1 : 0
}

async function runConvert(args: CliArgs): Promise<number> {
  if (isJsonPath(args.path)) {
    const result = await compileTokens(resolve(args.path), {
      targets: {
        base: { gamut: 'srgb', strategy: 'convert', format: args.toSpace === 'oklch' ? 'oklch' : 'hex' },
      },
    })
    if (args.out) await writeTextFile(resolve(args.out), result.css)
    else console.log(result.css)
    return 0
  }

  const space = args.toSpace?.toLowerCase() ?? 'oklch'
  if (!(SPACES as readonly string[]).includes(space)) {
    console.error(`Unsupported space: ${space}. Use: ${SPACES.join(', ')}`)
    return 1
  }

  if (space === 'oklch') {
    const result = colorToOklch(args.color!)
    if (!result) {
      console.error(`Cannot convert: ${args.color}`)
      return 1
    }
    console.log(result)
  } else {
    const result = convertColor(args.color!, space)
    if (!result) {
      console.error(`Cannot convert: ${args.color}`)
      return 1
    }
    console.log(result)
  }

  return 0
}

async function runTokenCompilerCommand(args: CliArgs, strategy: Strategy): Promise<number> {
  if (isJsonPath(args.path)) {
    const result = await compileTokens(resolve(args.path), {
      targets: {
        base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
        p3: {
          gamut: validateGamut(args.gamut, strategy === 'fit' ? 'srgb' : 'p3'),
          strategy,
          amount: args.amount,
          format: 'oklch',
        },
      },
      audit: { contrast: args.contrast, failOn: args.failOn },
    })
    if (args.out) await writeTextFile(resolve(args.out), result.css)
    else console.log(result.css)
    if (args.report) await writeTextFile(resolve(args.report), JSON.stringify(result.report, null, 2))
    try {
      assertNoBlockingFailures(result, args.failOn)
      return 0
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
      return 1
    }
  }

  const color = args.color ?? args.path
  if (!color) {
    console.error(`Missing color or token file argument`)
    showHelp()
    return 1
  }

  try {
    const source = parseColor(color)
    const gamut = validateGamut(args.gamut, strategy === 'fit' ? 'srgb' : 'p3')
    const result =
      strategy === 'expand'
        ? expandChroma(source, { gamut, amount: args.amount })
        : strategy === 'fit'
          ? fitGamut(source, { gamut })
          : gradeColor(source, { gamut, amount: args.amount, recipe: validateRecipe(args.recipe) })
    console.log(args.format === 'json' ? JSON.stringify(result, null, 2) : result.css)
    return 0
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function runDescribe(args: CliArgs): Promise<number> {
  const color = args.color ?? args.path
  if (!color) {
    console.error('Missing color argument')
    showHelp()
    return 1
  }

  try {
    console.log(formatDescription(color, { gamut: validateGamut(args.gamut, 'p3'), amount: args.amount }))
    return 0
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  if (args.exitCode != null) {
    process.exitCode = args.exitCode
    return
  }

  let exitCode = 0

  switch (args.command) {
    case 'help':
      showHelp()
      return
    case 'audit':
      if (!args.path) {
        console.error('Missing path argument')
        showHelp()
        process.exitCode = 1
        return
      }
      exitCode = await runAudit(args)
      break
    case 'check':
      if (!args.path) {
        console.error('Missing path argument')
        showHelp()
        process.exitCode = 1
        return
      }
      exitCode = await runCheck(args)
      break
    case 'doctor':
      if (!args.path) {
        console.error('Missing path argument')
        showHelp()
        process.exitCode = 1
        return
      }
      exitCode = await runDoctor(args)
      break
    case 'convert':
      if (!args.color && !args.path) {
        console.error('Missing color or token file argument')
        showHelp()
        process.exitCode = 1
        return
      }
      exitCode = await runConvert(args)
      break
    case 'expand':
      exitCode = await runTokenCompilerCommand(args, 'expand')
      break
    case 'grade':
      exitCode = await runTokenCompilerCommand(args, 'grade')
      break
    case 'fit':
      exitCode = await runTokenCompilerCommand(args, 'fit')
      break
    case 'describe':
      exitCode = await runDescribe(args)
      break
    default:
      console.error(`Unknown command: ${args.command}`)
      showHelp()
      process.exitCode = 1
      return
  }

  process.exitCode = exitCode
}

function isCliEntryPoint(): boolean {
  if (!process.argv[1]) return false
  const modulePath = fileURLToPath(import.meta.url)
  try {
    return realpathSync.native(resolve(process.argv[1])) === realpathSync.native(modulePath)
  } catch {
    return resolve(process.argv[1]) === modulePath
  }
}

if (isCliEntryPoint()) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    process.exitCode = 1
  })
}
