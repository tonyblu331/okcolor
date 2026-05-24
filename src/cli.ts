#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, extname, join } from 'path'
import { transformCss, auditCss } from './engine/index.js'
import type { ScanResult } from './engine/index.js'

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.vue', '.svelte', '.astro'])

interface CliArgs {
  command: 'audit' | 'check' | 'doctor'
  path: string
  format: 'pretty' | 'json'
  maxLegacyColors?: number
  allowNamed?: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2)
  const command = (args[0] as 'audit' | 'check' | 'doctor') || 'audit'

  let path = '.'
  let format: 'pretty' | 'json' = 'pretty'
  let maxLegacyColors: number | undefined
  let allowNamed = false

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--format=json') format = 'json'
    else if (arg.startsWith('--max-legacy-colors=')) {
      maxLegacyColors = parseInt(arg.split('=')[1], 10)
    } else if (arg === '--allow-named') {
      allowNamed = true
    } else if (!arg.startsWith('-')) {
      path = arg
    }
  }

  return { command, path, format, maxLegacyColors, allowNamed }
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

function readCssFile(file: string): string {
  const content = readFileSync(file, 'utf-8')
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

async function runAudit(args: CliArgs): Promise<void> {
  const files = findCssFiles(resolve(args.path))
  const fileStats: Array<{ file: string; stats: ScanResult }> = []
  let totals: ScanResult = {
    css: '',
    legacyCount: 0,
    hexCount: 0,
    rgbCount: 0,
    hslCount: 0,
    hwbCount: 0,
    namedCount: 0,
    gradientCount: 0,
  }

  for (const file of files) {
    const css = readCssFile(file)
    if (!css.trim()) continue
    const stats = auditCss(css)
    fileStats.push({ file, stats })
    totals.legacyCount += stats.legacyCount
    totals.hexCount += stats.hexCount
    totals.rgbCount += stats.rgbCount
    totals.hslCount += stats.hslCount
    totals.hwbCount += stats.hwbCount
    totals.namedCount += stats.namedCount
    totals.gradientCount += stats.gradientCount
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({ totals, files: fileStats }, null, 2))
    return
  }

  console.log('\n  📊  ok-actually audit\n')
  console.log(`  Scanned ${files.length} file(s)`)
  console.log(`  ──────────────────────────────`)
  console.log(`  Total legacy colors : ${totals.legacyCount}`)
  console.log(`  Hex                 : ${totals.hexCount}`)
  console.log(`  RGB / RGBA          : ${totals.rgbCount}`)
  console.log(`  HSL / HSLA          : ${totals.hslCount}`)
  console.log(`  HWB                 : ${totals.hwbCount}`)
  console.log(`  Named               : ${totals.namedCount}`)
  console.log(`  Gradients upgraded  : ${totals.gradientCount}`)

  if (fileStats.length > 0) {
    console.log(`\n  Top offenders:`)
    const sorted = fileStats
      .filter((f) => f.stats.legacyCount > 0)
      .sort((a, b) => b.stats.legacyCount - a.stats.legacyCount)
      .slice(0, 10)
    for (const { file, stats } of sorted) {
      console.log(`    ${file}  →  ${stats.legacyCount} legacy`)
    }
  }
  console.log()
}

async function runCheck(args: CliArgs): Promise<void> {
  const files = findCssFiles(resolve(args.path))
  let totalLegacy = 0
  const offenders: Array<{ file: string; count: number }> = []

  for (const file of files) {
    const css = readCssFile(file)
    if (!css.trim()) continue
    const stats = auditCss(css)
    const count = args.allowNamed
      ? stats.legacyCount - stats.namedCount
      : stats.legacyCount
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
  const files = findCssFiles(resolve(args.path))
  const issues: Array<{ file: string; line: number; message: string; severity: 'warn' | 'error' }> = []

  for (const file of files) {
    const css = readCssFile(file)
    const lines = css.split('\n')
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

  console.log('\n  🔬  ok-actually doctor\n')
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  switch (args.command) {
    case 'audit':
      await runAudit(args)
      break
    case 'check':
      await runCheck(args)
      break
    case 'doctor':
      await runDoctor(args)
      break
    default:
      console.log(`Unknown command: ${args.command}`)
      console.log('Usage: ok-actually <audit|check|doctor> [path] [options]')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
