# Vite Plugin Specification

## Purpose

Defines the behavior of the Vite plugin that bridges the WASM engine into the build pipeline.

## Requirements

### Requirement: Plugin Registration

The plugin MUST register with Vite's `pre` hook to process CSS before other plugins.

#### Scenario: Basic registration

- GIVEN a `vite.config.ts` importing `{ okActually }` from `ok-actually`
- WHEN `plugins: [okActually()]` is configured
- THEN Vite MUST invoke the plugin during the `pre` build phase

### Requirement: CSS File Transformation

The plugin MUST pass CSS file contents through the WASM engine and return transformed output.

#### Scenario: Transform CSS module

- GIVEN a `.css` file with legacy colors
- WHEN Vite requests the module during build
- THEN the plugin MUST return CSS with OKLCH replacements

#### Scenario: Transform CSS in JS/TS

- GIVEN a `<style>` block in a `.vue` or `.svelte` file
- WHEN Vite processes the embedded CSS
- THEN the plugin MUST apply OKLCH conversion to the style content

### Requirement: Dev Mode Performance

The plugin MUST complete transformation in under 15ms per file during HMR.

#### Scenario: HMR latency budget

- GIVEN a 10KB CSS file with 50 color values
- WHEN the file changes in dev mode
- THEN the full transform MUST complete within 15ms

### Requirement: WASM Initialization

The plugin MUST initialize the WASM instance once and reuse it across builds.

#### Scenario: First build

- GIVEN a fresh Vite dev server start
- WHEN the first CSS file is processed
- THEN the WASM module MUST load and instantiate

#### Scenario: Subsequent builds

- GIVEN an already-initialized WASM instance
- WHEN additional CSS files are processed
- THEN the same instance MUST be reused without reload
