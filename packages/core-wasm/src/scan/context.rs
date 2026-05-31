use super::token::{is_css_ident_byte, is_css_ident_start_byte, skip_whitespace_and_comments};

pub(super) fn declaration_prefix(bytes: &[u8], start: usize, colon: usize) -> bool {
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
pub(super) struct BlockContext {
    pub(super) declarations: bool,
    page: bool,
    pub(super) property_registration_color_syntax: bool,
}

pub(super) fn statement_allows_declaration(bytes: &[u8], mut i: usize) -> bool {
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

pub(super) fn word_before(bytes: &[u8], before: usize) -> &[u8] {
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

pub(super) fn property_allows_named_colors(
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

pub(super) fn block_context_for_open_brace(
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

pub(super) fn at_condition_context(
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
