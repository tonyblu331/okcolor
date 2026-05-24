import type { Plugin } from 'vite'
import { transformCss } from './engine/index.js'
import type { OkActuallyOptions } from './types.js'

const CSS_RE = /\.(css|scss|sass|less|styl|stylus)$/i
const STYLE_RE = /\.(vue|svelte|astro)$/i

/**
 * Create a Vite plugin that transforms legacy CSS colors to OKLCH
 * during the `pre` build phase.
 */
export function okActually(_options?: OkActuallyOptions): Plugin {
  const name = 'ok-actually'

  return {
    name,
    enforce: 'pre',

    async transform(code, id) {
      // Plain CSS files
      if (CSS_RE.test(id)) {
        const transformed = transformCss(code)
        return transformed === code ? undefined : transformed
      }

      // Embedded styles in Vue/Svelte/Astro
      if (STYLE_RE.test(id)) {
        const transformed = transformEmbeddedStyles(code)
        return transformed === code ? undefined : transformed
      }

      return undefined
    },
  }
}

/**
 * Extract and transform `<style>` blocks from framework files.
 * This is a lightweight regex-based approach for the MVP.
 */
function transformEmbeddedStyles(source: string): string {
  const styleRe = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi
  return source.replace(styleRe, (_match, open, css, close) => {
    const transformed = transformCss(css)
    return open + transformed + close
  })
}
