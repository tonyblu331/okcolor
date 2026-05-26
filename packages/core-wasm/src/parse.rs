use crate::math;
use crate::named;
use crate::types::RawColor;

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

/// Parse `#RRGGBB`, `#RGB`, `#RRGGBBAA`, or `#RGBA` to `RawColor`.
pub fn parse_hex(digits: &[u8]) -> Option<RawColor> {
    let (r, g, b, alpha) = match digits.len() {
        3 => (
            hex_val(digits[0]) * 17,
            hex_val(digits[1]) * 17,
            hex_val(digits[2]) * 17,
            None,
        ),
        4 => (
            hex_val(digits[0]) * 17,
            hex_val(digits[1]) * 17,
            hex_val(digits[2]) * 17,
            Some(hex_val(digits[3]) as f64 / 15.0),
        ),
        6 => (
            hex_val(digits[0]) * 16 + hex_val(digits[1]),
            hex_val(digits[2]) * 16 + hex_val(digits[3]),
            hex_val(digits[4]) * 16 + hex_val(digits[5]),
            None,
        ),
        8 => (
            hex_val(digits[0]) * 16 + hex_val(digits[1]),
            hex_val(digits[2]) * 16 + hex_val(digits[3]),
            hex_val(digits[4]) * 16 + hex_val(digits[5]),
            Some((hex_val(digits[6]) * 16 + hex_val(digits[7])) as f64 / 255.0),
        ),
        _ => return None,
    };
    Some(RawColor {
        r: r as f64 / 255.0,
        g: g as f64 / 255.0,
        b: b as f64 / 255.0,
        alpha,
    })
}

// ─── RGB ───

pub fn parse_rgb(tokens: &[&str]) -> Option<RawColor> {
    if tokens.len() < 3 {
        return None;
    }
    let r = parse_u8(tokens[0])?;
    let g = parse_u8(tokens[1])?;
    let b = parse_u8(tokens[2])?;
    Some(RawColor {
        r: r as f64 / 255.0,
        g: g as f64 / 255.0,
        b: b as f64 / 255.0,
        alpha: parse_alpha(tokens.get(3).copied()),
    })
}

// ─── HSL ───

pub fn parse_hsl(tokens: &[&str]) -> Option<RawColor> {
    if tokens.len() < 3 {
        return None;
    }
    let (r, g, b) = math::hsl_to_srgb(
        parse_angle(tokens[0]),
        parse_percent(tokens[1]),
        parse_percent(tokens[2]),
    );
    Some(RawColor {
        r,
        g,
        b,
        alpha: parse_alpha(tokens.get(3).copied()),
    })
}

// ─── HWB ───

pub fn parse_hwb(tokens: &[&str]) -> Option<RawColor> {
    if tokens.len() < 3 {
        return None;
    }
    let (r, g, b) = math::hwb_to_srgb(
        parse_angle(tokens[0]),
        parse_percent(tokens[1]),
        parse_percent(tokens[2]),
    );
    Some(RawColor {
        r,
        g,
        b,
        alpha: parse_alpha(tokens.get(3).copied()),
    })
}

// ─── oklch() ───

/// Parse `oklch(L C H / alpha)` to `RawColor`.
/// L may be 0–1 or 0%–100%; C is chroma; H is hue in degrees.
pub fn parse_oklch(tokens: &[&str]) -> Option<RawColor> {
    if tokens.len() < 3 {
        return None;
    }
    let raw_l = parse_lightness(tokens[0]);
    let c = parse_chroma(tokens[1]);
    let h = parse_angle(tokens[2]);
    let (r, g, b) = math::oklch_to_srgb(raw_l, c, h);
    Some(RawColor {
        r,
        g,
        b,
        alpha: parse_alpha(tokens.get(3).copied()),
    })
}

fn parse_lightness(s: &str) -> f64 {
    if let Some(rest) = s.strip_suffix('%') {
        rest.parse::<f64>().unwrap_or(0.0) / 100.0
    } else {
        s.parse::<f64>().unwrap_or(0.0)
    }
}

fn parse_chroma(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(0.0).abs()
}

// ─── color(srgb …) ───

pub fn parse_color_srgb(tokens: &[&str]) -> Option<RawColor> {
    if tokens.len() < 4 || !tokens[0].eq_ignore_ascii_case("srgb") {
        return None;
    }
    let r = tokens[1].parse::<f64>().ok()?;
    let g = tokens[2].parse::<f64>().ok()?;
    let b = tokens[3].parse::<f64>().ok()?;
    Some(RawColor {
        r,
        g,
        b,
        alpha: parse_alpha(tokens.get(4).copied()),
    })
}

// ─── Named ───

pub fn parse_named(name: &[u8]) -> Option<RawColor> {
    let lower = name.to_ascii_lowercase();
    let name_str = std::str::from_utf8(&lower).ok()?;
    let [rr, gg, bb] = named::lookup(name_str)?;
    Some(RawColor {
        r: rr as f64 / 255.0,
        g: gg as f64 / 255.0,
        b: bb as f64 / 255.0,
        alpha: None,
    })
}

/// Same as `parse_named` but assumes bytes are already lowercased.
pub fn parse_named_lowered(name: &[u8]) -> Option<RawColor> {
    let name_str = std::str::from_utf8(name).ok()?;
    let [rr, gg, bb] = named::lookup(name_str)?;
    Some(RawColor {
        r: rr as f64 / 255.0,
        g: gg as f64 / 255.0,
        b: bb as f64 / 255.0,
        alpha: None,
    })
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
    match s.strip_suffix('%') {
        Some(rest) => rest.parse::<f64>().unwrap_or(0.0),
        None => s.parse::<f64>().unwrap_or(0.0),
    }
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

/// Extract body inside the first pair of parentheses.
fn extract_body(s: &str) -> Option<&str> {
    let open = s.find('(')?;
    let close = s.rfind(')')?;
    if close <= open {
        return None;
    }
    Some(&s[open + 1..close])
}

/// Parse a single CSS colour value (hex, rgb(), hsl(), hwb(), oklch(), color(srgb …), or named)
/// into a RawColor. Convenience for the WASM bindings and convert dispatcher.
pub fn parse_single_color(trimmed: &str) -> Option<RawColor> {
    // Hex
    if let Some(rest) = trimmed.strip_prefix('#') {
        return parse_hex(rest.as_bytes());
    }

    // Function colours — extract body between parens first
    if let Some(body) = extract_body(trimmed) {
        let toks = tokenize_body(body);
        return if trimmed.starts_with("rgb") || trimmed.starts_with("rgba") {
            parse_rgb(&toks)
        } else if trimmed.starts_with("hsl") || trimmed.starts_with("hsla") {
            parse_hsl(&toks)
        } else if trimmed.starts_with("hwb") {
            parse_hwb(&toks)
        } else if trimmed.starts_with("color") {
            parse_color_srgb(&toks)
        } else if trimmed.starts_with("oklch") {
            parse_oklch(&toks)
        } else {
            None
        };
    }

    // Named
    parse_named(trimmed.as_bytes())
}

// ─── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_6_red() {
        let p = parse_hex(b"ff0000").unwrap();
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
        approx(p.b, 0.0);
        assert_eq!(p.alpha, None);
    }

    #[test]
    fn hex_3_red() {
        let p = parse_hex(b"f00").unwrap();
        approx_delta(p.r, 1.0, 1e-4);
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
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
    }

    #[test]
    fn rgb_percent() {
        let p = parse_rgb(&["100%", "0%", "0%"]).unwrap();
        approx_delta(p.r, 1.0, 1e-4);
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
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
        approx(p.b, 0.0);
    }

    #[test]
    fn hsl_with_alpha() {
        let p = parse_hsl(&["0", "100%", "50%", "0.5"]).unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn hwb_red() {
        let p = parse_hwb(&["0", "0%", "0%"]).unwrap();
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
        approx(p.b, 0.0);
    }

    #[test]
    fn hwb_white() {
        let p = parse_hwb(&["0", "100%", "0%"]).unwrap();
        approx_delta(p.r, 1.0, 1e-4);
        approx_delta(p.g, 1.0, 1e-4);
        approx_delta(p.b, 1.0, 1e-4);
    }

    #[test]
    fn hwb_with_white_and_black() {
        let p = parse_hwb(&["0", "20%", "30%"]).unwrap();
        approx_delta(p.r, 0.7, 1e-4);
        approx_delta(p.g, 0.2, 1e-4);
        approx_delta(p.b, 0.2, 1e-4);
    }

    #[test]
    fn color_srgb() {
        let p = parse_color_srgb(&["srgb", "1", "0", "0"]).unwrap();
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
        approx(p.b, 0.0);
    }

    #[test]
    fn color_srgb_with_alpha() {
        let p = parse_color_srgb(&["srgb", "1", "0", "0", "0.5"]).unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn named_red() {
        let p = parse_named(b"red").unwrap();
        approx_delta(p.r, 1.0, 1e-4);
        approx(p.g, 0.0);
        approx(p.b, 0.0);
    }

    #[test]
    fn named_case_insensitive() {
        let p = parse_named(b"RED").unwrap();
        approx_delta(p.r, 1.0, 1e-4);
    }

    #[test]
    fn named_transparent_not_found() {
        assert!(parse_named(b"transparent").is_none());
    }

    #[test]
    fn named_lowered_red() {
        let p = parse_named_lowered(b"red").unwrap();
        approx_delta(p.r, 1.0, 1e-4);
    }

    #[test]
    fn named_lowered_uppercase_still_works() {
        // parse_named_lowered doesn't lowercase, so "RED" fails
        assert!(parse_named_lowered(b"RED").is_none());
    }

    fn approx_delta(a: f64, b: f64, delta: f64) {
        assert!((a - b).abs() < delta, "expected {b} ±{delta}, got {a}");
    }

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "expected {b}, got {a}");
    }

    // ── oklch() ──

    #[test]
    fn parse_oklch_red() {
        let p = parse_oklch(&["0.62796", "0.25768", "29.2339"]).unwrap();
        approx_delta(p.r, 1.0, 2e-3);
        approx_delta(p.g, 0.0, 2e-3);
        approx_delta(p.b, 0.0, 2e-3);
        assert_eq!(p.alpha, None);
    }

    #[test]
    fn parse_oklch_with_percent_lightness() {
        let p = parse_oklch(&["62.796%", "0.25768", "29.2339"]).unwrap();
        approx_delta(p.r, 1.0, 2e-3);
        approx_delta(p.g, 0.0, 2e-3);
        approx_delta(p.b, 0.0, 2e-3);
    }

    #[test]
    fn parse_oklch_via_single_color() {
        let p = parse_single_color("oklch(62.796% 0.25768 29.2339)").unwrap();
        approx_delta(p.r, 1.0, 2e-3);
        approx_delta(p.g, 0.0, 2e-3);
        approx_delta(p.b, 0.0, 2e-3);
    }

    #[test]
    fn parse_oklch_invalid() {
        assert!(parse_oklch(&[""]).is_none());
        assert!(parse_oklch(&["0.5", "0.1"]).is_none());
    }
}
