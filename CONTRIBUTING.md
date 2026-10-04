# Contributing

Thanks for helping. qa-tracker is deliberately small: plain ESM, Node ≥ 20, one
runtime dependency (`yaml`), no build step.

## Setup

```bash
git clone https://github.com/Kadreev/qa-tracker.git
cd qa-tracker
pnpm install          # npm install works too
npm test              # node --test — the whole suite runs in under a second
npm run demo          # dashboard for examples/demo at http://localhost:4300
```

## Ground rules

- **The schema lives in two places on purpose.** `src/schema.mjs` is what the code
  enforces; `docs/SCHEMA.md` is what people and agents read. Change both in the
  same commit; `test/schema.test.mjs` fails when they disagree. The ladder
  meanings also appear in `templates/AGENTS.md`.
- **The evidence rules are the product.** A change that lets a level rise
  without a run, or lets a read-only run certify a mutating surface, needs a
  very good reason and a discussion in an issue first.
- **Keep diffs small for users.** Writes go through `src/store.mjs` with
  `{ lineWidth: 0 }` and keep comments and flow style. Don't add anything that
  reformats untouched entries.
- **Generated files are deterministic.** `STATUS.md` and `SURFACES.md` must not
  embed timestamps. If you change the renderer, run `npm run demo:render` and
  commit the regenerated demo; a test checks it is current.
- **The server is a write endpoint on localhost.** Keep it bound to loopback by
  default and keep the Host, Origin and content-type checks.
- Add a test with every behaviour change, and a line under `## [Unreleased]` in
  `CHANGELOG.md` for anything user-visible.

## Releasing

1. Move the `Unreleased` entries under a new version heading in `CHANGELOG.md`.
2. Bump `version` in `package.json` to match.
3. Tag `vX.Y.Z` and publish with `npm publish`.
