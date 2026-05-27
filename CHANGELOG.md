# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Astro Starlight documentation site with API reference, benchmarks, and playground
- GitHub Actions workflows for CI, docs deployment, and automated releases
- GitHub issue and PR templates
- Documentation for scanner coverage, Vite virtual style handling, symlink-safe CLI traversal, local benchmarks, and Windows `rust-lld` test workaround
- Incremental token compiler for sRGB design tokens, Display P3 OKLCH expansion, grading/fitting/describe commands, Vite token output mode, and pair-based WCAG contrast reports

### Changed

- `Scanner` performance: removed dead `O(N²)` line-tracking code
- `parse_color`: eliminated `to_lowercase()` allocation via `Cow<str>`
- `classify()`: eliminated double `try_match_color_at` call per color
- Hardened CSS scanning around selector functions, `@supports`/`@container` conditions, `@property` color registrations, escaped custom properties, gradients, and named-color property classification
- Updated benchmark/package-size claims to match the current WASM build and `npm pack --dry-run`
- Refactored token compiler architecture so Rust/WASM owns gamut and luminance math while TypeScript handles token orchestration, recipes, and reporting

## [1.0.0] - 2026-05-24

### Added

- Initial release
- WASM-powered OKLCH color converter with W3C-exact matrices
- Vite plugin for zero-config CSS transformation
- CLI with `audit`, `check`, and `doctor` commands
- Support for Hex, RGB, HSL, HWB, named colors, and `color(srgb ...)`
- Automatic gradient upgrade with `in oklch` interpolation
- `/* oklch-ignore */` escape hatch
- 122 Rust tests + 27 TypeScript tests, verified against Culori
