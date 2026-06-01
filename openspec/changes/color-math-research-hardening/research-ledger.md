# Color Math Research Ledger

> Change: `color-math-research-hardening`
> Last checked: 2026-06-01

This ledger separates standards, implementation oracles, papers, and advisory sources.
Do not promote a product claim unless it maps to at least one source and one executable
test fixture.

## Source register

| Source | Version/date checked | Classification | Use in okcolor | Link |
|--------|----------------------|----------------|----------------|------|
| CSS Color Module Level 4 | W3C Candidate Recommendation Draft, 2 May 2026 | Normative web color standard track | OKLab/OKLCH syntax, predefined RGB spaces, CSS gamut mapping direction | https://www.w3.org/TR/css-color-4/ |
| Media Queries Level 5 | W3C Working Draft, 19 February 2026 | Normative web standard track | `color-gamut: srgb | p3 | rec2020` behavior and display-capability wording | https://www.w3.org/TR/mediaqueries-5/ |
| Design Tokens Color Module 2025.10 | Final Community Group Report, 28 October 2025 | Stable community report, not W3C Recommendation | DTCG color token object shape, aliases, `colorSpace`, `components` | https://www.w3.org/community/reports/design-tokens/CG-FINAL-color-20251028/ |
| Oklab original article | Original 2020 article; matrices updated 2021-01-25 | Original derivation / engineering rationale | OKLab/OKLCH model rationale, D65 assumption, matrix lineage | https://bottosson.github.io/posts/oklab/ |
| WCAG 2.2 | W3C Recommendation, 12 December 2024 | Normative accessibility recommendation | Blocking WCAG contrast ratio gate | https://www.w3.org/TR/WCAG22/ |
| WCAG 3.0 draft | W3C Working Draft, 03 March 2026 | Draft/advisory only | Reason APCA must not be treated as final compliance | https://www.w3.org/TR/wcag-3.0/ |
| Color.js gamut mapping docs | Checked 2026-06-01 | Implementation oracle candidate | Test-only comparison for gamut mapping and CSS Color 4 behavior | https://colorjs.io/docs/gamut-mapping.html |
| ColorAide gamut mapping docs | Checked 2026-06-01 | Implementation oracle candidate | Test-only comparison for MINDE/chroma-reduction cases | https://facelessuser.github.io/coloraide/gamut/ |
| CIECAM16, CIE 248:2022 | CIE 248:2022, DOI 10.25039/TR.248.2022 | Color appearance reference | Future research track for viewing-condition-aware color, not v1 core | https://www.cie.co.at/publications/cie-2016-colour-appearance-model-colour-management-systems-ciecam16 |
| Safdar et al. JzAzBz / HDR-WCG | Optics Express 25(13), 2017, DOI 10.1364/OE.25.015131 | Peer-reviewed paper | Future research track for HDR/WCG perceptual uniformity, not v1 core | https://doi.org/10.1364/OE.25.015131 |
| Safdar et al. IS&T JzAzBz comparison | Color and Imaging Conference 2017, DOI 10.2352/ISSN.2169-2629.2017.25.264 | Peer-reviewed conference paper | Supporting future HDR/WCG research context | https://doi.org/10.2352/ISSN.2169-2629.2017.25.264 |

## Current product claims

| Claim | Status | Source mapping | Evidence required before release copy |
|-------|--------|----------------|---------------------------------------|
| "Converts legacy CSS colors to OKLCH" | Supported | CSS Color 4, Oklab article | Existing scanner/conversion tests plus CSS Color 4 syntax alignment. |
| "Creates controlled P3 enhancement" | Partially supported | CSS Color 4, Media Queries 5, Color.js/ColorAide as oracles | Needs oracle fixtures for gamut containment and chroma budget. |
| "Gamut-safe fit/expand" | Partially supported | CSS Color 4 gamut mapping, Color.js/ColorAide as oracles | Needs comparison fixtures and documented tolerances. |
| "WCAG contrast gate" | Supported for declared token pairs | WCAG 2.2 | Must remain ratio-based and pair-explicit. |
| "APCA support" | Advisory only | WCAG 3 draft status | Must never be marketed as compliance while WCAG 3 contrast algorithm is unresolved. |
| "Research-backed color science" | Not yet supported | Multiple sources | Requires every product claim to map to sources and passing oracle tests. |
| "HDR/Rec.2020/CAM16/JzAzBz support" | Not supported | CIECAM16, Safdar et al. | Future SDD proposal only. |

## Inclusion criteria for v1 math claims

- Source is a web standard, stable recommendation, original derivation, or peer-reviewed
  color-science source.
- Behavior has an executable test fixture.
- Tolerance is operation-specific and documented.
- Product copy distinguishes standards-backed behavior from product taste presets.

## Oracle tolerance policy

Executable fixtures MUST use operation-specific tolerances:

- **sRGB to OKLCH conversion:** lightness ±0.0005, chroma ±0.0005, hue ±0.05°.
- **Gamut boundary checks:** colors just inside the reported chroma ceiling use a
  0.0005 chroma inset; colors outside use a 0.003 chroma offset.
- **ColorAide raytrace fixed-L/fixed-h fit:** lightness ±0.0002, chroma ±0.00003,
  hue ±0.02°.
- **CSS Color 4 local MINDE gamut mapping:** tracked as a comparison policy, not an
  exact match requirement, because okcolor's current `fit` intentionally preserves
  OKLCH lightness and hue while reducing chroma.

## Exclusion criteria for v1 core

- Viewing-condition-dependent models without a product story for viewing conditions.
- HDR/WCG models without display pipeline tests.
- Algorithms only supported by a single blog/library without independent comparison.
- Any APCA statement implying final WCAG compliance.

## Open questions

1. What tolerance is acceptable for OKLCH roundtrip vs W3C sample code?
2. Should production `fit` track CSS Color 4 local MINDE exactly, or document okcolor's
   current chroma-max strategy as a separate policy?
3. Should report JSON expose oracle provenance after fixtures exist?
4. Should `rec2020` be blocked in types until the math and DX story are real?

## Release gate evidence

Checked 2026-06-01 on Windows (`G:\Antonio Bonet\okcolor`):

| Gate | Result | Notes |
|------|--------|-------|
| `npm test` | Passed | 154 Vitest tests, including TypeScript no-emit pretest. |
| `npm run test:e2e` | Passed | 14 packaged CLI/Vite/package-install/browser-export E2E tests. |
| `npm run lint` | Passed | ESLint over `src`. |
| `cargo test --manifest-path packages/core-wasm/Cargo.toml` | Passed | 150 Rust tests. |
| `cargo clippy --manifest-path packages/core-wasm/Cargo.toml -- -D warnings` | Passed | No warnings. |
| `npm run build:docs` | Passed | Astro/Starlight docs build. |
| `npm run bench:ci` | Passed | Regression gate passed; one throughput measurement was noisy but non-failing. |
| `git diff --check` | Passed | Only LF-to-CRLF working-copy warnings. |
| `npm pack --dry-run --json` | Passed | Packed size: 165,849 bytes; unpacked size: 467,103 bytes; 27 entries. |

Cross-platform install verification remains pending for Ubuntu and macOS. Windows package
install is covered by the packaged CLI E2E tarball consumer test.

