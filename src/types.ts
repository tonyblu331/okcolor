/** Options for the okColor Vite plugin. */
export interface OkColorOptions {
  /** Inline comment that prevents conversion on the current line. */
  ignoreComment?: string
  /** Optional token JSON input. When present, okcolor runs token compiler mode. */
  input?: string
  /** Optional CSS output path for token compiler mode. */
  output?: string
  /** Optional JSON report output path for token compiler mode. */
  reportPath?: string
  /** Output targets for token compiler mode. */
  targets?: Record<
    string,
    {
      gamut?: 'srgb' | 'p3'
      strategy?: 'convert' | 'expand' | 'grade' | 'fit'
      amount?: number
      format?: 'hex' | 'oklch'
    }
  >
  /** Named recipe overrides for token compiler mode. */
  recipes?: Record<
    string,
    {
      gamut?: 'srgb' | 'p3'
      strategy?: 'convert' | 'expand' | 'grade' | 'fit'
      intent?: 'literal' | 'vivid' | 'deeper' | 'premium' | 'muted' | 'softer' | 'warmer' | 'cooler'
      recipe?: 'literal' | 'vivid' | 'deeper' | 'premium' | 'muted' | 'softer' | 'warmer' | 'cooler'
      amount?: number
      format?: 'hex' | 'oklch'
      lightness?: number
    }
  >
  /** Audit options for token compiler reports. */
  audit?: {
    failOn?: Array<'invalid-css' | 'out-of-gamut' | 'wcag2-regression'>
    wcag2?: {
      /** Override token WCAG level for build-time contrast gates. */
      level?: 'aa' | 'aaa'
      /** Override the required WCAG 2 contrast ratio directly. */
      requiredRatio?: number
    }
  }
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
