import { isRecord } from './color.js'
import type { TokenParseDiagnostic, TokenParseDiagnosticKind } from './types.js'
export type { TokenParseDiagnostic, TokenParseDiagnosticKind } from './types.js'

export interface TokenColorInput {
  name: string
  original: unknown
  color: string
  recipe?: string
  alpha?: number
}

export interface TokenParseSummary {
  colors: TokenColorInput[]
  diagnostics: TokenParseDiagnostic[]
}

export function parseTokenInputs(tokens: Record<string, unknown>): TokenParseSummary {
  const colors: TokenColorInput[] = []
  const diagnostics: TokenParseDiagnostic[] = []

  for (const [name, token] of Object.entries(tokens)) {
    const result = parseTokenInput(name, token)
    if (result.color) colors.push(result.color)
    diagnostics.push(...result.diagnostics)
  }

  return { colors, diagnostics }
}

function parseTokenInput(
  name: string,
  token: unknown,
): { color?: TokenColorInput; diagnostics: TokenParseDiagnostic[] } {
  if (typeof token === 'string') {
    return {
      color: { name, original: token, color: token },
      diagnostics: [],
    }
  }

  if (!isRecord(token)) {
    return invalid(name, 'unsupported-token-shape', '$value', 'Token must be a color string or object with $value.')
  }

  const value = token.$value
  if (typeof value === 'string') {
    return {
      color: { name, original: token, color: value, recipe: extractRecipe(token), alpha: extractAlpha(token) },
      diagnostics: [],
    }
  }

  if (!isRecord(value)) {
    return invalid(name, 'unsupported-token-shape', '$value', 'Token $value must be a color string or object.')
  }

  if (typeof value.hex === 'string') {
    return {
      color: { name, original: token, color: value.hex, recipe: extractRecipe(token), alpha: extractAlpha(token) },
      diagnostics: [],
    }
  }

  const componentColor = colorSpaceComponentsToRgb(name, value)
  if ('diagnostics' in componentColor) return componentColor

  return {
    color: {
      name,
      original: token,
      color: componentColor.color,
      recipe: extractRecipe(token),
      alpha: extractAlpha(token),
    },
    diagnostics: [],
  }
}

function colorSpaceComponentsToRgb(
  token: string,
  value: Record<string, unknown>,
): { color: string } | { diagnostics: TokenParseDiagnostic[] } {
  if (value.colorSpace !== 'srgb') {
    return invalid(token, 'unsupported-color-space', '$value.colorSpace', 'Only srgb token color components are supported.')
  }

  if (!Array.isArray(value.components) || value.components.length < 3) {
    return invalid(
      token,
      'invalid-color-components',
      '$value.components',
      'sRGB token colors require at least three numeric components.',
    )
  }

  const components = value.components.slice(0, 3)
  if (!components.every((component) => typeof component === 'number' && Number.isFinite(component))) {
    return invalid(
      token,
      'invalid-color-components',
      '$value.components',
      'sRGB token color components must be finite numbers.',
    )
  }

  const [r, g, b] = components
  return { color: `rgb(${Math.round(clamp01(r) * 255)} ${Math.round(clamp01(g) * 255)} ${Math.round(clamp01(b) * 255)})` }
}

function extractRecipe(token: Record<string, unknown>): string | undefined {
  if (!isRecord(token.okcolor) || typeof token.okcolor.recipe !== 'string') return undefined
  return token.okcolor.recipe
}

function extractAlpha(token: Record<string, unknown>): number | undefined {
  if (!isRecord(token.$value) || typeof token.$value.alpha !== 'number') return undefined
  return clamp01(token.$value.alpha)
}

function invalid(
  token: string,
  kind: TokenParseDiagnosticKind,
  path: string,
  message: string,
): { diagnostics: TokenParseDiagnostic[] } {
  return {
    diagnostics: [
      {
        token,
        kind,
        severity: 'warning',
        path,
        message,
      },
    ],
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
