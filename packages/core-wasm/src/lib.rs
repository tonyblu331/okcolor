mod cache;
mod convert;
mod format;
mod math;
mod named;
mod parse;
pub mod scan;
mod types;

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
        + r#","hex_count":"#
        + &r.hex_count.to_string()
        + r#","rgb_count":"#
        + &r.rgb_count.to_string()
        + r#","hsl_count":"#
        + &r.hsl_count.to_string()
        + r#","hwb_count":"#
        + &r.hwb_count.to_string()
        + r#","named_count":"#
        + &r.named_count.to_string()
        + r#","gradient_count":"#
        + &r.gradient_count.to_string()
        + r#","unique_count":"#
        + &r.unique_count.to_string()
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
    let raw = parse::parse_single_color(input.trim())?;
    let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
    let mut buf = String::new();
    format::oklch_to_css(l, c, h, alpha, &mut buf).ok()?;
    Some(buf)
}

/// Convert a CSS colour value to any supported space.
/// Returns `null` if the input is not a recognised colour.
#[wasm_bindgen]
pub fn convert_color(input: &str, to_space: &str) -> Option<String> {
    let space = match to_space {
        "hex" => convert::Space::Hex,
        "rgb" => convert::Space::Rgb,
        "hsl" => convert::Space::Hsl,
        "hwb" => convert::Space::Hwb,
        "oklch" => convert::Space::Oklch,
        _ => return None,
    };
    convert::convert(input, space)
}

/// Return the raw scan result struct (for CLI tooling).
pub fn scan_result(input: &str) -> scan::ScanResult {
    scan::audit_css(input)
}

/// Diagnose CSS: returns a human-readable report of colour usage.
pub fn diagnose_css(input: &str) -> String {
    let r = scan::audit_css(input);
    format!(
        concat!(
            "Colour usage: {} legacy + {} unique = {} total\n",
            "  hex:   {}\n",
            "  rgb:   {}\n",
            "  hsl:   {}\n",
            "  hwb:   {}\n",
            "  named: {}\n",
            "  gradients: {}\n",
        ),
        r.legacy_count,
        r.unique_count,
        r.legacy_count + r.unique_count,
        r.hex_count,
        r.rgb_count,
        r.hsl_count,
        r.hwb_count,
        r.named_count,
        r.gradient_count,
    )
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
