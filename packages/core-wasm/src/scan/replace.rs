use super::ScanResult;
use super::token::{
    find_close_paren, func_color_type, is_css_ident_byte, skip_alpha, skip_whitespace,
};
use crate::format::oklch_to_css;
use crate::math;
use crate::parse;
use crate::types::RawColor;

fn hex_digit_count(bytes: &[u8], mut i: usize) -> usize {
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_hexdigit() {
        i += 1;
    }
    i - start
}

// ── Named colour boundary detection ─────────────────────────────────────

fn named_at(bytes: &[u8], i: usize) -> Option<usize> {
    let mut end = i;
    skip_alpha(bytes, &mut end);
    if end == i {
        return None;
    }
    // Must be followed by word boundary
    if end < bytes.len() && is_css_ident_byte(bytes[end]) {
        return None;
    }
    Some(end)
}

#[derive(Clone, Copy)]
enum ColorKind {
    Hex,
    Rgb,
    Hsl,
    Hwb,
    Named,
}

impl ColorKind {
    fn record(self, stat: &mut ScanResult) {
        match self {
            Self::Hex => stat.hex_count += 1,
            Self::Rgb => stat.rgb_count += 1,
            Self::Hsl => stat.hsl_count += 1,
            Self::Hwb => stat.hwb_count += 1,
            Self::Named => stat.named_count += 1,
        }
    }
}

struct ColorMatch {
    end: usize,
    kind: ColorKind,
    raw: RawColor,
}

/// Match one legacy colour at `bytes[i..]`.
///
/// This is the scanner's colour registry seam: transform and audit mode both
/// use the same recogniser so parsing rules cannot drift between modes.
fn match_color_at(
    bytes: &[u8],
    i: usize,
    value_context: bool,
    allow_named_colors: bool,
) -> Option<ColorMatch> {
    if !value_context {
        return None;
    }

    // Hex
    if bytes[i] == b'#' {
        let start = i + 1;
        let end = start + hex_digit_count(bytes, start);
        let cnt = end - start;
        if (3..=8).contains(&cnt) && cnt != 5 && cnt != 7 {
            if end < bytes.len() && is_css_ident_byte(bytes[end]) {
                return None;
            }
            let mut la = end;
            skip_whitespace(bytes, &mut la);
            if la < bytes.len() && bytes[la] == b'{' {
                return None;
            }
            let raw = parse::parse_hex(&bytes[start..end])?;
            return Some(ColorMatch {
                end,
                kind: ColorKind::Hex,
                raw,
            });
        }
        return None;
    }

    // Function colours
    if let Some((name_off, kind)) = func_color_type(bytes, i) {
        let mut pos = name_off;
        skip_whitespace(bytes, &mut pos);
        if pos >= bytes.len() || bytes[pos] != b'(' {
            return None;
        }
        let close = find_close_paren(bytes, pos)?;
        let body = std::str::from_utf8(&bytes[pos + 1..close]).ok()?;
        let toks = parse::tokenize_body(body);

        let raw = match kind {
            "rgb" => parse::parse_rgb(&toks),
            "hsl" => parse::parse_hsl(&toks),
            "hwb" => parse::parse_hwb(&toks),
            "color" => parse::parse_color_srgb(&toks),
            _ => None,
        };
        let raw = raw?;
        let kind = match kind {
            "rgb" | "color" => ColorKind::Rgb,
            "hsl" => ColorKind::Hsl,
            "hwb" => ColorKind::Hwb,
            _ => return None,
        };
        return Some(ColorMatch {
            end: close + 1,
            kind,
            raw,
        });
    }

    // Named — uses [u8; 32] stack buffer to avoid heap allocation.
    if !allow_named_colors {
        return None;
    }
    if let Some(end) = named_at(bytes, i) {
        let raw_bytes = &bytes[i..end];
        let mut buf = [0u8; 32];
        let lowered = if raw_bytes.len() <= 32 {
            buf[..raw_bytes.len()].copy_from_slice(raw_bytes);
            buf[..raw_bytes.len()].make_ascii_lowercase();
            &buf[..raw_bytes.len()]
        } else {
            return None;
        };

        let raw = parse::parse_named_lowered(lowered)?;
        return Some(ColorMatch {
            end,
            kind: ColorKind::Named,
            raw,
        });
    }

    None
}

/// Transform-mode colour matcher: hex, function, or named.
/// Writes OKLCH replacement directly to `out` and returns cursor position.
pub(super) fn replace_at_transform(
    bytes: &[u8],
    i: usize,
    stat: &mut ScanResult,
    out: &mut String,
    value_context: bool,
    allow_named_colors: bool,
) -> Option<usize> {
    let matched = match_color_at(bytes, i, value_context, allow_named_colors)?;
    matched.kind.record(stat);
    let (l, c, h, alpha) = math::raw_to_oklch(
        matched.raw.r,
        matched.raw.g,
        matched.raw.b,
        matched.raw.alpha,
    );
    oklch_to_css(l, c, h, alpha, out).ok()?;
    Some(matched.end)
}

/// Audit-mode colour matcher: hex, function, or named.
/// Counts colours in `stat` but does NO output.
/// Returns cursor position (same as transform), never allocates.
pub(super) fn replace_at_audit(
    bytes: &[u8],
    i: usize,
    stat: &mut ScanResult,
    value_context: bool,
    allow_named_colors: bool,
) -> Option<usize> {
    let matched = match_color_at(bytes, i, value_context, allow_named_colors)?;
    matched.kind.record(stat);
    Some(matched.end)
}
