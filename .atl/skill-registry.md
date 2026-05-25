# Skill Registry — okcolor

## Compact Rules

### Project Standards
- **Architecture**: Rust/WASM core engine → TypeScript CLI + Vite plugin
- **Rust style**: Stable toolchain, clippy-clean, wasm-bindgen + memchr + aho-corasick
- **TS style**: ESM, strict TypeScript, Vitest for tests
- **Testing**: RED-GREEN-REFACTOR — write failing test first for every change
- **Benchmarks**: Run `npm run bench` before/after every perf change
- **No `useEffect`**: React-free (Vite plugin only, no UI framework)
- **No placeholder patterns**: Always complete implementations
- **Byte-level ops in hot path**: Prefer `eq_ignore_ascii_case` on `&[u8]` over string allocations

### Build Commands
- `npm test` — Vitest TS tests
- `cargo test` — Rust tests
- `npm run bench` — Vitest benchmarks
- `npm run build` — wasm-pack + tsdown full build
- `npm run lint` — ESLint
- `npm run format` — Prettier

## User Skills

| Skill | Trigger | Path |
|-------|---------|------|
| rust-best-practices | Rust code | `~/.agents/skills/rust-best-practices/SKILL.md` |
| rust-testing | Rust tests | `~/.agents/skills/rust-testing/SKILL.md` |
| full-output-enforcement | Any code gen | `~/.claude/skills/output-skill/SKILL.md` |
| go-testing | (N/A — Go not in stack) | `~/.claude/skills/go-testing/SKILL.md` |
| no-use-effect | React/TS | `~/.agents/skills/no-use-effect/SKILL.md` |
| debugging | Bug diagnosis | `~/.claude/skills/diagnose/SKILL.md` |
| web-perf | Web performance | `~/.claude/skills/web-perf/SKILL.md` |

## Project Conventions

| File | Status |
|------|--------|
| `CLAUDE.md` | ✅ Root-level instructions |
| `.github/ISSUE_TEMPLATE/` | ✅ Has templates |
| `.github/workflows/ci.yml` | ✅ CI pipeline |
| `CONTRIBUTING.md` | ✅ Contributing guide |
| `CHANGELOG.md` | ✅ Keep a Changelog |
| `openspec/config.yaml` | ✅ SDD config (new) |
