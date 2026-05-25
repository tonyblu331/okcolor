import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { ScanResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveWasmDir(): string {
  try {
    readFileSync(resolve(__dirname, 'okcolor_core_bg.wasm'))
    return __dirname
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e
  }
  const pkgDir = resolve(__dirname, '..', 'packages/core-wasm/pkg')
  try {
    readFileSync(resolve(pkgDir, 'okcolor_core_bg.wasm'))
    return pkgDir
  } catch (e: any) {
    throw new Error(`okcolor WASM not found. Tried: dist/ (production) and ${pkgDir} (development). ${e.code === 'ENOENT' ? 'Run `npm run build` to rebuild the WASM engine.' : e.message}`)
  }
}

let initError: Error | null = null
let transformCssFn: (s: string) => string
let auditCssFn: (s: string) => string
let colorToOklchFn: (s: string) => string | null
let convertColorFn: (s: string, space: string) => string | null

{
  try {
    const WASM_DIR = resolveWasmDir()
    const wasmBytes = readFileSync(resolve(WASM_DIR, 'okcolor_core_bg.wasm')).buffer
    const glue = await import(pathToFileURL(resolve(WASM_DIR, 'okcolor_core.js')).href)
    ;(glue.initSync as (opts: { module: unknown }) => void)({ module: wasmBytes })
    transformCssFn = glue.transform_css as (s: string) => string
    auditCssFn = glue.audit_css as (s: string) => string
    colorToOklchFn = glue.color_to_oklch as (s: string) => string | null
    convertColorFn = glue.convert_color as (s: string, space: string) => string | null
  } catch (e) {
    initError = e instanceof Error ? e : new Error(String(e))
  }
}

function ensureInit(): void {
  if (initError) throw initError
}

// ── WASM pre-scan bail-out workaround ──────────────────────────────────
// The WASM pre-scan bails out when input has no `#`, `rgb(`, `hsl(`, etc.
// — but that misses inputs with ONLY named colours (e.g. `color: red;`).
// We inject a harmless `# ` prefix to force the full scan. The hex matcher
// rejects `# ` (0 hex digits) and emits both chars verbatim.
//
// 148 CSS named colours compiled into a single word-boundary regex.
const NAMED_RE = /\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/i

const FUNC_COLOR_RE = /rgba?\(|hsla?\(|hwb\(|color\(/i

/** Check whether the WASM pre-scan may miss named colours in this input. */
function bypassNeeded(input: string): boolean {
  return NAMED_RE.test(input)
    && !input.includes('#')
    && !FUNC_COLOR_RE.test(input)
}

const BYPASS = '# '

/** Transform a CSS string — replace all legacy colours with OKLCH. */
export function transformCss(input: string, ignoreComment?: string): string {
  ensureInit()
  const bypass = bypassNeeded(input)
  const work = bypass ? BYPASS + input : input
  if (!ignoreComment || ignoreComment === 'oklch-ignore') {
    const out = transformCssFn(work)
    return bypass ? out.slice(BYPASS.length) : out
  }
  const modified = work.split(ignoreComment).join('oklch-ignore')
  const result = transformCssFn(modified)
  const cleaned = result.split('/* oklch-ignore */').join(ignoreComment)
  return bypass ? cleaned.slice(BYPASS.length) : cleaned
}

/** Audit a CSS string — return colour usage statistics. */
export function auditCss(input: string): ScanResult {
  ensureInit()
  const bypass = bypassNeeded(input)
  const work = bypass ? BYPASS + input : input
  const p = JSON.parse(auditCssFn(work)) as Record<string, number>
  return {
    css:           input,
    legacy_count:  p.legacy_count  ?? 0,
    hex_count:     p.hex_count     ?? 0,
    rgb_count:     p.rgb_count     ?? 0,
    hsl_count:     p.hsl_count     ?? 0,
    hwb_count:     p.hwb_count     ?? 0,
    named_count:   p.named_count   ?? 0,
    gradient_count: p.gradient_count ?? 0,
    unique_count:  p.unique_count  ?? 0,
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
