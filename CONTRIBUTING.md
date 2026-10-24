# Contributing

Thanks for helping! A few ground rules keep this repo safe to clone.

## Setup

No install step. You need Node 20 or newer.

```sh
git config core.hooksPath .githooks   # strips AI co-author trailers from your commits
npm start                             # http://127.0.0.1:5173
npm run check                         # security scan + tests
```

## Rules

- **No dependencies and no vendored code.** This edition is deliberately third-party-free.
- **No canvas or WebGL.** The rig is pure CSS; keep it that way.
- **No HTML strings.** Build UI with `h()` and `s()` from `src/dom.js`.
- **No network calls** from `src/`. The CSP blocks them anyway.
- **No AI agent config files** in commits (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …). Keep them local; they're gitignored.
- **Physics changes need a test** in `tests/reservoir.test.mjs` with a hand-checkable value, and a matching update to `docs/PETROLEUM_MODEL.md`.
- `npm run check` must pass before you open a pull request.
