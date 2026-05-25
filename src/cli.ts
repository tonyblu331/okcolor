#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { resolve, extname, join } from 'node:path'
import { auditCss, convertColor, colorToOklch } from './wasm.js'
import type { ScanResult } from './types.js'

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.vue', '.svelte', '.astro'])
const CONCURRENCY = 32

const SPACES = ['hex', 'rgb', 'hsl', 'hwb', 'oklch'] as const

function showHelp(): void {
  console.log(`
  okcolor — build-time color modernizer

  Usage:
    okcolor audit <path> [--format json]
      Scan files for legacy colors and show statistics.

    okcolor check <path> [--max-legacy-colors N] [--allow-named]
      CI gate — exit 1 if legacy colors exceed threshold.

    okcolor doctor <path> [--format json]
      Find color issues (malformed hex, low contrast, etc.).

    okcolor convert <color> [--to <space>]
      Convert a single color between spaces.
      Supported spaces: hex, rgb, hsl, hwb, oklch

  Examples:
    npx okcolor audit ./src
    npx okcolor check . --max-legacy-colors 10
    npx okcolor doctor ./src --format json
    npx okcolor convert "#ff0000" --to hsl
`)
}

interface CliArgs {
  command: 'help' | 'audit' | 'check' | 'doctor' | 'convert'
  path?: string
  format: 'pretty' | 'json'
  maxLegacyColors?: number
  allowNamed?: boolean
  color?: string
  toSpace?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2)
  if (!args[0] || args[0] === '--help' || args[0] === '-h') {
    return { command: 'help', format: 'pretty' }
  }

  const command = args[0] === 'help' ? 'help' :
    args[0] as 'audit' | 'check' | 'doctor' | 'convert'

  let path: string | undefined
  let format: 'pretty' | 'json' = 'pretty'
  let maxLegacyColors: number | undefined
  let allowNamed = false
  let color: string | undefined
  let toSpace: string | undefined

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--format=json') format = 'json'
    else if (arg.startsWith('--max-legacy-colors=')) {
      maxLegacyColors = parseInt(arg.split('=')[1], 10)
    } else if (arg === '--allow-named') {
      allowNamed = true
    } else if (arg.startsWith('--to=')) {
      toSpace = arg.split('=')[1]
    } else if (!arg.startsWith('-')) {
      if (command === 'convert' && !color) color = arg
      else path = arg
    }
  }

  return { command, path, format, maxLegacyColors, allowNamed, color, toSpace }
}

function findCssFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      results.push(...findCssFiles(full))
    } else if (CSS_EXTS.has(extname(full))) {
      results.push(full)
    }
  }
  return results
}

function extractStyles(content: string, file: string): string {
  if (extname(file) === '.vue' || extname(file) === '.svelte' || extname(file) === '.astro') {
    const styles: string[] = []
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      styles.push(m[1])
    }
    return styles.join('\n')
  }
  return content
}

async function processFiles<T>(
  files: string[],
  fn: (css: string, file: string) => T,
): Promise<Array<{ file: string; result: T }>> {
  const results: Array<{ file: string; result: T }> = []
  const chunks: string[][] = []
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    chunks.push(files.slice(i, i + CONCURRENCY))
  }
  for (const chunk of chunks) {
    const batch = await Promise.all(chunk.map(async (file) => {
      const css = extractStyles(await readFile(file, 'utf-8'), file)
      if (!css.trim()) return null
      return { file, result: fn(css, file) }
    }))
    for (const item of batch) {
      if (item) results.push(item)
    }
  }
  return results
}

async function runAudit(args: CliArgs): Promise<void> {
  const files = findCssFiles(resolve(args.path!))
  const entries = await processFiles(files, (css) => auditCss(css))
  const fileStats: Array<{ file: string; stats: ScanResult }> = []
  let legacyCount = 0, hexCount = 0, rgbCount = 0, hslCount = 0
  let hwbCount = 0, namedCount = 0, gradientCount = 0
  for (const { file, result: stats } of entries) {
    fileStats.push({ file, stats })
    legacyCount   += stats.legacy_count
    hexCount      += stats.hex_count
    rgbCount      += stats.rgb_count
    hslCount      += stats.hsl_count
    hwbCount      += stats.hwb_count
    namedCount    += stats.named_count
    gradientCount += stats.gradient_count
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({
      totals: { legacyCount, hexCount, rgbCount, hslCount, hwbCount, namedCount, gradientCount },
      files: fileStats,
    }, null, 2))
    return
  }

  console.log('\n  📊  okcolor audit\n')
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
}

async function runCheck(args: CliArgs): Promise<void> {
  const files = findCssFiles(resolve(args.path!))
  const entries = await processFiles(files, (css) => auditCss(css))
  let totalLegacy = 0
  const offenders: Array<{ file: string; count: number }> = []
  for (const { file, result: stats } of entries) {
    const count = args.allowNamed
      ? stats.legacy_count - stats.named_count
      : stats.legacy_count
    if (count > 0) {
      totalLegacy += count
      offenders.push({ file, count })
    }
  }

  const max = args.maxLegacyColors ?? Number.MAX_SAFE_INTEGER
  const passed = totalLegacy <= max

  if (args.format === 'json') {
    console.log(JSON.stringify({ passed, totalLegacy, max, offenders }, null, 2))
    process.exit(passed ? 0 : 1)
  }

  if (passed) {
    console.log(`✓ Color check passed (${totalLegacy} legacy colors)`)
    process.exit(0)
  } else {
    console.log(`✗ Color check failed: ${totalLegacy} legacy colors found (max: ${max})`)
    for (const o of offenders) {
      console.log(`  ${o.file}: ${o.count}`)
    }
    process.exit(1)
  }
}

async function runDoctor(args: CliArgs): Promise<void> {
  const files = findCssFiles(resolve(args.path!))
  const issues: Array<{ file: string; line: number; message: string; severity: 'warn' | 'error' }> = []

  const entries = await processFiles(files, (css) => css.split('\n'))
  for (const { file, result: lines } of entries) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1

      const badHex = line.match(/#[a-fA-F0-9]{1,2}(?![a-fA-F0-9])|[#][a-fA-F0-9]{5}(?![a-fA-F0-9])|[#][a-fA-F0-9]{7}(?![a-fA-F0-9])/g)
      if (badHex) {
        issues.push({ file, line: lineNum, message: `Malformed hex color: ${badHex[0]}`, severity: 'error' })
      }

      if (/rgb\([^)]*\d+%?[^)]*\d+\)/.test(line) && !/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/.test(line)) {
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
    process.exit(issues.some((i) => i.severity === 'error') ? 1 : 0)
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
  process.exit(issues.some((i) => i.severity === 'error') ? 1 : 0)
}

async function runConvert(args: CliArgs): Promise<void> {
  const space = args.toSpace?.toLowerCase() ?? 'oklch'
  if (!SPACES.includes(space as never)) {
    console.error(`Unsupported space: ${space}. Use: ${SPACES.join(', ')}`)
    process.exit(1)
  }

  if (space === 'oklch') {
    const result = colorToOklch(args.color!)
    if (!result) {
      console.error(`Cannot convert: ${args.color}`)
      process.exit(1)
    }
    console.log(result)
  } else {
    const result = convertColor(args.color!, space)
    if (!result) {
      console.error(`Cannot convert: ${args.color}`)
      process.exit(1)
    }
    console.log(result)
  }

  process.exit(0)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  switch (args.command) {
    case 'help':
      showHelp()
      process.exit(0)
    case 'audit':
      if (!args.path) { console.error('Missing path argument'); showHelp(); process.exit(1) }
      await runAudit(args)
      break
    case 'check':
      if (!args.path) { console.error('Missing path argument'); showHelp(); process.exit(1) }
      await runCheck(args)
      break
    case 'doctor':
      if (!args.path) { console.error('Missing path argument'); showHelp(); process.exit(1) }
      await runDoctor(args)
      break
    case 'convert':
      if (!args.color) { console.error('Missing color argument'); showHelp(); process.exit(1) }
      await runConvert(args)
      break
    default:
      console.error(`Unknown command: ${args.command}`)
      showHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
