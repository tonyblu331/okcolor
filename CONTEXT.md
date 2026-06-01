# okcolor Domain Context

This file captures the domain language used by architecture reviews and SDD work.
It is intentionally product-facing: names here should describe okcolor concepts, not
implementation accidents.

## Core domain terms

- **Color identity** — The parsed, normalized identity of a source color. It includes
  original input, source gamut, canonical hex where available, and OKLCH coordinates.
- **Target gamut** — The display gamut a transform is intended to be safe for. The
  v1 product targets are `srgb` and `p3`; `rec2020` and HDR models are research-track
  until oracle-backed.
- **Transform intent** — The product reason for changing a color: `convert`, `fit`,
  `expand`, or `grade`.
- **Recipe** — A named design intent such as `premium`, `vivid`, `muted`, `warmer`, or
  `literal`. Recipes are not scientific claims; they are product taste presets backed
  by explicit deltas and tests.
- **Chroma budget** — The available chroma at a fixed OKLCH lightness and hue inside a
  target gamut.
- **Token compile** — The application use case that turns design tokens into layered CSS,
  design-token output, and an audit report.
- **Contrast pair** — A declared foreground/background relationship that can be audited
  for WCAG 2.2 compliance and APCA advisory scoring.
- **Compile report** — The durable explanation of what okcolor emitted, skipped, graded,
  fit, or failed.
- **Reference oracle** — A standards-aligned external implementation or fixture used to
  verify okcolor math. Examples: W3C sample code, Color.js, ColorAide, and frozen browser
  behavior where applicable.

## Architectural language

- **Domain module** — A deep module that owns invariants for one domain term above.
- **Application use case** — A small orchestration module such as `CompileTokens`,
  `AuditTokens`, `DescribeColor`, or `TransformSingleColor`.
- **Port** — An interface owned by the application/domain side, for example
  `ColorMathPort`, `TokenSourcePort`, `TokenReportPort`, or `CssEmitterPort`.
- **Adapter** — A concrete implementation of a port, for example the Rust/WASM math
  adapter, file-system token adapter, CLI adapter, Vite adapter, or Color.js oracle
  adapter.

## Current architectural tension

The scanner/Rust engine has healthy depth after the module split. The token compiler
does not yet: parsing, recipe resolution, transform orchestration, CSS rendering,
contrast auditing, report building, and file IO are still concentrated in
`src/token/compiler.ts`. The next architecture work should deepen this area instead of
adding feature glue.
