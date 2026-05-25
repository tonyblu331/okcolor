import type { Plugin } from 'vite'
import { transformCss } from './wasm.js'
import type { OkColorOptions } from './types.js'

const CSS_RE = /\.(css|scss|sass|less|styl|stylus)$/i
const STYLE_RE = /\.(vue|svelte|astro)$/i

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function okColor(options?: OkColorOptions): Plugin {
  const name = 'okcolor'
  const cache = new Map<string, { hash: number; output: string | undefined }>()
  const ignoreComment = options?.ignoreComment

  return {
    name,
    enforce: 'pre',

    async transform(code, id) {
      if (!CSS_RE.test(id) && !STYLE_RE.test(id)) return undefined

      const hash = fnv1a(code)
      const cached = cache.get(id)
      if (cached && cached.hash === hash) return cached.output

      let output: string | undefined

      if (CSS_RE.test(id)) {
        try {
          const transformed = transformCss(code, ignoreComment)
          output = transformed === code ? undefined : transformed
        } catch (e) {
          console.warn(`[okcolor] transform failed for ${id}:`, e instanceof Error ? e.message : e)
          output = undefined
        }
      } else {
        const transformed = transformEmbeddedStyles(code, ignoreComment)
        output = transformed === code ? undefined : transformed
      }

      cache.set(id, { hash, output })
      return output
    },
  }
}

function transformEmbeddedStyles(source: string, ignoreComment?: string): string {
  const styleRe = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi
  return source.replace(styleRe, (_match, open, css, close) => {
    try {
      const transformed = transformCss(css, ignoreComment)
      return open + transformed + close
    } catch (e) {
      return _match
    }
  })
}
