# Proposal: MVP Initial Build

## Intent

Deliver the foundational `ok-actually` package that can intercept legacy CSS color formats at build-time and upgrade them to OKLCH. The MVP must demonstrate the core WASM engine, Vite plugin integration, and CLI audit capability.

## Scope

### In Scope
- Rust WASM core with DFA lexer for hex, rgb, hsl, named colors
- String interner with O(1) direct-mapped cache
- sRGB → OKLCH color conversion engine
- Vite plugin (`pre` hook) with WASM bridge
- CLI commands: `audit`, `check`
- `/* oklch-ignore */` escape hatch
- Safety bails for `var()`, `calc()`, `env()`, `currentColor`

### Out of Scope
- `doctor` CLI command (deferred to v1.1)
- Automatic gradient `in oklch` injection (deferred to v1.1)
- Radial/conic gradient support (deferred)
- Canary release automation (deferred)

## Approach

Build the Rust core first (lexer + color math + interner), compile to WASM with `wasm-pack`, then build the TypeScript wrapper (Vite plugin + CLI). Use a monorepo-like structure within a single npm package: Rust code in `packages/core-wasm/`, TypeScript in `src/`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/core-wasm/` | New | Rust WASM engine: lexer, color math, interner |
| `src/plugin.ts` | New | Vite plugin entry point |
| `src/cli.ts` | New | CLI entry with audit/check commands |
| `src/index.ts` | New | Public API exports |
| `package.json` | New | Package manifest with exports and bin |
| `tsconfig.json` | New | TypeScript configuration |
| `vite.config.ts` | New | Build config for plugin distribution |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| WASM bundle size exceeds budget | Med | Use `wasm-pack` with `--target web`, enable LTO, strip debug symbols |
| OKLCH precision differs from browser | Med | Round-trip test against CSS Color Module Level 4 reference values |
| DFA lexer misses edge-case syntax | Low | Extensive test corpus from W3C CSS Color test suite |
| Vite `pre` hook ordering issues | Low | Test against Vite 8 + Tailwind v4 starter template |

## Rollback Plan

If the WASM engine fails performance targets, swap the Rust core for a JavaScript implementation using `culori` as a fallback. The TypeScript interface (`src/plugin.ts`, `src/cli.ts`) remains unchanged.

## Dependencies

- `wasm-pack` (dev dependency for Rust → WASM builds)
- `tsdown` (for package bundling)
- `vitest` (for TypeScript tests)
- Vite 8 peer dependency

## Success Criteria

- [ ] `#ff0000` → `oklch(62.8% 0.2577 29.23)` with < 1ms per file in dev mode
- [ ] `audit` command prints color debt breakdown for a test project
- [ ] `check` command exits non-zero when legacy colors exceed threshold
- [ ] `/* oklch-ignore */` preserves original color string
- [ ] `var()` expressions pass through unmodified
