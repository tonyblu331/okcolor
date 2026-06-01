# Design

## Visual Theme

okcolor documentation should feel like a color laboratory manual crossed with a bold product instrument. It is full-size, flat, high-contrast, and tactile. The site should avoid generic SaaS blue/purple, decorative gradients, beige-craft warmth, and glassmorphism.

## Color System

Use OKLCH tokens.

- Canvas: flat near-white neutral, not yellow, cream, beige, or green-tinted.
- Surface: transparent or white instrument planes with crisp ink rules, not card stacks.
- Ink: near-black with a slight cool undertone.
- Accent: controlled vermilion/orange-red for active UI and selected gamut/result affordances.
- Status: use text, labels, and borders first; avoid green as the default success color.
- Spectrum: only appears inside sampled gamut visualizations and color swatches because there it is data.

## Typography

Use the existing Starlight stack for now, but style it with stronger scale and geometry. Display headings should be wide and confident, capped at readable line lengths. Color values use mono. Avoid tiny uppercase section labels as recurring scaffolding.

## Layout

The documentation shell should expand for product pages. Converter pages use a full-width instrument layout:

- Controls and readouts are large, not hidden.
- The gamut viewer dominates the fold.
- 2D and 3D are modes of one viewer, not separate charts.
- H/C/L controls are primary teaching artifacts.

## Components

- Instrument panel: flat surface, ink rules, minimal radius.
- View switch: text-button mode control, not a segmented pill.
- Readout: large numeric/value blocks with copyable mono values.
- Gamut viewer: canvas with labeled sRGB/P3 contours, source/result markers, and no decorative background gradients.
- Documentation card: strong border, flat fill, large type, no soft ghost-card shadow.

## Motion

Motion is restrained and physical. Hover states may translate by 1px or invert colors. 3D gamut rotation is the main interactive motion. Respect `prefers-reduced-motion`.
