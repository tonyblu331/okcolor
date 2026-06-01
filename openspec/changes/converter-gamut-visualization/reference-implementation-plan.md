---
id: converter-gamut-visualization/reference-implementation-plan
title: "Reference implementation plan — OKLCH picker planes and 3D volume"
parent: converter-gamut-visualization
status: draft
created: 2026-06-01
---

# Reference Implementation Plan — OKLCH Picker Planes and 3D Volume

## Design read

The target is not a generic "converter graph." It is a color-science picker surface:

- multiple small cards, each fixing one OKLCH channel and plotting the other two,
- a 3D volume view where `L` is vertical, `C` is radial distance, and `H` rotates around
  the neutral axis,
- palette nodes/markers projected into every view using the same coordinate model.

## What the references are doing

### 1. OKLCH picker cards

The picker cards are channel slices:

| Card | Fixed channel | X axis | Y axis | Purpose |
| --- | --- | --- | --- | --- |
| Lightness | Hue | Lightness | Chroma | Choose brightness while seeing the chroma ceiling for that hue. |
| Chroma | Lightness | Hue | Chroma | Choose saturation while seeing the gamut limit across hue. |
| Hue | Chroma | Hue | Lightness | Rotate hue while seeing which lightness values remain reachable. |

Each pixel is not a decorative gradient. It is sampled from an OKLCH coordinate:

```text
sample = { l, c, h }
if sample is outside selected gamut:
  alpha = 0 or dimmed unavailable
else:
  paint converted display color
```

The slider under each card is a 1D slice of the same model, not a separate decoration.

### 2. WebGL/shader approach

Eero Lehtinen's picker uses fragment shaders. The fragment shader maps UV coordinates
directly to OKLCH channels, converts to linear RGB, and returns alpha 0 for invalid gamut
samples. It also supersamples/dithers to avoid brittle/pixelated edges.

For okcolor, the equivalent can be:

1. Start with Canvas `ImageData` for 2D slices.
2. Add 2x device-pixel sampling and optional 2x2 supersampling for edges.
3. Move to a tiny WebGL shader only if Canvas cannot stay smooth enough.

### 3. Evil Martians 3D mesh approach

The Evil Martians picker uses a real 3D model:

1. Sample points on RGB cube boundaries.
2. Convert each boundary RGB sample into OKLCH.
3. Use those OKLCH coordinates as 3D geometry.
4. Color vertices from the original RGB values.
5. Triangulate/render the surface.

The important lesson: a 3D gamut view is a boundary mesh/surface, not arbitrary rings.

### 4. Volume-style palette model

Volume treats palette colors as nodes in OKLCH space:

```text
vertical axis = L
radial distance = C
rotation angle = H
```

Palette operations are spatial operations:

- move up/down for lightness,
- move outward/inward for chroma,
- rotate around the neutral axis for hue,
- keep linked nodes preserving their spatial relationship.

For okcolor docs, we do not need the full palette editor. We need the mental model:
current source/result markers should appear consistently across 2D and 3D views.

## Implementation plan for okcolor

### Phase A — Correct 2D cards

Replace the single huge map with three cards:

1. **Lightness card**
   - fixed: current hue,
   - x: lightness,
   - y: chroma,
   - marker: current source/result.

2. **Chroma card**
   - fixed: current lightness,
   - x: hue,
   - y: chroma,
   - marker: current source/result.

3. **Hue card**
   - fixed: current chroma,
   - x: hue,
   - y: lightness,
   - marker: current source/result.

Each card gets:

- raster sampled color field,
- out-of-gamut mask,
- sRGB/P3 boundary overlay,
- one 1D slider strip derived from the same sample function.

### Phase B — Smooth sampling

Use the same render function for every card:

```ts
renderPlane({
  width,
  height,
  fixedChannel,
  xChannel,
  yChannel,
  gamut,
  supersample: 2
})
```

Rules:

- Render at device pixel ratio.
- Supersample 2x2 only near boundary or for all pixels if still fast.
- Cache by `planeKey = fixedChannel + fixedValue + gamut + width + height`.
- Redraw markers separately so pointer movement is cheap.

### Phase C — Real 3D surface

Upgrade from point cloud to boundary surface:

1. For each RGB cube face, generate a regular grid:
   - `r = 0`, `r = 1`,
   - `g = 0`, `g = 1`,
   - `b = 0`, `b = 1`.
2. Convert every sample to OKLCH.
3. Build quads/triangles per face.
4. Project with camera:
   - x/z from hue/chroma,
   - y from lightness.
5. Depth-sort triangles before drawing in Canvas2D, or use WebGL/Three if Canvas depth
   sorting is not enough.

### Phase D — UI layout

Use a 2x2 card grid like the reference:

```text
[ Lightness ] [ Chroma ]
[ 3D        ] [ Hue    ]
```

Keep controls outside the visual cards. The visual cards should be the instrument.

### Phase E — verification

- Compare all cards against reference screenshots:
  - no blocky edges,
  - unavailable areas are clean,
  - markers agree across cards,
  - 3D shape reads as a continuous gamut boundary.
- Verify drag behavior per card:
  - lightness card changes L/C,
  - chroma card changes H/C,
  - hue card changes H/L.
- Run `npm run build:docs`.

## Do not do

- Do not keep the current single-plane layout as the final target.
- Do not hand-paint a 3D-looking blob.
- Do not use CSS gradients for the scientific color field.
- Do not render out-of-gamut areas as if they are valid.
- Do not use one giant canvas if the reference needs multiple coordinated views.
