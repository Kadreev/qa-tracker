---
name: qa-tracker
description: Use when recording or planning QA work in a project that has a qa-tracker directory (features.yaml, issues.yaml, runs.yaml) — after any QA pass or browser run, after shipping a fix for a tracked finding, when filing a finding, when asked what to test next, or when asked to show the QA dashboard.
---

# qa-tracker

The project tracks QA coverage with [qa-tracker](https://github.com/Kadreev/qa-tracker):
a feature matrix with an L0–L4 validation ladder, permanent findings, an
append-only log of runs, and an optional UI surface checklist. Everything is
YAML; the CLI validates every write.

## Orient

1. Find the data directory (default `./qa-tracker`; otherwise pass `--dir`).
2. Read its `STATUS.md`, then `AGENTS.md` (the full rules) if present.
3. `npx qa-tracker plan --json` tells you what to validate next.

## Fixing findings

Take issues with `npx qa-tracker next` (the top of the dashboard's open-issues
table: severity, then complexity), never by your own ordering unless asked.
After the fix: `note <id> <what changed>`, then `set <id> status fixed`. Only a
later run with `add-run --verified` makes it `verified-fixed`.

## Iron rules

1. **No run, no level bump.** Levels move only through `add-run --levels`.
2. **Read-only runs cap at L2** and can pass only `read`/`navigate` surfaces.
   L3/L4 need a sandbox or test account, never real data.
3. **Never overwrite user intent:** `weight`, `target_level`, `name`, `area`, `routes`.
4. **Never delete a finding**; re-status it. Ids are permanent.
5. **`npx qa-tracker validate` must pass** before you commit.

## After a QA pass

```bash
npx qa-tracker add-issue --feature <id> --title "…" --details "what happens, steps" \
  [--severity <critical|high|medium|low>] [--category <name>] [--complexity 1-10]
npx qa-tracker triage                  # open issues still needing a decision
npx qa-tracker set <issue> <category|complexity|severity> <value>   # resolve one
npx qa-tracker add-run --blast-radius <read-only|sandbox|test-account> \
  --features a,b --levels a=L3 --opened QA-7 --verified QA-2 --profiles <who>
npx qa-tracker set <feature> <functionality|usability|code_health> <pass|issues|unknown>
npx qa-tracker verdict <surface-id> <pass|broken|blocked> --run <run-id> [--issues …] [--notes …]
npx qa-tracker validate
```

After a fix ships: `set <issue> status fixed` and `set <feature> reverify true`.

## Triage

`--severity` is optional. Severity is impact, complexity is effort to fix, status
is lifecycle. File the finding with `--details`, run `triage`, and `set` each item:
`needs-triage` is a missing value, `disagrees` is an explicit value that a
confident Jev answer contradicts; `set` (even to the same value) clears it. A
value you set is never overwritten by Jev. With `TYPESAFE_API_KEY` configured,
`assess` fills the confident answers first, but it sends the title and `details`
to TypeSafe, so keep secrets out of `--details`. `ᴶ` marks an unconfirmed model
judgment.

## Red flags — stop

- Raising a level because something "looked fine" with no run recorded.
- Changing a weight or target from a run result.
- Editing YAML by hand when a CLI command exists for the change.
- Committing without `validate`.

## Dashboard

`npx qa-tracker serve` serves http://localhost:4300 for people: edit weights,
re-verify flags and issue statuses in place, and export to PDF. It binds to
127.0.0.1 and has no hot reload; restart it after upgrading.
