# Color Engine Spec Delta — `color-math-research-hardening`

## ADDED Requirements

### Requirement: Research-backed color claims

okcolor MUST NOT describe a color transform as research-backed unless the claim is
mapped to a source in `research-ledger.md` and covered by at least one executable fixture.

#### Scenario: Claim has no fixture

**Given** a product claim about gamut-safe color transformation
**When** no oracle fixture verifies the behavior
**Then** the claim MUST remain internal or be labeled experimental

### Requirement: OKLCH v1 scope

okcolor SHALL treat OKLCH/OKLab as the v1 operational color model for SDR web colors.
CAM16, JzAzBz, Rec.2020, and HDR behavior SHALL remain research-track unless a later
OpenSpec change promotes them with fixtures and DX design.

#### Scenario: User requests Rec.2020 output

**Given** the current v1 product scope
**When** a caller requests Rec.2020 output
**Then** okcolor MUST reject or ignore it explicitly rather than silently pretending it is supported

### Requirement: Oracle-backed gamut operations

The `fit`, `expand`, `findChromaMax`, and `inGamut` math SHOULD be validated against
test-only reference oracles before any production algorithm change.

#### Scenario: Oracle mismatch is found

**Given** a W3C/Color.js/ColorAide fixture disagrees with okcolor
**When** the mismatch exceeds the documented tolerance
**Then** the test MUST fail or be tracked as an explicit known mismatch with source citation

### Requirement: APCA advisory status

APCA output MUST remain advisory metadata. WCAG 2.2 contrast ratio SHALL be the default
blocking compliance gate.

#### Scenario: APCA passes but WCAG 2.2 fails

**Given** a declared contrast pair
**And** APCA advisory status is pass-like
**But** WCAG 2.2 ratio is below the configured threshold
**When** token audit runs
**Then** the pair MUST be reported as a blocking contrast failure

### Requirement: Contrast lock semantics

`contrastLock` SHALL be treated as an explicit invariant for declared token contrast
pairs. It SHALL NOT silently mutate token colors to repair contrast unless a later
proposal defines a repair strategy, report contract, and visual-delta policy.

#### Scenario: P3 transform breaks a declared pair

**Given** a background token declares a foreground token
**And** the fallback target passes WCAG 2 AA
**But** the P3 target falls below the required WCAG 2 AA ratio
**When** token audit runs with `wcag2-regression` enabled
**Then** the P3 pair MUST be reported as a blocking failure

#### Scenario: Declared foreground token is missing

**Given** a background token declares a foreground token that cannot be compiled
**When** token audit runs
**Then** `report.contrastPairs` MUST contain a skipped pair entry
**And** the skipped reason MUST distinguish missing foreground, missing background, or missing target
**And** the pair MUST NOT be counted as a WCAG pass

### Requirement: Token compiler architecture

The token compiler SHOULD be deepened into modules for parsing/diagnostics, recipe policy,
CSS emission, report building, and color math ports. File IO, CLI, and Vite integration
SHOULD remain adapters.

#### Scenario: Unsupported token shape

**Given** a token that cannot be parsed as a supported color
**When** token compile runs
**Then** okcolor SHOULD emit a structured diagnostic instead of silently dropping the token

### Requirement: Versioned compile report contract

The token compiler report MUST expose a top-level numeric `schemaVersion` so frontend
CI integrations can pin the report contract before reading nested diagnostics, contrast
pairs, target data, or failure summaries.

#### Scenario: Token compile report is consumed by CI

**Given** token compile emits JSON through the CLI, Vite `reportPath`, or public API
**When** a consumer reads the report
**Then** `report.schemaVersion` MUST be present
**And** the current v1 report shape MUST use `schemaVersion: 1`

### Requirement: Browser runtime adapter

okcolor SHOULD expose a dedicated browser entry point for live frontend tools that need
runtime color conversion. The browser entry point MUST NOT import Node-only modules and
MUST require explicit WASM initialization before synchronous conversion helpers are used.

#### Scenario: Vite app bundles browser adapter

**Given** a frontend app imports from `okcolor/browser`
**When** the app is built with Vite
**Then** the browser adapter MUST bundle without Node polyfills
**And** the WASM asset MUST be emitted for the browser runtime

## MODIFIED Requirements

### Requirement: Canonical color-engine spec truth

The canonical spec MUST reflect current repository evidence. Performance or bundle-size
claims MUST cite measured artifacts such as `bench/baseline.json`, `npm pack --dry-run`,
or WASM build logs.
