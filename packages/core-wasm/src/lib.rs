mod cache;
mod format;
mod math;
mod named;
mod parse;
mod scan;

use wasm_bindgen::prelude::*;

/// Transform a CSS string: replace all legacy colour values with OKLCH.
#[wasm_bindgen]
pub fn transform_css(input: &str) -> String {
    scan::transform_css(input)
}

/// Audit a CSS string: return a JSON string with colour usage statistics.
#[wasm_bindgen]
pub fn audit_css(input: &str) -> String {
    let r = scan::audit_css(input);
    r#"{"legacy_count":"#.to_string()
        + &r.legacy_count.to_string()
        + r#","hex_count":"# + &r.hex_count.to_string()
        + r#","rgb_count":"# + &r.rgb_count.to_string()
        + r#","hsl_count":"# + &r.hsl_count.to_string()
        + r#","hwb_count":"# + &r.hwb_count.to_string()
        + r#","named_count":"# + &r.named_count.to_string()
        + r#","gradient_count":"# + &r.gradient_count.to_string()
        + r#","unique_count":"# + &r.unique_count.to_string()
        + "}"
}

// ── Lower-level bindings for testing / composition ────────────────────────

/// Convert an individual CSS colour value to OKLCH.
///
/// Recognises the same formats as the scanner: hex, rgb(), hsl(), hwb(),
/// color(srgb …), and named colours.
/// Returns `null` if the input is not a recognised colour.
#[wasm_bindgen]
pub fn color_to_oklch(input: &str) -> Option<String> {
    use crate::parse::*;

    let bytes = input.as_bytes();
    let trimmed = input.trim();

    // Hex
    if let Some(rest) = trimmed.strip_prefix('#') {
        return parse_hex(rest.as_bytes())
            .map(|p| format::oklch_to_css(p.l, p.c, p.h, p.alpha));
    }

    // Function colours
    let toks = tokenize_body(trimmed);

    let result = if trimmed.starts_with("rgb") || trimmed.starts_with("rgba") {
        parse_rgb(&toks)
    } else if trimmed.starts_with("hsl") || trimmed.starts_with("hsla") {
        parse_hsl(&toks)
    } else if trimmed.starts_with("hwb") {
        parse_hwb(&toks)
    } else if trimmed.starts_with("color") {
        parse_color_srgb(&toks)
    } else {
        None
    };

    if let Some(p) = result {
        return Some(format::oklch_to_css(p.l, p.c, p.h, p.alpha));
    }

    // Named
    let parsed = parse_named(bytes);
    parsed.map(|p| format::oklch_to_css(p.l, p.c, p.h, p.alpha))
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn transform_roundtrip() {
        let css = "a { color: #ff0000; }";
        let result = transform_css(css);
        assert!(result.contains("oklch("));
        // Second pass should be a no-op
        let again = transform_css(&result);
        assert_eq!(again, result);
    }

    #[test]
    fn audit_json_valid() {
        let json = audit_css("a { color: red; }");
        assert!(json.contains("\"named_count\":1"));
        assert!(json.contains("\"legacy_count\":1"));
    }

    #[test]
    fn color_to_oklch_hex() {
        let r = color_to_oklch("#ff0000").unwrap();
        assert!(r.starts_with("oklch("));
    }

    #[test]
    fn color_to_oklch_named() {
        let r = color_to_oklch("red").unwrap();
        assert!(r.starts_with("oklch("));
    }

    #[test]
    fn color_to_oklch_invalid_returns_none() {
        assert!(color_to_oklch("not-a-color").is_none());
    }
}
