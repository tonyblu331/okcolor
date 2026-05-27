import { colorToOklch, convertColor } from '../wasm.js'
import type { Oklch, ParsedColor } from './types.js'

export function parseOklchCss(input: string): Oklch | undefined {
  const match = input.trim().match(/^oklch\(\s*([+-]?\d*\.?\d+)(%)?\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)/i)
  if (!match) return undefined
  const l = Number(match[1]) / (match[2] ? 100 : 1)
  return roundOklch({ l, c: Number(match[3]), h: normalizeHue(Number(match[4])) })
}

export function parseColor(input: string): ParsedColor {
  const trimmed = input.trim()
  const oklch = parseOklchCss(trimmed) ?? parseRequiredOklch(colorToOklch(trimmed), trimmed)
  return { input: trimmed, hex: requiredConvert(trimmed, 'hex'), oklch, sourceGamut: 'srgb' }
}

export function formatOklch(oklch: Oklch): string {
  return `oklch(${round(oklch.l * 100, 2)}% ${round(oklch.c, 5)} ${round(oklch.h, 2)})`
}

export function tokenNameToCssVar(name: string): string {
  return `--${name.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
}

export function roundOklch(oklch: Oklch): Oklch {
  return { l: round(oklch.l, 4), c: round(oklch.c, 5), h: round(normalizeHue(oklch.h), 2) }
}

export function round(n: number, places: number): number {
  const factor = 10 ** places
  return Math.round((n + Number.EPSILON) * factor) / factor
}

export function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRequiredOklch(value: string | undefined, input: string): Oklch {
  const parsed = value ? parseOklchCss(value) : undefined
  if (!parsed) throw new Error(`Cannot parse color: ${input}`)
  return parsed
}

function requiredConvert(input: string, to: string): string {
  const result = convertColor(input, to)
  if (!result) throw new Error(`Cannot convert color: ${input}`)
  return result
}
