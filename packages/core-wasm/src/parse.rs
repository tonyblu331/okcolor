use crate::cache;
use crate::math;
use crate::named;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedColor {
    pub l: f64,
    pub c: f64,
    pub h: f64,
    pub alpha: Option<f64>,
}

// ── Char helpers ───────────────────────────────────────────────────────

fn hex_val(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    }
}


// ── Hex ────────────────────────────────────────────────────────────────

/// Parse `#RRGGBB`, `#RGB`, `#RRGGBBAA`, or `#RGBA`.
pub fn parse_hex(digits: &[u8]) -> Option<ParsedColor> {
    match digits.len() {
        3 => {
            let r = hex_val(digits[0]) * 17;
            let g = hex_val(digits[1]) * 17;
            let b = hex_val(digits[2]) * 17;
            convert_srgb8(r, g, b, None)
        }
        4 => {
            let r = hex_val(digits[0]) * 17;
            let g = hex_val(digits[1]) * 17;
            let b = hex_val(digits[2]) * 17;
            let a = hex_val(digits[3]) as f64 / 15.0;
            convert_srgb8(r, g, b, Some(a))
        }
        6 => {
            let r = hex_val(digits[0]) * 16 + hex_val(digits[1]);
            let g = hex_val(digits[2]) * 16 + hex_val(digits[3]);
            let b = hex_val(digits[4]) * 16 + hex_val(digits[5]);
            convert_srgb8(r, g, b, None)
        }
        8 => {
            let r = hex_val(digits[0]) * 16 + hex_val(digits[1]);
            let g = hex_val(digits[2]) * 16 + hex_val(digits[3]);
            let b = hex_val(digits[4]) * 16 + hex_val(digits[5]);
            let a = (hex_val(digits[6]) * 16 + hex_val(digits[7])) as f64 / 255.0;
            convert_srgb8(r, g, b, Some(a))
        }
        _ => None,
    }
}

// ─── RGB ───

pub fn parse_rgb(tokens: &[&str]) -> Option<ParsedColor> {
    if tokens.len() < 3 {
        return None;
    }
    convert_srgb8(
        parse_u8(tokens[0])?,
        parse_u8(tokens[1])?,
        parse_u8(tokens[2])?,
        parse_alpha(tokens.get(3).copied()),
    )
}

// ─── HSL ───

pub fn parse_hsl(tokens: &[&str]) -> Option<ParsedColor> {
    if tokens.len() < 3 {
        return None;
    }
    let (r, g, b) = math::hsl_to_srgb(
        parse_angle(tokens[0]),
        parse_percent(tokens[1]),
        parse_percent(tokens[2]),
    );
    Some(convert_srgb_float(r, g, b, parse_alpha(tokens.get(3).copied())))
}

// ─── HWB ───

pub fn parse_hwb(tokens: &[&str]) -> Option<ParsedColor> {
    if tokens.len() < 3 {
        return None;
    }
    let (r, g, b) = math::hwb_to_srgb(
        parse_angle(tokens[0]),
        parse_percent(tokens[1]),
        parse_percent(tokens[2]),
    );
    Some(convert_srgb_float(r, g, b, parse_alpha(tokens.get(3).copied())))
}

// ─── color(srgb …) ───

pub fn parse_color_srgb(tokens: &[&str]) -> Option<ParsedColor> {
    if tokens.len() < 4 || !tokens[0].eq_ignore_ascii_case("srgb") {
        return None;
    }
    let r = tokens[1].parse::<f64>().ok()?;
    let g = tokens[2].parse::<f64>().ok()?;
    let b = tokens[3].parse::<f64>().ok()?;
    Some(convert_srgb_float(r, g, b, parse_alpha(tokens.get(4).copied())))
}

// ─── Named ───

pub fn parse_named(name: &[u8]) -> Option<ParsedColor> {
    let lower = name.to_ascii_lowercase();
    let name_str = std::str::from_utf8(&lower).ok()?;
    let rgb = named::lookup(name_str)?;
    convert_srgb8(rgb[0], rgb[1], rgb[2], None)
}

// ─── Tokenising for function colours ───────────────────────────────────

/// Split `rgb(…​)` / `hsl(…​)` / `hwb(…​)` body by `/`, `,`, and whitespace.
pub fn tokenize_body(body: &str) -> Vec<&str> {
    body.split(|c: char| c == ',' || c == '/' || c.is_ascii_whitespace())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect()
}

// ─── Number helpers ────────────────────────────────────────────────────

fn parse_u8(s: &str) -> Option<u8> {
    let s = s.trim();
    if let Some(rest) = s.strip_suffix('%') {
        let n = rest.parse::<f64>().ok()?;
        Some(((n / 100.0) * 255.0).round().clamp(0.0, 255.0) as u8)
    } else {
        let n = s.parse::<i32>().ok()?;
        Some(n.clamp(0, 255) as u8)
    }
}

fn parse_percent(s: &str) -> f64 {
    let num = match s.strip_suffix('%') {
        Some(rest) => rest.parse::<f64>().unwrap_or(0.0),
        None => s.parse::<f64>().unwrap_or(0.0),
    };
    num
}

fn parse_angle(s: &str) -> f64 {
    let s = s.trim();
    if let Some(rest) = s.strip_suffix("deg") {
        rest.parse::<f64>().unwrap_or(0.0)
    } else {
        s.parse::<f64>().unwrap_or(0.0)
    }
}

fn parse_alpha(s: Option<&str>) -> Option<f64> {
    let s = s?;
    if let Some(rest) = s.strip_suffix('%') {
        rest.parse::<f64>().ok().map(|n| n / 100.0)
    } else {
        s.parse::<f64>().ok()
    }
}

// ─── Conversion helpers ────────────────────────────────────────────────

fn convert_srgb8(r: u8, g: u8, b: u8, alpha: Option<f64>) -> Option<ParsedColor> {
    let a8 = alpha.map(|a| (a * 255.0).round() as u8).unwrap_or(255);
    if let Some((l, c, h)) = cache::cache_get(r, g, b, a8) {
        return Some(ParsedColor { l, c, h, alpha });
    }
    let (l, c, h) = math::srgb8_to_oklch(r, g, b);
    cache::cache_set(r, g, b, a8, (l, c, h));
    Some(ParsedColor { l, c, h, alpha })
}

fn convert_srgb_float(r: f64, g: f64, b: f64, alpha: Option<f64>) -> ParsedColor {
    let (l, c, h) = math::srgb_float_to_oklch(r, g, b);
    ParsedColor { l, c, h, alpha }
}

// ─── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_6_red() {
        let p = parse_hex(b"ff0000").unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
        approx_delta(p.c, 0.25768, 1e-4);
        assert_eq!(p.alpha, None);
    }

    #[test]
    fn hex_3_red() {
        let p = parse_hex(b"f00").unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn hex_8_with_alpha() {
        let p = parse_hex(b"ff000080").unwrap();
        approx_delta(p.alpha.unwrap(), 0.50196, 1e-4);
    }

    #[test]
    fn hex_4_short_alpha() {
        let p = parse_hex(b"f008").unwrap();
        approx_delta(p.alpha.unwrap(), 0.5333, 1e-3);
    }

    #[test]
    fn hex_invalid_length() {
        assert!(parse_hex(b"ff").is_none());
        assert!(parse_hex(b"fffff").is_none());
    }

    #[test]
    fn rgb_comma() {
        let p = parse_rgb(&["255", "0", "0"]).unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn rgb_percent() {
        let p = parse_rgb(&["100%", "0%", "0%"]).unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn rgb_with_alpha() {
        let p = parse_rgb(&["255", "0", "0", "0.5"]).unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn rgb_with_alpha_percent() {
        let p = parse_rgb(&["255", "0", "0", "50%"]).unwrap();
        approx_delta(p.alpha.unwrap(), 0.5, 1e-4);
    }

    #[test]
    fn hsl_red() {
        let p = parse_hsl(&["0", "100%", "50%"]).unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn hsl_with_alpha() {
        let p = parse_hsl(&["0", "100%", "50%", "0.5"]).unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn hwb_red() {
        let p = parse_hwb(&["0", "0%", "0%"]).unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn hwb_white() {
        let p = parse_hwb(&["0", "100%", "0%"]).unwrap();
        approx_delta(p.l, 1.0, 1e-4);
    }

    #[test]
    fn color_srgb() {
        let p = parse_color_srgb(&["srgb", "1", "0", "0"]).unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn color_srgb_with_alpha() {
        let p = parse_color_srgb(&["srgb", "1", "0", "0", "0.5"]).unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn named_red() {
        let p = parse_named(b"red").unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn named_case_insensitive() {
        let p = parse_named(b"RED").unwrap();
        approx_delta(p.l, 0.62796, 1e-4);
    }

    #[test]
    fn named_transparent_not_found() {
        assert!(parse_named(b"transparent").is_none());
    }

    fn approx_delta(a: f64, b: f64, delta: f64) {
        assert!((a - b).abs() < delta, "expected {b} ±{delta}, got {a}");
    }
}
