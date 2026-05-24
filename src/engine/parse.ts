import { srgb8ToOklch, srgbFloatToOklch, hslToSrgb, hwbToSrgb } from './math.js'
import { cacheGet, cacheSet } from './cache.js'
import { lookupNamed } from './named.js'

export interface ParsedColor {
  l: number
  c: number
  h: number
  alpha?: number
}

// ─── Hex ───

function hexDigit(c: string): number {
  const code = c.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 97 && code <= 102) return code - 97 + 10
  if (code >= 65 && code <= 70) return code - 65 + 10
  return 0
}

function hexByte(s: string): number {
  return hexDigit(s[0]) * 16 + hexDigit(s[1])
}

export function parseHex(digits: string): ParsedColor | null {
  const len = digits.length
  if (len === 3) {
    return convertSrgb8(
      hexDigit(digits[0]) * 17,
      hexDigit(digits[1]) * 17,
      hexDigit(digits[2]) * 17,
    )
  }
  if (len === 4) {
    return convertSrgb8(
      hexDigit(digits[0]) * 17,
      hexDigit(digits[1]) * 17,
      hexDigit(digits[2]) * 17,
      hexDigit(digits[3]) / 15,
    )
  }
  if (len === 6) {
    return convertSrgb8(hexByte(digits.slice(0, 2)), hexByte(digits.slice(2, 4)), hexByte(digits.slice(4, 6)))
  }
  if (len === 8) {
    return convertSrgb8(
      hexByte(digits.slice(0, 2)),
      hexByte(digits.slice(2, 4)),
      hexByte(digits.slice(4, 6)),
      hexByte(digits.slice(6, 8)) / 255,
    )
  }
  return null
}

// ─── RGB ───

export function parseRgb(body: string): ParsedColor | null {
  const tokens = tokenizeBody(body)
  if (tokens.length < 3) return null
  return convertSrgb8(parseU8(tokens[0]), parseU8(tokens[1]), parseU8(tokens[2]), parseAlpha(tokens, 3))
}

// ─── HSL ───

export function parseHsl(body: string): ParsedColor | null {
  const tokens = tokenizeBody(body)
  if (tokens.length < 3) return null
  const [r, g, b] = hslToSrgb(parseAngle(tokens[0]), parsePercent(tokens[1]), parsePercent(tokens[2]))
  return convertSrgbFloat(r, g, b, parseAlpha(tokens, 3))
}

// ─── HWB ───

export function parseHwb(body: string): ParsedColor | null {
  const tokens = tokenizeBody(body)
  if (tokens.length < 3) return null
  const [r, g, b] = hwbToSrgb(parseAngle(tokens[0]), parsePercent(tokens[1]), parsePercent(tokens[2]))
  return convertSrgbFloat(r, g, b, parseAlpha(tokens, 3))
}

// ─── color(srgb ...) ───

export function parseColorSrgb(body: string): ParsedColor | null {
  const tokens = tokenizeBody(body)
  if (tokens.length < 4 || tokens[0].toLowerCase() !== 'srgb') return null
  return convertSrgbFloat(parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3]), parseAlpha(tokens, 4))
}

// ─── Named ───

export function parseNamed(name: string): ParsedColor | null {
  const rgb = lookupNamed(name)
  if (!rgb) return null
  return convertSrgb8(rgb[0], rgb[1], rgb[2])
}

// ─── Shared helpers ───

function tokenizeBody(body: string): string[] {
  return body
    .split(/[,\s\/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseNumberOrPercent(s: string): number | null {
  s = s.trim()
  if (s.endsWith('%')) {
    const n = parseFloat(s.slice(0, -1))
    return isNaN(n) ? null : n / 100
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseU8(s: string): number | null {
  s = s.trim()
  if (s.endsWith('%')) {
    const n = parseFloat(s.slice(0, -1))
    return isNaN(n) ? null : Math.round((n / 100) * 255)
  }
  const n = parseInt(s, 10)
  return isNaN(n) ? null : Math.max(0, Math.min(255, n))
}

function parsePercent(s: string): number {
  const n = parseNumberOrPercent(s)
  return n == null ? 0 : n * 100
}

function parseAngle(s: string): number {
  s = s.trim()
  if (s.endsWith('deg')) return parseFloat(s.slice(0, -3)) || 0
  return parseFloat(s) || 0
}

function parseAlpha(tokens: string[], idx: number): number | undefined {
  const s = tokens[idx]
  if (s == null) return undefined
  if (s.endsWith('%')) {
    const n = parseFloat(s.slice(0, -1))
    return isNaN(n) ? undefined : n / 100
  }
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}

// ─── Conversion helpers ───

function convertSrgb8(r: number | null, g: number | null, b: number | null, a?: number): ParsedColor | null {
  if (r == null || g == null || b == null) return null
  const cached = cacheGet(r, g, b, a)
  if (cached) {
    const [l, c, h] = cached
    return { l, c, h, alpha: a }
  }
  const [l, c, h] = srgb8ToOklch(r, g, b)
  cacheSet(r, g, b, a, [l, c, h])
  return { l, c, h, alpha: a }
}

function convertSrgbFloat(r: number, g: number, b: number, a?: number): ParsedColor {
  const [l, c, h] = srgbFloatToOklch(r, g, b)
  return { l, c, h, alpha: a }
}
