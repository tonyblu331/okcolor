//! AC-driven CSS scanner.
//!
//! Uses a single Aho-Corasick automaton (161 patterns) to find all legacy
//! colour indicators (`#`, function colours, gradient names, and 148 named
//! colours) in a single linear pass.  Comments and strings are pre-scanned
//! into skip ranges so patterns inside them are ignored.
//!
//! In transform mode each match is dispatched to the appropriate parser +
//! formatter; in audit mode only the counters are incremented.  When no
//! legacy indicators exist and there's no `oklch-ignore` marker the input
//! is returned verbatim — making second-pass and modern-only CSS free.

use std::sync::LazyLock;

use aho_corasick::{AhoCorasick, MatchKind};

use crate::named;

// ── Aho-Corasick patterns ───────────────────────────────────────────────

const PATTERN_HEX: usize = 0;
const PATTERN_RGB: usize = 1;
const PATTERN_COLOR_FN: usize = 6;

/// Aho-Corasick automaton for all 161 patterns: `#`, 6 function colours,
/// 6 gradient names, and 148 named colours.
/// Used only by `has_legacy_indicators` and `count_legacy_indicators`.
static SCAN_AHO: LazyLock<AhoCorasick> = LazyLock::new(|| {
    let mut patterns: Vec<&[u8]> = Vec::new();
    patterns.push(b"#");
    patterns.extend_from_slice(&[b"rgb(", b"rgba(", b"hsl(", b"hsla(", b"hwb(", b"color("]);
    patterns.extend_from_slice(&[
        b"linear-gradient(",
        b"radial-gradient(",
        b"conic-gradient(",
        b"repeating-linear-gradient(",
        b"repeating-radial-gradient(",
        b"repeating-conic-gradient(",
    ]);
    for (name, _) in named::NAMED_PAIRS {
        patterns.push(name.as_bytes());
    }
    AhoCorasick::builder()
        .match_kind(MatchKind::LeftmostLongest)
        .ascii_case_insensitive(true)
        .build(&patterns)
        .expect("valid AC patterns")
});

#[derive(Debug, Default)]
struct IndicatorCounts {
    hex: usize,
    func: usize,
    named: usize,
}

impl IndicatorCounts {
    fn is_empty(&self) -> bool {
        self.hex == 0 && self.func == 0 && self.named == 0
    }

    fn estimated_growth(&self) -> usize {
        (self.hex + self.func + self.named) * 15
    }
}

/// Quick check: does `bytes` contain any legacy colour indicator?
fn has_legacy_indicators(bytes: &[u8]) -> bool {
    SCAN_AHO.is_match(bytes)
}

/// Count legacy colour indicators (conservative upper bound).
fn count_legacy_indicators(bytes: &[u8]) -> IndicatorCounts {
    let mut counts = IndicatorCounts::default();
    for m in SCAN_AHO.find_iter(bytes) {
        match m.pattern().as_usize() {
            PATTERN_HEX => counts.hex += 1,
            PATTERN_RGB..=PATTERN_COLOR_FN => counts.func += 1,
            _ => counts.named += 1,
        }
    }
    counts
}

// ── Public types / entry-points ──────────────────────────────────────────

#[derive(Debug, Default)]
pub struct ScanResult {
    pub css: String,
    pub legacy_count: u32,
    pub hex_count: u32,
    pub rgb_count: u32,
    pub hsl_count: u32,
    pub hwb_count: u32,
    pub named_count: u32,
    pub gradient_count: u32,
    pub unique_count: u32,
}

pub fn transform_css(input: &str) -> String {
    engine::scan_transform_impl(input).css
}

pub fn audit_css(input: &str) -> ScanResult {
    engine::scan_audit_impl(input)
}

// ── Scanner helpers ──────────────────────────────────────────────────────

// ── Main scan loop ──────────────────────────────────────────────────────

mod context;
mod engine;
mod gradient;
mod ignore;
mod replace;
mod sink;
mod state;
mod token;

#[cfg(test)]
use ignore::find_ignore_ranges;

// ── Low-level helpers ───────────────────────────────────────────────────

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_hex_6() {
        let result = transform_css("a { color: #ff0000; }");
        assert!(result.contains("oklch("));
        assert!(!result.contains("#ff0000"));
    }

    #[test]
    fn transform_hex_6_exact_output() {
        let result = transform_css("a { color: #ff0000; }");
        // W3C reference: l=0.627955 c=0.257683 h=29.2339
        // Formatted:  62.8% 0.25768 29.23
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_hex_3_exact_output() {
        let result = transform_css("a { color: #f00; }");
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_rgb_exact_output() {
        let result = transform_css("a { color: rgb(255, 0, 0); }");
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_hsl_exact_output() {
        let result = transform_css("a { color: hsl(0, 100%, 50%); }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_named_exact_output() {
        let result = transform_css("a { color: red; }");
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_named_uppercase() {
        let result = transform_css("a { color: RED; }");
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_named_mixed_case() {
        let result = transform_css("a { color: ReBeCcApUrPlE; }");
        assert_eq!(result, "a { color: oklch(44.03% 0.1603 303.37); }");
    }

    #[test]
    fn transform_color_srgb_exact_output() {
        let result = transform_css("a { color: color(srgb 1 0 0); }");
        assert_eq!(result, "a { color: oklch(62.8% 0.25768 29.23); }");
    }

    #[test]
    fn transform_hex_3() {
        let result = transform_css("a { color: #f00; }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_hex_8_alpha() {
        let result = transform_css("a { color: #ff000080; }");
        assert!(result.contains("oklch("));
        assert!(result.contains("/"));
    }

    #[test]
    fn transform_rgb() {
        let result = transform_css("a { color: rgb(255, 0, 0); }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_hsl() {
        let result = transform_css("a { color: hsl(0, 100%, 50%); }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_hwb() {
        let result = transform_css("a { color: hwb(0 0% 0%); }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_named() {
        let result = transform_css("a { color: red; }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn transform_color_srgb() {
        let result = transform_css("a { color: color(srgb 1 0 0); }");
        assert!(result.contains("oklch("));
    }

    #[test]
    fn ignore_id_selector() {
        // #myId { ... } should NOT be treated as colour
        let result = transform_css("#myId { color: red; }");
        assert!(result.contains("#myId"));
        assert!(result.contains("oklch("));
    }

    #[test]
    fn ignore_comment() {
        let result = transform_css("a { color: /* keep */ #ff0000; }");
        assert!(result.contains("/* keep */"));
    }

    #[test]
    fn oklch_ignore_pragma() {
        let result = transform_css("a { color: #ff0000; /* oklch-ignore */ }");
        assert!(result.contains("#ff0000"));
    }

    #[test]
    fn gradient_injects_oklch() {
        let result = transform_css("a { background: linear-gradient(red, blue); }");
        assert!(result.contains("in oklch"));
        assert!(result.contains("oklch("));
    }

    #[test]
    fn gradient_does_not_double_inject() {
        let result = transform_css("a { background: linear-gradient(in oklch, red, blue); }");
        // Count occurrences of "in oklch" — should be exactly 1
        assert_eq!(result.matches("in oklch").count(), 1);
    }

    #[test]
    fn gradient_all_variants_produce_oklch() {
        for grad in [
            "linear-gradient",
            "radial-gradient",
            "conic-gradient",
            "repeating-linear-gradient",
            "repeating-radial-gradient",
            "repeating-conic-gradient",
        ] {
            let input = format!("a {{ background: {grad}(red, blue); }}");
            let result = transform_css(&input);
            assert!(result.contains("oklch("), "missing oklch in {grad}");
            assert!(result.contains("in oklch"), "missing 'in oklch' in {grad}");
        }
    }

    #[test]
    fn audit_counts() {
        let result = audit_css("a { color: #ff0000; } b { color: rgb(0,255,0); }");
        assert_eq!(result.hex_count, 1);
        assert_eq!(result.rgb_count, 1);
    }

    #[test]
    fn preserved_modern_unchanged() {
        let result = transform_css("a { color: oklch(50% 0.2 180); }");
        assert_eq!(result, "a { color: oklch(50% 0.2 180); }");
    }

    #[test]
    fn gradient_tracks_count() {
        let result = audit_css("a { background: linear-gradient(red, blue); }");
        assert_eq!(result.gradient_count, 1);
    }

    #[test]
    fn empty_input() {
        assert_eq!(transform_css(""), "");
        let r = audit_css("");
        assert_eq!(r.legacy_count, 0);
    }

    #[test]
    fn ignores_transparent() {
        let result = transform_css("a { color: transparent; }");
        assert_eq!(result, "a { color: transparent; }");
    }

    #[test]
    fn multiple_colors_in_line() {
        let result = transform_css("a { color: red; border: 1px solid #00f; }");
        // Both replaced
        assert_eq!(result.matches("oklch(").count(), 2);
    }

    #[test]
    fn string_content_untouched() {
        let result = transform_css("a::before { content: \"#ff0000\"; }");
        assert!(result.contains("#ff0000"));
    }

    #[test]
    fn supports_color_condition_and_body_are_value_contexts() {
        let input = "@supports (color: red) { .a { color: blue; } }";
        let result = transform_css(input);
        assert!(result.contains("@supports (color: oklch("));
        assert_eq!(result.matches("oklch(").count(), 2);

        let audit = audit_css(input);
        assert_eq!(audit.named_count, 2);
        assert_eq!(audit.legacy_count, 2);
    }

    #[test]
    fn supports_selector_function_does_not_transform_selector_names() {
        let input = "@supports selector(.red) { .a { color: red; } }";
        let result = transform_css(input);
        assert!(result.contains("selector(.red)"));
        assert_eq!(result.matches("oklch(").count(), 1);

        let audit = audit_css(input);
        assert_eq!(audit.named_count, 1);
        assert_eq!(audit.legacy_count, 1);
    }

    #[test]
    fn container_style_condition_and_body_are_value_contexts() {
        let input = "@container style(color: red) { .a { background: blue; } }";
        let result = transform_css(input);
        assert!(result.contains("@container style(color: oklch("));
        assert_eq!(result.matches("oklch(").count(), 2);

        let audit = audit_css(input);
        assert_eq!(audit.named_count, 2);
        assert_eq!(audit.legacy_count, 2);
    }

    #[test]
    fn property_color_syntax_allows_initial_value_color() {
        let input =
            "@property --brand { syntax: \"<color>\"; inherits: false; initial-value: red; }";
        let result = transform_css(input);
        assert!(result.contains("initial-value: oklch("));

        let audit = audit_css(input);
        assert_eq!(audit.named_count, 1);
        assert_eq!(audit.legacy_count, 1);
    }

    #[test]
    fn property_non_color_syntax_keeps_initial_value_name() {
        let input = "@property --space { syntax: \"<length>\"; inherits: false; initial-value: red; } .a { color: red; }";
        let result = transform_css(input);
        assert!(result.contains("initial-value: red"));
        assert_eq!(result.matches("oklch(").count(), 1);

        let audit = audit_css(input);
        assert_eq!(audit.named_count, 1);
        assert_eq!(audit.legacy_count, 1);
    }

    // ── find_ignore_ranges tests ──

    // ── Audit split tests ──

    #[test]
    fn audit_zero_output_allocation() {
        let result = audit_css("a { color: red; } b { color: #ff0000; }");
        // After audit split, .css MUST be empty — no output built
        assert_eq!(result.css, "");
        assert_eq!(result.named_count, 1);
        assert_eq!(result.hex_count, 1);
        assert_eq!(result.legacy_count, 2);
    }

    #[test]
    fn audit_zero_output_no_colors_at_all() {
        let result = audit_css("a { color: oklch(50% 0.2 180); }");
        assert_eq!(result.css, "");
        assert_eq!(result.legacy_count, 0);
    }

    #[test]
    fn audit_zero_output_gradient() {
        let result = audit_css("a { background: linear-gradient(red, blue); }");
        assert_eq!(result.css, "");
        assert_eq!(result.named_count, 2);
        assert_eq!(result.gradient_count, 1);
    }

    // ── find_ignore_ranges tests ──

    #[test]
    fn find_ignore_ranges_no_marker() {
        let ranges = find_ignore_ranges("a { color: red; }\nb { color: blue; }\n");
        assert!(ranges.is_empty(), "expected no ranges, got {ranges:?}");
    }

    #[test]
    fn find_ignore_ranges_with_marker() {
        let ranges =
            find_ignore_ranges("a { color: #ff0000; /* oklch-ignore */ }\nb { color: blue; }");
        assert_eq!(ranges.len(), 1);
    }

    #[test]
    fn find_ignore_ranges_case_insensitive() {
        let ranges = find_ignore_ranges("a { color: red; /* OKLCH-IGNORE */ }");
        assert_eq!(ranges.len(), 1);
    }

    #[test]
    fn find_ignore_ranges_multiple_lines() {
        let input = "a { color: red; /* oklch-ignore */ }\nb { color: blue; }\nc { color: green; /* oklch-ignore */ }";
        let ranges = find_ignore_ranges(input);
        assert_eq!(ranges.len(), 2);
    }
}
