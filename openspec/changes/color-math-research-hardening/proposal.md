---
id: color-math-research-hardening
title: "Color math research hardening and token architecture deepening"
status: proposal
created: 2026-06-01
---

# Color Math Research Hardening and Token Architecture Deepening

## Intent

okcolor already has a strong Rust/WASM scanner and a useful token compiler, but the
product layer is not yet rigorous enough to claim research-backed color math or
Clean/Hexagonal/DDD architecture.

This change establishes the missing SDD foundation before more product features:

1. Freeze the standards and paper evidence behind the v1 color model.
2. Add oracle-driven math tests before changing transform behavior.
3. Deepen the token compiler into domain modules, application use cases, ports, and
   adapters.
4. Make DX contracts explicit: token diagnostics, reports, Vite output, CLI JSON, and
   failure modes.

## Problem

The current implementation is operational, but several claims are under-proven:

- The canonical color-engine spec is stale against current CLI/API and package evidence.
- `src/token/compiler.ts` mixes too many responsibilities behind one shallow interface.
- `grade` recipes are product taste heuristics, not color-science proof.
- APCA output exists, but WCAG 3 has not finalized its contrast algorithm, so APCA cannot
  be a compliance gate.
- CAM16/JzAzBz/HDR are relevant research directions but would be premature as v1 core
  implementation.

## Scope

### In scope

- Research ledger with source status: standard, implementation oracle, paper, or advisory.
- Oracle fixture plan for OKLCH conversion, gamut checks, chroma max, fit, expand, and
  contrast.
- Token compiler architecture plan using domain/application/port/adapter seams.
- DX contract for malformed tokens, skipped tokens, report output, Vite `reportPath`, CLI
  JSON, and deterministic failure modes.
- Canonical spec truth audit.

### Out of scope

- Implementing CAM16, JzAzBz, Rec.2020, HDR, or viewing-condition-aware appearance models.
- Changing scanner hot paths.
- Changing public CLI behavior before oracle tests exist.
- Adding a runtime dependency on Color.js/ColorAide for production math.

## Affected packages

- `src/token/*` — token parsing, transforms, contrast, reports, and compile orchestration.
- `src/vite.ts`, `src/types.ts` — Vite token compiler DX.
- `src/cli.ts` — JSON/report/error contract.
- `packages/core-wasm/src/gamut.rs`, `packages/core-wasm/src/math.rs` — math oracle test targets.
- `openspec/specs/color-engine/spec.md` — truth-audited canonical spec.

## Performance impact

Planning and oracle fixtures should not affect runtime performance. Any later production
math changes MUST run:

```bash
npm test
npm run lint
npm run test:e2e
cargo test --manifest-path packages/core-wasm/Cargo.toml
cargo clippy --manifest-path packages/core-wasm/Cargo.toml -- -D warnings
npm run bench:ci
```

## Rollback plan

This proposal is documentation and test planning first. If later oracle tests expose a
math mismatch, rollback means:

1. Keep public transforms unchanged.
2. Mark the mismatch in `research-ledger.md`.
3. Add a failing/ignored fixture with source citation.
4. Only change production math after a separate implementation change passes the fixture.

## Release candidacy impact

- Beta remains viable once reports/diagnostics are explicit.
- 1.0 should not claim "research-backed" until oracle fixtures pass.
- CAM16/JzAzBz/HDR should remain future/research labels, not v1 promises.
