# Threat model

## Assets

1. **Visitors' browsers.** Anyone who opens the GitHub Pages site runs this code.
2. **Contributors' machines.** Anyone who clones the repo and runs a script, or opens it in an AI coding agent.
3. **The maintainer's GitHub account and CI.** Push access, the Pages deployment, Actions tokens.

## Attack surfaces and controls

### Supply chain

- **npm.** There is no dependency tree to poison. CI enforces this (`scripts/security-scan.mjs`).
- **Third-party code.** None. Unlike the WebGL edition, this one ships no vendored library: the rig is CSS, charts are SVG built in code, and sound is synthesised with WebAudio. The scanner rejects any non-local import, any dynamic `import()`, and any canvas/WebGL use.
- **GitHub Actions.** Pinned to commit SHAs, so a moved tag can't change what runs. Tokens are read-only except where a job genuinely needs more (CodeQL `security-events`, Pages `pages`/`id-token`), and those are scoped per job.
  - *Residual risk:* `actions/upload-pages-artifact` is a composite action that calls other actions by tag internally. Pinning the outer SHA fixes its code but not those inner references. The job that runs it has no write token.

### Prompt injection (against people using AI agents on this repo)

AI coding agents read files and treat some of them as instructions. An attacker can try to plant text that the agent obeys and the human never sees.

| Vector | Control |
|---|---|
| Auto-loaded instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.claude/`, `.wolf/` …) | Gitignored and banned by the scanner unless explicitly listed in `.agent-files-allowlist` after review. |
| Repo-level MCP config (`.mcp.json`) that launches a server on clone | Gitignored and banned by the scanner. |
| Hidden text: zero-width characters, bidi overrides (Trojan Source), Unicode tag characters | Scanner rejects them in every text file. |
| HTML comments in Markdown (invisible on GitHub, visible in raw files) | Scanner rejects them. |
| Imperative bait: text telling an agent to discard its earlier instructions, to run or download something, or to pipe a download into a shell | Pattern-matched by the scanner in docs, code comments and data. |
| Malicious pull requests adding any of the above | CI runs the scanner on every PR; branch protection should require it to pass. |

Pattern matching can't catch every phrasing, so **review PRs that touch docs or configuration as carefully as code.**

### Browser runtime

- **CSP** (meta tag, plus HTTP headers from the dev server): only same-origin scripts and styles, no network, no forms, no plugins, no `<base>` rewriting.
- **No HTML injection path**: `src/dom.js` never parses HTML. `h()` blocks `on*` and `style` attributes and only allows `#`, `./` and `https://` links; `s()` (SVG) also rejects `href`.
- **Kill-sheet inputs** are parsed with `parseFloat` and only ever used as numbers.
- **Local storage** is the only input. It is validated and size-capped before use (`validateSave`, with tests for prototype pollution, NaN and Infinity, oversized values, forged wells and unknown items/achievements).

### Things this project deliberately does not have

A backend, authentication, cookies, analytics, third-party scripts, payment processing, file uploads or user-generated content.
