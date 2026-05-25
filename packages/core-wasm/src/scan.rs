//! Character-level CSS scanner.
//!
//! Walks the input byte-by-byte without any regex crate. Dispatches to
//! gradient, hex, function-colour, and named-colour matchers at word
//! boundaries. In transform mode it rewrites matches in-place into
//! `oklch(...)`; in audit mode it only tallies.
//!
//! ## Performance
//!
//! A pre-scan with `memchr`, `memmem`, and `AhoCorasick` checks whether
//! the input contains any legacy colour indicator (`#`, `rgb(`, `hsl(`,
//! `hwb(`, `color(`, or any of 148 named colour strings).  If none exist
//! and there's no `oklch-ignore` marker, the entire scan loop is skipped
//! — the input is returned unchanged.  This makes second-pass (idempotent)
//! and modern-only CSS practically free.

use std::sync::LazyLock;

use memchr::{memchr, memchr_iter, memmem};

use crate::format::oklch_to_css;
use crate::math;
use crate::named;
use crate::parse;

// ── Pre-scan legacy-color indicators ────────────────────────────────────

/// `memmem::Finder` instances pre-compiled once for fast substring search.
static FUNC_FINDERS: LazyLock<[memmem::Finder<'static>; 6]> = LazyLock::new(|| {
    [
        memmem::Finder::new(b"rgb("),
        memmem::Finder::new(b"rgba("),
        memmem::Finder::new(b"hsl("),
        memmem::Finder::new(b"hsla("),
        memmem::Finder::new(b"hwb("),
        memmem::Finder::new(b"color("),
    ]
});

/// Quick check: does `bytes` contain any legacy colour indicator?
///
/// Returns `true` if there's a `#` (potential hex colour), any of the
/// function-colour prefixes (`rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`,
/// `color(`), or any named colour string (via Aho-Corasick).
///
/// This is a **conservative** check: false positives are fine (full scan
/// runs with zero extra cost), but false negatives would break transforms.
fn has_legacy_indicators(bytes: &[u8]) -> bool {
    // Hex: # (fastest single-byte SIMD search)
    if memchr(b'#', bytes).is_some() {
        return true;
    }
    // Function colours: substring search
    for finder in FUNC_FINDERS.iter() {
        if finder.find(bytes).is_some() {
            return true;
        }
    }
    // Named colours: Aho-Corasick (single linear scan, no false negatives)
    if named::has_named(bytes) {
        return true;
    }
    false
}

/// Count legacy colour indicators (conservative upper bound).
///
/// Returns `(hex_count, func_count, named_count)` for output capacity
/// pre-allocation.  Over-counting is safe (wastes a few bytes of
/// capacity); under-counting would cause reallocation.
fn count_legacy_indicators(bytes: &[u8]) -> (usize, usize, usize) {
    let hex = memchr_iter(b'#', bytes).count();
    let func: usize = FUNC_FINDERS.iter().map(|f| f.find_iter(bytes).count()).sum();
    let named = named::count_named(bytes);
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

    // Pre-scan for oklch-ignore ranges (transform only)
    let ignore_ranges = if has_ignore { find_ignore_ranges(input) } else { Vec::new() };

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
            if i + 1 < len { i += 2; }
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

        // ── String literal ────────────────────────────────────────
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
        if let Some(end) = match_gradient_transform(bytes, i, &mut out, &mut stat) {
            i = end;
            continue;
        }

        // ── Individual colour ─────────────────────────────────────
        if let Some(end) = replace_at_transform(bytes, i, &mut stat, &mut out, false) {
            i = end;
            continue;
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

fn scan_audit_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut stat = ScanResult::default();

    // ── Quick bail-out ─────────────────────────────────────────────
    // Skip bail-out too: we still need accurate counts even for
    // all-modern input. Only bail if there's nothing to count.
    if !bytes.windows(12).any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"))
        && !has_legacy_indicators(bytes)
    {
        return stat;
    }

    let mut i = 0;

    while i < len {
        // ── Block comment ─────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len { i += 2; }
            continue;
        }

        // ── Line comment ──────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' { i += 1; }
            continue;
        }

        // ── String literal ────────────────────────────────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < len {
                if bytes[i] == b'\\' { i += 2; }
                else if bytes[i] == q { i += 1; break; }
                else { i += 1; }
            }
            continue;
        }

        // ── Gradient (audit: count colours inside, no output) ────
        if let Some(end) = match_gradient_audit(bytes, i, &mut stat) {
            i = end;
            continue;
        }

        // ── Individual colour ─────────────────────────────────────
        if let Some(end) = replace_at_audit(bytes, i, &mut stat, false) {
            i = end;
            continue;
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

// ── Gradient matcher ────────────────────────────────────────────────────

fn match_gradient_transform(
    bytes: &[u8], i: usize,
    out: &mut String,
    stat: &mut ScanResult,
) -> Option<usize> {
    if !is_word_boundary(bytes, i) { return None; }
    let after_name = func_at(bytes, i, GRADIENT_NAMES)?;
    let mut pos = after_name;
    skip_whitespace(bytes, &mut pos);
    if pos >= bytes.len() || bytes[pos] != b'(' { return None; }

    let close = find_close_paren(bytes, pos)?;
    let inner   = &bytes[pos + 1 .. close];
    let inner_s = std::str::from_utf8(inner).ok()?;

    let already_ok = {
        let start = inner.iter().position(|&b| !b.is_ascii_whitespace()).unwrap_or(inner.len());
        let trimmed = &inner[start..];
        let needle = if trimmed.len() >= 8 { &trimmed[..8] } else { &trimmed[..0] };
        needle.eq_ignore_ascii_case(b"in oklch") || needle.eq_ignore_ascii_case(b"in oklab")
    };

    stat.gradient_count += 1;

    let gradient_name = std::str::from_utf8(&bytes[i..after_name]).ok()?;
    out.push_str(gradient_name);
    out.push('(');
    if !already_ok {
        out.push_str("in oklch, ");
    }
    process_gradient_inner(inner_s, stat, out);
    out.push(')');

    Some(close + 1)
}

fn match_gradient_audit(
    bytes: &[u8], i: usize,
    stat: &mut ScanResult,
) -> Option<usize> {
    if !is_word_boundary(bytes, i) { return None; }
    let after_name = func_at(bytes, i, GRADIENT_NAMES)?;
    let mut pos = after_name;
    skip_whitespace(bytes, &mut pos);
    if pos >= bytes.len() || bytes[pos] != b'(' { return None; }

    let close = find_close_paren(bytes, pos)?;
    let inner = &bytes[pos + 1 .. close];

    stat.gradient_count += 1;

    // Walk inner content counting colours via replace_at_audit, no output
    let mut j = 0;
    while j < inner.len() {
        if let Some(end) = replace_at_audit(inner, j, stat, true) {
            j = end;
        } else {
            j += 1;
        }
    }

    Some(close + 1)
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
                if pos < bytes.len() && bytes[pos] == b'(' {
                    if let Some(close) = find_close_paren(bytes, pos) {
                        out.push_str(&content[i..close + 1]);
                        i = close + 1;
                        continue;
                    }
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
        if raw.is_none() { return None; }

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
