use super::ScanResult;
use super::ignore::ignored_until;
use super::replace::{replace_at_audit, replace_at_transform};
use super::token::{
    is_css_ident_byte, is_word_boundary, keyword_at, push_next_char, skip_modern_function,
    skip_relative_color_function, skip_url_function, skip_whitespace_and_comments,
    starts_with_ignore_ascii_case,
};

const GRADIENT_NAMES: &[&str] = &[
    "linear-gradient",
    "radial-gradient",
    "conic-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
    "repeating-conic-gradient",
];

/// Check whether `bytes[i..]` starts with one of the gradient names.
pub(super) fn gradient_at(bytes: &[u8], i: usize) -> Option<usize> {
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

pub(super) fn has_leading_gradient_interpolation(inner: &[u8]) -> bool {
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

/// Walk gradient inner content, replacing colours (skip nested modern funcs).
/// Writes directly to `out` instead of returning a new String.
pub(super) fn process_gradient_inner(
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

            if let Some(end) = skip_modern_function(bytes, i) {
                if let Some(out) = out.as_deref_mut() {
                    out.push_str(&content[i..end]);
                }
                i = end;
                continue;
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
