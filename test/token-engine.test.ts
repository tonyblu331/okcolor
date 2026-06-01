import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { APCAcontrast } from 'apca-w3'
import type { ColorMathPort } from '../src/token-engine.js'
import { describe, expect, it } from 'vitest'
import {
  assertNoBlockingFailures,
  compileTokenObject,
  collectBlockingFailures,
  compileTokens,
  describeColor,
  expandChroma,
  findChromaMax,
  fitGamut,
  gradeColor,
  parseColor,
  tokenNameToCssVar,
} from '../src/token-engine.js'
import { apcaContrast } from '../src/token/contrast.js'
import { renderLayeredCss } from '../src/token/css-emitter.js'
import { parseTokenInputs } from '../src/token/parser.js'
import { resolveTokenRecipePolicy } from '../src/token/recipe-policy.js'
import { buildCompileReport, createCompiledTokenReport, toFallbackTargetReport } from '../src/token/report-builder.js'

describe('token color engine', () => {
  it('parses source colors through the existing faithful OKLCH conversion path', () => {
    const color = parseColor('#ff0000')
    expect(color.oklch).toEqual({ l: 0.628, c: 0.25768, h: 29.23 })
    expect(color.hex).toBe('#ff0000')
  })

  it('routes transform math through an injectable ColorMathPort seam', () => {
    const calls: string[] = []
    const math: ColorMathPort = {
      chromaMax(_l, _h, gamut) {
        calls.push(`chromaMax:${gamut}`)
        return 0.2
      },
      inGamut(_oklch, gamut) {
        calls.push(`inGamut:${gamut}`)
        return true
      },
      expandChroma(oklch, gamut, amount) {
        calls.push(`expand:${gamut}:${amount}`)
        return { oklch: { ...oklch, c: 0.2 }, cMax: 0.2, neutralSkipped: false }
      },
      fitGamut(oklch, gamut) {
        calls.push(`fit:${gamut}`)
        return { oklch: { ...oklch, c: 0.1 }, cMax: 0.1, neutralSkipped: false }
      },
    }

    const source = parseColor('#ff5a00')
    const expanded = expandChroma(source, { gamut: 'p3', amount: 0.5, math })
    const fitted = fitGamut(source, { gamut: 'srgb', math })

    expect(expanded.oklch.c).toBe(0.2)
    expect(fitted.oklch.c).toBe(0.1)
    expect(findChromaMax(source.oklch.l, source.oklch.h, 'p3', math)).toBe(0.2)
    expect(calls).toEqual(['expand:p3:0.5', 'inGamut:p3', 'fit:srgb', 'inGamut:srgb', 'chromaMax:p3'])
  })

  it('finds a Display P3 chroma ceiling that is displayable', () => {
    const source = parseColor('#ff5a00')
    const cMax = findChromaMax(source.oklch.l, source.oklch.h, 'p3')
    expect(cMax).toBeGreaterThanOrEqual(source.oklch.c)
  })

  it('expands chroma while preserving lightness and hue', () => {
    const source = parseColor('#ff5a00')
    const expanded = expandChroma(source, { gamut: 'p3', amount: 0.8 })
    expect(expanded.oklch.l).toBeCloseTo(source.oklch.l, 4)
    expect(expanded.oklch.h).toBeCloseTo(source.oklch.h, 2)
    expect(expanded.oklch.c).toBeGreaterThanOrEqual(source.oklch.c)
    expect(expanded.inGamut).toBe(true)
  })

  it('does not invent hue or vivid chroma for neutrals', () => {
    const source = parseColor('#808080')
    const expanded = expandChroma(source, { gamut: 'p3', amount: 1 })
    expect(expanded.oklch.c).toBe(source.oklch.c)
    expect(expanded.neutralSkipped).toBe(true)
  })

  it('fits an out-of-sRGB OKLCH color by reducing chroma', () => {
    const fitted = fitGamut('oklch(70% 0.35 145)', { gamut: 'srgb' })
    expect(fitted.oklch.c).toBeLessThan(0.35)
    expect(fitted.inGamut).toBe(true)
  })

  it('applies recipe deltas in expected directions', () => {
    const source = parseColor('#0055ff')
    const deeper = gradeColor(source, { recipe: 'deeper', gamut: 'p3' })
    const muted = gradeColor(source, { recipe: 'muted', gamut: 'p3' })
    expect(deeper.oklch.l).toBeLessThan(source.oklch.l)
    expect(muted.oklch.c).toBeLessThan(source.oklch.c)
  })

  it('converts token names into stable CSS custom properties', () => {
    expect(tokenNameToCssVar('color.action.primary.bg')).toBe('--color-action-primary-bg')
  })

  it('renders layered CSS from explicit emission buckets', () => {
    expect(
      renderLayeredCss({
        base: ['  --brand-orange: #ff5a00;'],
        literal: ['  --brand-orange-oklch: oklch(0.731 0.184 48.12);'],
        p3: ['  --brand-orange: oklch(0.731 0.213 48.12);'],
      }),
    ).toBe(
      [
        ':root {',
        '  --brand-orange: #ff5a00;',
        '}',
        '',
        '@supports (color: oklch(0.5 0.1 40)) {',
        '  :root {',
        '  --brand-orange-oklch: oklch(0.731 0.184 48.12);',
        '  }',
        '}',
        '',
        '@media (color-gamut: p3) {',
        '  @supports (color: oklch(0.5 0.1 40)) {',
        '    :root {',
        '    --brand-orange: oklch(0.731 0.213 48.12);',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('compiles simple and structured tokens into layered CSS and report data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'okcolor-token-'))
    const input = join(dir, 'colors.json')
    await writeFile(
      input,
      JSON.stringify({
        'brand.orange': '#ff5a00',
        'brand.gray.900': {
          $type: 'color',
          $value: '#111111',
          okcolor: { recipe: 'literal' },
        },
      }),
    )

    try {
      const result = await compileTokens(input, {
        targets: {
          base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
          p3: { gamut: 'p3', strategy: 'expand', amount: 0.75, format: 'oklch' },
        },
      })

      expect(result.css).toContain('--brand-orange: #ff5a00;')
      expect(result.css).toContain('@media (color-gamut: p3)')
      expect(result.css).toContain('--brand-orange: oklch(')
      expect(result.report.schemaVersion).toBe(1)
      expect(result.report.tokens).toHaveLength(2)
      const orange = result.report.tokens.find((token) => token.token === 'brand.orange')
      expect(orange?.targets.srgb).toMatchObject({
        gamut: 'srgb',
        strategy: 'convert',
        delta: { lightness: 0, chroma: 0, hue: 0 },
        css: '#ff5a00',
      })
      expect(orange?.targets.p3).toMatchObject({
        gamut: 'p3',
        strategy: 'expand',
      })
      expect(orange?.targets.p3.delta.lightness).toBe(0)
      expect(orange?.targets.p3.delta.hue).toBe(0)
      expect(orange?.targets.p3.delta.chroma).toBeGreaterThanOrEqual(0)
      expect(result.designTokens['brand.orange'].$value).toMatchObject({ colorSpace: 'srgb' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves built-in and aliased token recipe policy before transform orchestration', () => {
    expect(
      resolveTokenRecipePolicy({
        tokenName: 'brand.gray.900',
        tokenRecipe: 'literal',
        targetConfig: { gamut: 'p3', strategy: 'expand', amount: 0.75 },
      }),
    ).toMatchObject({
      config: { gamut: 'p3', strategy: 'convert', recipe: 'literal', amount: 0.75 },
      recipe: 'literal',
      gradeRecipe: 'literal',
    })

    expect(
      resolveTokenRecipePolicy({
        tokenName: 'brand.orange',
        tokenRecipe: 'p3Premium',
        targetConfig: { gamut: 'p3', strategy: 'expand', amount: 0.75 },
        recipes: {
          p3Premium: { strategy: 'grade', recipe: 'premium', amount: 0.6 },
        },
      }),
    ).toMatchObject({
      config: { gamut: 'p3', strategy: 'grade', recipe: 'premium', amount: 0.6 },
      recipe: 'premium',
      gradeRecipe: 'premium',
    })
  })

  it('reports grade recipe deltas for art-directed token recipes', () => {
    const result = compileTokenObject(
      {
        'brand.orange': {
          $type: 'color',
          $value: '#ff5a00',
          okcolor: { recipe: 'p3Premium' },
        },
      },
      {
        recipes: {
          p3Premium: {
            strategy: 'grade',
            recipe: 'premium',
            gamut: 'p3',
            amount: 0.6,
          },
        },
      },
    )

    const p3 = result.report.tokens[0]?.targets.p3
    expect(p3).toMatchObject({
      gamut: 'p3',
      strategy: 'grade',
      recipe: 'premium',
    })
    expect(p3?.delta.lightness).toBeLessThan(0)
    expect(p3?.delta.chroma).toBeGreaterThan(0)
  })

  it('supports built-in token recipes without custom recipe aliases', () => {
    const result = compileTokenObject({
      'brand.orange': {
        $type: 'color',
        $value: '#ff5a00',
        okcolor: { recipe: 'premium' },
      },
    })

    expect(result.report.tokens[0]?.targets.p3).toMatchObject({
      strategy: 'grade',
      recipe: 'premium',
    })
  })

  it('fails loudly for unknown token recipes without a custom recipe definition', () => {
    expect(() =>
      compileTokenObject({
        'brand.orange': {
          $type: 'color',
          $value: '#ff5a00',
          okcolor: { recipe: 'expensive' },
        },
      }),
    ).toThrow(/Unknown okcolor recipe "expensive" for token "brand\.orange"/)
  })

  it('fails loudly for invalid custom recipe targets', () => {
    expect(() =>
      compileTokenObject(
        {
          'brand.orange': {
            $type: 'color',
            $value: '#ff5a00',
            okcolor: { recipe: 'brandPremium' },
          },
        },
        {
          recipes: {
            brandPremium: {
              strategy: 'grade',
              recipe: 'expensive',
            },
          },
        },
      ),
    ).toThrow(/Unsupported okcolor recipe "expensive" for token "brand\.orange"/)
  })

  it('reports why neutral expansion was skipped', () => {
    const result = compileTokenObject({ 'brand.gray': '#808080' })
    const p3 = result.report.tokens[0]?.targets.p3
    expect(p3).toMatchObject({
      strategy: 'expand',
      neutralSkipped: true,
      skippedReason: 'chroma-below-threshold',
    })
    expect(p3?.delta.chroma).toBe(0)
  })

  it('preserves structured token alpha and skips malformed color component tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'okcolor-structured-'))
    const input = join(dir, 'colors.json')
    await writeFile(
      input,
      JSON.stringify({
        'shadow.tint': {
          $type: 'color',
          $value: {
            colorSpace: 'srgb',
            components: [0, 0, 0],
            alpha: 0.42,
            hex: '#000000',
          },
        },
        'bad.components': {
          $type: 'color',
          $value: {
            colorSpace: 'srgb',
            components: [1, 'none', 0],
            alpha: 1,
          },
        },
      }),
    )

    try {
      const result = await compileTokens(input)
      expect(result.report.tokens.map((token) => token.token)).toEqual(['shadow.tint'])
      expect(result.report.diagnostics).toEqual([
        expect.objectContaining({ token: 'bad.components', kind: 'invalid-color-components' }),
      ])
      expect(result.designTokens['shadow.tint'].$value).toMatchObject({
        colorSpace: 'srgb',
        alpha: 0.42,
        hex: '#0000006b',
      })
      expect(result.designTokens).not.toHaveProperty('bad.components')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes skipped token diagnostics in the compile report', () => {
    const result = compileTokenObject({
      'brand.orange': '#ff5a00',
      'bad.components': {
        $type: 'color',
        $value: {
          colorSpace: 'srgb',
          components: [1, 'none', 0],
        },
      },
      'bad.space': {
        $type: 'color',
        $value: {
          colorSpace: 'display-p3',
          components: [1, 0.4, 0],
        },
      },
    })

    expect(result.report.tokens.map((token) => token.token)).toEqual(['brand.orange'])
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        token: 'bad.components',
        kind: 'invalid-color-components',
        severity: 'warning',
        path: '$value.components',
      }),
      expect.objectContaining({
        token: 'bad.space',
        kind: 'unsupported-color-space',
        severity: 'warning',
        path: '$value.colorSpace',
      }),
    ])
  })

  it('parses token colors with diagnostics before compile orchestration', () => {
    const parsed = parseTokenInputs({
      'brand.orange': {
        $type: 'color',
        $value: '#ff5a00',
        okcolor: { recipe: 'premium' },
      },
      'bad.components': {
        $type: 'color',
        $value: {
          colorSpace: 'srgb',
          components: [1, 'none', 0],
        },
      },
      'bad.space': {
        $type: 'color',
        $value: {
          colorSpace: 'display-p3',
          components: [1, 0.4, 0],
        },
      },
    })

    expect(parsed.colors).toMatchObject([{ name: 'brand.orange', color: '#ff5a00', recipe: 'premium' }])
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ token: 'bad.components', kind: 'invalid-color-components' }),
      expect.objectContaining({ token: 'bad.space', kind: 'unsupported-color-space' }),
    ])
  })

  it('audits declared foreground/background contrast pairs in fallback and P3 targets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'okcolor-contrast-'))
    const input = join(dir, 'colors.json')
    await writeFile(
      input,
      JSON.stringify({
        'color.action.primary.bg': {
          $type: 'color',
          $value: '#0055ff',
          okcolor: {
            text: 'color.action.primary.fg',
            contrast: 'wcag2-aa',
          },
        },
        'color.action.primary.fg': {
          $type: 'color',
          $value: '#ffffff',
        },
      }),
    )

    try {
      const result = await compileTokens(input)
      const bg = result.report.tokens.find((token) => token.token === 'color.action.primary.bg')
      expect(bg?.contrast.wcag2['color.action.primary.fg@srgb']).toMatchObject({
        foreground: 'color.action.primary.fg',
        background: 'color.action.primary.bg',
        status: 'pass',
        required: 4.5,
      })
      expect(bg?.contrast.wcag2['color.action.primary.fg@p3']).toMatchObject({
        foreground: 'color.action.primary.fg',
        background: 'color.action.primary.bg',
      })
      expect(bg?.contrast.apca['color.action.primary.fg@srgb']).toMatchObject({
        lc: expect.any(Number),
        polarity: expect.any(String),
        advisory: expect.stringMatching(/^(pass-body|pass-large|fail)$/),
      })
      expect(result.report.contrastPairs).toEqual([
        expect.objectContaining({
          background: 'color.action.primary.bg',
          foreground: 'color.action.primary.fg',
          target: 'srgb',
          status: 'evaluated',
          wcag2Key: 'color.action.primary.fg@srgb',
          apcaKey: 'color.action.primary.fg@srgb',
        }),
        expect.objectContaining({
          background: 'color.action.primary.bg',
          foreground: 'color.action.primary.fg',
          target: 'p3',
          status: 'evaluated',
          wcag2Key: 'color.action.primary.fg@p3',
          apcaKey: 'color.action.primary.fg@p3',
        }),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves alpha in token fallback and OKLCH output layers', () => {
    const result = compileTokenObject({
      'overlay.scrim': '#ff000080',
      'overlay.structured': {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5 },
      },
    })

    expect(result.css).toContain('--overlay-scrim: #ff000080;')
    expect(result.css).toContain('--overlay-scrim-oklch: oklch(62.8% 0.25768 29.23 / 0.502);')
    expect(result.css).toContain('--overlay-structured: #ff000080;')
    expect(result.css).toContain('--overlay-structured-oklch: oklch(62.8% 0.25768 29.23 / 0.5);')
    expect(result.designTokens['overlay.scrim']).toMatchObject({
      $value: { alpha: expect.closeTo(0.50196, 4), hex: '#ff000080' },
    })
  })

  it('uses the actual sRGB target for token fit contrast reports', () => {
    const result = compileTokenObject(
      {
        surface: {
          $type: 'color',
          $value: 'oklch(70% 0.35 145)',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#000000',
      },
      {
        targets: {
          base: { gamut: 'srgb', strategy: 'fit', format: 'oklch' },
        },
      },
    )
    const surface = result.report.tokens.find((token) => token.token === 'surface')

    expect(surface?.targets).not.toHaveProperty('p3')
    expect(surface?.targets.srgb).toMatchObject({ gamut: 'srgb', strategy: 'fit' })
    expect(surface?.contrast.wcag2['foreground@p3']).toBeUndefined()
    expect(surface?.contrast.wcag2['foreground@srgb']).toMatchObject({ target: 'srgb' })
    expect(result.css).toContain('--surface: oklch(')
    expect(result.css).not.toContain('@media (color-gamut: p3)')
  })

  it('skips contrast audit for alpha colors instead of reporting opaque false passes', () => {
    const result = compileTokenObject({
      surface: {
        $type: 'color',
        $value: '#ffffff',
        okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
      },
      foreground: '#00000080',
    })
    const surface = result.report.tokens.find((token) => token.token === 'surface')

    expect(surface?.contrast.wcag2).toEqual({})
    expect(result.report.contrastPairs).toEqual([
      expect.objectContaining({
        background: 'surface',
        foreground: 'foreground',
        target: 'srgb',
        status: 'skipped',
        skippedReason: 'alpha-unsupported',
      }),
      expect.objectContaining({
        background: 'surface',
        foreground: 'foreground',
        target: 'p3',
        status: 'skipped',
        skippedReason: 'alpha-unsupported',
      }),
    ])
  })

  it('audits P3 contrast when a P3 target relies on default gamut', () => {
    const result = compileTokenObject(
      {
        surface: {
          $type: 'color',
          $value: '#0055ff',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#ffffff',
      },
      {
        targets: {
          base: { gamut: 'srgb', strategy: 'convert', format: 'hex' },
          p3: { strategy: 'expand', amount: 0.75, format: 'oklch' },
        },
      },
    )
    const surface = result.report.tokens.find((token) => token.token === 'surface')

    expect(surface?.targets.p3).toMatchObject({ gamut: 'p3' })
    expect(surface?.contrast.wcag2['foreground@p3']).toMatchObject({ target: 'p3' })
    expect(result.report.contrastPairs).toContainEqual(
      expect.objectContaining({ target: 'p3', status: 'evaluated', wcag2Key: 'foreground@p3' }),
    )
  })

  it('reports skipped contrast pairs when declared foreground tokens are missing or malformed', () => {
    const result = compileTokenObject({
      surface: {
        $type: 'color',
        $value: '#ffffff',
        okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
      },
      broken: {
        $type: 'color',
        $value: '#111111',
        okcolor: { text: 'bad.components', contrast: 'wcag2-aa' },
      },
      'bad.components': {
        $type: 'color',
        $value: {
          colorSpace: 'srgb',
          components: [1, 'none', 0],
        },
      },
      'bad.background': {
        $type: 'color',
        $value: {
          colorSpace: 'display-p3',
          components: [1, 0, 0],
        },
        okcolor: { text: 'foreground.valid', contrast: 'wcag2-aa' },
      },
      'foreground.valid': '#000000',
    })

    expect(result.report.contrastPairs).toEqual([
      expect.objectContaining({
        background: 'surface',
        foreground: 'foreground',
        target: 'srgb',
        status: 'skipped',
        skippedReason: 'missing-foreground',
      }),
      expect.objectContaining({
        background: 'surface',
        foreground: 'foreground',
        target: 'p3',
        status: 'skipped',
        skippedReason: 'missing-foreground',
      }),
      expect.objectContaining({
        background: 'broken',
        foreground: 'bad.components',
        target: 'srgb',
        status: 'skipped',
        skippedReason: 'missing-foreground',
      }),
      expect.objectContaining({
        background: 'broken',
        foreground: 'bad.components',
        target: 'p3',
        status: 'skipped',
        skippedReason: 'missing-foreground',
      }),
      expect.objectContaining({
        background: 'bad.background',
        foreground: 'foreground.valid',
        target: 'srgb',
        status: 'skipped',
        skippedReason: 'missing-background',
      }),
      expect.objectContaining({
        background: 'bad.background',
        foreground: 'foreground.valid',
        target: 'p3',
        status: 'skipped',
        skippedReason: 'missing-background',
      }),
    ])
    expect(result.report.summary.failures).toEqual([])
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ token: 'bad.components', kind: 'invalid-color-components' }),
      expect.objectContaining({ token: 'bad.background', kind: 'unsupported-color-space' }),
    ])
  })

  it('builds compile report summaries from token target and contrast state', () => {
    const source = parseColor('#ffffff')
    const report = createCompiledTokenReport({
      token: 'surface',
      source,
      targets: {
        srgb: { ...toFallbackTargetReport(source), inGamut: false },
      },
    })
    report.contrast.wcag2['foreground@srgb'] = {
      foreground: 'foreground',
      background: 'surface',
      target: 'srgb',
      ratio: 1.16,
      required: 4.5,
      status: 'fail',
    }

    const compileReport = buildCompileReport({
      tokens: [report],
      diagnostics: [
        {
          token: 'bad.components',
          kind: 'invalid-color-components',
          severity: 'warning',
          path: '$value.components',
          message: 'sRGB token color components must be finite numbers.',
        },
      ],
    })

    expect(compileReport.schemaVersion).toBe(1)
    expect(compileReport.summary).toMatchObject({ contrastPassed: false, failureCount: 2 })
    expect(compileReport.summary.failures.map((failure) => failure.kind)).toEqual([
      'out-of-gamut',
      'wcag2-regression',
    ])
    expect(compileReport.diagnostics).toHaveLength(1)
  })

  it('uses WCAG 2 contrast as the blocking gate while APCA remains advisory', () => {
    const source = parseColor('#ffffff')
    const wcagFailApcaPass = createCompiledTokenReport({
      token: 'surface',
      source,
      targets: {
        srgb: toFallbackTargetReport(source),
      },
    })
    wcagFailApcaPass.contrast.wcag2['foreground@srgb'] = {
      foreground: 'foreground',
      background: 'surface',
      target: 'srgb',
      ratio: 4.49,
      required: 4.5,
      status: 'fail',
    }
    wcagFailApcaPass.contrast.apca['foreground@srgb'] = {
      foreground: 'foreground',
      background: 'surface',
      target: 'srgb',
      lc: 75,
      polarity: 'normal',
      advisory: 'pass-body',
    }

    const apcaFailWcagPass = createCompiledTokenReport({
      token: 'inverse.surface',
      source,
      targets: {
        srgb: toFallbackTargetReport(source),
      },
    })
    apcaFailWcagPass.contrast.wcag2['inverse.foreground@srgb'] = {
      foreground: 'inverse.foreground',
      background: 'inverse.surface',
      target: 'srgb',
      ratio: 4.5,
      required: 4.5,
      status: 'pass',
    }
    apcaFailWcagPass.contrast.apca['inverse.foreground@srgb'] = {
      foreground: 'inverse.foreground',
      background: 'inverse.surface',
      target: 'srgb',
      lc: 20,
      polarity: 'normal',
      advisory: 'fail',
    }

    const wcagBlocked = buildCompileReport({ tokens: [wcagFailApcaPass], diagnostics: [] })
    const apcaAdvisory = buildCompileReport({ tokens: [apcaFailWcagPass], diagnostics: [] })

    expect(wcagBlocked.summary).toMatchObject({
      contrastPassed: false,
      failureCount: 1,
      failures: [expect.objectContaining({ kind: 'wcag2-regression' })],
    })
    expect(apcaAdvisory.summary).toMatchObject({
      contrastPassed: true,
      failureCount: 0,
      failures: [],
    })
  })

  it('reports WCAG contrast failures for declared pairs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'okcolor-contrast-fail-'))
    const input = join(dir, 'colors.json')
    await writeFile(
      input,
      JSON.stringify({
        surface: {
          $type: 'color',
          $value: '#ffffff',
          okcolor: { text: 'foreground', contrast: 'wcag2-aa' },
        },
        foreground: '#eeeeee',
      }),
    )

    try {
      const result = await compileTokens(input)
      const surface = result.report.tokens.find((token) => token.token === 'surface')
      expect(surface?.contrast.wcag2['foreground@srgb']).toMatchObject({
        status: 'fail',
        ratio: expect.any(Number),
      })
      expect(result.report.summary.contrastPassed).toBe(false)
      expect(collectBlockingFailures(result).some((failure) => failure.kind === 'wcag2-regression')).toBe(true)
      expect(() => assertNoBlockingFailures(result)).toThrow(/okcolor audit failed/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps APCA advisory math aligned with the W3-licensed apca-w3 oracle for luminance inputs', () => {
    const samples = [
      { textY: 0.1, bgY: 1 },
      { textY: 1, bgY: 0.1 },
      { textY: 0.18, bgY: 0.5 },
      { textY: 0.5, bgY: 0.18 },
    ]

    for (const sample of samples) {
      const ours = apcaContrast(sample.textY, sample.bgY, 'fg', 'bg', 'srgb')
      const oracle = APCAcontrast(sample.textY, sample.bgY)
      expect(ours.lc).toBeCloseTo(Number(oracle), 1)
    }
  })

  it('describes available chroma budget without mutating the source', () => {
    const description = describeColor('#ff5a00', { gamut: 'p3' })
    expect(description.source.hex).toBe('#ff5a00')
    expect(description.target.cMax).toBeGreaterThanOrEqual(description.source.oklch.c)
    expect(description.suggestions.literal).toContain('oklch(')
  })
})
