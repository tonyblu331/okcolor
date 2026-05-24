//! Character-level CSS scanner.
//!
//! Walks the input byte-by-byte without any regex crate. Dispatches to
//! gradient, hex, function-colour, and named-colour matchers at word
//! boundaries. In transform mode it rewrites matches in-place into
//! `oklch(...)`; in audit mode it only tallies.

use crate::format::oklch_to_css;
use crate::named;
use crate::parse::{self, ParsedColor};

// ── Public types / entry-points ──────────────────────────────────────────

#[derive(Debug, Default)]
pub struct ScanResult {
    pub css:             String,
    pub legacy_count:    u32,
    pub hex_count:       u32,
    pub rgb_count:       u32,
    pub hsl_count:       u32,
    pub hwb_count:       u32,
    pub named_count:     u32,
    pub gradient_count:  u32,
    pub unique_count:    u32,
}

pub fn transform_css(input: &str) -> String {
    scan(input, true).css
}

pub fn audit_css(input: &str) -> ScanResult {
    scan(input, false)
}

/// Collect byte ranges of line content that should be ignored.
/// A line is ignored if it contains `/* oklch-ignore */`.
fn find_ignore_ranges(input: &str) -> Vec<(usize, usize)> {
    let bytes = input.as_bytes();
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let line_start = i;
        while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
        let line_end = i; // position of '\n' or EOF
        let line = &bytes[line_start..line_end];
        if let Ok(s) = std::str::from_utf8(line) {
            if s.to_lowercase().contains("oklch-ignore") {
                // Only protect the part BEFORE the comment marker itself
                // so the comment is still emitted. Actually, we emit the
                // entire line verbatim — the scanner will skip over this range.
                ranges.push((line_start, if i < bytes.len() { i + 1 } else { i }));
            }
        }
        if i < bytes.len() && bytes[i] == b'\n' { i += 1; }
    }
    ranges
}

// ── Main scan loop ───────────────────────────────────────────────────────

fn scan(input: &str, transform: bool) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut out  = String::with_capacity(len);
    let mut stat = ScanResult::default();

    // Pre-scan for oklch-ignore ranges
    let ignore_ranges = if transform { find_ignore_ranges(input) } else { Vec::new() };

    let mut i    = 0;
    let mut ir_idx = 0;

    while i < len {
        // ── Skip oklch-ignore lines verbatim ─────────────────────
        if ir_idx < ignore_ranges.len() && i == ignore_ranges[ir_idx].0 {
            let end = ignore_ranges[ir_idx].1;
            out.push_str(&input[i..end]);
            i = end;
            ir_idx += 1;
            continue;
        }

        // ── Block comment ─────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            let start = i;
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len { i += 2; } // skip */
            out.push_str(&input[start..i]);
            continue;
        }

        // ── Line comment ──────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            let start = i;
            while i < len && bytes[i] != b'\n' { i += 1; }
            out.push_str(&input[start..i]);
            continue;
        }

        // ── String literal (single or double quote) ───────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q   = bytes[i];
            let beg = i;
            i += 1;
            while i < len {
                if bytes[i] == b'\\' { i += 2; }
                else if bytes[i] == q { i += 1; break; }
                else { i += 1; }
            }
            out.push_str(&input[beg..i]);
            continue;
        }

        // ── Gradient ──────────────────────────────────────────────
        if let Some(end) = match_gradient(bytes, i, &mut out, &mut stat, transform) {
            i = end;
            continue;
        }

        // ── Hex colour ────────────────────────────────────────────
        if bytes[i] == b'#' {
            if let Some(end) = match_hex(bytes, i, &mut out, &mut stat, transform) {
                i = end;
                continue;
            }
            out.push(b'#' as char);
            i += 1;
            continue;
        }

        // ── Function colours (rgb, hsl, hwb, color) ───────────────
        if is_word_boundary(bytes, i) {
            if let Some(end) = match_func_color(bytes, i, &mut out, &mut stat, transform) {
                i = end;
                continue;
            }
            // Named color
            if let Some(end) = match_named(bytes, i, &mut out, &mut stat, transform) {
                i = end;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }

    stat.css = out;
    stat.legacy_count = stat.hex_count + stat.rgb_count
                      + stat.hsl_count + stat.hwb_count
                      + stat.named_count;
    stat
}

// ── Low-level helpers ───────────────────────────────────────────────────

fn is_word_boundary(bytes: &[u8], i: usize) -> bool {
    if i == 0 { return true; }
    !bytes[i - 1].is_ascii_alphanumeric() && bytes[i - 1] != b'-'
}

fn skip_whitespace(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
        *i += 1;
    }
}

fn skip_alpha(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && bytes[*i].is_ascii_alphabetic() {
        *i += 1;
    }
}

fn hex_digit_count(bytes: &[u8], mut i: usize) -> usize {
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_hexdigit() { i += 1; }
    i - start
}

const GRADIENT_NAMES: &[&[u8]] = &[
    b"linear-gradient",
    b"radial-gradient",
    b"conic-gradient",
    b"repeating-linear-gradient",
    b"repeating-radial-gradient",
    b"repeating-conic-gradient",
];

const MODERN_FUNCS: &[&[u8]] = &[
    b"oklch", b"oklab", b"lab", b"lch", b"color-mix",
    b"light-dark", b"var", b"calc", b"env",
];

/// Check whether `bytes[i..]` starts with one of `names` at a word boundary.
fn func_at(bytes: &[u8], i: usize, names: &[&[u8]]) -> Option<usize> {
    for name in names {
        if bytes[i..].starts_with(name) {
            let after = i + name.len();
            if after < bytes.len() && (bytes[after].is_ascii_alphanumeric() || bytes[after] == b'-') {
                continue;
            }
            return Some(after);
        }
    }
    None
}

/// Find matching `)` respecting nested parens and strings.
fn find_close_paren(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 1u32;
    i += 1; // skip '('
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 { return Some(i); }
            }
            b'"' | b'\'' => {
                let q = bytes[i];
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' { i += 2; }
                    else if bytes[i] == q { break; }
                    else { i += 1; }
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 < bytes.len() { i += 1; } // skip */
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Check that position is inside a *value* context (after `:`, `,`, or `(`
/// but not after `;`, `{`, `}`).
fn in_value_context(bytes: &[u8], i: usize) -> bool {
    let mut j = i.saturating_sub(1);
    loop {
        let c = bytes[j];
        if c == b':' || c == b',' || c == b'(' { return true; }
        if c == b';' || c == b'{' || c == b'}' { return false; }
        if j == 0 { return false; }
        j -= 1;
    }
}

// ── Gradient matcher ────────────────────────────────────────────────────

fn match_gradient(
    bytes: &[u8], i: usize,
    out: &mut String,
    stat: &mut ScanResult,
    transform: bool,
) -> Option<usize> {
    if !is_word_boundary(bytes, i) { return None; }
    let after_name = func_at(bytes, i, GRADIENT_NAMES)?;
    let mut pos = after_name;
    skip_whitespace(bytes, &mut pos);
    if pos >= bytes.len() || bytes[pos] != b'(' { return None; }

    let close = find_close_paren(bytes, pos)?;
    let inner   = &bytes[pos + 1 .. close];
    let full_s  = std::str::from_utf8(&bytes[i..close + 1]).ok()?;
    let inner_s = std::str::from_utf8(inner).ok()?;

    let already_ok = inner_s.trim().to_ascii_lowercase()
        .starts_with("in oklch") || inner_s.trim().to_ascii_lowercase()
        .starts_with("in oklab");

    stat.gradient_count += 1;

    // Re-process every stop inside the gradient (recursive)
    if transform {
        // Check if any protected function (modern CSS) exists inside
        let processed = process_gradient_inner(inner_s, stat, transform);

        let final_inner = if already_ok { processed } else {
            format!("in oklch, {}", processed)
        };

        let gradient_name = std::str::from_utf8(&bytes[i..after_name]).ok()?;
        out.push_str(gradient_name);
        out.push('(');
        out.push_str(&final_inner);
        out.push(')');
    } else {
        // Audit: walk inner content counting colours
        let mut j = 0;
        while j < inner.len() {
            if let Some(nj) = audit_color_inner(inner, j, stat) {
                j = nj;
            } else {
                j += 1;
            }
        }
        out.push_str(full_s);
    }

    Some(close + 1)
}

/// Walk gradient inner content, replacing colours (skip nested modern funcs).
fn process_gradient_inner(content: &str, stat: &mut ScanResult, transform: bool) -> String {
    let bytes = content.as_bytes();
    let mut out = String::with_capacity(content.len());
    let mut i = 0;

    while i < bytes.len() {
        // Skip comments & strings
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            let start = i; i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < bytes.len() { i += 2; }
            out.push_str(&content[start..i]);
            continue;
        }
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i]; let start = i; i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' { i += 2; }
                else if bytes[i] == q { i += 1; break; }
                else { i += 1; }
            }
            out.push_str(&content[start..i]);
            continue;
        }

        // Check for modern CSS functions (don't recurse into them)
        if is_word_boundary(bytes, i) {
            if let Some(after) = func_at(bytes, i, MODERN_FUNCS) {
                let mut pos = after;
                skip_whitespace(bytes, &mut pos);
                if pos < bytes.len() && bytes[pos] == b'(' {
                    if let Some(close) = find_close_paren(bytes, pos) {
                        out.push_str(&content[i..close + 1]);
                        i = close + 1;
                        continue;
                    }
                }
            }

            // Replaced colour inside gradient
            if let Some((ni, rep)) = replace_at(bytes, i, stat, transform) {
                out.push_str(&rep);
                i = ni;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }

    out
}

/// Audit-mode colour matching inside gradient inner content.
fn audit_color_inner(bytes: &[u8], i: usize, stat: &mut ScanResult) -> Option<usize> {
    // Hex
    if bytes[i] == b'#' {
        let end = i + 1 + hex_digit_count(bytes, i + 1);
        let cnt = end - i - 1;
        if (3..=8).contains(&cnt) && cnt != 5 && cnt != 7 {
            if parse::parse_hex(&bytes[i + 1..end]).is_some() {
                stat.hex_count += 1;
                return Some(end);
            }
        }
        return None;
    }

    if !is_word_boundary(bytes, i) { return None; }

    // Function colours
    if let Some(ty) = func_color_type(bytes, i) {
        let body_start = i + ty.0;
        let mut pos = body_start;
        skip_whitespace(bytes, &mut pos);
        if pos < bytes.len() && bytes[pos] == b'(' {
            if let Some(close) = find_close_paren(bytes, pos) {
                let body  = std::str::from_utf8(&bytes[pos + 1..close]).ok()?;
                let toks  = parse::tokenize_body(body);
                let valid = match ty.1 {
                    "rgb" => parse::parse_rgb(&toks).is_some(),
                    "hsl" => parse::parse_hsl(&toks).is_some(),
                    "hwb" => parse::parse_hwb(&toks).is_some(),
                    _     => false,
                };
                if valid {
                    *match ty.1 {
                        "rgb" => &mut stat.rgb_count,
                        "hsl" => &mut stat.hsl_count,
                        "hwb" => &mut stat.hwb_count,
                        _ => return None,
                    } += 1;
                    return Some(close + 1);
                }
            }
        }
        return None;
    }

    // Named
    if let Some(end) = named_at(bytes, i) {
        if in_value_context(bytes, i) {
            let name = std::str::from_utf8(&bytes[i..end]).ok()?;
            if named::is_named(&name.to_ascii_lowercase()) {
                stat.named_count += 1;
                return Some(end);
            }
        }
        return None;
    }

    None
}

/// Return (offset-after-name, type-name) for a recognized colour function.
fn func_color_type(bytes: &[u8], i: usize) -> Option<(usize, &'static str)> {
    for &(name, kind) in &[
        (b"rgb" as &[u8], "rgb"),
        (b"rgba", "rgb"),
        (b"hsl", "hsl"),
        (b"hsla", "hsl"),
        (b"hwb", "hwb"),
        (b"color", "color"),
    ] {
        if bytes[i..].starts_with(name) {
            let after = i + name.len();
            if after < bytes.len() && bytes[after].is_ascii_alphanumeric() { continue; }
            return Some((after, kind));
        }
    }
    None
}

// ── Hex matcher ─────────────────────────────────────────────────────────

fn match_hex(
    bytes: &[u8], i: usize,
    out: &mut String,
    stat: &mut ScanResult,
    transform: bool,
) -> Option<usize> {
    let start    = i + 1;
    let end      = start + hex_digit_count(bytes, start);
    let cnt      = end - start;

    if !(3..=8).contains(&cnt) || cnt == 5 || cnt == 7 { return None; }

    // Reject ID selectors (#id {)
    let mut la = end;
    skip_whitespace(bytes, &mut la);
    if la < bytes.len() && bytes[la] == b'{' { return None; }

    let parsed = parse::parse_hex(&bytes[start..end])?;

    stat.hex_count += 1;

    if transform {
        out.push_str(&oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha));
    } else {
        out.push(b'#' as char);
        out.push_str(std::str::from_utf8(&bytes[start..end]).ok()?);
    }

    Some(end)
}

// ── Function colour matcher ─────────────────────────────────────────────

fn match_func_color(
    bytes: &[u8], i: usize,
    out: &mut String,
    stat: &mut ScanResult,
    transform: bool,
) -> Option<usize> {
    let (name_offset, kind) = func_color_type(bytes, i)?;
    let body_start = name_offset;
    let mut pos = body_start;
    skip_whitespace(bytes, &mut pos);
    if pos >= bytes.len() || bytes[pos] != b'(' { return None; }

    let close = find_close_paren(bytes, pos)?;
    let body  = std::str::from_utf8(&bytes[pos + 1..close]).ok()?;
    let toks  = parse::tokenize_body(body);

    let parsed: Option<ParsedColor> = match kind {
        "rgb"   => parse::parse_rgb(&toks),
        "hsl"   => parse::parse_hsl(&toks),
        "hwb"   => parse::parse_hwb(&toks),
        "color" => parse::parse_color_srgb(&toks),
        _       => None,
    };

    let parsed = parsed?;

    *match kind {
        "rgb"   => &mut stat.rgb_count,
        "hsl"   => &mut stat.hsl_count,
        "hwb"   => &mut stat.hwb_count,
        "color" => &mut stat.rgb_count,
        _       => return None,
    } += 1;

    if transform {
        out.push_str(&oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha));
    } else {
        out.push_str(&input_slice(bytes, i, close + 1));
    }

    Some(close + 1)
}

// ── Named colour matcher ────────────────────────────────────────────────

fn named_at(bytes: &[u8], i: usize) -> Option<usize> {
    let mut end = i;
    skip_alpha(bytes, &mut end);
    if end == i { return None; }
    // Must be followed by word boundary
    if end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'-') {
        return None;
    }
    Some(end)
}

fn match_named(
    bytes: &[u8], i: usize,
    out: &mut String,
    stat: &mut ScanResult,
    transform: bool,
) -> Option<usize> {
    let end = named_at(bytes, i)?;
    if !in_value_context(bytes, i) { return None; }

    let raw  = std::str::from_utf8(&bytes[i..end]).ok()?;
    let name = raw.to_ascii_lowercase();
    if !named::is_named(&name) { return None; }

    stat.named_count += 1;

    if transform {
        let parsed = parse::parse_named(name.as_bytes())?;
        out.push_str(&oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha));
    } else {
        out.push_str(raw);
    }

    Some(end)
}

/// Wrapper around replace_at used in the top-level loop for standalone colors.
fn replace_at(
    bytes: &[u8], i: usize,
    stat: &mut ScanResult,
    transform: bool,
) -> Option<(usize, String)> {
    // Hex
    if bytes[i] == b'#' {
        let start = i + 1;
        let end   = start + hex_digit_count(bytes, start);
        let cnt   = end - start;
        if (3..=8).contains(&cnt) && cnt != 5 && cnt != 7 {
            let mut la = end;
            skip_whitespace(bytes, &mut la);
            if la < bytes.len() && bytes[la] == b'{' { return None; }
            let parsed = parse::parse_hex(&bytes[start..end])?;
            stat.hex_count += 1;
            let rep = if transform {
                oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha)
            } else {
                format!("#{}", std::str::from_utf8(&bytes[start..end]).ok()?)
            };
            return Some((end, rep));
        }
        return None;
    }

    // Function colours
    if let Some((name_off, kind)) = func_color_type(bytes, i) {
        let mut pos = name_off;
        skip_whitespace(bytes, &mut pos);
        if pos >= bytes.len() || bytes[pos] != b'(' { return None; }
        let close = find_close_paren(bytes, pos)?;
        let body  = std::str::from_utf8(&bytes[pos + 1..close]).ok()?;
        let toks  = parse::tokenize_body(body);

        let parsed = match kind {
            "rgb"   => parse::parse_rgb(&toks),
            "hsl"   => parse::parse_hsl(&toks),
            "hwb"   => parse::parse_hwb(&toks),
            "color" => parse::parse_color_srgb(&toks),
            _       => None,
        };
        let parsed = parsed?;

        *match kind {
            "rgb"   => &mut stat.rgb_count,
            "hsl"   => &mut stat.hsl_count,
            "hwb"   => &mut stat.hwb_count,
            "color" => &mut stat.rgb_count,
            _       => return None,
        } += 1;

        let rep = if transform {
            oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha)
        } else {
            input_slice(bytes, i, close + 1)
        };
        return Some((close + 1, rep));
    }

    // Named
    if let Some(end) = named_at(bytes, i) {
        if !in_value_context(bytes, i) { return None; }
        let raw  = std::str::from_utf8(&bytes[i..end]).ok()?;
        let name = raw.to_ascii_lowercase();
        if !named::is_named(&name) { return None; }

        stat.named_count += 1;

        let rep = if transform {
            let parsed = parse::parse_named(name.as_bytes())?;
            oklch_to_css(parsed.l, parsed.c, parsed.h, parsed.alpha)
        } else {
            raw.to_string()
        };
        return Some((end, rep));
    }

    None
}

fn input_slice(bytes: &[u8], from: usize, to: usize) -> String {
    std::str::from_utf8(&bytes[from..to])
        .map(|s| s.to_string())
        .unwrap_or_default()
}

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
}
