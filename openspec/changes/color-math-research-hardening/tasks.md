---
id: color-math-research-hardening/tasks
title: "Color math research hardening — task breakdown"
parent: color-math-research-hardening
status: draft
created: 2026-06-01
---

# Color Math Research Hardening — Tasks

## Phase 0: SDD baseline

- [x] 0.1 Create proposal, design, tasks, research ledger, and delta spec.
- [x] 0.2 Add project domain vocabulary in `CONTEXT.md`.
- [x] 0.3 Truth-audit the canonical color-engine spec so it no longer advertises stale CLI/API/size claims.

## Phase 1: Research ledger and source freeze

- [x] 1.1 Record exact source versions/dates for CSS Color 4, Media Queries 5, DTCG Color Module, WCAG 2.2, WCAG 3, Oklab, CIECAM16, and JzAzBz.
- [x] 1.2 Classify each source as `normative`, `implementation-oracle`, `paper`, or `advisory`.
- [x] 1.3 Add inclusion/exclusion criteria for v1 math claims.
- [x] 1.4 Add a "claim ledger" mapping product claims to source evidence.

## Phase 2: Oracle fixtures

- [x] 2.1 Add W3C/CSS sample conversion fixtures for sRGB→OKLab/OKLCH plus Display P3 gamut cases.
- [x] 2.2 Add Color.js test-only oracle script for gamut checks and CSS gamut mapping samples.
- [x] 2.3 Add ColorAide test-only oracle script for MINDE/chroma-reduction comparison cases.
- [x] 2.4 Add Rust/WASM parity tests for `oklch_chroma_max`, `oklch_in_gamut`, `fit_oklch_gamut`, and `expand_oklch_chroma`.
- [x] 2.5 Document tolerances per operation. Do not use one global tolerance.

## Phase 3: Token architecture deepening

- [x] 3.1 Extract token parsing into a deep module returning parsed colors plus diagnostics.
- [x] 3.2 Extract recipe policy into a module owning aliases, built-ins, validation, and defaults.
- [x] 3.3 Extract CSS emission into a `CssEmitter` module.
- [x] 3.4 Extract compile report assembly into a report builder.
- [x] 3.5 Introduce a `ColorMathPort` seam with production WASM adapter and test oracle adapters.
- [x] 3.6 Keep public exports stable while moving internals.

## Phase 4: DX contract

- [x] 4.1 Add structured diagnostics for malformed/skipped tokens.
- [x] 4.2 Add Vite token compiler `reportPath` support and type coverage.
- [x] 4.3 Snapshot CLI JSON schemas for `audit`, `expand`, `grade`, `fit`, and token compile output.
- [x] 4.4 Ensure stdout remains data-only and stderr remains human diagnostics.
- [x] 4.5 Document failure modes for unknown recipe, unsupported color space, malformed token, contrast regression, and out-of-gamut output.

## Phase 5: Contrast lock and policy

- [x] 5.1 Design `contrastLock` semantics before implementation.
- [x] 5.2 Add tests proving WCAG 2.2 is the blocking gate.
- [x] 5.3 Keep APCA in advisory report fields only.
- [x] 5.4 Add pair-level report output for skipped/missing contrast pairs.

## Phase 6: Release gates

- [x] 6.1 Run full TS/Rust/e2e/lint gates after each implementation slice.
- [x] 6.2 Run `npm run bench:ci` after any math or scanner-adjacent change.
- [ ] 6.3 Verify package install on Ubuntu, Windows, and macOS before 1.0.
- [x] 6.4 Run `npm pack --dry-run` and record package/unpacked sizes.
- [x] 6.5 Update docs only after the report/diagnostic contracts are executable.

## Phase 7: Frontend-first package polish

- [x] 7.1 Reframe README/package description around Vite-first frontend DX.
- [x] 7.2 Remove stale CLI transform examples from README, docs pages, and terminal demos.
- [x] 7.3 Add a browser/WASM playground page for color conversion, P3 expansion, and contrast feedback.
- [x] 7.4 Add framework recipes for Astro, SvelteKit, Nuxt, Remix Vite, SolidStart, Qwik, and plain Vite.
- [x] 7.5 Add report `schemaVersion` before 1.0 so frontend CI integrations can pin contracts.
- [x] 7.6 Decide whether a future `okcolor/browser` export is needed after the playground proves the browser usage shape.
- [x] 7.7 Keep frontend-first usage build-time by default: expose WCAG policy overrides through Vite/CLI, document `okcolor/browser` as runtime-tool-only, and verify root/core entrypoints stay isolated from the browser adapter.
