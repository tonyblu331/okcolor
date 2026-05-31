import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { APCAcontrast } from 'apca-w3'
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

describe('token color engine', () => {
  it('parses source colors through the existing faithful OKLCH conversion path', () => {
    const color = parseColor('#ff0000')
    expect(color.oklch).toEqual({ l: 0.628, c: 0.25768, h: 29.23 })
    expect(color.hex).toBe('#ff0000')
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
      expect(result.designTokens['shadow.tint'].$value).toMatchObject({
        colorSpace: 'srgb',
        alpha: 0.42,
        hex: '#000000',
      })
      expect(result.designTokens).not.toHaveProperty('bad.components')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
