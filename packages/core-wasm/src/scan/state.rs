use super::context::{
    BlockContext, at_condition_context, block_context_for_open_brace, declaration_prefix,
    property_allows_named_colors, statement_allows_declaration, word_before,
};
use super::token::{is_word_boundary, skip_url_function};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ParenContext {
    SelectorFunction,
    Other,
}

#[derive(Debug)]
pub(super) struct CssScanState {
    segment_start: usize,
    statement_start: usize,
    pub(super) value_context: bool,
    value_paren_depth: usize,
    condition_value_context: bool,
    pub(super) allow_named_colors: bool,
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

pub(super) fn update_value_state_at(bytes: &[u8], i: usize, state: &mut CssScanState) {
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

pub(super) fn advance_value_state(
    bytes: &[u8],
    mut i: usize,
    end: usize,
    state: &mut CssScanState,
) {
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
