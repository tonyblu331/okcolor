import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const cliPath = resolve('dist/cli.js')
const npmCli = process.env.npm_execpath ?? resolve('node_modules/npm/bin/npm-cli.js')

async function runNpm(args: string[], cwd = process.cwd()) {
  return execFileAsync(process.execPath, [npmCli, ...args], { cwd })
}


function jsonSchemaShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [jsonSchemaShape(value[0])]
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, jsonSchemaShape(nested)]),
    )
  }
  return typeof value
}

async function runOkcolor(
  args: string[],
  cwd = process.cwd(),
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 }
  }
}

describe('okcolor CLI E2E', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'okcolor-e2e-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps package entrypoints tree-shakeable and browser runtime isolated', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf-8')) as {
      sideEffects?: unknown
      exports?: Record<string, unknown>
    }
    const rootEntry = await readFile(resolve('dist/index.js'), 'utf-8')
    const coreEntry = await readFile(resolve('dist/core.js'), 'utf-8')
    const browserEntry = await readFile(resolve('dist/browser.js'), 'utf-8')

    expect(packageJson.sideEffects).toBe(false)
    expect(packageJson.exports).toHaveProperty('./browser')
    expect(rootEntry).not.toContain('./browser')
    expect(coreEntry).not.toContain('./browser')
    expect(browserEntry).not.toContain('node:')
    expect(browserEntry).toContain('./okcolor_core.js')
  })

  it('compiles token JSON into layered CSS and a token audit report through the packaged CLI', async () => {
    const tokens = join(dir, 'tokens.json')
    const cssOut = join(dir, 'colors.css')
    const reportOut = join(dir, 'okcolor.report.json')
    await writeFile(
      tokens,
      JSON.stringify({
        'color.action.primary.bg': {
          $type: 'color',
          $value: '#0055ff',
          okcolor: { text: 'color.action.primary.fg', contrast: 'wcag2-aa' },
        },
        'color.action.primary.fg': '#ffffff',
        'bad.components': {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [1, 'none', 0] },
        },
      }),
    )

    const result = await runOkcolor([
      'expand',
      tokens,
      '--gamut',
      'p3',
      '--amount',
      '0.75',
      '--out',
      cssOut,
      '--report',
      reportOut,
    ])

    expect(result).toMatchObject({ code: 0 })
    await expect(readFile(cssOut, 'utf-8')).resolves.toContain('@media (color-gamut: p3)')
    const report = JSON.parse(await readFile(reportOut, 'utf-8')) as {
      schemaVersion: number
      summary: { contrastPassed: boolean; failureCount: number }
      diagnostics: Array<{ token: string; kind: string; severity: string }>
      tokens: Array<{
        token: string
        contrast: { wcag2: Record<string, { status: string }>; apca: Record<string, { lc: number }> }
      }>
    }
    const background = report.tokens.find((token) => token.token === 'color.action.primary.bg')
    expect(report.schemaVersion).toBe(1)
    expect(report.summary).toMatchObject({ contrastPassed: true, failureCount: 0 })
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ token: 'bad.components', kind: 'invalid-color-components', severity: 'warning' }),
    ])
    expect(background?.contrast.wcag2['color.action.primary.fg@srgb']).toMatchObject({ status: 'pass' })
    expect(background?.contrast.apca['color.action.primary.fg@srgb']).toMatchObject({ lc: expect.any(Number) })
  })

  it('fails token audit through the packaged CLI when WCAG failOn catches a declared pair', async () => {
    const tokens = join(dir, 'tokens.json')
    await writeFile(
      tokens,
      JSON.stringify({
        surface: {
          $type: 'color',
          $value: '#ffffff',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#eeeeee',
      }),
    )

    const result = await runOkcolor(['audit', tokens, '--fail-on', 'wcag2-regression'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('okcolor audit failed')
  })

  it('applies CLI WCAG 2 contrast policy overrides to token audits', async () => {
    const tokens = join(dir, 'tokens.json')
    await writeFile(
      tokens,
      JSON.stringify({
        surface: {
          $type: 'color',
          $value: '#0055ff',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#ffffff',
      }),
    )

    const result = await runOkcolor(['audit', tokens, '--format=json', '--wcag2=aaa'])
    const report = JSON.parse(result.stdout) as {
      tokens: Array<{ contrast: { wcag2: Record<string, { required: number; requirement: string; status: string }> } }>
    }

    expect(result.code).toBe(1)
    expect(report.tokens[0]?.contrast.wcag2['foreground@srgb']).toMatchObject({
      required: 7,
      requirement: 'wcag2-aaa',
      status: 'fail',
    })
  })

  it('labels token audit JSON output with token contrast mode', async () => {
    const tokens = join(dir, 'tokens.json')
    await writeFile(
      tokens,
      JSON.stringify({
        surface: {
          $type: 'color',
          $value: '#111111',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#ffffff',
      }),
    )

    const result = await runOkcolor(['audit', tokens, '--mode', 'tokens', '--format', 'json'])
    const report = JSON.parse(result.stdout) as { mode: string; summary: { contrastPassed: boolean } }

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(report).toMatchObject({ mode: 'token-contrast', summary: { contrastPassed: true } })
  })

  it('labels CSS audit JSON output with CSS debt mode', async () => {
    await writeFile(join(dir, 'style.css'), '.button { color: #ff0000; background: red; }')

    const result = await runOkcolor(['audit', dir, '--mode', 'css', '--format', 'json'])
    const report = JSON.parse(result.stdout) as { mode: string; totals: { legacyCount: number } }

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(report).toMatchObject({ mode: 'css-debt', totals: { legacyCount: 2 } })
  })

  it('snapshots CLI JSON schema shapes for audit and token compile outputs', async () => {
    const tokens = join(dir, 'tokens.json')
    const reportOut = join(dir, 'okcolor.report.json')
    await writeFile(
      tokens,
      JSON.stringify({
        surface: {
          $type: 'color',
          $value: '#111111',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#ffffff',
      }),
    )
    await writeFile(join(dir, 'style.css'), '.button { color: #ff0000; background: red; }')

    const cssAudit = await runOkcolor(['audit', dir, '--mode', 'css', '--format', 'json'])
    const tokenAudit = await runOkcolor(['audit', tokens, '--mode', 'tokens', '--format', 'json'])
    const tokenCompile = await runOkcolor(['expand', tokens, '--gamut', 'p3', '--report', reportOut])

    expect(cssAudit.code).toBe(0)
    expect(tokenAudit.code).toBe(0)
    expect(tokenCompile.code).toBe(0)
    expect(jsonSchemaShape(JSON.parse(cssAudit.stdout))).toMatchInlineSnapshot(`
      {
        "files": [
          {
            "file": "string",
            "stats": {
              "css": "string",
              "gradient_count": "number",
              "hex_count": "number",
              "hsl_count": "number",
              "hwb_count": "number",
              "legacy_count": "number",
              "named_count": "number",
              "rgb_count": "number",
              "unique_count": "number",
            },
          },
        ],
        "mode": "string",
        "totals": {
          "gradientCount": "number",
          "hexCount": "number",
          "hslCount": "number",
          "hwbCount": "number",
          "legacyCount": "number",
          "namedCount": "number",
          "rgbCount": "number",
        },
      }
    `)
    expect(jsonSchemaShape(JSON.parse(tokenAudit.stdout))).toMatchInlineSnapshot(`
      {
        "contrastPairs": [
          {
            "apcaKey": "string",
            "background": "string",
            "foreground": "string",
            "status": "string",
            "target": "string",
            "wcag2Key": "string",
          },
        ],
        "diagnostics": [],
        "mode": "string",
        "schemaVersion": "number",
        "summary": {
          "contrastPassed": "boolean",
          "failureCount": "number",
          "failures": [],
        },
        "tokens": [
          {
            "contrast": {
              "apca": {
                "foreground@p3": {
                  "advisory": "string",
                  "background": "string",
                  "foreground": "string",
                  "lc": "number",
                  "polarity": "string",
                  "target": "string",
                },
                "foreground@srgb": {
                  "advisory": "string",
                  "background": "string",
                  "foreground": "string",
                  "lc": "number",
                  "polarity": "string",
                  "target": "string",
                },
              },
              "wcag2": {
                "foreground@p3": {
                  "background": "string",
                  "foreground": "string",
                  "ratio": "number",
                  "required": "number",
                  "requirement": "string",
                  "status": "string",
                  "target": "string",
                },
                "foreground@srgb": {
                  "background": "string",
                  "foreground": "string",
                  "ratio": "number",
                  "required": "number",
                  "requirement": "string",
                  "status": "string",
                  "target": "string",
                },
              },
            },
            "oklch": {
              "c": "number",
              "h": "number",
              "l": "number",
            },
            "source": "string",
            "sourceGamut": "string",
            "targets": {
              "p3": {
                "amount": "number",
                "cMax": "number",
                "css": "string",
                "delta": {
                  "chroma": "number",
                  "hue": "number",
                  "lightness": "number",
                },
                "displaySafe": "boolean",
                "gamut": "string",
                "inGamut": "boolean",
                "neutralSkipped": "boolean",
                "skippedReason": "string",
                "strategy": "string",
                "syntaxValid": "boolean",
              },
              "srgb": {
                "amount": "number",
                "cMax": "number",
                "css": "string",
                "delta": {
                  "chroma": "number",
                  "hue": "number",
                  "lightness": "number",
                },
                "displaySafe": "boolean",
                "gamut": "string",
                "inGamut": "boolean",
                "strategy": "string",
                "syntaxValid": "boolean",
              },
            },
            "token": "string",
          },
        ],
      }
    `)
    expect(jsonSchemaShape(JSON.parse(await readFile(reportOut, 'utf-8')))).toMatchObject({
      diagnostics: [],
      schemaVersion: 'number',
      summary: { contrastPassed: 'boolean', failureCount: 'number', failures: [] },
      tokens: expect.any(Array),
    })
  })

  it('snapshots single-color transform JSON schema shapes', async () => {
    const expand = await runOkcolor(['expand', '#ff5a00', '--format', 'json'])
    const grade = await runOkcolor(['grade', '#ff5a00', '--recipe', 'premium', '--format', 'json'])
    const fit = await runOkcolor(['fit', 'oklch(70% 0.35 145)', '--format', 'json'])

    expect(expand.code).toBe(0)
    expect(grade.code).toBe(0)
    expect(fit.code).toBe(0)
    expect(jsonSchemaShape(JSON.parse(expand.stdout))).toMatchInlineSnapshot(`
      {
        "alpha": "number",
        "amount": "number",
        "cMax": "number",
        "css": "string",
        "delta": {
          "chroma": "number",
          "hue": "number",
          "lightness": "number",
        },
        "displaySafe": "boolean",
        "gamut": "string",
        "inGamut": "boolean",
        "neutralSkipped": "boolean",
        "oklch": {
          "c": "number",
          "h": "number",
          "l": "number",
        },
        "source": {
          "alpha": "number",
          "hex": "string",
          "input": "string",
          "oklch": {
            "c": "number",
            "h": "number",
            "l": "number",
          },
          "sourceGamut": "string",
        },
        "strategy": "string",
        "syntaxValid": "boolean",
      }
    `)
    expect(jsonSchemaShape(JSON.parse(grade.stdout))).toMatchObject({
      recipe: 'string',
      strategy: 'string',
      source: expect.any(Object),
    })
    expect(jsonSchemaShape(JSON.parse(fit.stdout))).toMatchObject({
      strategy: 'string',
      source: expect.any(Object),
      oklch: expect.any(Object),
    })
  })

  it('prints single-color grade metadata as JSON when requested', async () => {
    const result = await runOkcolor(['grade', '#ff5a00', '--recipe', 'premium', '--format', 'json'])
    const report = JSON.parse(result.stdout) as {
      css: string
      gamut: string
      strategy: string
      recipe: string
      delta: { lightness: number; chroma: number; hue: number }
    }

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(report).toMatchObject({
      css: expect.stringContaining('oklch('),
      gamut: 'p3',
      strategy: 'grade',
      recipe: 'premium',
    })
    expect(report.delta.lightness).toBeLessThan(0)
    expect(report.delta.chroma).toBeGreaterThan(0)
  })

  it('routes token expand with explicit sRGB gamut through the base target', async () => {
    const tokens = join(dir, 'tokens.json')
    const reportOut = join(dir, 'okcolor.report.json')
    await writeFile(tokens, JSON.stringify({ brand: 'oklch(70% 0.35 145)' }))

    const result = await runOkcolor(['expand', tokens, '--gamut', 'srgb', '--report', reportOut])
    const report = JSON.parse(await readFile(reportOut, 'utf-8')) as {
      tokens: Array<{ targets: Record<string, { gamut: string; strategy: string }> }>
    }

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('--brand: oklch(')
    expect(result.stdout).not.toContain('@media (color-gamut: p3)')
    expect(report.tokens[0].targets).not.toHaveProperty('p3')
    expect(report.tokens[0].targets.srgb).toMatchObject({ gamut: 'srgb', strategy: 'expand' })
  })

  it('keeps stdout data-only and routes CLI diagnostics to stderr', async () => {
    const missingArgument = await runOkcolor(['audit'])
    const invalidRecipe = await runOkcolor(['grade', '#ff5a00', '--recipe', 'unknown', '--format', 'json'])

    expect(missingArgument.code).toBe(1)
    expect(missingArgument.stdout).toBe('')
    expect(missingArgument.stderr).toContain('Missing path argument')
    expect(missingArgument.stderr).toContain('Usage:')

    expect(invalidRecipe.code).toBe(1)
    expect(invalidRecipe.stdout).toBe('')
    expect(invalidRecipe.stderr).toContain('Unsupported recipe: unknown')
  })
})

describe('okcolor Vite plugin E2E', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'okcolor-vite-e2e-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('runs token compiler mode during a real Vite production build', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
    await writeFile(join(dir, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.js"></script>')
    await writeFile(join(dir, 'tokens.json'), JSON.stringify({ 'brand.orange': '#ff5a00' }))
    await writeFile(
      join(dir, 'vite.config.mjs'),
      `
import { okColor } from ${JSON.stringify(pathToFileURL(resolve('dist/index.js')).href)}

export default {
  plugins: [
    okColor({
      input: 'tokens.json',
      output: 'src/generated/colors.css',
      reportPath: 'src/generated/okcolor.report.json',
      targets: {
        base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
        p3: { gamut: 'p3', strategy: 'expand', amount: 0.75, format: 'oklch' },
      },
    }),
  ],
}
`,
    )
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(
      join(dir, 'src/main.js'),
      `import './style.css'\ndocument.querySelector('#app').textContent = 'okcolor'`,
    )
    await writeFile(join(dir, 'src/style.css'), `.box { color: #ff0000; }`)

    const viteBin = resolve('node_modules/vite/bin/vite.js')
    const result = await execFileAsync(process.execPath, [viteBin, 'build'], { cwd: dir })

    expect(result.stderr).not.toContain('[okcolor]')
    await expect(readFile(join(dir, 'src/generated/colors.css'), 'utf-8')).resolves.toContain(
      '@media (color-gamut: p3)',
    )
    await expect(readFile(join(dir, 'src/generated/colors.css'), 'utf-8')).resolves.toContain(
      '--brand-orange: #ff5a00;',
    )
    const report = JSON.parse(await readFile(join(dir, 'src/generated/okcolor.report.json'), 'utf-8')) as {
      tokens: Array<{ token: string }>
    }
    expect(report.tokens).toEqual([expect.objectContaining({ token: 'brand.orange' })])
  })
})

describe('okcolor package tarball E2E', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'okcolor-pack-e2e-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('installs the packed tarball and imports the public API from a consumer project', async () => {
    const packDir = join(dir, 'pack')
    const appDir = join(dir, 'app')
    await mkdir(packDir, { recursive: true })
    await mkdir(appDir, { recursive: true })
    await runNpm(['pack', '--pack-destination', packDir])
    const tarball = join(packDir, 'okcolor-1.0.0.tgz')

    await writeFile(join(appDir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
    await runNpm(['install', '--ignore-scripts', tarball], appDir)

    const probe = `
import { COMPILE_REPORT_SCHEMA_VERSION, colorToOklch, okColor, wasmColorMath } from 'okcolor'
import { compileTokens, COMPILE_REPORT_SCHEMA_VERSION as CORE_COMPILE_REPORT_SCHEMA_VERSION, wasmColorMath as coreWasmColorMath } from 'okcolor/core'
if (!colorToOklch('#ff0000')?.startsWith('oklch(')) throw new Error('colorToOklch failed')
if (typeof okColor !== 'function') throw new Error('okColor export missing')
if (typeof compileTokens !== 'function') throw new Error('compileTokens export missing')
if (COMPILE_REPORT_SCHEMA_VERSION !== 1) throw new Error('schema version export missing')
if (CORE_COMPILE_REPORT_SCHEMA_VERSION !== 1) throw new Error('core schema version export missing')
if (typeof wasmColorMath?.inGamut !== 'function') throw new Error('wasmColorMath export missing')
if (typeof coreWasmColorMath?.expandChroma !== 'function') throw new Error('core wasmColorMath export missing')
console.log('ok')
`
    const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], { cwd: appDir })
    expect(result.stdout.trim()).toBe('ok')
  }, 60_000)

  it('bundles the browser export and WASM asset in a Vite consumer project', async () => {
    const packDir = join(dir, 'pack')
    const appDir = join(dir, 'app')
    await mkdir(packDir, { recursive: true })
    await mkdir(join(appDir, 'src'), { recursive: true })
    await runNpm(['pack', '--pack-destination', packDir])
    const tarball = join(packDir, 'okcolor-1.0.0.tgz')

    await writeFile(join(appDir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
    await runNpm(['install', '--ignore-scripts', tarball], appDir)
    await writeFile(join(appDir, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.js"></script>')
    await writeFile(
      join(appDir, 'src/main.js'),
      `
import {
  OKCOLOR_WASM_URL,
  colorToOklch,
  initOkColorBrowser,
  transformCss,
} from 'okcolor/browser'

await initOkColorBrowser()
document.querySelector('#app').textContent = [
  OKCOLOR_WASM_URL,
  colorToOklch('#ff0000'),
  transformCss('.box { color: #ff0000; }'),
].join('\\n')
`,
    )

    const viteBin = resolve('node_modules/vite/bin/vite.js')
    await execFileAsync(process.execPath, [viteBin, 'build'], { cwd: appDir })
    const builtAssets = await readdir(join(appDir, 'dist/assets'))

    expect(builtAssets.some((file) => file.endsWith('.wasm'))).toBe(true)
    expect(builtAssets.some((file) => file.endsWith('.js'))).toBe(true)
  }, 60_000)
})
