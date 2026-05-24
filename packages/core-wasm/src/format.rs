/// Format OKLCH as CSS `oklch()` functional notation.
///
/// Per CSS Color 4 §10.9, achromatic colors (chroma < 0.0002) have a
/// *powerless* hue component that MUST be clamped to 0.
pub fn oklch_to_css(l: f64, c: f64, h: f64, alpha: Option<f64>) -> String {
    let l_rounded = (l * 100.0 * 100.0).round() / 100.0;
    let c_rounded = (c * 100_000.0).round() / 100_000.0;
    let h_rounded = if c_rounded < 0.0002 { 0.0 } else { (h * 100.0).round() / 100.0 };

    match alpha {
        Some(a) => {
            let a_rounded = (a * 10_000.0).round() / 10_000.0;
            format!("oklch({l_rounded}% {c_rounded} {h_rounded} / {a_rounded})")
        }
        None => format!("oklch({l_rounded}% {c_rounded} {h_rounded})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_opaque() {
        assert_eq!(oklch_to_css(0.5, 0.2, 180.0, None), "oklch(50% 0.2 180)");
    }

    #[test]
    fn format_with_alpha() {
        assert_eq!(
            oklch_to_css(0.5, 0.2, 180.0, Some(0.5)),
            "oklch(50% 0.2 180 / 0.5)"
        );
    }

    #[test]
    fn format_achromatic_clamps_hue() {
        assert_eq!(
            oklch_to_css(0.5, 0.0001, 45.0, None),
            "oklch(50% 0.0001 0)"
        );
    }

    #[test]
    fn format_rounds_lightness() {
        // 0.12345 → 12.345 → rounds to 12.35
        assert_eq!(
            oklch_to_css(0.12345, 0.2, 180.0, None),
            "oklch(12.35% 0.2 180)"
        );
    }

    #[test]
    fn format_with_transparent_alpha() {
        assert_eq!(
            oklch_to_css(1.0, 0.0, 0.0, Some(0.0)),
            "oklch(100% 0 0 / 0)"
        );
    }

    #[test]
    fn format_alpha_rounding() {
        // 0.123456 → rounds to 0.1235
        assert_eq!(
            oklch_to_css(0.5, 0.2, 180.0, Some(0.123456)),
            "oklch(50% 0.2 180 / 0.1235)"
        );
    }
}
