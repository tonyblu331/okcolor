use super::gradient::gradient_at;
use super::ignore::{find_ignore_ranges, ignored_until};
use super::sink::{AuditSink, GradientMatch, ScanSink, TransformSink};
use super::state::{CssScanState, advance_value_state, update_value_state_at};
use super::token::{
    find_close_paren, is_word_boundary, skip_modern_function, skip_relative_color_function,
    skip_url_function,
};
use super::{ScanResult, count_legacy_indicators, has_legacy_indicators};

pub(super) fn scan_transform_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let has_ignore = bytes
        .windows(12)
        .any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    let indicator_counts = count_legacy_indicators(bytes);
    if !has_ignore && indicator_counts.is_empty() {
        return ScanResult {
            css: input.to_string(),
            ..ScanResult::default()
        };
    }

    scan_impl(
        input,
        TransformSink::with_capacity(bytes.len() + indicator_counts.estimated_growth()),
        has_ignore,
    )
}

pub(super) fn scan_audit_impl(input: &str) -> ScanResult {
    let bytes = input.as_bytes();
    let has_ignore = bytes
        .windows(12)
        .any(|w| w.eq_ignore_ascii_case(b"oklch-ignore"));
    if !has_legacy_indicators(bytes) {
        return ScanResult::default();
    }

    scan_impl(input, AuditSink, has_ignore)
}

fn scan_impl<S: ScanSink>(input: &str, mut sink: S, has_ignore: bool) -> ScanResult {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut stat = ScanResult::default();

    let ignore_ranges = if has_ignore {
        find_ignore_ranges(input)
    } else {
        Vec::new()
    };
    let mut ir_idx = 0usize;
    let mut i = 0usize;
    let mut scan_state = CssScanState::default();

    while i < len {
        if let Some(skip_to) = ignored_until(i, len, &ignore_ranges, &mut ir_idx) {
            sink.push_str(&input[i..skip_to]);
            advance_value_state(bytes, i, skip_to, &mut scan_state);
            i = skip_to;
            continue;
        }

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
            sink.push_str(&input[start..i]);
            continue;
        }
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            let start = i;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            sink.push_str(&input[start..i]);
            continue;
        }

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
            sink.push_str(&input[start..i]);
            continue;
        }

        if bytes[i] == b'#' {
            if let Some(end) = sink.replace_at(
                bytes,
                i,
                &mut stat,
                scan_state.value_context,
                scan_state.allow_named_colors,
            ) {
                i = end;
                continue;
            }
            sink.push_char('#');
            i += 1;
            continue;
        }

        if is_word_boundary(bytes, i) && bytes[i].is_ascii_alphabetic() {
            if let Some(end) = skip_url_function(bytes, i) {
                sink.push_str(&input[i..end]);
                i = end;
                continue;
            }
            if let Some(end) = skip_modern_function(bytes, i) {
                sink.push_str(&input[i..end]);
                i = end;
                continue;
            }
            if let Some(end) = skip_relative_color_function(bytes, i) {
                sink.push_str(&input[i..end]);
                i = end;
                continue;
            }

            if let Some(name_end) = gradient_at(bytes, i) {
                let paren_pos = name_end;
                debug_assert!(paren_pos < len && bytes[paren_pos] == b'(');
                let close = match find_close_paren(bytes, paren_pos) {
                    Some(c) => c,
                    None => {
                        sink.push_next_char(input, &mut i);
                        continue;
                    }
                };
                sink.handle_gradient(
                    &mut i,
                    GradientMatch {
                        input,
                        bytes,
                        name_end,
                        close,
                        ignore_ranges: &ignore_ranges,
                    },
                    &mut stat,
                );
                continue;
            }

            if let Some(end) = sink.replace_at(
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
        sink.push_next_char(input, &mut i);
    }

    stat.css = sink.finish();
    stat.legacy_count =
        stat.hex_count + stat.rgb_count + stat.hsl_count + stat.hwb_count + stat.named_count;
    stat
}
