# Tasks: get-to-10-10

## Phase 1: CI/CD + Quality Gates

- [x] 1.1 Add `tsc --noEmit` to CI pipeline (ci.yml)
- [x] 1.2 Configure `NPM_TOKEN` secret and wire `npm publish` in release.yml
- [x] 1.3 Add benchmark tracking: `npm run bench` in CI, compare against baseline, fail on >10% regression
- [x] 1.4 Add `cargo clippy` to CI for Rust linting

## Phase 2: WASM Bundle Optimization

- [x] 2.1 Install binaryen natively (download `wasm-opt` binary for CI platform)
- [x] 2.2 Run `wasm-opt -O4 -Oz` on `okcolor_core_bg.wasm`, measure size
- [x] 2.3 Profile wasm-bindgen exports for code duplication, add `#[inline(never)]` where beneficial
- [x] 2.4 Verify bundle < 100 KB after optimization

## Phase 3: Performance Profiling

- [x] 3.1 Profile `scan.rs` hot path with `cargo bench` or `perf`, identify bottlenecks
- [x] 3.2 Benchmark `aho-corasick` vs raw `match` for named color detection
- [x] 3.3 Optimize scanner hot path based on profiling data
- [ ] 3.4 Target: 1,000+ ops/s in `npm run bench` transform metric

## Phase 4: Architecture Polish

- [x] 4.1 Add `#[cfg(not(target_arch = "wasm32"))]` to cache.rs for `RwLock` (native) / `Mutex` (wasm) conditional
- [ ] 4.2 Move named color bypass (`# ` prefix hack) from JS `wasm.ts` into Rust scan pre-filter
- [ ] 4.3 Split `scan.rs` into module: `scanner/tokenize.rs`, `scanner/replace.rs`, `scanner/audit.rs`
- [x] 4.4 Replace `Promise.all` in `processFiles` (cli.ts) with `Promise.allSettled` for resilience

## Phase 5: Testing Hardening

- [x] 5.1 Add `tsc --noEmit` as npm test script dependency
- [x] 5.2 Expand CLI tests: stdout assertions, exit codes for check/audit/doctor/convert
- [ ] 5.3 Add property-based roundtrip tests with `proptest` (Rust) — generate random colors, verify < 1e-4 error
- [x] 5.4 Add `processFiles` error resilience test (corrupted file doesn't crash scan)

## Phase 6: Package Polish

- [ ] 6.1 Verify `npm install okcolor` on Linux, Mac, Windows (CI matrix)
- [ ] 6.2 Audit `exports` map for dual ESM/CJS coverage
- [ ] 6.3 Final `npm pack --dry-run` — confirm < 50 KB gzip
