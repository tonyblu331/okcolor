# CLI Specification

## Purpose

Defines the behavior of the `ok-actually` command-line interface.

## Requirements

### Requirement: Audit Command

The `audit` command MUST analyze a project and report color format breakdown.

#### Scenario: Audit project directory

- GIVEN a project with CSS files containing mixed color formats
- WHEN `npx ok-actually audit` is executed
- THEN it MUST print:
  - Total legacy colors found
  - Breakdown by format (hex, rgb, hsl, named)
  - "Color Debt" score (percentage of files using legacy formats)
  - Top 10 most frequent legacy colors

#### Scenario: Audit with path argument

- GIVEN `npx ok-actually audit ./src/styles/`
- WHEN executed
- THEN it MUST scan only the specified directory and its subdirectories

### Requirement: Check Command

The `check` command MUST validate that legacy color usage is within thresholds.

#### Scenario: Check passes within threshold

- GIVEN `--max-legacy-colors=10` and a project with 8 legacy colors
- WHEN `npx ok-actually check` runs
- THEN it MUST exit with code 0 and print "✓ Color check passed"

#### Scenario: Check fails exceeding threshold

- GIVEN `--max-legacy-colors=10` and a project with 15 legacy colors
- WHEN `npx ok-actually check` runs
- THEN it MUST exit with code 1 and print:
  - "✗ Color check failed: 15 legacy colors found (max: 10)"
  - List of offending files and line numbers

#### Scenario: Check with format whitelist

- GIVEN `--allow-named --max-legacy-colors=5`
- WHEN executed
- THEN named colors MUST NOT count toward the legacy total

### Requirement: CLI Output Format

The CLI MUST support machine-readable output for CI integration.

#### Scenario: JSON output

- GIVEN `--format=json`
- WHEN any command runs
- THEN output MUST be valid JSON with structured fields
