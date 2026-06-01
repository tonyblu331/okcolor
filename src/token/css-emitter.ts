export interface LayeredCssInput {
  base: string[]
  literal: string[]
  p3: string[]
}

export function renderLayeredCss(input: LayeredCssInput): string {
  const lines = [
    ':root {',
    ...input.base,
    '}',
    '',
    '@supports (color: oklch(0.5 0.1 40)) {',
    '  :root {',
    ...input.literal,
    '  }',
    '}',
  ]

  if (input.p3.length > 0) {
    lines.push(
      '',
      '@media (color-gamut: p3) {',
      '  @supports (color: oklch(0.5 0.1 40)) {',
      '    :root {',
      ...input.p3.map((line) => `  ${line}`),
      '    }',
      '  }',
      '}',
    )
  }

  lines.push('')
  return lines.join('\n')
}
