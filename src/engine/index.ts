/**
 * Re-exports from the canonical WASM engine.
 * This file exists so existing import paths (`okcolor/core`) keep working.
 */
export { transformCss, auditCss } from '../wasm.js'
export type { ScanResult } from '../types.js'
