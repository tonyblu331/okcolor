## ADDED Requirements

### Requirement: Converter docs SHALL render sampled OKLCH planes

The live converter documentation SHALL render 2D gamut maps as sampled OKLCH planes with
explicit axes and fixed coordinates, rather than as decorative polar or radial fills.

#### Scenario: Hue by chroma plane at fixed lightness

- **Given** a valid source color has been converted to OKLCH
- **When** the converter renders the primary 2D map
- **Then** the x axis SHALL represent hue from 0 to 360 degrees
- **And** the y axis SHALL represent chroma from 0 to the displayed chroma range
- **And** the plane SHALL use the current source lightness as its fixed coordinate

#### Scenario: Out-of-gamut samples are unavailable

- **Given** a sampled OKLCH coordinate is outside the selected target gamut
- **When** the converter paints the 2D plane
- **Then** the sample SHALL be masked, transparent, or visibly disabled
- **And** it SHALL NOT be painted as if it were reachable color

### Requirement: Converter docs SHALL render 3D gamut structure from real samples

The live converter documentation SHALL render the 3D gamut view from sampled gamut
boundary points or equivalent boundary geometry.

#### Scenario: Boundary points come from target gamut samples

- **Given** the selected target gamut is sRGB or Display P3
- **When** the converter builds the 3D view
- **Then** boundary points SHALL be derived from real target-gamut RGB boundary samples
  or an equivalent `cMax`/boundary computation
- **And** the 3D view SHALL NOT use arbitrary decorative rings as the main gamut shape

#### Scenario: Source and result markers share the same projection

- **Given** the source and result OKLCH colors are known
- **When** the 3D view is rendered
- **Then** both markers SHALL be projected using the same 3D coordinate mapping as the
  gamut boundary samples

### Requirement: Converter visualization SHALL remain interactive and bounded

The live converter visualization SHALL remain responsive in the browser.

#### Scenario: Dragging the 2D plane updates color input

- **Given** the WASM engine is loaded
- **When** the user drags inside the valid 2D hue × chroma plane
- **Then** the converter SHALL update the input color to the corresponding OKLCH value
- **And** the output readouts SHALL refresh without a page reload

#### Scenario: Rendering work is cached

- **Given** the user changes only the input chroma marker inside an already rendered plane
- **When** the fixed lightness, target gamut, and canvas size have not changed
- **Then** the converter SHOULD reuse the cached plane image
- **And** it SHOULD redraw only overlays and markers
