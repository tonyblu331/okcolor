# Design: MVP Initial Build

## Technical Approach

Build inside-out: Rust core → WASM compilation → TypeScript bridge → Vite plugin + CLI. The Rust core owns all parsing and math; TypeScript handles I/O, Vite integration, and CLI surface.

## Architecture Decisions

### Decision: Rust + WASM for Core Engine

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Rust + WASM | Zero-cost abstractions, small wasm, precise math | ✅ Chosen |
| Pure TypeScript | Faster dev cycle, larger bundle, slower math | ❌ Rejected — PRD requires < 15ms HMR |
| Native Node addon | Fastest, complex cross-platform builds | ❌ Rejected — WASM is simpler to distribute |

### Decision: Single Package with Internal WASM

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Single package | Simpler install, larger npm tarball | ✅ Chosen |
| Monorepo (core + plugin + cli) | Granular deps, complex publish | ❌ Rejected — premature for MVP |

### Decision: String Interner over HashMap

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Direct-mapped `Vec` + `u32` indices | O(1), cache-friendly, no hash overhead | ✅ Chosen — PRD explicitly requires this |
| `FxHashMap` | Standard, flexible | ❌ Rejected — violates PRD constraint |

## Data Flow

```
CSS Source (bytes)
       │
       ▼
┌──────────────┐
│  DFA Lexer   │ ──→ Skip if var()/calc()/env()/currentColor
│  (Rust/WASM) │ ──→ Skip if /* oklch-ignore */
└──────────────┘
       │
       ▼
┌──────────────┐
│   Token      │
│  (Hex/RGB/   │
│  HSL/Named)  │
└──────────────┘
       │
       ▼
┌──────────────┐
│   Interner   │ ──→ Known? Return cached ColorID
│  (u32 index) │ ──→ New? Assign ColorID, compute OKLCH
└──────────────┘
       │
       ▼
┌──────────────┐
│  OKLCH Math  │
│  (sRGB →     │
│   OKLab →    │
│   OKLCH)     │
└──────────────┘
       │
       ▼
┌──────────────┐
│  String      │
│  Rebuild     │
└──────────────┘
       │
       ▼
Transformed CSS
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/core-wasm/Cargo.toml` | Create | Rust package manifest |
| `packages/core-wasm/src/lib.rs` | Create | WASM exports, top-level transform fn |
| `packages/core-wasm/src/lexer.rs` | Create | DFA byte scanner |
| `packages/core-wasm/src/token.rs` | Create | Token types (Hex, Rgb, Hsl, Named) |
| `packages/core-wasm/src/color.rs` | Create | sRGB → OKLab → OKLCH math |
| `packages/core-wasm/src/interner.rs` | Create | String interner with u32 ColorID |
| `packages/core-wasm/src/named.rs` | Create | CSS named color → sRGB lookup table |
| `src/index.ts` | Create | Public API re-exports |
| `src/vite.ts` | Create | Vite plugin implementation |
| `src/cli.ts` | Create | CLI entry point (audit, check) |
| `src/wasm.ts` | Create | WASM initialization and bridge helpers |
| `src/types.ts` | Create | Shared TypeScript interfaces |
| `package.json` | Create | npm manifest with exports + bin |
| `tsconfig.json` | Create | TypeScript compiler options |
| `tsdown.config.ts` | Create | Build configuration |

## Interfaces / Contracts

### WASM Exports (Rust)

```rust
#[wasm_bindgen]
pub fn transform_css(input: &[u8]) -> String;

#[wasm_bindgen]
pub fn audit_css(input: &[u8]) -> JsValue; // JSON string
```

### TypeScript Plugin API

```typescript
export interface OkActuallyOptions {
  ignoreComment?: string; // default: "oklch-ignore"
}

export function okActually(options?: OkActuallyOptions): Plugin;
```

### CLI Interface

```bash
ok-actually audit [path] [--format=json]
ok-actually check [path] [--max-legacy-colors=N] [--allow-named] [--format=json]
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Rust) | DFA lexer tokenization, color math accuracy, interner dedup | `cargo test` with W3C reference values |
| Unit (TS) | WASM bridge, plugin hook registration, CLI argument parsing | `vitest` with mocked file system |
| Integration | Vite plugin transforms real CSS files | `vitest` + temporary Vite build |

## Migration / Rollout

No migration required. This is a greenfield package.

## Open Questions

- [ ] Should the WASM target be `web` or `bundler` for Vite compatibility?
- [ ] What OKLCH precision (decimal places) produces acceptable browser parity?
