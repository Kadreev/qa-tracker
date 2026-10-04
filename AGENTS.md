# AGENTS.md — working on qa-tracker itself

(For using qa-tracker inside another project, read `templates/AGENTS.md`, which
`qa-tracker init` copies into the data directory.)

## Layout

- `bin/qa-tracker.mjs` — CLI entry; all logic is in `src/cli.mjs`.
- `src/schema.mjs` — vocabulary and field specs. Single source of truth.
- `src/validate.mjs`, `src/surfaces.mjs` — the rules.
- `src/edit.mjs` — applies one change to YAML Documents (comment-preserving).
- `src/store.mjs` — load → apply → validate → write → regenerate STATUS.md.
- `src/markdown.mjs`, `src/dashboard.mjs`, `src/server.mjs` — rendering and the local dashboard.
- `templates/` — what `init` copies. `examples/demo/` — the demo dataset.
- `docs/SCHEMA.md` — prose schema, kept in step with `src/schema.mjs` by tests.

## Before you hand back

```bash
npm test                    # must pass
npm run demo:render         # if you touched rendering; commit the result
```

Follow `CONTRIBUTING.md`: change the schema module and `docs/SCHEMA.md` together,
never weaken the evidence rules without an issue, keep generated output
deterministic, and keep the server loopback-only with its request checks.
