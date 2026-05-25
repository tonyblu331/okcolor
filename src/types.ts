import type { Plugin } from 'vite'

/** Options for the okColor Vite plugin. */
export interface OkColorOptions {
  /** Inline comment that prevents conversion on the current line. */
  ignoreComment?: string
}

/** Colour usage statistics returned by auditCss. */
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
