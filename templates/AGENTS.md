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
npx qa-tracker next --json       # the open issue to fix now (dashboard order)
npx qa-tracker issues            # every open issue, in that order
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
# 1. file what you found (ids default to QA-1, QA-2, …). --severity is optional:
#    describe the problem in --details and leave the rest to triage (below)
npx qa-tracker add-issue --feature notes-list \
  --title "Deleting a pinned note leaves an empty card until reload" \
  --details "Pin a note, delete it from the list: the card stays, empty, until reload."

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

## Fixing findings

Work the open issues in the order the dashboard shows them: severity, then
complexity. `next` always returns the top one, so a person watching the
dashboard sees you take its rows from the top. Do not pick issues by another
ordering unless asked.

```bash
npx qa-tracker next                                  # read its details and source first
# … fix it, with a test that failed before the fix …
npx qa-tracker note QA-7 Fixed in abc123: the total now counts paused rows
npx qa-tracker set QA-7 status fixed                 # verified-fixed needs a later run
```

`note` appends one dated paragraph to the issue's details; the words need no
quoting, and `--file <path>` reads longer text from a file.

## Triage

Every issue has three triage fields: `severity` (impact: critical → low),
`complexity` (effort to fix, 1–10) and `category` (what kind of defect). `status`
is the lifecycle, a separate thing. You may pass any of them to `add-issue`
(`--severity`, `--complexity`, `--category`); a value you give is explicit and is
never overwritten.

Leave out what you are unsure of. Anything missing lands in the **triage queue**:

```bash
npx qa-tracker triage            # or --json: open issues needing a decision
npx qa-tracker set QA-7 category accessibility
npx qa-tracker set QA-7 complexity 2
npx qa-tracker set QA-7 severity medium
```

- `needs-triage`: a value is missing (or the category is not in the list). Decide
  it from the issue and `set` it.
- `disagrees`: a value that was set on purpose differs from a confident Jev
  suggestion. Decide which is right and `set` the value (even the same one); that
  records that you reviewed it and clears the item.

If a TypeSafe key is configured, `npx qa-tracker assess` asks Jev first and fills
the confident answers; `triage` then shows only what is left. It sends the issue
title and `details`, so never put secrets or customer data in `--details`. A value
marked `ᴶ` in `STATUS.md` is a model's judgment that nobody has confirmed.
`npx qa-tracker get QA-7` shows where each value came from.

## Planning the next run

`plan` ranks features by `weight × (target − current)` plus a bonus for `reverify`.
When you dispatch browser agents, hand each one a list of surface ids and their
`expected` text, and ask for a verdict per id. That keeps "tested through the UI"
attributable.

Schema reference: https://github.com/Kadreev/qa-tracker/blob/main/docs/SCHEMA.md
