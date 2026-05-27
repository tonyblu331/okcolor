import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      summary: { contrastPassed: boolean; failureCount: number }
      tokens: Array<{
        token: string
        contrast: { wcag2: Record<string, { status: string }>; apca: Record<string, { lc: number }> }
      }>
    }
    const background = report.tokens.find((token) => token.token === 'color.action.primary.bg')
    expect(report.summary).toMatchObject({ contrastPassed: true, failureCount: 0 })
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
import { colorToOklch, okColor } from 'okcolor'
import { compileTokens } from 'okcolor/core'
if (!colorToOklch('#ff0000')?.startsWith('oklch(')) throw new Error('colorToOklch failed')
if (typeof okColor !== 'function') throw new Error('okColor export missing')
if (typeof compileTokens !== 'function') throw new Error('compileTokens export missing')
console.log('ok')
`
    const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], { cwd: appDir })
    expect(result.stdout.trim()).toBe('ok')
  }, 30_000)
})
