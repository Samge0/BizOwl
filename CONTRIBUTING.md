# Contributing to BizOwl

Thanks for your interest in contributing! 🎉

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/<your-username>/BizOwl.git`
3. **Install** dependencies:
   ```bash
   npm install
   cd skills/builtin/web-search && npm install && cd ../../..
   ```
4. **Run** in dev mode: `npm run dev`

## Development Workflow

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Test: `npm run test:renderer`
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new agent preset
   fix: resolve token refresh issue
   docs: update README
   chore: bump dependencies
   ```
5. Push and open a Pull Request

## Code Style

- **JavaScript**: 2-space indentation, single quotes, semicolons
- **CSS**: BEM-ish naming, CSS custom properties for theming
- **HTML**: Semantic tags, accessibility attributes
- See `.editorconfig` for editor settings

## Project Structure

```
electron/     # Main process (CJS) — IPC handlers, window management
src/          # Business logic (ESM) — agent loop, auth, prompt pipeline
renderer/     # UI layer — HTML, CSS, vanilla JS modules
skills/       # Built-in skills (document export, web search, etc.)
assets/       # Static resources (preset prompts, icons)
scripts/      # Development tools (test harness)
```

## Key Principles

- **Preserve existing functionality** — don't break what works
- **Apple Design System** — UI follows SF Pro typography, Action Blue (#0066CC), frosted glass
- **No external UI frameworks** — vanilla JS + CSS custom properties
- **Token safety** — never consume `refreshToken` (one-time rotation, would kick the original app)

## Reporting Bugs

Use [GitHub Issues](https://github.com/Samge0/BizOwl/issues). Include:
- OS and Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Console logs (from Debug Console in the app)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
