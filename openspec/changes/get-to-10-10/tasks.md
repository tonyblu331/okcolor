# Tasks: get-to-10-10

> Truth audit: 2026-06-01. Checked against the current repo, `npm pack --dry-run`,
> built WASM artifacts, and `.github/workflows/ci.yml`. Do not mark performance or
> size targets complete unless the checked evidence below proves the exact target.

## Phase 1: CI/CD + Quality Gates

- [x] 1.1 Add `tsc --noEmit` to CI pipeline (ci.yml)
- [x] 1.2 Wire `npm publish` in release.yml using `NPM_TOKEN` (actual secret presence is external to the repo)
- [x] 1.3 Add benchmark tracking: `npm run bench` in CI, compare against baseline, fail on regression
  - Current evidence: CI runs `npm run bench:ci`, which benchmarks scanner-critical files, writes `.tmp/bench-results.json`, and compares transform, audit, ignore, gradient, idempotency, throughput, and plugin-overhead metrics against `bench/baseline.json` via `scripts/check-bench-regression.mjs`. Stable readings fail on >10% slowdown; high-RME readings are reported as noisy instead of pretending the measurement is exact.
- [x] 1.4 Add `cargo clippy` to CI for Rust linting

## Phase 2: WASM Bundle Optimization

- [x] 2.1 Wire Binaryen `wasm-opt` through the npm `binaryen` package used by `scripts/optimize-wasm.mjs`
- [x] 2.2 Run `wasm-opt -O4 -Oz` on `okcolor_core_bg.wasm`, measure size
- [ ] 2.3 Profile wasm-bindgen exports for code duplication, add `#[inline(never)]` where beneficial
  - Current evidence: no `#[inline(never)]` annotations are present in `packages/core-wasm/src/*.rs`; leave unchecked until profiling evidence or code changes are repo-visible.
- [ ] 2.4 Verify bundle < 100 KB after optimization
  - Current evidence: latest `npm run test:e2e` build reported `wasm-opt: 242 KB → 221 KB`, so this target is not met.

## Phase 3: Performance Profiling

- [ ] 3.1 Profile `scan.rs` hot path with `cargo bench` or `perf`, identify bottlenecks
  - Current evidence: the repo has Vitest benchmark suites, but no repo-visible `cargo bench`/`perf` artifact for this task.
- [x] 3.2 Benchmark `aho-corasick` vs raw `match` for named color detection
- [x] 3.3 Optimize scanner hot path based on profiling data
- [ ] 3.4 Target: 1,000+ ops/s in `npm run bench` transform metric
  - Current evidence: some 50 KB format-specific transforms exceed 1,000 ops/s, but mixed 50 KB and 100 KB whole-file transforms do not. This needs a precise workload definition or more optimization.

## Phase 4: Architecture Polish

- [x] 4.1 Add `#[cfg(not(target_arch = "wasm32"))]` to cache.rs for `RwLock` (native) / `Mutex` (wasm) conditional
- [x] 4.2 Verify JS named-color bypass is gone and named colors are handled by the Rust scanner
  - Current evidence: `src/wasm.ts` has no named-color prefix hack; `packages/core-wasm/src/scan.rs` builds `SCAN_AHO` from `named::NAMED_PAIRS`.
- [x] 4.3 Split `scan.rs` into modules
  - Current evidence: `packages/core-wasm/src/scan.rs` is now the parent/public entrypoint plus tests; scanner implementation is split into `scan/engine.rs`, `scan/token.rs`, `scan/gradient.rs`, `scan/replace.rs`, `scan/sink.rs`, `scan/ignore.rs`, and `scan/state.rs`. Audit behavior is represented by the `AuditSink` adapter in `scan/sink.rs` rather than a separate pass-through `audit.rs`.
- [x] 4.4 Replace `Promise.all` in `processFiles` (cli.ts) with `Promise.allSettled` for resilience
- [x] 4.5 Consolidate transform/audit legacy scan flow into one behavior-preserving scanner engine
  - Current evidence: `scan_transform_impl` and `scan_audit_impl` now use a shared generic `scan_impl` with `TransformSink`/`AuditSink`, preserving public DX while avoiding runtime mode dispatch in the scanner hot path.

## Phase 5: Testing Hardening

- [x] 5.1 Add `tsc --noEmit` as npm test script dependency
- [x] 5.2 Expand CLI tests: stdout assertions, exit codes for check/audit/scope/convert
- [x] 5.3 Add property-based u8 sRGB roundtrip tests with `proptest` (Rust) — generate random RGB triples, verify OKLCH roundtrip < 1e-4 error per channel
- [x] 5.4 Add `processFiles` error resilience test (corrupted file doesn't crash scan)
  - Current scanner evidence: Rust scanner characterization tests cover `@supports`, `@supports selector()`, `@container style()`, and `@property` color/non-color syntax contexts across transform and audit counts.

## Phase 6: Package Polish

- [ ] 6.1 Verify `npm install okcolor` on Linux, Mac, Windows (CI matrix)
  - Current evidence: CI test matrix covers Ubuntu and Windows, not macOS. Tarball E2E verifies install/import in a temp consumer project.
- [x] 6.2 Audit `exports` map
  - Current evidence: package is ESM-only (`type: module`) with `import` and `types` exports for `.` and `./core`; there is no CJS `require` export.
- [x] 6.3 Final `npm pack --dry-run` — document current package size
  - Current evidence: `npm pack --dry-run` reports 150.5 kB package size, 401.4 kB unpacked size, 21 files. The old `< 50 KB gzip` target is not true for the current WASM package shape.
