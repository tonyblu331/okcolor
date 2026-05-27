import type { Plugin } from 'vite'
import { transformCss } from './wasm.js'
import { writeCompileResult } from './token-engine.js'
import type { OkColorOptions } from './types.js'

const CSS_RE = /\.(css|scss|sass|less|styl|stylus)$/i
const STYLE_RE = /\.(vue|svelte|astro)$/i
const STYLE_BLOCK_RE = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi
const STYLE_QUERY_RE = /(?:^|[?&#])type=style(?:$|[&#])/i

function cleanUrl(id: string): string {
  return id.split(/[?#]/, 1)[0] ?? id
}

function isViteVirtualStyle(id: string, file: string): boolean {
  if (!STYLE_RE.test(file)) return false
  const query = id.slice(file.length)
  return STYLE_QUERY_RE.test(query)
}

function isQueriedId(id: string, file: string): boolean {
  return id.length > file.length
}

function warnTransformFailed(id: string, error: unknown): void {
  console.warn(`[okcolor] transform failed for ${id}:`, error instanceof Error ? error.message : error)
}

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

    async buildStart() {
      if (!options?.input || !options.output) return
      await writeCompileResult(options.input, {
        output: options.output,
        targets: options.targets,
        recipes: options.recipes,
        audit: options.audit,
      })
    },

    async transform(code, id) {
      const file = cleanUrl(id)
      const isCss = CSS_RE.test(file) || isViteVirtualStyle(id, file)
      const isStyle = STYLE_RE.test(file) && !isQueriedId(id, file)
      if (!isCss && !isStyle) return undefined

      const hash = fnv1a(code)
      const cached = cache.get(id)
      if (cached && cached.hash === hash) return cached.output

      let output: string | undefined

      if (isCss) {
        try {
          const transformed = transformCss(code, ignoreComment)
          output = transformed === code ? undefined : transformed
        } catch (e) {
          warnTransformFailed(id, e)
          output = undefined
        }
      } else {
        const transformed = transformEmbeddedStyles(code, id, ignoreComment)
        output = transformed === code ? undefined : transformed
      }

      cache.set(id, { hash, output })
      return output
    },
  }
}

function transformEmbeddedStyles(source: string, id: string, ignoreComment?: string): string {
  return source.replace(STYLE_BLOCK_RE, (_match, open, css, close) => {
    try {
      const transformed = transformCss(css, ignoreComment)
      return open + transformed + close
    } catch (e) {
      warnTransformFailed(id, e)
      return _match
    }
  })
}
