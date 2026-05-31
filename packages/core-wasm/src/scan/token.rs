pub(super) fn is_css_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte >= 0x80
}

pub(super) fn is_css_ident_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte >= 0x80
}

pub(super) fn is_word_boundary(bytes: &[u8], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    !is_css_ident_byte(bytes[i - 1])
}

pub(super) fn push_next_char(input: &str, i: &mut usize, out: &mut String) {
    let ch = input[*i..]
        .chars()
        .next()
        .expect("cursor must point inside input");
    out.push(ch);
    *i += ch.len_utf8();
}

pub(super) fn skip_whitespace(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
        *i += 1;
    }
}

pub(super) fn skip_whitespace_and_comments(bytes: &[u8], i: &mut usize) {
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

pub(super) fn skip_alpha(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && bytes[*i].is_ascii_alphabetic() {
        *i += 1;
    }
}

pub(super) fn starts_with_ignore_ascii_case(bytes: &[u8], prefix: &[u8]) -> bool {
    bytes.len() >= prefix.len() && bytes[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Return (offset-after-name, type-name) for a recognized colour function.
pub(super) fn func_color_type(bytes: &[u8], i: usize) -> Option<(usize, &'static str)> {
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

pub(super) fn keyword_at(bytes: &[u8], i: usize, keyword: &[u8], limit: usize) -> bool {
    let end = i + keyword.len();
    end <= limit
        && (i == 0 || !is_css_ident_byte(bytes[i - 1]))
        && bytes[i..end].eq_ignore_ascii_case(keyword)
        && (end == limit || !is_css_ident_byte(bytes[end]))
}

pub(super) fn skip_url_function(bytes: &[u8], i: usize) -> Option<usize> {
    let after = func_at(bytes, i, URL_FUNCS)?;
    let mut pos = after;
    skip_whitespace(bytes, &mut pos);
    if pos < bytes.len() && bytes[pos] == b'(' {
        let close = find_close_paren_without_line_comments(bytes, pos)?;
        return Some(close + 1);
    }
    None
}

pub(super) fn skip_modern_function(bytes: &[u8], i: usize) -> Option<usize> {
    let after = func_at(bytes, i, MODERN_FUNCS)?;
    let mut pos = after;
    skip_whitespace(bytes, &mut pos);
    if pos < bytes.len() && bytes[pos] == b'(' {
        let close = find_close_paren(bytes, pos)?;
        return Some(close + 1);
    }
    None
}

pub(super) fn skip_relative_color_function(bytes: &[u8], i: usize) -> Option<usize> {
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
pub(super) fn find_close_paren(bytes: &[u8], i: usize) -> Option<usize> {
    find_close_paren_inner(bytes, i, true)
}

pub(super) fn find_close_paren_without_line_comments(bytes: &[u8], i: usize) -> Option<usize> {
    find_close_paren_inner(bytes, i, false)
}

pub(super) fn find_close_paren_inner(
    bytes: &[u8],
    mut i: usize,
    skip_line_comments: bool,
) -> Option<usize> {
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
