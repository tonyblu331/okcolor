import init, {
  audit_css,
  color_to_oklch,
  convert_color,
  expand_oklch_chroma,
  fit_oklch_gamut,
  oklch_chroma_max,
  oklch_in_gamut,
  oklch_relative_luminance,
  transform_css,
} from './okcolor_core.js'
import type { ScanResult } from './types.js'

const DEFAULT_IGNORE_COMMENT = 'oklch-ignore'

export const OKCOLOR_WASM_URL = new URL('./okcolor_core_bg.wasm', import.meta.url).href

let initPromise: Promise<void> | undefined
let initialized = false

export type OkColorBrowserInitInput = string | Response | ArrayBuffer | ArrayBufferView | WebAssembly.Module

export interface WasmChromaTransform {
  l: number
  c: number
  h: number
  cMax: number
  inGamut: boolean
  neutralSkipped: boolean
}

export function initOkColorBrowser(input: OkColorBrowserInitInput = OKCOLOR_WASM_URL): Promise<void> {
  if (!initPromise) {
    initPromise = init(input as Parameters<typeof init>[0])
      .then(() => {
        initialized = true
      })
      .catch((error: unknown) => {
        initPromise = undefined
        initialized = false
        throw error
      })
  }

  return initPromise
}

export function isOkColorBrowserReady(): boolean {
  return initialized
}

export function transformCss(input: string, ignoreComment?: string): string {
  ensureInit()
  if (!ignoreComment || ignoreComment === DEFAULT_IGNORE_COMMENT) {
    return transform_css(input)
  }
  const customPlaceholder = makeUniqueMarker(input, '__OKC_CUSTOM_IGNORE_PLACEHOLDER__')
  const withCustomPlaceholders = input.split(ignoreComment).join(customPlaceholder)
  const shielded = shieldBuiltinIgnoreMarkers(withCustomPlaceholders)
  const sentinel = makeUniqueMarker(shielded.text, '__OKC_CUSTOM_oklch-ignore_SENTINEL__')
  const modified = shielded.text.split(customPlaceholder).join(sentinel)
  const result = transform_css(modified)
  return shielded.restore(result.split(sentinel).join(ignoreComment))
}

export function auditCss(input: string): ScanResult {
  ensureInit()
  const parsed = JSON.parse(audit_css(input)) as Record<string, number>
  return {
    css: input,
    legacy_count: parsed.legacy_count ?? 0,
    hex_count: parsed.hex_count ?? 0,
    rgb_count: parsed.rgb_count ?? 0,
    hsl_count: parsed.hsl_count ?? 0,
    hwb_count: parsed.hwb_count ?? 0,
    named_count: parsed.named_count ?? 0,
    gradient_count: parsed.gradient_count ?? 0,
    unique_count: parsed.unique_count ?? 0,
  }
}

export function colorToOklch(input: string): string | undefined {
  ensureInit()
  return color_to_oklch(input) ?? undefined
}

export function convertColor(input: string, toSpace: string): string | undefined {
  ensureInit()
  return convert_color(input, toSpace) ?? undefined
}

export function oklchInGamut(l: number, c: number, h: number, gamut: string): boolean | undefined {
  ensureInit()
  return oklch_in_gamut(l, c, h, gamut) ?? undefined
}

export function oklchChromaMax(l: number, h: number, gamut: string): number | undefined {
  ensureInit()
  return oklch_chroma_max(l, h, gamut) ?? undefined
}

export function expandOklchChroma(
  l: number,
  c: number,
  h: number,
  gamut: string,
  amount: number,
): WasmChromaTransform | undefined {
  ensureInit()
  const result = expand_oklch_chroma(l, c, h, gamut, amount)
  return result ? (JSON.parse(result) as WasmChromaTransform) : undefined
}

export function fitOklchGamut(l: number, c: number, h: number, gamut: string): WasmChromaTransform | undefined {
  ensureInit()
  const result = fit_oklch_gamut(l, c, h, gamut)
  return result ? (JSON.parse(result) as WasmChromaTransform) : undefined
}

export function oklchRelativeLuminance(l: number, c: number, h: number): number {
  ensureInit()
  return oklch_relative_luminance(l, c, h)
}

function ensureInit(): void {
  if (!initialized) {
    throw new Error('okcolor/browser is not initialized. Call `await initOkColorBrowser()` before using WASM APIs.')
  }
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
