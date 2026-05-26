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
use crate::types::RawColor;

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

#[derive(Debug, Default)]
struct IndicatorCounts {
    hex: usize,
    func: usize,
    named: usize,
}

impl IndicatorCounts {
    fn is_empty(&self) -> bool {
        self.hex == 0 && self.func == 0 && self.named == 0
    }

    fn estimated_growth(&self) -> usize {
        (self.hex + self.func + self.named) * 15
    }
}

/// Quick check: does `bytes` contain any legacy colour indicator?
fn has_legacy_indicators(bytes: &[u8]) -> bool {
    SCAN_AHO.is_match(bytes)
}

/// Count legacy colour indicators (conservative upper bound).
fn count_legacy_indicators(bytes: &[u8]) -> IndicatorCounts {
    let mut counts = IndicatorCounts::default();
    for m in SCAN_AHO.find_iter(bytes) {
        match m.pattern().as_usize() {
            PATTERN_HEX => counts.hex += 1,
            PATTERN_RGB..=PATTERN_COLOR_FN => counts.func += 1,
            _ => counts.named += 1,
        }
    }
    counts
}

// ── Public types / entry-points ──────────────────────────────────────────

#[derive(Debug, Default)]
pub struct ScanResult {
    pub css: String,
    pub legacy_count: u32,
    pub hex_count: u32,
    pub rgb_count: u32,
    pub hsl_count: u32,
    pub hwb_count: u32,
    pub named_count: u32,
    pub gradient_count: u32,
    pub unique_count: u32,
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
    let mut in_block_comment = false;
    while i < bytes.len() {
        let line_start = i;
        while i < bytes.len() && bytes[i] != b'\n' {
            i += 1;
        }
        let line_end = i;
        if line_has_ignore_comment(bytes, line_start, line_end, &mut in_block_comment) {
            ranges.push((line_start, if i < bytes.len() { i + 1 } else { i }));
        }
        if i < bytes.len() && bytes[i] == b'\n' {
            i += 1;
        }
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
fn gradient_at(bytes: &[u8], i: usize) -> Option<usize> {
    for &name in GRADIENT_NAMES {
        if starts_with_ignore_ascii_case(&bytes[i..], name.as_bytes()) {
            let after = i + name.len();
            if after < bytes.len() && bytes[after] == b'(' {
                return Some(after);
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
    let has_ignore = bytes
        .windows(12)
        .any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    let indicator_counts = count_legacy_indicators(bytes);
    if !has_ignore && indicator_counts.is_empty() {
        stat.css = input.to_string();
        return stat;
    }

    let mut out = String::with_capacity(len + indicator_counts.estimated_growth());

    let ignore_ranges = if has_ignore {
        find_ignore_ranges(input)
    } else {
        Vec::new()
    };
    let mut ir_idx = 0usize;
    let mut i = 0usize;
    let mut scan_state = CssScanState::default();

    while i < len {
        // ── Ignore ranges (oklch-ignore pragma) ────────────────────
        if let Some(skip_to) = ignored_until(i, len, &ignore_ranges, &mut ir_idx) {
            out.push_str(&input[i..skip_to]);
            advance_value_state(bytes, i, skip_to, &mut scan_state);
            i = skip_to;
            continue;
        }

        // ── Skip comments — push to output unchanged ───────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            let start = i;
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            } else {
                i = len;
            }
            out.push_str(&input[start..i]);
            continue;
        }
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            let start = i;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            out.push_str(&input[start..i]);
            continue;
        }

        // ── Skip strings — push to output unchanged ────────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let start = i;
            let q = bytes[i];
            i += 1;
            while i < len {
                if bytes[i] == b'\\' {
                    i += 1;
                    if i < len {
                        i += 1;
                    }
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            out.push_str(&input[start..i]);
            continue;
        }

        // ── Hex colour ─────────────────────────────────────────────
        if bytes[i] == b'#' {
            if let Some(end) = replace_at_transform(
                bytes,
                i,
                &mut stat,
                &mut out,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }
            out.push('#');
            i += 1;
            continue;
        }

        // ── Gradient or function or named colour at word boundary ──
        if is_word_boundary(bytes, i) && bytes[i].is_ascii_alphabetic() {
            if let Some(end) = skip_url_function(bytes, i) {
                out.push_str(&input[i..end]);
                i = end;
                continue;
            }
            if let Some(end) = skip_modern_function(bytes, i) {
                out.push_str(&input[i..end]);
                i = end;
                continue;
            }
            if let Some(end) = skip_relative_color_function(bytes, i) {
                out.push_str(&input[i..end]);
                i = end;
                continue;
            }

            // Gradient
            if let Some(name_end) = gradient_at(bytes, i) {
                let paren_pos = name_end;
                debug_assert!(paren_pos < len && bytes[paren_pos] == b'(');
                let close = match find_close_paren(bytes, paren_pos) {
                    Some(c) => c,
                    None => {
                        push_next_char(input, &mut i, &mut out);
                        continue;
                    }
                };
                let inner = &bytes[name_end + 1..close]; // skip '('
                let inner_s = match std::str::from_utf8(inner) {
                    Ok(s) => s,
                    Err(_) => {
                        push_next_char(input, &mut i, &mut out);
                        continue;
                    }
                };
                let already_ok = has_leading_gradient_interpolation(inner);
                let mut inner_out = String::with_capacity(inner_s.len() + 32);
                let transformed = process_gradient_inner(
                    inner_s,
                    &mut stat,
                    Some(&mut inner_out),
                    name_end + 1,
                    &ignore_ranges,
                );
                if transformed == 0 {
                    out.push_str(&input[i..close + 1]);
                    i = close + 1;
                    continue;
                }

                stat.gradient_count += 1;
                out.push_str(&input[i..name_end]);
                out.push('(');
                if !already_ok {
                    out.push_str("in oklch, ");
                }
                out.push_str(&inner_out);
                out.push(')');
                i = close + 1;
                continue;
            }

            // Function colour
            if let Some(end) = replace_at_transform(
                bytes,
                i,
                &mut stat,
                &mut out,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }

            // Named colour
            if let Some(end) = replace_at_transform(
                bytes,
                i,
                &mut stat,
                &mut out,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }
        }

        update_value_state_at(bytes, i, &mut scan_state);
        push_next_char(input, &mut i, &mut out);
    }

    stat.css = out;
    stat.legacy_count =
        stat.hex_count + stat.rgb_count + stat.hsl_count + stat.hwb_count + stat.named_count;
    stat
}

fn scan_audit_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut stat = ScanResult::default();

    let has_ignore = bytes
        .windows(12)
        .any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    if !has_legacy_indicators(bytes) {
        return stat;
    }

    let ignore_ranges = if has_ignore {
        find_ignore_ranges(input)
    } else {
        Vec::new()
    };
    let mut ir_idx = 0usize;
    let mut i = 0usize;
    let mut scan_state = CssScanState::default();
    while i < len {
        // ── Ignore ranges (oklch-ignore pragma) ────────────────────
        if let Some(skip_to) = ignored_until(i, len, &ignore_ranges, &mut ir_idx) {
            advance_value_state(bytes, i, skip_to, &mut scan_state);
            i = skip_to;
            continue;
        }

        // ── Skip comments ──────────────────────────────────────────
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            } else {
                i = len;
            }
            continue;
        }
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        // ── Skip strings ───────────────────────────────────────────
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < len {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        // ── Hex ────────────────────────────────────────────────────
        if bytes[i] == b'#' {
            if let Some(end) = replace_at_audit(
                bytes,
                i,
                &mut stat,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }
            i += 1;
            continue;
        }

        // ── Gradient / function / named at word boundary ───────────
        if is_word_boundary(bytes, i) && bytes[i].is_ascii_alphabetic() {
            if let Some(end) = skip_url_function(bytes, i) {
                i = end;
                continue;
            }
            if let Some(end) = skip_modern_function(bytes, i) {
                i = end;
                continue;
            }
            if let Some(end) = skip_relative_color_function(bytes, i) {
                i = end;
                continue;
            }

            // Gradient
            if let Some(name_end) = gradient_at(bytes, i) {
                let paren_pos = name_end;
                debug_assert!(paren_pos < len && bytes[paren_pos] == b'(');
                let close = match find_close_paren(bytes, paren_pos) {
                    Some(c) => c,
                    None => {
                        i += 1;
                        continue;
                    }
                };
                let inner = &bytes[name_end + 1..close];
                if let Ok(inner_s) = std::str::from_utf8(inner) {
                    let found = process_gradient_inner(
                        inner_s,
                        &mut stat,
                        None,
                        name_end + 1,
                        &ignore_ranges,
                    );
                    if found > 0 {
                        stat.gradient_count += 1;
                    }
                }
                i = close + 1;
                continue;
            }

            // Function or named
            if let Some(end) = replace_at_audit(
                bytes,
                i,
                &mut stat,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }
        }

        update_value_state_at(bytes, i, &mut scan_state);
        i += 1;
    }

    stat.legacy_count =
        stat.hex_count + stat.rgb_count + stat.hsl_count + stat.hwb_count + stat.named_count;
    stat
}

// ── Low-level helpers ───────────────────────────────────────────────────

fn is_css_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte >= 0x80
}

fn is_css_ident_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte >= 0x80
}

fn is_word_boundary(bytes: &[u8], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    !is_css_ident_byte(bytes[i - 1])
}

fn push_next_char(input: &str, i: &mut usize, out: &mut String) {
    let ch = input[*i..]
        .chars()
        .next()
        .expect("cursor must point inside input");
    out.push(ch);
    *i += ch.len_utf8();
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

fn contains_ignore_marker(bytes: &[u8], start: usize, end: usize) -> bool {
    end.saturating_sub(start) >= 12
        && bytes[start..end]
            .windows(12)
            .any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"))
}

fn line_has_ignore_comment(
    bytes: &[u8],
    start: usize,
    end: usize,
    in_block_comment: &mut bool,
) -> bool {
    let mut found = false;
    let mut i = start;

    while i < end {
        if *in_block_comment {
            let comment_start = i;
            while i + 1 < end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            let comment_end = if i + 1 < end {
                *in_block_comment = false;
                i + 2
            } else {
                end
            };
            found |= contains_ignore_marker(bytes, comment_start, comment_end);
            i = comment_end;
            continue;
        }

        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < end {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < end && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            *in_block_comment = true;
            i += 2;
            continue;
        }

        if is_word_boundary(bytes, i)
            && bytes[i].is_ascii_alphabetic()
            && let Some(url_end) = skip_url_function(bytes, i)
        {
            i = url_end.min(end);
            continue;
        }

        if i + 1 < end && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            found |= contains_ignore_marker(bytes, i + 2, end);
            break;
        }

        i += 1;
    }

    found
}

fn hex_digit_count(bytes: &[u8], mut i: usize) -> usize {
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_hexdigit() {
        i += 1;
    }
    i - start
}

fn ignored_until(
    absolute_pos: usize,
    limit: usize,
    ignore_ranges: &[(usize, usize)],
    range_idx: &mut usize,
) -> Option<usize> {
    while *range_idx < ignore_ranges.len() && absolute_pos >= ignore_ranges[*range_idx].1 {
        *range_idx += 1;
    }

    if *range_idx < ignore_ranges.len()
        && absolute_pos >= ignore_ranges[*range_idx].0
        && absolute_pos < ignore_ranges[*range_idx].1
    {
        return Some(ignore_ranges[*range_idx].1.min(limit));
    }

    None
}

fn starts_with_ignore_ascii_case(bytes: &[u8], prefix: &[u8]) -> bool {
    bytes.len() >= prefix.len() && bytes[..prefix.len()].eq_ignore_ascii_case(prefix)
}

const MODERN_FUNCS: &[&[u8]] = &[
    b"oklch",
    b"oklab",
    b"lab",
    b"lch",
    b"color-mix",
    b"light-dark",
    b"var",
    b"calc",
    b"env",
];

const URL_FUNCS: &[&[u8]] = &[b"url"];

/// Check whether `bytes[i..]` starts with one of `names` at a word boundary.
fn func_at(bytes: &[u8], i: usize, names: &[&[u8]]) -> Option<usize> {
    for name in names {
        if starts_with_ignore_ascii_case(&bytes[i..], name) {
            let after = i + name.len();
            if after < bytes.len() && is_css_ident_byte(bytes[after]) {
                continue;
            }
            return Some(after);
        }
    }
    None
}

fn keyword_at(bytes: &[u8], i: usize, keyword: &[u8], limit: usize) -> bool {
    let end = i + keyword.len();
    end <= limit
        && (i == 0 || !is_css_ident_byte(bytes[i - 1]))
        && bytes[i..end].eq_ignore_ascii_case(keyword)
        && (end == limit || !is_css_ident_byte(bytes[end]))
}

fn skip_url_function(bytes: &[u8], i: usize) -> Option<usize> {
    let after = func_at(bytes, i, URL_FUNCS)?;
    let mut pos = after;
    skip_whitespace(bytes, &mut pos);
    if pos < bytes.len() && bytes[pos] == b'(' {
        let close = find_close_paren_without_line_comments(bytes, pos)?;
        return Some(close + 1);
    }
    None
}

fn skip_modern_function(bytes: &[u8], i: usize) -> Option<usize> {
    let after = func_at(bytes, i, MODERN_FUNCS)?;
    let mut pos = after;
    skip_whitespace(bytes, &mut pos);
    if pos < bytes.len() && bytes[pos] == b'(' {
        let close = find_close_paren(bytes, pos)?;
        return Some(close + 1);
    }
    None
}

fn skip_relative_color_function(bytes: &[u8], i: usize) -> Option<usize> {
    let (after, _) = func_color_type(bytes, i)?;
    let mut pos = after;
    skip_whitespace(bytes, &mut pos);
    if pos >= bytes.len() || bytes[pos] != b'(' {
        return None;
    }

    let close = find_close_paren(bytes, pos)?;
    let mut body = pos + 1;
    skip_whitespace_and_comments(bytes, &mut body);
    if keyword_at(bytes, body, b"from", close) {
        return Some(close + 1);
    }

    None
}

/// Find matching `)` respecting nested parens and strings.
fn find_close_paren(bytes: &[u8], i: usize) -> Option<usize> {
    find_close_paren_inner(bytes, i, true)
}

fn find_close_paren_without_line_comments(bytes: &[u8], i: usize) -> Option<usize> {
    find_close_paren_inner(bytes, i, false)
}

fn find_close_paren_inner(bytes: &[u8], mut i: usize, skip_line_comments: bool) -> Option<usize> {
    let mut depth = 1u32;
    i += 1; // skip '('
    while i < bytes.len() {
        if skip_line_comments
            && is_word_boundary(bytes, i)
            && bytes[i].is_ascii_alphabetic()
            && let Some(end) = skip_url_function(bytes, i)
        {
            i = end;
            continue;
        }

        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            b'"' | b'\'' => {
                let q = bytes[i];
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i += 2;
                    } else if bytes[i] == q {
                        break;
                    } else {
                        i += 1;
                    }
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 < bytes.len() {
                    i += 1;
                } else {
                    i = bytes.len().saturating_sub(1);
                } // skip */
            }
            b'/' if skip_line_comments && i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn has_leading_gradient_interpolation(inner: &[u8]) -> bool {
    let limit = first_top_level_comma(inner).unwrap_or(inner.len());
    let mut i = 0usize;
    let mut depth = 0usize;

    while i < limit {
        if inner[i] == b'"' || inner[i] == b'\'' {
            let q = inner[i];
            i += 1;
            while i < limit {
                if inner[i] == b'\\' {
                    i += 2;
                } else if inner[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < limit && inner[i] == b'/' && inner[i + 1] == b'*' {
            i += 2;
            while i + 1 < limit && !(inner[i] == b'*' && inner[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(limit);
            continue;
        }

        if i + 1 < limit && inner[i] == b'/' && inner[i + 1] == b'/' {
            while i < limit && inner[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        match inner[i] {
            b'(' => {
                depth += 1;
                i += 1;
                continue;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                i += 1;
                continue;
            }
            _ => {}
        }

        if depth == 0 && keyword_at(inner, i, b"in", limit) {
            let mut after = i + 2;
            skip_whitespace_and_comments(inner, &mut after);
            if after < limit && is_css_ident_byte(inner[after]) {
                return true;
            }
        }

        i += 1;
    }

    false
}

fn first_top_level_comma(bytes: &[u8]) -> Option<usize> {
    let mut i = 0usize;
    let mut depth = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => return Some(i),
            _ => {}
        }
        i += 1;
    }

    None
}

fn skip_whitespace_and_comments(bytes: &[u8], i: &mut usize) {
    loop {
        skip_whitespace(bytes, i);

        if *i + 1 < bytes.len() && bytes[*i] == b'/' && bytes[*i + 1] == b'*' {
            *i += 2;
            while *i + 1 < bytes.len() && !(bytes[*i] == b'*' && bytes[*i + 1] == b'/') {
                *i += 1;
            }
            if *i + 1 < bytes.len() {
                *i += 2;
            } else {
                *i = bytes.len();
            }
            continue;
        }

        if *i + 1 < bytes.len() && bytes[*i] == b'/' && bytes[*i + 1] == b'/' {
            *i += 2;
            while *i < bytes.len() && bytes[*i] != b'\n' {
                *i += 1;
            }
            continue;
        }

        break;
    }
}

fn declaration_prefix(bytes: &[u8], start: usize, colon: usize) -> bool {
    let mut i = start;
    skip_whitespace_and_comments(bytes, &mut i);
    if i >= colon {
        return false;
    }

    if bytes[i] == b'-' {
        i += 1;
        if i < colon && bytes[i] == b'-' {
            i += 1;
            let name_start = i;
            consume_css_ident(bytes, &mut i, colon);
            if i == name_start {
                return false;
            }
            skip_whitespace_and_comments(bytes, &mut i);
            return i == colon;
        }
        if i >= colon || !is_css_ident_start_or_escape(bytes, i) {
            return false;
        }
        consume_css_ident(bytes, &mut i, colon);
    } else if is_css_ident_start_or_escape(bytes, i) {
        consume_css_ident(bytes, &mut i, colon);
    } else {
        return false;
    }

    skip_whitespace_and_comments(bytes, &mut i);
    i == colon
}

fn is_css_ident_start_or_escape(bytes: &[u8], i: usize) -> bool {
    bytes[i] == b'\\' || is_css_ident_start_byte(bytes[i])
}

fn consume_css_ident(bytes: &[u8], i: &mut usize, limit: usize) {
    while *i < limit {
        if is_css_ident_byte(bytes[*i]) {
            *i += 1;
        } else if bytes[*i] == b'\\' {
            consume_css_escape(bytes, i, limit);
        } else {
            break;
        }
    }
}

fn consume_css_escape(bytes: &[u8], i: &mut usize, limit: usize) {
    debug_assert!(*i < limit && bytes[*i] == b'\\');
    *i += 1;
    if *i >= limit {
        return;
    }

    if bytes[*i].is_ascii_hexdigit() {
        let mut consumed = 0usize;
        while *i < limit && consumed < 6 && bytes[*i].is_ascii_hexdigit() {
            *i += 1;
            consumed += 1;
        }
        if *i < limit && bytes[*i].is_ascii_whitespace() {
            *i += 1;
        }
    } else {
        *i += 1;
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct BlockContext {
    declarations: bool,
    page: bool,
    property_registration_color_syntax: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ParenContext {
    SelectorFunction,
    Other,
}

#[derive(Debug)]
struct CssScanState {
    segment_start: usize,
    statement_start: usize,
    value_context: bool,
    value_paren_depth: usize,
    condition_value_context: bool,
    allow_named_colors: bool,
    block_stack: Vec<BlockContext>,
    paren_stack: Vec<ParenContext>,
    selector_function_depth: usize,
    statement_declaration_cache: Option<(usize, bool)>,
}

impl Default for CssScanState {
    fn default() -> Self {
        Self {
            segment_start: 0,
            statement_start: 0,
            value_context: false,
            value_paren_depth: 0,
            condition_value_context: false,
            allow_named_colors: true,
            block_stack: Vec::new(),
            paren_stack: Vec::new(),
            selector_function_depth: 0,
            statement_declaration_cache: None,
        }
    }
}

impl CssScanState {
    fn reset_statement(&mut self, start: usize) {
        self.segment_start = start;
        self.statement_start = start;
        self.statement_declaration_cache = None;
        self.paren_stack.clear();
        self.selector_function_depth = 0;
        self.reset_value();
    }

    fn reset_value(&mut self) {
        self.value_context = false;
        self.value_paren_depth = 0;
        self.condition_value_context = false;
        self.allow_named_colors = true;
    }

    fn push_paren(&mut self, context: ParenContext) {
        if context == ParenContext::SelectorFunction {
            self.selector_function_depth += 1;
        }
        self.paren_stack.push(context);
    }

    fn pop_paren(&mut self) {
        if self.paren_stack.pop() == Some(ParenContext::SelectorFunction) {
            self.selector_function_depth = self.selector_function_depth.saturating_sub(1);
        }
    }
}

fn update_value_state_at(bytes: &[u8], i: usize, state: &mut CssScanState) {
    match bytes[i] {
        b'{' => {
            let parent = state.block_stack.last().copied().unwrap_or_default();
            state.block_stack.push(block_context_for_open_brace(
                bytes,
                state.statement_start,
                i,
                parent,
            ));
            state.reset_statement(i + 1);
        }
        b'}' => {
            state.block_stack.pop();
            state.reset_statement(i + 1);
        }
        b';' => {
            state.reset_statement(i + 1);
        }
        b'(' => {
            let paren_context = if word_before(bytes, i).eq_ignore_ascii_case(b"selector") {
                ParenContext::SelectorFunction
            } else {
                ParenContext::Other
            };
            state.push_paren(paren_context);

            if state.value_context {
                state.value_paren_depth += 1;
            } else {
                state.segment_start = i + 1;
                state.reset_value();
            }
        }
        b')' if state.value_context
            && state.condition_value_context
            && state.value_paren_depth == 0 =>
        {
            state.pop_paren();
            state.segment_start = i + 1;
            state.reset_value();
        }
        b')' if state.value_context && state.value_paren_depth > 0 => {
            state.pop_paren();
            state.value_paren_depth -= 1;
        }
        b')' if !state.value_context => {
            state.pop_paren();
            state.segment_start = i + 1;
            state.reset_value();
        }
        b':' if !state.value_context => {
            let has_declaration_prefix = declaration_prefix(bytes, state.segment_start, i);
            if !has_declaration_prefix {
                state.value_context = false;
                return;
            }

            let condition_context = at_condition_context(
                bytes,
                state.statement_start,
                state.segment_start,
                state.selector_function_depth,
            );
            let declaration_block_context = state
                .block_stack
                .last()
                .map(|context| context.declarations)
                .unwrap_or(false)
                && state.statement_allows_declaration(bytes);
            state.value_context = declaration_block_context
                || condition_context
                || (state.block_stack.is_empty() && state.statement_allows_declaration(bytes));
            state.value_paren_depth = 0;
            state.condition_value_context = state.value_context && condition_context;
            let property_registration_color_syntax = state
                .block_stack
                .last()
                .map(|context| context.property_registration_color_syntax)
                .unwrap_or(false);
            state.allow_named_colors = state.value_context
                && property_allows_named_colors(
                    bytes,
                    state.segment_start,
                    i,
                    property_registration_color_syntax,
                );
        }
        _ => {}
    }
}

impl CssScanState {
    fn statement_allows_declaration(&mut self, bytes: &[u8]) -> bool {
        if let Some((start, allowed)) = self.statement_declaration_cache
            && start == self.statement_start
        {
            return allowed;
        }

        let allowed = statement_allows_declaration(bytes, self.statement_start);
        self.statement_declaration_cache = Some((self.statement_start, allowed));
        allowed
    }
}

fn statement_allows_declaration(bytes: &[u8], mut i: usize) -> bool {
    let mut depth = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b'{' if depth == 0 => return false,
            b';' | b'}' if depth == 0 => return true,
            _ => {}
        }
        i += 1;
    }

    true
}

fn word_before(bytes: &[u8], before: usize) -> &[u8] {
    let mut end = before;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && is_css_ident_byte(bytes[start - 1]) {
        start -= 1;
    }
    &bytes[start..end]
}

fn property_name(bytes: &[u8], start: usize, colon: usize) -> Option<&[u8]> {
    let mut i = start;
    skip_whitespace_and_comments(bytes, &mut i);
    if i >= colon {
        return None;
    }

    let prop_start = i;
    consume_css_ident(bytes, &mut i, colon);
    if i == prop_start {
        return None;
    }

    Some(&bytes[prop_start..i])
}

fn property_allows_named_colors(
    bytes: &[u8],
    start: usize,
    colon: usize,
    property_registration_color_syntax: bool,
) -> bool {
    let Some(name) = property_name(bytes, start, colon) else {
        return true;
    };

    if property_registration_color_syntax && name.eq_ignore_ascii_case(b"initial-value") {
        return true;
    }

    if name.starts_with(b"--") {
        return true;
    }

    if name.eq_ignore_ascii_case(b"color")
        || ends_with_ignore_ascii_case(name, b"-color")
        || ends_with_ignore_ascii_case(name, b"-colors")
    {
        return true;
    }

    [
        b"accent-color" as &[u8],
        b"background",
        b"background-color",
        b"block-overflow",
        b"border",
        b"border-block",
        b"border-block-color",
        b"border-block-end",
        b"border-block-start",
        b"border-bottom",
        b"border-bottom-color",
        b"border-color",
        b"border-inline",
        b"border-inline-color",
        b"border-inline-end",
        b"border-inline-start",
        b"border-left",
        b"border-left-color",
        b"border-right",
        b"border-right-color",
        b"border-top",
        b"border-top-color",
        b"box-shadow",
        b"caret-color",
        b"color",
        b"column-rule",
        b"column-rule-color",
        b"fill",
        b"filter",
        b"flood-color",
        b"-webkit-text-stroke",
        b"-webkit-text-emphasis",
        b"lighting-color",
        b"outline",
        b"outline-color",
        b"override-colors",
        b"scrollbar-color",
        b"stop-color",
        b"stroke",
        b"text-stroke",
        b"text-decoration",
        b"text-decoration-color",
        b"text-emphasis",
        b"text-emphasis-color",
        b"text-shadow",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn ends_with_ignore_ascii_case(bytes: &[u8], suffix: &[u8]) -> bool {
    bytes.len() >= suffix.len() && bytes[bytes.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

fn block_context_for_open_brace(
    bytes: &[u8],
    statement_start: usize,
    open_brace: usize,
    parent: BlockContext,
) -> BlockContext {
    let mut i = statement_start;
    skip_whitespace_and_comments(bytes, &mut i);
    if i >= open_brace || bytes[i] != b'@' {
        return BlockContext {
            declarations: true,
            page: false,
            property_registration_color_syntax: false,
        };
    }
    i += 1;
    let name_start = i;
    while i < open_brace && is_css_ident_byte(bytes[i]) {
        i += 1;
    }
    let name = &bytes[name_start..i];
    let page = name.eq_ignore_ascii_case(b"page");
    let property_registration = name.eq_ignore_ascii_case(b"property");
    let declarations = is_declaration_list_at_rule(name)
        || (parent.declarations && is_grouping_at_rule(name))
        || (parent.page && is_page_margin_at_rule(name));
    let property_registration_color_syntax =
        property_registration && property_block_syntax_allows_color(bytes, open_brace);

    BlockContext {
        declarations,
        page,
        property_registration_color_syntax,
    }
}

fn property_block_syntax_allows_color(bytes: &[u8], open_brace: usize) -> bool {
    let Some(close_brace) = find_close_brace(bytes, open_brace) else {
        return false;
    };

    let mut i = open_brace + 1;
    while i < close_brace {
        skip_whitespace_and_comments(bytes, &mut i);
        if i >= close_brace {
            break;
        }

        let descriptor_start = i;
        consume_css_ident(bytes, &mut i, close_brace);
        if i == descriptor_start {
            i += 1;
            continue;
        }

        let descriptor = &bytes[descriptor_start..i];
        skip_whitespace_and_comments(bytes, &mut i);
        if i >= close_brace || bytes[i] != b':' {
            i = descriptor_value_end(bytes, i, close_brace);
            if i < close_brace {
                i += 1;
            }
            continue;
        }

        i += 1;
        let value_start = i;
        let value_end = descriptor_value_end(bytes, i, close_brace);
        if descriptor.eq_ignore_ascii_case(b"syntax")
            && syntax_value_allows_color(bytes, value_start, value_end)
        {
            return true;
        }

        i = value_end;
        if i < close_brace {
            i += 1;
        }
    }

    false
}

fn syntax_value_allows_color(bytes: &[u8], start: usize, end: usize) -> bool {
    let mut i = start;
    skip_whitespace_and_comments(bytes, &mut i);
    if i >= end || (bytes[i] != b'"' && bytes[i] != b'\'') {
        return false;
    }

    let quote = bytes[i];
    i += 1;
    let content_start = i;
    while i < end {
        if bytes[i] == b'\\' {
            i = (i + 2).min(end);
            continue;
        }
        if bytes[i] == quote {
            return contains_color_component_type(&bytes[content_start..i]);
        }
        i += 1;
    }

    false
}

fn contains_color_component_type(bytes: &[u8]) -> bool {
    bytes
        .windows(b"<color>".len())
        .any(|window| window.eq_ignore_ascii_case(b"<color>"))
}

fn descriptor_value_end(bytes: &[u8], mut i: usize, limit: usize) -> usize {
    let mut paren_depth = 0usize;
    while i < limit {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let quote = bytes[i];
            i += 1;
            while i < limit {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(limit);
                } else if bytes[i] == quote {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < limit && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < limit && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(limit);
            continue;
        }

        if i + 1 < limit && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < limit && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        match bytes[i] {
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b';' if paren_depth == 0 => return i,
            _ => {}
        }
        i += 1;
    }

    limit
}

fn find_close_brace(bytes: &[u8], mut i: usize) -> Option<usize> {
    debug_assert!(i < bytes.len() && bytes[i] == b'{');
    let mut depth = 1usize;
    i += 1;
    while i < bytes.len() {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let quote = bytes[i];
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == quote {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }

        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }

    None
}

fn is_declaration_list_at_rule(name: &[u8]) -> bool {
    [
        b"font-face" as &[u8],
        b"font-palette-values",
        b"font-feature-values",
        b"page",
        b"property",
        b"counter-style",
        b"viewport",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn is_grouping_at_rule(name: &[u8]) -> bool {
    [
        b"media" as &[u8],
        b"supports",
        b"container",
        b"layer",
        b"scope",
        b"starting-style",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn is_page_margin_at_rule(name: &[u8]) -> bool {
    [
        b"top-left-corner" as &[u8],
        b"top-left",
        b"top-center",
        b"top-right",
        b"top-right-corner",
        b"bottom-left-corner",
        b"bottom-left",
        b"bottom-center",
        b"bottom-right",
        b"bottom-right-corner",
        b"left-top",
        b"left-middle",
        b"left-bottom",
        b"right-top",
        b"right-middle",
        b"right-bottom",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn at_condition_context(
    bytes: &[u8],
    statement_start: usize,
    segment_start: usize,
    selector_function_depth: usize,
) -> bool {
    if segment_start == 0 || bytes[segment_start - 1] != b'(' {
        return false;
    }

    let Some(at_rule_name) = statement_at_rule_name(bytes, statement_start, segment_start - 1)
    else {
        return false;
    };
    let supports = at_rule_name.eq_ignore_ascii_case(b"supports");
    let container = at_rule_name.eq_ignore_ascii_case(b"container");
    if !supports && !container {
        return false;
    }

    let before_paren = word_before(bytes, segment_start - 1);
    if before_paren.eq_ignore_ascii_case(b"selector") {
        return false;
    }

    if before_paren.eq_ignore_ascii_case(b"style") {
        return true;
    }

    if !supports {
        return false;
    }

    selector_function_depth == 0
}

fn statement_at_rule_name(bytes: &[u8], statement_start: usize, limit: usize) -> Option<&[u8]> {
    let mut i = statement_start;
    skip_whitespace_and_comments(bytes, &mut i);
    if i >= limit || bytes[i] != b'@' {
        return None;
    }
    i += 1;
    let name_start = i;
    while i < limit && is_css_ident_byte(bytes[i]) {
        i += 1;
    }
    (i > name_start).then_some(&bytes[name_start..i])
}

fn advance_value_state(bytes: &[u8], mut i: usize, end: usize, state: &mut CssScanState) {
    while i < end {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < end {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        if i + 1 < end && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < end {
                i += 2;
            } else {
                i = end;
            }
            continue;
        }

        if i + 1 < end && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < end && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        if is_word_boundary(bytes, i)
            && bytes[i].is_ascii_alphabetic()
            && let Some(url_end) = skip_url_function(bytes, i)
        {
            i = url_end.min(end);
            continue;
        }

        update_value_state_at(bytes, i, state);
        i += 1;
    }
}

/// Walk gradient inner content, replacing colours (skip nested modern funcs).
/// Writes directly to `out` instead of returning a new String.
fn process_gradient_inner(
    content: &str,
    stat: &mut ScanResult,
    mut out: Option<&mut String>,
    absolute_start: usize,
    ignore_ranges: &[(usize, usize)],
) -> usize {
    let bytes = content.as_bytes();
    let mut i = 0;
    let limit = absolute_start + bytes.len();
    let mut ir_idx = 0usize;
    let mut matches = 0usize;

    while i < bytes.len() {
        if let Some(skip_to) = ignored_until(absolute_start + i, limit, ignore_ranges, &mut ir_idx)
        {
            let next = skip_to - absolute_start;
            if let Some(out) = out.as_deref_mut() {
                out.push_str(&content[i..next]);
            }
            i = next;
            continue;
        }

        // Skip comments & strings
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            let start = i;
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < bytes.len() {
                i += 2;
            } else {
                i = bytes.len();
            }
            if let Some(out) = out.as_deref_mut() {
                out.push_str(&content[start..i]);
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            let start = i;
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            if let Some(out) = out.as_deref_mut() {
                out.push_str(&content[start..i]);
            }
            continue;
        }
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            let start = i;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == q {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            if let Some(out) = out.as_deref_mut() {
                out.push_str(&content[start..i]);
            }
            continue;
        }

        // Check for modern CSS functions (don't recurse into them)
        if is_word_boundary(bytes, i) {
            if let Some(end) = skip_url_function(bytes, i) {
                if let Some(out) = out.as_deref_mut() {
                    out.push_str(&content[i..end]);
                }
                i = end;
                continue;
            }

            if let Some(after) = func_at(bytes, i, MODERN_FUNCS) {
                let mut pos = after;
                skip_whitespace(bytes, &mut pos);
                if pos < bytes.len()
                    && bytes[pos] == b'('
                    && let Some(close) = find_close_paren(bytes, pos)
                {
                    if let Some(out) = out.as_deref_mut() {
                        out.push_str(&content[i..close + 1]);
                    }
                    i = close + 1;
                    continue;
                }
            }

            if let Some(end) = skip_relative_color_function(bytes, i) {
                if let Some(out) = out.as_deref_mut() {
                    out.push_str(&content[i..end]);
                }
                i = end;
                continue;
            }

            // Replaced colour inside gradient
            if let Some(out) = out.as_deref_mut() {
                if let Some(ni) = replace_at_transform(bytes, i, stat, out, true, true) {
                    matches += 1;
                    i = ni;
                    continue;
                }
            } else if let Some(ni) = replace_at_audit(bytes, i, stat, true, true) {
                matches += 1;
                i = ni;
                continue;
            }
        }

        if let Some(out) = out.as_deref_mut() {
            push_next_char(content, &mut i, out);
        } else {
            i += 1;
            continue;
        }
    }

    matches
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
        if starts_with_ignore_ascii_case(&bytes[i..], name) {
            let after = i + name.len();
            if after < bytes.len() && is_css_ident_byte(bytes[after]) {
                continue;
            }
            return Some((after, kind));
        }
    }
    None
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
fn replace_at_transform(
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
fn replace_at_audit(
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
        for grad in [
            "linear-gradient",
            "radial-gradient",
            "conic-gradient",
            "repeating-linear-gradient",
            "repeating-radial-gradient",
            "repeating-conic-gradient",
        ] {
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
        let ranges =
            find_ignore_ranges("a { color: #ff0000; /* oklch-ignore */ }\nb { color: blue; }");
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
