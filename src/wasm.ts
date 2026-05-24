/**
 * Canonical okcolor engine — Rust/WASM.
 *
 * Uses top-level `await` in ESM: the module graph blocks until the WASM
 * binary is compiled and cached.  Consumers import `transformCss` /
 * `auditCss` synchronously — no `ensureWasm()` ceremony needed.
 *
 * The generated wasm-bindgen glue is dynamically imported at runtime so
 * tsdown does **not** bundle it.  The `.wasm` binary is loaded via
 * `initSync` for sub-millisecond startup in Node.js.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScanResult } from './types.js'

// ── Resolve the WASM package directory ──────────────────────────────────

function findPkgDir(): string {
  // Dev: relative from source file
  try {
    const d = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core-wasm/pkg')
    readFileSync(resolve(d, 'okcolor_core_bg.wasm'))
    return d
  } catch { /* fall through */ }
  // Vitest dev: from CWD
  const d = resolve(process.cwd(), 'packages/core-wasm/pkg')
  readFileSync(resolve(d, 'okcolor_core_bg.wasm'))
  return d
}

const PKG_DIR = findPkgDir()

// ── Eager synchronous WASM init ─────────────────────────────────────────

const glue = await import(resolve(PKG_DIR, 'okcolor_core.js'))
const wasmBytes = readFileSync(resolve(PKG_DIR, 'okcolor_core_bg.wasm')).buffer
;(glue.initSync as (opts: { module: BufferSource }) => void)({ module: wasmBytes })

const transformCssFn   = glue.transform_css   as (s: string) => string
const auditCssFn       = glue.audit_css       as (s: string) => string
const colorToOklchFn   = glue.color_to_oklch   as (s: string) => string | null

// ── Public API (synchronous) ────────────────────────────────────────────

/** Transform a CSS string — replace all legacy colours with OKLCH. */
export function transformCss(input: string): string {
  return transformCssFn(input)
}

/** Audit a CSS string — return colour usage statistics. */
export function auditCss(input: string): ScanResult {
  const p = JSON.parse(auditCssFn(input)) as Record<string, number>
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
