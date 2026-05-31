use super::token::{is_word_boundary, skip_url_function};

/// Collect byte ranges of line content that should be ignored.
/// A line is ignored if it contains `/* oklch-ignore */`.
/// NOTE: the caller guarantees at least one marker exists.
pub(super) fn find_ignore_ranges(input: &str) -> Vec<(usize, usize)> {
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

pub(super) fn ignored_until(
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
