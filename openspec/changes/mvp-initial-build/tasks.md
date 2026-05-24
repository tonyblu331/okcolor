# Tasks: MVP Initial Build

## Phase 1: Infrastructure & Tooling

- [ ] 1.1 Create `packages/core-wasm/Cargo.toml` with `wasm-bindgen` dependency
- [ ] 1.2 Create root `package.json` with exports, bin, and dev dependencies
- [ ] 1.3 Create `tsconfig.json` with ESM + strict mode
- [ ] 1.4 Create `tsdown.config.ts` for dual ESM/CJS output
- [ ] 1.5 Install `wasm-pack` and verify `cargo` toolchain
- [ ] 1.6 Set up `vitest` and `cargo test` runners

## Phase 2: Rust Core Engine

- [ ] 2.1 Implement `named.rs` — CSS named color → sRGB lookup table (148 entries)
- [ ] 2.2 Implement `token.rs` — Token enum (Hex, Rgb, Hsl, Named, Skip)
- [ ] 2.3 Implement `lexer.rs` — DFA byte scanner with O(N) walk
- [ ] 2.4 Implement `color.rs` — sRGB → OKLab → OKLCH conversion math
- [ ] 2.5 Implement `interner.rs` — String interner with `u32` ColorID and flat Vec cache
- [ ] 2.6 Implement `lib.rs` — WASM exports `transform_css()` and `audit_css()`
- [ ] 2.7 Add `cargo test` suite for lexer, color math, interner
- [ ] 2.8 Build WASM artifact with `wasm-pack build --target bundler`

## Phase 3: TypeScript Bridge & Plugin

- [ ] 3.1 Create `src/types.ts` — Shared interfaces and options types
- [ ] 3.2 Create `src/wasm.ts` — WASM module loader with singleton instance
- [ ] 3.3 Create `src/vite.ts` — Vite plugin with `pre` hook and CSS transform
- [ ] 3.4 Create `src/index.ts` — Public API exports
- [ ] 3.5 Write vitest tests for plugin hook behavior
- [ ] 3.6 Verify HMR latency < 15ms with benchmark fixture

## Phase 4: CLI Implementation

- [ ] 4.1 Create `src/cli.ts` — CLI entry with `commander` or native `process.argv`
- [ ] 4.2 Implement `audit` command — scan directory, count formats, print breakdown
- [ ] 4.3 Implement `check` command — threshold validation with exit codes
- [ ] 4.4 Add `--format=json` flag to both commands
- [ ] 4.5 Add `--max-legacy-colors` and `--allow-named` flags to `check`
- [ ] 4.6 Write vitest tests for CLI argument parsing and output formatting

## Phase 5: Integration & Verification

- [ ] 5.1 End-to-end test: Vite build with sample CSS → verify OKLCH output
- [ ] 5.2 End-to-end test: `audit` on fixture project → verify report accuracy
- [ ] 5.3 End-to-end test: `check` with threshold → verify pass/fail exit codes
- [ ] 5.4 Verify `/* oklch-ignore */` preserves original color
- [ ] 5.5 Verify `var()`, `calc()`, `env()`, `currentColor` pass through unmodified
- [ ] 5.6 Build distributable package and verify `exports` / `bin` resolution
