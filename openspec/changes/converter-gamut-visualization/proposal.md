---
id: converter-gamut-visualization
title: "Research-backed converter gamut visualization rebuild"
status: proposal
created: 2026-06-01
---

# Research-Backed Converter Gamut Visualization Rebuild

## Intent

The live converter should help users understand OKLCH conversion and gamut fitting by
showing real color-space geometry, not decorative approximations.

The current converter UI proves the WASM calls work, but the 2D/3D visuals were iterated
too quickly and now communicate the wrong model. This change freezes the research lessons
from established OKLCH tools and rebuilds the visual layer from clean primitives.

## Problem

The current converter visuals are not release-quality:

- The 2D map has gone through polar sweeps and hand-filled shapes that do not match how
  strong OKLCH pickers explain the space.
- The 3D view is a projected decorative volume rather than a boundary derived from real
  gamut samples.
- The implementation mixes picker interaction, conversion state, and visualization code in
  one component, making each visual experiment drag old assumptions forward.
- It is easy for a user to mistake the visual for exact gamut geometry when parts are only
  illustrative.

## Scope

### In scope

- Rebuild `WasmConverter.astro` visualization code with a clean renderer boundary.
- Replace fake 2D geometry with mathematically sampled OKLCH planes:
  - primary plane: hue × chroma at fixed lightness,
  - secondary/inspectable plane: lightness × chroma at fixed hue.
- Render out-of-gamut regions explicitly with masking/alpha or neutral disabled treatment.
- Replace fake 3D volume with a real sampled gamut boundary point cloud or mesh derived
  from RGB cube boundary samples converted into OKLCH.
- Preserve the converter controls, swatches, CSS output, contrast feedback, and WASM-backed
  conversion behavior.
- Add visual regression artifacts/screenshots for the 2D and 3D views.
- Document what is exact, what is sampled, and what tolerance/resolution is used.

### Out of scope

- Adding a full production color picker package to `okcolor`.
- Making docs depend on a large 3D stack unless the Canvas2D point-cloud renderer proves
  insufficient.
- Changing the core Rust/WASM gamut math.
- Shipping animated or decorative hero visuals.
- Implementing CAM16, JzAzBz, HDR, Rec.2020 editing, or viewing-condition-aware models.

## Affected packages

- `packages/docs/src/components/WasmConverter.astro` — current live converter component.
- `packages/docs/src/content/docs/guides/converter.mdx` — explanation of the views.
- `packages/core-wasm/pkg/okcolor_core.js` — existing generated WASM bindings used by the
  docs page.
- Optional later helper file under `packages/docs/src/components/` or
  `packages/docs/src/lib/` if the renderer is split out of the Astro component.

## Performance impact

The docs page may do more visualization work than before. It MUST remain interactive:

- Initial render SHOULD complete in under 150 ms on a modern laptop for the default
  sample resolution.
- 2D plane rendering SHOULD use `ImageData` at bounded resolution and cache by
  `(plane, lightness, hue, gamut, devicePixelRatio)`.
- 3D boundary generation SHOULD be cached by target gamut and sample step.
- Pointer dragging MUST NOT regenerate the entire 3D model on every movement.

## Rollback plan

If the rebuilt renderer fails performance, correctness, or browser compatibility:

1. Keep the converter controls and output panels.
2. Hide the 3D view behind a simple "Visualization unavailable" panel.
3. Keep the 2D view as a rectangular sampled plane only.
4. Do not restore the decorative polar/filled fake volume renderer.

## Release candidacy impact

The converter page should not be treated as a showcase until this change lands. The docs
can still document the CLI/Vite/token compiler, but the live converter needs this rebuild
before it is used as proof of product quality.
