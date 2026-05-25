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

use std::str;
use std::sync::LazyLock;

use aho_corasick::{AhoCorasick, MatchKind};

use crate::format::oklch_to_css;
use crate::math;
use crate::named;
use crate::parse;

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

/// Quick check: does `bytes` contain any legacy colour indicator?
fn has_legacy_indicators(bytes: &[u8]) -> bool {
    SCAN_AHO.is_match(bytes)
}

/// Count legacy colour indicators (conservative upper bound).
fn count_legacy_indicators(bytes: &[u8]) -> (usize, usize, usize) {
    let mut hex = 0usize;
    let mut func = 0usize;
    let mut named = 0usize;
    for m in SCAN_AHO.find_iter(bytes) {
        match m.pattern().as_usize() {
            PATTERN_HEX => hex += 1,
            PATTERN_RGB..=PATTERN_COLOR_FN => func += 1,
            _ => named += 1,
        }
    }
    (hex, func, named)
}

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
    scan_transform_impl(input).css
}

pub fn audit_css(input: &str) -> ScanResult {
    scan_audit_impl(input)
}

/// Collect byte ranges of line content that should be ignored.
/// A line is ignored if it contains `/* oklch-ignore */`.
/// NOTE: the caller guarantees at least one marker exists.
fn find_ignore_ranges(input: &str) -> Vec<(usize, usize)> {
    let bytes = input.as_bytes();
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let line_start = i;
        while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
        let line_end = i;
        if bytes[line_start..line_end].windows(12).any(|w| w.eq_ignore_ascii_case(b"oklch-ignore")) {
            ranges.push((line_start, if i < bytes.len() { i + 1 } else { i }));
        }
        if i < bytes.len() && bytes[i] == b'\n' { i += 1; }
    }
    ranges
}

// ── Scanner helpers ──────────────────────────────────────────────────────

const GRADIENT_NAMES: &[&str] = &[
    "linear-gradient",
    "radial-gradient",
    "conic-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
    "repeating-conic-gradient",
];

/// Check whether `bytes[i..]` starts with one of the gradient names.
fn gradient_at(bytes: &[u8], i: usize) -> Option<&'static str> {
    for &name in GRADIENT_NAMES {
        if bytes[i..].starts_with(name.as_bytes()) {
            let after = i + name.len();
            if after < bytes.len() && bytes[after] == b'(' {
                return Some(name);
            }
            return None;
        }
    }
    None
}

// ── Main scan loops ──────────────────────────────────────────────────────

fn scan_transform_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut stat = ScanResult::default();

    // ── Quick bail-out ─────────────────────────────────────────────
    let has_ignore = bytes.windows(12).any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    if !has_ignore && !has_legacy_indicators(bytes) {
        stat.css = input.to_string();
        return stat;
    }

    let (hex_c, func_c, named_c) = count_legacy_indicators(bytes);
    let estimated_growth = (hex_c + func_c + named_c) * 15;
    let mut out = String::with_capacity(len + estimated_growth);

    let ignore_ranges = if has_ignore { find_ignore_ranges(input) } else { Vec::new() };
    let mut ir_idx = 0usize;
    let mut i = 0usize;

    while i < len {
        // ── Skip comments — push to output unchanged ───────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            out.push_str(&input[i..i + 2]); i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                out.push(bytes[i] as char); i += 1;
            }
            if i + 1 < len { out.push_str(&input[i..i + 2]); i += 2; }
            continue;
        }
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' { out.push(bytes[i] as char); i += 1; }
            continue;
        }

        // ── Skip strings — push to output unchanged ────────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i]; out.push(q as char); i += 1;
            while i < len {
                if bytes[i] == b'\\' { out.push(bytes[i] as char); i += 1; if i < len { out.push(bytes[i] as char); i += 1; } }
                else if bytes[i] == q { out.push(q as char); i += 1; break; }
                else { out.push(bytes[i] as char); i += 1; }
            }
            continue;
        }

        // ── Ignore ranges (oklch-ignore pragma) ────────────────────
        if ir_idx < ignore_ranges.len() && i == ignore_ranges[ir_idx].0 {
            out.push_str(&input[i..ignore_ranges[ir_idx].1]);
            i = ignore_ranges[ir_idx].1;
            ir_idx += 1;
            continue;
        }

        // ── Hex colour ─────────────────────────────────────────────
        if bytes[i] == b'#' {
            if let Some(end) = replace_at_transform(bytes, i, &mut stat, &mut out, false) {
                i = end;
                continue;
            }
            out.push('#');
            i += 1;
            continue;
        }

        // ── Gradient or function or named colour at word boundary ──
        if is_word_boundary(bytes, i) && bytes[i].is_ascii_alphabetic() {
            // Gradient
            if let Some(grad_name) = gradient_at(bytes, i) {
                let name_end = i + grad_name.len();
                let paren_pos = name_end;
                debug_assert!(paren_pos < len && bytes[paren_pos] == b'(');
                let close = match find_close_paren(bytes, paren_pos) {
                    Some(c) => c,
                    None => { out.push(bytes[i] as char); i += 1; continue; }
                };
                let inner = &bytes[name_end + 1..close]; // skip '('
                let inner_s = match std::str::from_utf8(inner) {
                    Ok(s) => s,
                    Err(_) => { out.push(bytes[i] as char); i += 1; continue; }
                };
                let already_ok = {
                    let start = inner.iter().position(|&b| !b.is_ascii_whitespace()).unwrap_or(inner.len());
                    let needle = if inner.len() - start >= 8 { &inner[start..start + 8] } else { &[] };
                    needle.eq_ignore_ascii_case(b"in oklch") || needle.eq_ignore_ascii_case(b"in oklab")
                };
                stat.gradient_count += 1;
                out.push_str(grad_name);
                out.push('(');
                if !already_ok { out.push_str("in oklch, "); }
                process_gradient_inner(inner_s, &mut stat, &mut out);
                out.push(')');
                i = close + 1;
                continue;
            }

            // Function colour
            if let Some(end) = replace_at_transform(bytes, i, &mut stat, &mut out, false) {
                i = end;
                continue;
            }

            // Named colour
            if let Some(end) = replace_at_transform(bytes, i, &mut stat, &mut out, false) {
                i = end;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }

    // Flush any pending ignore ranges
    while ir_idx < ignore_ranges.len() {
        if i < ignore_ranges[ir_idx].0 {
            out.push_str(&input[i..ignore_ranges[ir_idx].0]);
        }
        out.push_str(&input[ignore_ranges[ir_idx].0..ignore_ranges[ir_idx].1]);
        i = ignore_ranges[ir_idx].1;
        ir_idx += 1;
    }

    stat.css = out;
    stat.legacy_count = stat.hex_count + stat.rgb_count
                      + stat.hsl_count + stat.hwb_count
                      + stat.named_count;
    stat
}

fn scan_audit_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut stat = ScanResult::default();

    if !has_legacy_indicators(bytes) {
        return stat;
    }

    let mut i = 0usize;
    while i < len {
        // ── Skip comments ──────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') { i += 1; }
            if i + 1 < len { i += 2; }
            continue;
        }
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' { i += 1; }
            continue;
        }

        // ── Skip strings ───────────────────────────────────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i]; i += 1;
            while i < len {
                if bytes[i] == b'\\' { i += 2; }
                else if bytes[i] == q { i += 1; break; }
                else { i += 1; }
            }
            continue;
        }

        // ── Hex ────────────────────────────────────────────────────
        if bytes[i] == b'#' {
            if let Some(end) = replace_at_audit(bytes, i, &mut stat, false) {
                i = end;
                continue;
            }
            i += 1;
            continue;
        }

        // ── Gradient / function / named at word boundary ───────────
        if is_word_boundary(bytes, i) && bytes[i].is_ascii_alphabetic() {
            // Gradient
            if let Some(grad_name) = gradient_at(bytes, i) {
                let name_end = i + grad_name.len();
                let paren_pos = name_end;
                debug_assert!(paren_pos < len && bytes[paren_pos] == b'(');
                let close = match find_close_paren(bytes, paren_pos) {
                    Some(c) => c,
                    None => { i += 1; continue; }
                };
                stat.gradient_count += 1;
                let inner = &bytes[name_end + 1..close];
                let mut j = 0;
                while j < inner.len() {
                    if let Some(end) = replace_at_audit(inner, j, &mut stat, true) {
                        j = end;
                    } else {
                        j += 1;
                    }
                }
                i = close + 1;
                continue;
            }

            // Function or named
            if let Some(end) = replace_at_audit(bytes, i, &mut stat, false) {
                i = end;
                continue;
            }
        }

        i += 1;
    }

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
///
/// When `in_paren_ctx` is `true`, position 0 is treated as if preceded by
/// `(` — handles the case where the byte slice is gradient inner content
/// (the opening `(` is outside the slice).
fn in_value_context(bytes: &[u8], i: usize, in_paren_ctx: bool) -> bool {
    let mut j = i.saturating_sub(1);
    loop {
        if j == 0 && in_paren_ctx && !matches!(bytes[0], b';' | b'{' | b'}') {
            return true;
        }
        let c = bytes[j];
        if c == b':' || c == b',' || c == b'(' { return true; }
        if c == b';' || c == b'{' || c == b'}' { return false; }
        if j == 0 { return false; }
        j -= 1;
    }
}

/// Walk gradient inner content, replacing colours (skip nested modern funcs).
/// Writes directly to `out` instead of returning a new String.
fn process_gradient_inner(content: &str, stat: &mut ScanResult, out: &mut String) {
    let bytes = content.as_bytes();
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
                if pos < bytes.len() && bytes[pos] == b'('
                    && let Some(close) = find_close_paren(bytes, pos) {
                        out.push_str(&content[i..close + 1]);
                        i = close + 1;
                        continue;
                    }
            }

            // Replaced colour inside gradient
            if let Some(ni) = replace_at_transform(bytes, i, stat, out, true) {
                i = ni;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }
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

// ── Named colour boundary detection ─────────────────────────────────────

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

/// Transform-mode colour matcher: hex, function, or named.
/// Writes OKLCH replacement directly to `out` and returns cursor position.
fn replace_at_transform(
    bytes: &[u8], i: usize,
    stat: &mut ScanResult,
    out: &mut String,
    in_paren_ctx: bool,
) -> Option<usize> {
    // Hex
    if bytes[i] == b'#' {
        let start = i + 1;
        let end   = start + hex_digit_count(bytes, start);
        let cnt   = end - start;
        if (3..=8).contains(&cnt) && cnt != 5 && cnt != 7 {
            let mut la = end;
            skip_whitespace(bytes, &mut la);
            if la < bytes.len() && bytes[la] == b'{' { return None; }
            let raw = parse::parse_hex(&bytes[start..end])?;
            stat.hex_count += 1;
            let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
            oklch_to_css(l, c, h, alpha, out).ok()?;
            return Some(end);
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

        let raw = match kind {
            "rgb"   => parse::parse_rgb(&toks),
            "hsl"   => parse::parse_hsl(&toks),
            "hwb"   => parse::parse_hwb(&toks),
            "color" => parse::parse_color_srgb(&toks),
            _       => None,
        };
        let raw = raw?;

        *match kind {
            "rgb"   => &mut stat.rgb_count,
            "hsl"   => &mut stat.hsl_count,
            "hwb"   => &mut stat.hwb_count,
            "color" => &mut stat.rgb_count,
            _       => return None,
        } += 1;

        let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
        oklch_to_css(l, c, h, alpha, out).ok()?;
        return Some(close + 1);
    }

    // Named — uses [u8; 32] stack buffer to avoid heap allocation
    if let Some(end) = named_at(bytes, i) {
        if !in_value_context(bytes, i, in_paren_ctx) { return None; }
        let raw_bytes = &bytes[i..end];
        let mut buf = [0u8; 32];
        let name: &str = if raw_bytes.len() <= 32 {
            buf[..raw_bytes.len()].copy_from_slice(raw_bytes);
            buf[..raw_bytes.len()].make_ascii_lowercase();
            std::str::from_utf8(&buf[..raw_bytes.len()]).ok()?
        } else {
            return None;
        };
        if !named::is_named(name) { return None; }

        stat.named_count += 1;
        let raw = parse::parse_named_lowered(name.as_bytes())?;
        let (l, c, h, alpha) = math::raw_to_oklch(raw.r, raw.g, raw.b, raw.alpha);
        oklch_to_css(l, c, h, alpha, out).ok()?;
        return Some(end);
    }

    None
}

/// Audit-mode colour matcher: hex, function, or named.
/// Counts colours in `stat` but does NO output.
/// Returns cursor position (same as transform), never allocates.
fn replace_at_audit(
    bytes: &[u8], i: usize,
    stat: &mut ScanResult,
    in_paren_ctx: bool,
) -> Option<usize> {
    // Hex
    if bytes[i] == b'#' {
        let start = i + 1;
        let end   = start + hex_digit_count(bytes, start);
        let cnt   = end - start;
        if (3..=8).contains(&cnt) && cnt != 5 && cnt != 7 {
            let mut la = end;
            skip_whitespace(bytes, &mut la);
            if la < bytes.len() && bytes[la] == b'{' { return None; }
            if parse::parse_hex(&bytes[start..end]).is_some() {
                stat.hex_count += 1;
                return Some(end);
            }
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

        let raw = match kind {
            "rgb"   => parse::parse_rgb(&toks),
            "hsl"   => parse::parse_hsl(&toks),
            "hwb"   => parse::parse_hwb(&toks),
            "color" => parse::parse_color_srgb(&toks),
            _       => None,
        };
        raw.as_ref()?;

        *match kind {
            "rgb"   => &mut stat.rgb_count,
            "hsl"   => &mut stat.hsl_count,
            "hwb"   => &mut stat.hwb_count,
            "color" => &mut stat.rgb_count,
            _       => return None,
        } += 1;

        return Some(close + 1);
    }

    // Named — uses [u8; 32] stack buffer to avoid heap allocation
    if let Some(end) = named_at(bytes, i) {
        if !in_value_context(bytes, i, in_paren_ctx) { return None; }
        let raw_bytes = &bytes[i..end];
        let mut buf = [0u8; 32];
        let name: &str = if raw_bytes.len() <= 32 {
            buf[..raw_bytes.len()].copy_from_slice(raw_bytes);
            buf[..raw_bytes.len()].make_ascii_lowercase();
            std::str::from_utf8(&buf[..raw_bytes.len()]).ok()?
        } else {
            return None;
        };
        if !named::is_named(name) { return None; }

        stat.named_count += 1;
        return Some(end);
    }

    None
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
        for grad in ["linear-gradient", "radial-gradient", "conic-gradient",
                      "repeating-linear-gradient", "repeating-radial-gradient",
                      "repeating-conic-gradient"] {
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
        let ranges = find_ignore_ranges("a { color: #ff0000; /* oklch-ignore */ }\nb { color: blue; }");
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
