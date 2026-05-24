import type { Plugin } from 'vite'

/** Options for the ok-actually Vite plugin. */
export interface OkActuallyOptions {
  /** Inline comment that prevents conversion on the current line. */
  ignoreComment?: string
}

/** Color audit statistics for a single file or project. */
export interface AuditStats {
  legacy_count: number
  hex_count: number
  rgb_count: number
  hsl_count: number
  hwb_count: number
  named_count: number
  gradient_count: number
  unique_count: number
}

/** Public API shape. */
export interface OkActuallyApi {
  /** Create a Vite plugin instance. */
  vite: (options?: OkActuallyOptions) => Plugin
  /** Transform CSS string (uses fresh interner). */
  transform: (css: string) => string
  /** Audit CSS string and return statistics. */
  audit: (css: string) => AuditStats
}
