# Core Engine Specification

## Purpose

Defines the behavior of the Rust WASM core: DFA lexer, color conversion math, and string interner cache.

## Requirements

### Requirement: DFA Byte Lexer

The lexer MUST scan raw CSS bytes in O(N) time and tokenize legacy color formats.

#### Scenario: Hex tokenization

- GIVEN a CSS file containing `#ff0000`
- WHEN the DFA scans the byte stream
- THEN it emits a `Hex` token with span (start, end) and raw bytes

#### Scenario: RGB functional notation

- GIVEN a CSS file containing `rgb(255, 0, 0)`
- WHEN the DFA scans the byte stream
- THEN it emits an `Rgb` token with parsed components

#### Scenario: HSL functional notation

- GIVEN a CSS file containing `hsl(0, 100%, 50%)`
- WHEN the DFA scans the byte stream
- THEN it emits an `Hsl` token with parsed components

#### Scenario: Named color keyword

- GIVEN a CSS file containing `red`
- WHEN the DFA scans in a property-value context
- THEN it emits a `Named` token mapping to sRGB

### Requirement: Color Conversion Math

The engine MUST convert sRGB-derived colors to perceptually uniform OKLCH.

#### Scenario: Hex to OKLCH

- GIVEN the hex value `#ff0000`
- WHEN conversion is applied
- THEN the result MUST be `oklch(62.8% 0.2577 29.23)` within 0.01% tolerance

#### Scenario: RGB to OKLCH

- GIVEN `rgb(255, 0, 0)`
- WHEN conversion is applied
- THEN the result MUST equal the OKLCH value for `#ff0000`

#### Scenario: HSL to OKLCH

- GIVEN `hsl(0, 100%, 50%)`
- WHEN conversion is applied
- THEN the result MUST equal the OKLCH value for `#ff0000`

### Requirement: String Interner Cache

The engine MUST deduplicate color strings via a direct-mapped O(1) cache.

#### Scenario: First occurrence

- GIVEN a new legacy color string `#ff0000`
- WHEN it is encountered
- THEN it receives `ColorID = 1` and math is computed once

#### Scenario: Duplicate occurrence

- GIVEN `#ff0000` already has `ColorID = 1`
- WHEN the same string appears again
- THEN the cached OKLCH value for `ColorID = 1` MUST be returned instantly

### Requirement: Safety Bails

The engine MUST NOT transform expressions containing dynamic values.

#### Scenario: CSS variable bail

- GIVEN `color: var(--primary)`
- WHEN the lexer encounters `var(`
- THEN it MUST skip the entire declaration value and pass it through unmodified

#### Scenario: currentColor bail

- GIVEN `border-color: currentColor`
- WHEN the lexer tokenizes the value
- THEN it MUST pass `currentColor` through unmodified

### Requirement: Escape Hatch

The engine MUST respect `/* oklch-ignore */` comments.

#### Scenario: Ignore comment on same line

- GIVEN `background: #ff0000; /* oklch-ignore */`
- WHEN the scanner processes the line
- THEN it MUST emit the original `#ff0000` without conversion
