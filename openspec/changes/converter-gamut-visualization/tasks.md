---
id: converter-gamut-visualization/tasks
title: "Converter gamut visualization rebuild — task breakdown"
parent: converter-gamut-visualization
status: draft
created: 2026-06-01
---

# Converter Gamut Visualization Rebuild — Tasks

## Phase 0: Freeze evidence and remove ambiguity

- [x] 0.1 Capture reference screenshots from Evil Martians, Volume, and Björn Ottosson.
- [x] 0.2 Inspect implementation patterns in `evilmartians/oklch-picker`.
- [x] 0.3 Inspect implementation patterns in `eero-lehtinen/oklch-color-picker`.
- [x] 0.4 Record research lessons in this SDD change.

## Phase 1: Cut away the broken renderer

- [x] 1.1 Remove the current polar sweep 2D drawing path.
- [x] 1.2 Remove the current fake filled 3D volume drawing path.
- [x] 1.3 Keep only stable UI state, WASM init, conversion output, swatches, and copy.
- [x] 1.4 Add renderer helper boundaries before rebuilding visuals.

## Phase 2: Build the 2D OKLCH plane renderer

- [x] 2.1 Implement `renderHueChromaPlane()` with explicit hue × chroma axes.
- [x] 2.2 Mask out-of-gamut samples instead of painting them.
- [x] 2.3 Add current source/result markers to the plane.
- [x] 2.4 Update pointer picking to map rectangular plane x/y to hue/chroma.
- [x] 2.5 Add a secondary lightness × chroma slice at the current hue.
- [ ] 2.6 Cache plane output by fixed lightness, target gamut, and canvas size.
- [x] 2.7 Overlay computed gamut boundary contours on 2D planes.
- [x] 2.8 Label the active gamut boundary directly in the canvas.

## Phase 3: Build the 3D sampled boundary renderer

- [x] 3.1 Implement RGB cube-face boundary sampling for sRGB and Display P3.
- [x] 3.2 Convert boundary samples to OKLCH with the existing engine/math path.
- [x] 3.3 Project OKLCH `(h, c, l)` to a stable 3D canvas view.
- [x] 3.4 Depth-sort points or segments before drawing.
- [x] 3.5 Draw source/result markers in the same projected coordinate system.
- [x] 3.6 Add a static camera angle first.
- [x] 3.7 Add pointer-drag rotation for the OKLCH 3D volume.
- [x] 3.8 Render a connected gamut shell instead of only loose boundary points.

## Phase 4: UX copy and visual hierarchy

- [x] 4.1 Rename the 2D view to "Hue x chroma plane".
- [x] 4.2 Rename the secondary view to "Lightness x chroma slice".
- [x] 4.3 Rename the 3D view to "Rotatable 3D gamut".
- [x] 4.4 Add one sentence explaining sampling and masking.
- [x] 4.5 Keep styling neutral and tool-like; color belongs inside the maps.
- [x] 4.6 Consolidate the 2D/3D gamut panels into one viewer with an explicit toggle.

## Phase 5: Verification

- [x] 5.1 Run `npm run build:docs`.
- [x] 5.2 Verify converter route returns HTTP 200.
- [x] 5.3 Verify pointer drag changes the input color.
- [x] 5.4 Capture in-app/browser screenshots for 2D and 3D views.
- [ ] 5.5 Compare against research checklist in `design.md`.
- [x] 5.6 Confirm no old fake renderer functions remain.

## Phase 6: Commit gate

- [ ] 6.1 Separate this docs/visualization change from unrelated working-tree edits.
- [ ] 6.2 Commit with a conventional commit message.
- [ ] 6.3 Push only after build and browser verification pass.
