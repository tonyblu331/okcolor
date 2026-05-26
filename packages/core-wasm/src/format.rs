use std::fmt::Write;

use crate::math;

// ── sRGB → CSS formatters ──────────────────────────────────────────────

/// sRGB gamma (0.0–1.0) → CSS hex string (`#RRGGBB` or `#RRGGBBAA`).
pub fn srgb_to_hex(r: f64, g: f64, b: f64, alpha: Option<f64>) -> String {
    let ri = (r.clamp(0.0, 1.0) * 255.0).round() as u8;
    let gi = (g.clamp(0.0, 1.0) * 255.0).round() as u8;
    let bi = (b.clamp(0.0, 1.0) * 255.0).round() as u8;
    match alpha {
        Some(a) => format!(
            "#{ri:02x}{gi:02x}{bi:02x}{:02x}",
            (a.clamp(0.0, 1.0) * 255.0).round() as u8
        ),
        None => format!("#{ri:02x}{gi:02x}{bi:02x}"),
    }
}

/// sRGB gamma (0.0–1.0) → CSS `rgb(r g b)` / `rgb(r g b / a)`.
pub fn srgb_to_rgb(r: f64, g: f64, b: f64, alpha: Option<f64>) -> String {
    let ri = (r.clamp(0.0, 1.0) * 255.0).round() as u8;
    let gi = (g.clamp(0.0, 1.0) * 255.0).round() as u8;
    let bi = (b.clamp(0.0, 1.0) * 255.0).round() as u8;
    match alpha {
        Some(a) => format!("rgb({ri} {gi} {bi} / {a})"),
        None => format!("rgb({ri} {gi} {bi})"),
    }
}

/// sRGB gamma (0.0–1.0) → CSS `hsl(h s% l%)` / `hsl(h s% l% / a)`.
pub fn srgb_to_hsl(r: f64, g: f64, b: f64, alpha: Option<f64>) -> String {
    let (h, s, l) = math::srgb_to_hsl(r, g, b);
    let h_rounded = (h * 100.0).round() / 100.0;
    let s_rounded = (s * 100.0).round() / 100.0;
    let l_rounded = (l * 100.0).round() / 100.0;
    match alpha {
        Some(a) => format!("hsl({h_rounded} {s_rounded}% {l_rounded}% / {a})"),
        None => format!("hsl({h_rounded} {s_rounded}% {l_rounded}%)"),
    }
}

/// sRGB gamma (0.0–1.0) → CSS `hwb(h w% b%)` / `hwb(h w% b% / a)`.
pub fn srgb_to_hwb(r: f64, g: f64, b: f64, alpha: Option<f64>) -> String {
    let (h, w, b_) = math::srgb_to_hwb(r, g, b);
    let h_rounded = (h * 100.0).round() / 100.0;
    let w_rounded = (w * 100.0).round() / 100.0;
    let b_rounded = (b_ * 100.0).round() / 100.0;
    match alpha {
        Some(a) => format!("hwb({h_rounded} {w_rounded}% {b_rounded}% / {a})"),
        None => format!("hwb({h_rounded} {w_rounded}% {b_rounded}%)"),
    }
}

/// Format OKLCH as CSS `oklch()` functional notation.
///
/// Per CSS Color 4 §10.9, achromatic colors (chroma < 0.0002) have a
/// *powerless* hue component that MUST be clamped to 0.
pub fn oklch_to_css(
    l: f64,
    c: f64,
    h: f64,
    alpha: Option<f64>,
    out: &mut impl Write,
) -> std::fmt::Result {
    let l_rounded = (l * 100.0 * 100.0).round() / 100.0;
    let c_rounded = (c * 100_000.0).round() / 100_000.0;
    let h_rounded = if c_rounded < 0.0002 {
        0.0
    } else {
        (h * 100.0).round() / 100.0
    };

    match alpha {
        Some(a) => {
            let a_rounded = (a * 10_000.0).round() / 10_000.0;
            write!(
                out,
                "oklch({l_rounded}% {c_rounded} {h_rounded} / {a_rounded})"
            )
        }
        None => write!(out, "oklch({l_rounded}% {c_rounded} {h_rounded})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── hex ──

    #[test]
    fn hex_red() {
        assert_eq!(srgb_to_hex(1.0, 0.0, 0.0, None), "#ff0000");
    }

    #[test]
    fn hex_green() {
        assert_eq!(srgb_to_hex(0.0, 1.0, 0.0, None), "#00ff00");
    }

    #[test]
    fn hex_white() {
        assert_eq!(srgb_to_hex(1.0, 1.0, 1.0, None), "#ffffff");
    }

    #[test]
    fn hex_black() {
        assert_eq!(srgb_to_hex(0.0, 0.0, 0.0, None), "#000000");
    }

    #[test]
    fn hex_with_alpha() {
        assert_eq!(srgb_to_hex(1.0, 0.0, 0.0, Some(0.5)), "#ff000080");
    }

    // ── rgb() ──

    #[test]
    fn rgb_red() {
        assert_eq!(srgb_to_rgb(1.0, 0.0, 0.0, None), "rgb(255 0 0)");
    }

    #[test]
    fn rgb_with_alpha() {
        assert_eq!(srgb_to_rgb(1.0, 0.0, 0.0, Some(0.5)), "rgb(255 0 0 / 0.5)");
    }

    // ── hsl() ──

    #[test]
    fn hsl_red() {
        assert_eq!(srgb_to_hsl(1.0, 0.0, 0.0, None), "hsl(0 100% 50%)");
    }

    #[test]
    fn hsl_blue() {
        assert_eq!(srgb_to_hsl(0.0, 0.0, 1.0, None), "hsl(240 100% 50%)");
    }

    #[test]
    fn hsl_white() {
        assert_eq!(srgb_to_hsl(1.0, 1.0, 1.0, None), "hsl(0 0% 100%)");
    }

    // ── hwb() ──

    #[test]
    fn hwb_red() {
        assert_eq!(srgb_to_hwb(1.0, 0.0, 0.0, None), "hwb(0 0% 0%)");
    }

    #[test]
    fn hwb_white() {
        assert_eq!(srgb_to_hwb(1.0, 1.0, 1.0, None), "hwb(0 100% 0%)");
    }

    #[test]
    fn hwb_black() {
        assert_eq!(srgb_to_hwb(0.0, 0.0, 0.0, None), "hwb(0 0% 100%)");
    }

    #[test]
    fn format_opaque() {
        let mut buf = String::new();
        oklch_to_css(0.5, 0.2, 180.0, None, &mut buf).unwrap();
        assert_eq!(buf, "oklch(50% 0.2 180)");
    }

    #[test]
    fn format_with_alpha() {
        let mut buf = String::new();
        oklch_to_css(0.5, 0.2, 180.0, Some(0.5), &mut buf).unwrap();
        assert_eq!(buf, "oklch(50% 0.2 180 / 0.5)");
    }

    #[test]
    fn format_achromatic_clamps_hue() {
        let mut buf = String::new();
        oklch_to_css(0.5, 0.0001, 45.0, None, &mut buf).unwrap();
        assert_eq!(buf, "oklch(50% 0.0001 0)");
    }

    #[test]
    fn format_rounds_lightness() {
        // 0.12345 → 12.345 → rounds to 12.35
        let mut buf = String::new();
        oklch_to_css(0.12345, 0.2, 180.0, None, &mut buf).unwrap();
        assert_eq!(buf, "oklch(12.35% 0.2 180)");
    }

    #[test]
    fn format_with_transparent_alpha() {
        let mut buf = String::new();
        oklch_to_css(1.0, 0.0, 0.0, Some(0.0), &mut buf).unwrap();
        assert_eq!(buf, "oklch(100% 0 0 / 0)");
    }

    #[test]
    fn format_alpha_rounding() {
        // 0.123456 → rounds to 0.1235
        let mut buf = String::new();
        oklch_to_css(0.5, 0.2, 180.0, Some(0.123456), &mut buf).unwrap();
        assert_eq!(buf, "oklch(50% 0.2 180 / 0.1235)");
    }
}
