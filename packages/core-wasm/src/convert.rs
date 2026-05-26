use crate::format;
use crate::math;
use crate::parse;
use crate::types::RawColor;

/// Target colour spaces for conversion.
pub enum Space {
    Hex,
    Rgb,
    Hsl,
    Hwb,
    Oklch,
}

/// Convert a CSS colour value string to the target space.
pub fn convert(input: &str, to: Space) -> Option<String> {
    let raw: RawColor = parse::parse_single_color(input)?;
    match to {
        Space::Hex => Some(format::srgb_to_hex(raw.r, raw.g, raw.b, raw.alpha)),
        Space::Rgb => Some(format::srgb_to_rgb(raw.r, raw.g, raw.b, raw.alpha)),
        Space::Hsl => Some(format::srgb_to_hsl(raw.r, raw.g, raw.b, raw.alpha)),
        Space::Hwb => Some(format::srgb_to_hwb(raw.r, raw.g, raw.b, raw.alpha)),
        Space::Oklch => {
            let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
            let mut buf = String::new();
            format::oklch_to_css(l, c, h, alpha, &mut buf).ok()?;
            Some(buf)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convert_hex_to_oklch() {
        let r = convert("#ff0000", Space::Oklch).unwrap();
        assert_eq!(r, "oklch(62.8% 0.25768 29.23)");
    }

    #[test]
    fn convert_hex_to_hsl() {
        let r = convert("#ff0000", Space::Hsl).unwrap();
        assert_eq!(r, "hsl(0 100% 50%)");
    }

    #[test]
    fn convert_hex_to_hwb() {
        let r = convert("#ff0000", Space::Hwb).unwrap();
        assert_eq!(r, "hwb(0 0% 0%)");
    }

    #[test]
    fn convert_hex_to_hex() {
        let r = convert("#ff0000", Space::Hex).unwrap();
        assert_eq!(r, "#ff0000");
    }

    #[test]
    fn convert_hex_to_rgb() {
        let r = convert("#ff0000", Space::Rgb).unwrap();
        assert_eq!(r, "rgb(255 0 0)");
    }

    #[test]
    fn convert_rgb_to_oklch() {
        let r = convert("rgb(255 0 0)", Space::Oklch).unwrap();
        assert_eq!(r, "oklch(62.8% 0.25768 29.23)");
    }

    #[test]
    fn convert_hsl_to_hex() {
        let r = convert("hsl(0 100% 50%)", Space::Hex).unwrap();
        assert_eq!(r, "#ff0000");
    }

    #[test]
    fn convert_hwb_to_hex() {
        let r = convert("hwb(0 0% 0%)", Space::Hex).unwrap();
        assert_eq!(r, "#ff0000");
    }

    #[test]
    fn convert_hwb_with_white_and_black_to_hex() {
        let r = convert("hwb(0 20% 30%)", Space::Hex).unwrap();
        assert_eq!(r, "#b33333");
    }

    #[test]
    fn convert_named_to_oklch() {
        let r = convert("red", Space::Oklch).unwrap();
        assert_eq!(r, "oklch(62.8% 0.25768 29.23)");
    }

    #[test]
    fn convert_oklch_to_hex() {
        let r = convert("oklch(62.796% 0.25768 29.2339)", Space::Hex).unwrap();
        assert_eq!(r, "#ff0000");
    }

    #[test]
    fn convert_oklch_to_hsl() {
        let r = convert("oklch(62.796% 0.25768 29.2339)", Space::Hsl).unwrap();
        assert_eq!(r, "hsl(0 100% 50%)");
    }

    #[test]
    fn convert_oklch_to_oklch() {
        let r = convert("oklch(62.796% 0.25768 29.2339)", Space::Oklch).unwrap();
        assert_eq!(r, "oklch(62.8% 0.25768 29.23)");
    }

    #[test]
    fn convert_oklch_white() {
        let r = convert("oklch(100% 0 0)", Space::Hex).unwrap();
        assert_eq!(r, "#ffffff");
    }

    #[test]
    fn convert_oklch_black() {
        let r = convert("oklch(0% 0 0)", Space::Hex).unwrap();
        assert_eq!(r, "#000000");
    }

    #[test]
    fn convert_invalid_returns_none() {
        assert!(convert("not-a-color", Space::Oklch).is_none());
    }
}
