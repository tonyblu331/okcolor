use std::str;

use super::ScanResult;
use super::gradient::{has_leading_gradient_interpolation, process_gradient_inner};
use super::replace::{replace_at_audit, replace_at_transform};
use super::token::push_next_char;

pub(super) struct TransformSink {
    css: String,
}

impl TransformSink {
    pub(super) fn with_capacity(capacity: usize) -> Self {
        Self {
            css: String::with_capacity(capacity),
        }
    }
}

pub(super) struct AuditSink;

pub(super) struct GradientMatch<'a> {
    pub(super) input: &'a str,
    pub(super) bytes: &'a [u8],
    pub(super) name_end: usize,
    pub(super) close: usize,
    pub(super) ignore_ranges: &'a [(usize, usize)],
}

pub(super) trait ScanSink {
    fn push_str(&mut self, value: &str);
    fn push_char(&mut self, value: char);
    fn push_next_char(&mut self, input: &str, i: &mut usize);
    fn replace_at(
        &mut self,
        bytes: &[u8],
        i: usize,
        stat: &mut ScanResult,
        value_context: bool,
        allow_named_colors: bool,
    ) -> Option<usize>;
    fn handle_gradient(
        &mut self,
        i: &mut usize,
        gradient: GradientMatch<'_>,
        stat: &mut ScanResult,
    );
    fn finish(self) -> String;
}

impl ScanSink for TransformSink {
    fn push_str(&mut self, value: &str) {
        self.css.push_str(value);
    }

    fn push_char(&mut self, value: char) {
        self.css.push(value);
    }

    fn push_next_char(&mut self, input: &str, i: &mut usize) {
        push_next_char(input, i, &mut self.css);
    }

    fn replace_at(
        &mut self,
        bytes: &[u8],
        i: usize,
        stat: &mut ScanResult,
        value_context: bool,
        allow_named_colors: bool,
    ) -> Option<usize> {
        replace_at_transform(
            bytes,
            i,
            stat,
            &mut self.css,
            value_context,
            allow_named_colors,
        )
    }

    fn handle_gradient(
        &mut self,
        i: &mut usize,
        gradient: GradientMatch<'_>,
        stat: &mut ScanResult,
    ) {
        let inner = &gradient.bytes[gradient.name_end + 1..gradient.close];
        let inner_s = match str::from_utf8(inner) {
            Ok(s) => s,
            Err(_) => {
                self.push_next_char(gradient.input, i);
                return;
            }
        };
        let already_ok = has_leading_gradient_interpolation(inner);
        let mut inner_out = String::with_capacity(inner_s.len() + 32);
        let transformed = process_gradient_inner(
            inner_s,
            stat,
            Some(&mut inner_out),
            gradient.name_end + 1,
            gradient.ignore_ranges,
        );
        if transformed == 0 {
            self.css.push_str(&gradient.input[*i..gradient.close + 1]);
            *i = gradient.close + 1;
            return;
        }

        stat.gradient_count += 1;
        self.css.push_str(&gradient.input[*i..gradient.name_end]);
        self.css.push('(');
        if !already_ok {
            self.css.push_str("in oklch, ");
        }
        self.css.push_str(&inner_out);
        self.css.push(')');
        *i = gradient.close + 1;
    }

    fn finish(self) -> String {
        self.css
    }
}

impl ScanSink for AuditSink {
    fn push_str(&mut self, _value: &str) {}

    fn push_char(&mut self, _value: char) {}

    fn push_next_char(&mut self, _input: &str, i: &mut usize) {
        *i += 1;
    }

    fn replace_at(
        &mut self,
        bytes: &[u8],
        i: usize,
        stat: &mut ScanResult,
        value_context: bool,
        allow_named_colors: bool,
    ) -> Option<usize> {
        replace_at_audit(bytes, i, stat, value_context, allow_named_colors)
    }

    fn handle_gradient(
        &mut self,
        i: &mut usize,
        gradient: GradientMatch<'_>,
        stat: &mut ScanResult,
    ) {
        let inner = &gradient.bytes[gradient.name_end + 1..gradient.close];
        if let Ok(inner_s) = str::from_utf8(inner) {
            let found = process_gradient_inner(
                inner_s,
                stat,
                None,
                gradient.name_end + 1,
                gradient.ignore_ranges,
            );
            if found > 0 {
                stat.gradient_count += 1;
            }
        }
        *i = gradient.close + 1;
    }

    fn finish(self) -> String {
        String::new()
    }
}
