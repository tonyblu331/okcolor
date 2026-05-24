import { oklchToCss } from './format.js'
import { parseHex, parseRgb, parseHsl, parseHwb, parseColorSrgb, parseNamed, type ParsedColor } from './parse.js'

export interface ScanResult {
  css: string
  legacy_count: number
  hex_count: number
  rgb_count: number
  hsl_count: number
  hwb_count: number
  named_count: number
  gradient_count: number
  unique_count: number
}

const MODERN_FUNCS = new Set([
  'oklch',
  'oklab',
  'lab',
  'lch',
  'color-mix',
  'light-dark',
  'contrast-color',
  'relative-color',
  'var',
  'calc',
  'env',
])

/** Transform CSS by replacing legacy colors with OKLCH. */
export function transformCss(input: string): string {
  return scan(input, true).css
}

/** Audit CSS and return color format statistics without transforming. */
export function auditCss(input: string): ScanResult {
  return scan(input, false)
}

// ─── Main scanner ───

function scan(input: string, transform: boolean): ScanResult {
  const stats: ScanResult = {
    css: input,
    legacy_count: 0,
    hex_count: 0,
    rgb_count: 0,
    hsl_count: 0,
    hwb_count: 0,
    named_count: 0,
    gradient_count: 0,
    unique_count: 0,
  }

  if (!input) return stats

  // 1. Protect strings, comments, and oklch-ignore lines
  const { protectedCss, restore } = protectRegions(input)

  // 2. Process gradients first (they contain colors inside)
  let code = protectedCss
  code = processGradients(code, stats, transform)

  // 3. Replace standalone colors
  code = replaceColors(code, stats, transform)

  // 4. Restore protected regions
  stats.css = restore(code)
  return stats
}

// ─── Region protection ───

function protectRegions(css: string): {
  protectedCss: string
  restore: (s: string) => string
} {
  const placeholders: string[] = []
  const prefix = '__OKA_' + Math.random().toString(36).slice(2, 8) + '_'

  let protectedCss = css

  // Lines with /* oklch-ignore */ — protect the entire line
  protectedCss = protectedCss.replace(/.*\/\*\s*oklch-ignore\s*\*\/.*/gm, (m) => {
    placeholders.push(m)
    return `${prefix}I${placeholders.length - 1}_`
  })

  // Block comments
  protectedCss = protectedCss.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    placeholders.push(m)
    return `${prefix}C${placeholders.length - 1}_`
  })

  // Line comments
  protectedCss = protectedCss.replace(/\/\/.*$/gm, (m) => {
    placeholders.push(m)
    return `${prefix}L${placeholders.length - 1}_`
  })

  // Strings (single and double quotes)
  protectedCss = protectedCss.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => {
    placeholders.push(m)
    return `${prefix}S${placeholders.length - 1}_`
  })

  return {
    protectedCss,
    restore: (s: string) => {
      return s
        .replace(new RegExp(`${prefix}I(\\d+)_`, 'g'), (_, i) => placeholders[+i] ?? '')
        .replace(new RegExp(`${prefix}C(\\d+)_`, 'g'), (_, i) => placeholders[+i] ?? '')
        .replace(new RegExp(`${prefix}L(\\d+)_`, 'g'), (_, i) => placeholders[+i] ?? '')
        .replace(new RegExp(`${prefix}S(\\d+)_`, 'g'), (_, i) => placeholders[+i] ?? '')
    },
  }
}

// ─── Gradient processing ───

function processGradients(
  code: string,
  stats: ScanResult,
  transform: boolean,
): string {
  const gradientRe =
    /\b(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient)\s*\(/gi

  const matches: Array<{ start: number; end: number; replacement: string }> = []

  let m: RegExpExecArray | null
  while ((m = gradientRe.exec(code)) !== null) {
    const start = m.index
    const funcName = m[1]
    const openParen = m.index + m[0].length - 1
    const closeParen = findCloseParen(code, openParen)
    if (closeParen === -1) continue

    const inner = code.slice(openParen + 1, closeParen)
    const alreadyOklch = /^\s*in\s+oklch\b/.test(inner) || /^\s*in\s+oklab\b/.test(inner)

    // Process stops inside the gradient
    const processedInner = replaceColorsInGradient(inner, stats, transform)

    if (transform) {
      const finalInner = alreadyOklch ? processedInner : `in oklch, ${processedInner}`
      matches.push({
        start,
        end: closeParen + 1,
        replacement: `${funcName}(${finalInner})`,
      })
    }

    stats.gradient_count++
  }

  // Replace from end to start
  if (transform) {
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end, replacement } = matches[i]
      code = code.slice(0, start) + replacement + code.slice(end)
    }
  }

  return code
}

/** Find the matching close paren, respecting nested parens and strings. */
function findCloseParen(s: string, start: number): number {
  let depth = 1
  let i = start + 1
  while (i < s.length && depth > 0) {
    const ch = s[i]
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    } else if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < s.length) {
        if (s[i] === quote && s[i - 1] !== '\\') break
        i++
      }
    }
    i++
  }
  return -1
}

/** Replace colors inside gradient stops, but skip nested functions. */
function replaceColorsInGradient(
  content: string,
  stats: ScanResult,
  transform: boolean,
): string {
  // Protect nested function calls inside gradient stops
  const funcs: string[] = []
  const prefix = '__GF_' + Math.random().toString(36).slice(2, 8) + '_'

  let protectedContent = content.replace(/\b([a-z-]+)\s*\(/gi, (m, name, offset) => {
    const lower = name.toLowerCase()
    if (MODERN_FUNCS.has(lower)) {
      const close = findCloseParen(content, offset + name.length)
      if (close !== -1) {
        const full = content.slice(offset, close + 1)
        funcs.push(full)
        return `${prefix}F${funcs.length - 1}_`
      }
    }
    return m
  })

  // Now replace colors in the protected content
  protectedContent = replaceColors(protectedContent, stats, transform)

  // Restore functions
  return protectedContent.replace(new RegExp(`${prefix}F(\\d+)_`, 'g'), (_, i) => funcs[+i] ?? '')
}

// ─── Color replacement ───

function replaceColors(
  code: string,
  stats: ScanResult,
  transform: boolean,
): string {
  // Hex
  code = replacePattern(code, /#([0-9a-fA-F]{3,8})\b/g, (digits) => {
    const parsed = parseHex(digits)
    if (!parsed) return null
    stats.hex_count++
    return parsed
  }, transform)

  // color(srgb ...)
  code = replacePattern(code, /\bcolor\s*\(\s*(srgb\s+[^)]*)\)/gi, (body) => {
    const parsed = parseColorSrgb(body)
    if (!parsed) return null
    stats.rgb_count++
    return parsed
  }, transform)

  // rgb/rgba
  code = replacePattern(code, /\brgba?\s*\(([^)]*)\)/gi, (body) => {
    const parsed = parseRgb(body)
    if (!parsed) return null
    stats.rgb_count++
    return parsed
  }, transform)

  // hsl/hsla
  code = replacePattern(code, /\bhsla?\s*\(([^)]*)\)/gi, (body) => {
    const parsed = parseHsl(body)
    if (!parsed) return null
    stats.hsl_count++
    return parsed
  }, transform)

  // hwb
  code = replacePattern(code, /\bhwb\s*\(([^)]*)\)/gi, (body) => {
    const parsed = parseHwb(body)
    if (!parsed) return null
    stats.hwb_count++
    return parsed
  }, transform)

  // Named colors
  code = replaceNamedColors(code, stats, transform)

  stats.legacy_count = stats.hex_count + stats.rgb_count + stats.hsl_count + stats.hwb_count + stats.named_count

  return code
}

/** Generic regex replacer that builds match list then replaces end-to-start. */
function replacePattern(
  code: string,
  re: RegExp,
  parser: (body: string) => ParsedColor | null,
  transform: boolean,
): string {
  const matches: Array<{ start: number; end: number; replacement: string }> = []

  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    // Skip if this looks like an ID selector: #abc followed by whitespace then {
    const afterMatch = m.index + m[0].length
    let lookahead = afterMatch
    while (lookahead < code.length && /\s/.test(code[lookahead])) lookahead++
    if (code[lookahead] === '{' && m[0].startsWith('#')) continue

    const parsed = parser(m[1] ?? m[0])
    if (!parsed) continue

    if (transform) {
      matches.push({
        start: m.index,
        end: afterMatch,
        replacement: oklchToCss(parsed.l, parsed.c, parsed.h, parsed.alpha),
      })
    }
  }

  if (!transform) return code

  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, replacement } = matches[i]
    code = code.slice(0, start) + replacement + code.slice(end)
  }

  return code
}

/** Replace named colors with context check (value position only). */
function replaceNamedColors(
  code: string,
  stats: ScanResult,
  transform: boolean,
): string {
  const names = Array.from(
    new Set([
      'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige',
      'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown',
      'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral',
      'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
      'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
      'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred',
      'darksalmon', 'darkseagreen', 'darkslateblue', 'darkslategray',
      'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
      'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite',
      'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
      'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink',
      'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
      'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
      'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
      'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue',
      'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow',
      'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
      'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
      'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
      'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
      'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
      'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
      'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
      'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown',
      'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
      'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
      'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal',
      'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
      'whitesmoke', 'yellow', 'yellowgreen',
    ]),
  ).sort((a, b) => b.length - a.length)

  const re = new RegExp(`\\b(${names.join('|')})\\b`, 'gi')

  const matches: Array<{ start: number; end: number; replacement: string }> = []

  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (!isInValueContext(code, m.index)) continue

    const parsed = parseNamed(m[1])
    if (!parsed) continue

    stats.named_count++

    if (transform) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement: oklchToCss(parsed.l, parsed.c, parsed.h, parsed.alpha),
      })
    }
  }

  if (!transform) return code

  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, replacement } = matches[i]
    code = code.slice(0, start) + replacement + code.slice(end)
  }

  return code
}

/** Check if a position in CSS is inside a value context (after :, ,, or (). */
function isInValueContext(css: string, pos: number): boolean {
  for (let i = pos - 1; i >= 0; i--) {
    const ch = css[i]
    if (ch === ':' || ch === ',' || ch === '(') return true
    if (ch === ';' || ch === '{' || ch === '}') return false
  }
  return false
}
