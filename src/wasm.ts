import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScanResult } from './types.js'

function findPkgDir(): string {
  try {
    const d = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core-wasm/pkg')
    readFileSync(resolve(d, 'okcolor_core_bg.wasm'))
    return d
  } catch { /* fall through */ }
  const d = resolve(process.cwd(), 'packages/core-wasm/pkg')
  readFileSync(resolve(d, 'okcolor_core_bg.wasm'))
  return d
}

const PKG_DIR = findPkgDir()

const glue = await import(resolve(PKG_DIR, 'okcolor_core.js'))
const wasmBytes = readFileSync(resolve(PKG_DIR, 'okcolor_core_bg.wasm')).buffer
;(glue.initSync as (opts: { module: BufferSource }) => void)({ module: wasmBytes })

const transformCssFn   = glue.transform_css   as (s: string) => string
const auditCssFn       = glue.audit_css       as (s: string) => string
const colorToOklchFn   = glue.color_to_oklch   as (s: string) => string | null
const convertColorFn   = glue.convert_color   as (s: string, space: string) => string | null

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
  const result = colorToOklchFn(input)
  return result ?? undefined
}

/** Convert a CSS colour value to any supported space. */
export function convertColor(input: string, toSpace: string): string | undefined {
  const result = convertColorFn(input, toSpace)
  return result ?? undefined
}
