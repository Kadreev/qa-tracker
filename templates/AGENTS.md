# QA tracker — guide for AI agents

This directory is a QA validation tracker ([qa-tracker](https://github.com/Kadreev/qa-tracker)).
It is plain YAML plus a CLI, so you can read and update it without a browser.

## Read the state

- **`STATUS.md`** — the generated snapshot: coverage matrix, open issues, next-run
  plan. Read it first.
- **`SURFACES.md`** — the generated UI checklist, if `surfaces/` has files.
- Source of truth: `features.yaml`, `issues.yaml`, `runs.yaml`, `surfaces/*.yaml`.

```bash
npx qa-tracker status            # the snapshot
npx qa-tracker plan --json       # what to validate next, ranked
npx qa-tracker get <id> --json   # one feature, issue or run
npx qa-tracker surfaces --json   # every surface, flat, with its `expected` text
```

(Pass `--dir <path>` if this directory is not `./qa-tracker` from where you run.)

## The validation ladder

`current_level` is the highest level whose checks **fully passed in a recorded run**.
Cumulative: a feature with a failing L1 check is L0 however well L2 went.

| Level | Passes when |
|---|---|
| L0 | Renders; no console errors or blank states |
| L1 | Displayed data is correct and internally consistent |
| L2 | Non-mutating interactions work (filters, tabs, modals, sort) |
| L3 | Create, edit, delete and run exercised and verified |
| L4 | Edge cases, empty and error states, concurrency, regressions re-checked |

## Rules you must follow

1. **No run, no level bump.** `current_level` only moves through `add-run --levels`.
   The CLI refuses `set <feature> current_level`.
2. **Read-only runs cap at L2** and can only pass `read`/`navigate` surfaces. L3/L4
   need a sandbox or a dedicated test account — never real user data. The
   validator enforces both.
3. **Never overwrite user intent.** `weight`, `target_level`, `name`, `area` and
   `routes` belong to the humans. Change them only when a human asks.
4. **Findings are never deleted.** Change `status` instead; ids are permanent.
5. **Validate before committing:** `npx qa-tracker validate` must pass.
6. **Prefer the CLI to hand edits.** It validates the whole dataset before writing,
   keeps formatting stable and regenerates `STATUS.md`.

## After a QA pass

```bash
# 1. file what you found (ids default to QA-1, QA-2, …)
npx qa-tracker add-issue --feature notes-list --severity high --type functionality \
  --title "Deleting a pinned note leaves an empty card until reload"

# 2. record the run — it is the evidence, and it applies the level changes
npx qa-tracker add-run --blast-radius sandbox --profiles bug-hunter \
  --features notes-list,search --levels notes-list=L3 --opened QA-7 --verified QA-2

# 3. per-feature quality dimensions (pass | issues | unknown)
npx qa-tracker set notes-list functionality issues

# 4. per-surface verdicts, if surfaces/ is used
npx qa-tracker verdict notes.list.sort broken --run run-2026-01-20 --issues QA-3
npx qa-tracker verdict notes.list.empty blocked --run run-2026-01-20 --notes "needs a fresh account"

npx qa-tracker validate
```

`--verified` marks those issues `verified-fixed`. When a fix ships, set the issue
to `fixed` and the feature's `reverify` to `true`, so the next plan re-checks it:

```bash
npx qa-tracker set QA-2 status fixed
npx qa-tracker set notes-list reverify true
```

## Planning the next run

`plan` ranks features by `weight × (target − current)` plus a bonus for `reverify`.
When you dispatch browser agents, hand each one a list of surface ids and their
`expected` text, and ask for a verdict per id. That keeps "tested through the UI"
attributable.

Schema reference: https://github.com/Kadreev/qa-tracker/blob/main/docs/SCHEMA.md
