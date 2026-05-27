import { accessSync, constants, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { ScanResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_IGNORE_COMMENT = 'oklch-ignore'

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ENOENT'
}

function canReadFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch (e) {
    if (isMissingFileError(e)) return false
    throw e
  }
}

function resolveWasmDir(): string {
  if (canReadFile(resolve(__dirname, 'okcolor_core_bg.wasm'))) {
    return __dirname
  }

  const pkgDir = resolve(__dirname, '..', 'packages/core-wasm/pkg')
  if (canReadFile(resolve(pkgDir, 'okcolor_core_bg.wasm'))) {
    return pkgDir
  }

  throw new Error(
    `okcolor WASM not found. Tried: dist/ (production) and ${pkgDir} (development). Run \`npm run build\` to rebuild the WASM engine.`,
  )
}

let initError: Error | null = null
let transformCssFn: (s: string) => string
let auditCssFn: (s: string) => string
let colorToOklchFn: (s: string) => string | null
let convertColorFn: (s: string, space: string) => string | null
let oklchInGamutFn: (l: number, c: number, h: number, gamut: string) => boolean | null
let oklchChromaMaxFn: (l: number, h: number, gamut: string) => number | null
let expandOklchChromaFn: (l: number, c: number, h: number, gamut: string, amount: number) => string | null
let fitOklchGamutFn: (l: number, c: number, h: number, gamut: string) => string | null
let oklchRelativeLuminanceFn: (l: number, c: number, h: number) => number

{
  try {
    const WASM_DIR = resolveWasmDir()
    const wasmBytes = readFileSync(resolve(WASM_DIR, 'okcolor_core_bg.wasm'))
    const glue = await import(pathToFileURL(resolve(WASM_DIR, 'okcolor_core.js')).href)
    ;(glue.initSync as (opts: { module: unknown }) => void)({ module: wasmBytes })
    transformCssFn = glue.transform_css as (s: string) => string
    auditCssFn = glue.audit_css as (s: string) => string
    colorToOklchFn = glue.color_to_oklch as (s: string) => string | null
    convertColorFn = glue.convert_color as (s: string, space: string) => string | null
    oklchInGamutFn = glue.oklch_in_gamut as (l: number, c: number, h: number, gamut: string) => boolean | null
    oklchChromaMaxFn = glue.oklch_chroma_max as (l: number, h: number, gamut: string) => number | null
    expandOklchChromaFn = glue.expand_oklch_chroma as (
      l: number,
      c: number,
      h: number,
      gamut: string,
      amount: number,
    ) => string | null
    fitOklchGamutFn = glue.fit_oklch_gamut as (l: number, c: number, h: number, gamut: string) => string | null
    oklchRelativeLuminanceFn = glue.oklch_relative_luminance as (l: number, c: number, h: number) => number
  } catch (e) {
    initError = e instanceof Error ? e : new Error(String(e))
  }
}

function ensureInit(): void {
  if (initError) throw initError
}

function makeUniqueMarker(input: string, base: string): string {
  let sentinel = base
  let suffix = 0
  while (input.includes(sentinel)) {
    suffix += 1
    sentinel = `${base}_${suffix}__`
  }
  return sentinel
}

function shieldBuiltinIgnoreMarkers(input: string): {
  text: string
  restore: (output: string) => string
} {
  const originals: string[] = []
  const markerBase = makeUniqueMarker(input, '__OKC_BUILTIN_IGNORE_SHIELD__')
  const text = input.replace(/oklch-ignore/gi, (match) => {
    const marker = `${markerBase}${originals.length}__`
    originals.push(match)
    return marker
  })

  return {
    text,
    restore(output) {
      let restored = output
      for (let i = 0; i < originals.length; i++) {
        restored = restored.split(`${markerBase}${i}__`).join(originals[i])
      }
      return restored
    },
  }
}

/** Transform a CSS string — replace all legacy colours with OKLCH. */
export function transformCss(input: string, ignoreComment?: string): string {
  ensureInit()
  if (!ignoreComment || ignoreComment === DEFAULT_IGNORE_COMMENT) {
    return transformCssFn(input)
  }
  const customPlaceholder = makeUniqueMarker(input, '__OKC_CUSTOM_IGNORE_PLACEHOLDER__')
  const withCustomPlaceholders = input.split(ignoreComment).join(customPlaceholder)
  const shielded = shieldBuiltinIgnoreMarkers(withCustomPlaceholders)
  const sentinel = makeUniqueMarker(shielded.text, '__OKC_CUSTOM_oklch-ignore_SENTINEL__')
  const modified = shielded.text.split(customPlaceholder).join(sentinel)
  const result = transformCssFn(modified)
  return shielded.restore(result.split(sentinel).join(ignoreComment))
}

/** Audit a CSS string — return colour usage statistics. */
export function auditCss(input: string): ScanResult {
  ensureInit()
  const p = JSON.parse(auditCssFn(input)) as Record<string, number>
  return {
    css: input,
    legacy_count: p.legacy_count ?? 0,
    hex_count: p.hex_count ?? 0,
    rgb_count: p.rgb_count ?? 0,
    hsl_count: p.hsl_count ?? 0,
    hwb_count: p.hwb_count ?? 0,
    named_count: p.named_count ?? 0,
    gradient_count: p.gradient_count ?? 0,
    unique_count: p.unique_count ?? 0,
  }
}

/** Convert a single CSS colour value to an OKLCH string. */
export function colorToOklch(input: string): string | undefined {
  ensureInit()
  const result = colorToOklchFn(input)
  return result ?? undefined
}

/** Convert a CSS colour value to any supported space. */
export function convertColor(input: string, toSpace: string): string | undefined {
  ensureInit()
  const result = convertColorFn(input, toSpace)
  return result ?? undefined
}

export interface WasmChromaTransform {
  l: number
  c: number
  h: number
  cMax: number
  inGamut: boolean
  neutralSkipped: boolean
}

export function oklchInGamut(l: number, c: number, h: number, gamut: string): boolean | undefined {
  ensureInit()
  return oklchInGamutFn(l, c, h, gamut) ?? undefined
}

export function oklchChromaMax(l: number, h: number, gamut: string): number | undefined {
  ensureInit()
  return oklchChromaMaxFn(l, h, gamut) ?? undefined
}

export function expandOklchChroma(
  l: number,
  c: number,
  h: number,
  gamut: string,
  amount: number,
): WasmChromaTransform | undefined {
  ensureInit()
  const result = expandOklchChromaFn(l, c, h, gamut, amount)
  return result ? JSON.parse(result) as WasmChromaTransform : undefined
}

export function fitOklchGamut(l: number, c: number, h: number, gamut: string): WasmChromaTransform | undefined {
  ensureInit()
  const result = fitOklchGamutFn(l, c, h, gamut)
  return result ? JSON.parse(result) as WasmChromaTransform : undefined
}

export function oklchRelativeLuminance(l: number, c: number, h: number): number {
  ensureInit()
  return oklchRelativeLuminanceFn(l, c, h)
}
