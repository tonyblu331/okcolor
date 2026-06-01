---
id: converter-gamut-visualization/research-ledger
title: "Converter gamut visualization — research ledger"
parent: converter-gamut-visualization
status: draft
created: 2026-06-01
---

# Converter Gamut Visualization — Research Ledger

## Included sources

### Evil Martians OKLCH Color Picker

- **URL:** https://oklch.com/
- **Repo:** https://github.com/evilmartians/oklch-picker
- **Screenshot:** `G:/Antonio Bonet/okcolor/.tmp-review/oklch-research/evilmartians-oklch-picker-product.png`
- **Source status:** implementation reference.
- **Learned:** The UI is graph-first. It shows P3/fallback swatches, numeric OKLCH/RGB
  values, and separate graph cards for lightness/chroma/hue. It has toggles for graph
  display and wider gamut overlays.
- **Implementation lesson:** The repo uses `three`, `Delaunator`, vertex colors, and RGB
  gamut-edge samples for a 3D model. Serious 3D gamut views are generated from boundary
  samples, not hand-drawn decorative volume rings.

### Eero Lehtinen OKLCH Color Picker

- **URL:** https://github.com/eero-lehtinen/oklch-color-picker
- **Source status:** implementation reference.
- **Learned:** The picker uses Rust/WebGL shaders. The picker fragment shader maps 2D
  coordinates directly to OKLCH axes:
  - one shader maps lightness × chroma at fixed hue,
  - another maps hue × chroma at fixed lightness.
- **Implementation lesson:** The shader masks out-of-gamut samples with alpha and uses
  rotated-grid supersampling plus dithering. That is why it reads clean instead of
  pixelated.

### Björn Ottosson — Gamut clipping

- **URL:** https://bottosson.github.io/posts/gamutclipping/
- **Screenshots:**
  - `G:/Antonio Bonet/okcolor/.tmp-review/oklch-research/bottosson-red-clipped-chroma.png`
  - `G:/Antonio Bonet/okcolor/.tmp-review/oklch-research/bottosson-yellowgreen-clipped-chroma.png`
- **Source status:** algorithm/reference article.
- **Learned:** Gamut clipping is about finding real intersections with the gamut boundary.
  The diagrams show lightness/chroma slices and projection paths, not decorative color
  blobs.
- **Implementation lesson:** Boundary and projection lines must correspond to real
  gamut math. If the docs show a shape, it must be derived from `cMax`, RGB boundary
  sampling, or equivalent geometry.

### Color.js gamut mapping

- **URL:** https://colorjs.io/docs/gamut-mapping.html
- **Source status:** implementation oracle/reference.
- **Learned:** CSS-style gamut mapping reduces chroma in OKLCH and relies on perceptual
  difference thresholds, rather than clipping individual RGB channels.
- **Implementation lesson:** The converter must keep explaining chroma reduction and
  target-gamut fit. Visuals should reinforce that model.

### CSS Color 4 gamut mapping

- **URL:** https://www.w3.org/TR/css-color-4/
- **Source status:** normative standard.
- **Learned:** CSS Color 4 describes OKLCH-based gamut mapping for CSS colors.
- **Implementation lesson:** User-facing docs should say "mapped/fitted into target
  gamut" and avoid implying arbitrary saturation.

### Volume

- **URL:** https://www.volumecolor.io/
- **Screenshot:** `G:/Antonio Bonet/okcolor/.tmp-review/oklch-research/volume-3d-oklch.png`
- **Source status:** product/UI reference.
- **Learned:** The product direction treats color palettes as navigable geometry/volume.
- **Implementation lesson:** okcolor should not copy the marketing visual style, but the
  3D view should clearly read as color-space structure rather than a flat chart.

## Excluded or limited sources

- Generic HSL/HSV pickers: useful for UI affordances, but not reliable for OKLCH gamut
  explanation.
- Decorative color-palette websites: excluded unless they show implementation details or
  real gamut geometry.

## Decisions from research

1. Rebuild 2D as rectangular OKLCH planes.
2. Mask unavailable samples; do not paint fake out-of-gamut color.
3. Rebuild 3D from sampled boundary points.
4. Prefer a no-new-dependency Canvas2D point cloud first, escalate to `three` only if
   legibility fails.
5. Keep the visual system neutral; the color maps carry the color.
