# Contributing

Thanks for your interest in contributing to ok-actually!

## Development Setup

You need:
- [Node.js](https://nodejs.org/) >= 18

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm run test

# Lint & format
npm run lint
npm run format
```

## Project Structure

```
├── packages/
│   └── docs/          # Astro Starlight documentation site
├── src/               # TypeScript source (Vite plugin, CLI, color engine)
│   └── engine/        # Pure JS color conversion engine
├── test/              # TypeScript test suite
└── dist/              # Compiled output (generated)
```

## Pull Request Process

1. Fork the repository and create a branch
2. Make your changes with tests
3. Ensure `cargo test` and `npm run test` pass
4. Update documentation if your change is user-facing
5. Open a PR against `main`

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `perf:` — performance improvement
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or correcting tests

## Questions?

Open a [discussion](https://github.com/ok-actually/ok-actually/discussions) or [issue](https://github.com/ok-actually/ok-actually/issues).
