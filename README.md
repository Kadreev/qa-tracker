# qa-tracker

**Evidence-based QA coverage tracking in plain YAML.** Track how deeply every
feature of your product has actually been verified — not which lines a unit test
touched, but whether someone (or some agent) clicked through it, on what data,
and what they found.

[![CI](https://github.com/Kadreev/qa-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kadreev/qa-tracker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/qa-tracker.svg)](https://www.npmjs.com/package/qa-tracker)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The qa-tracker dashboard showing the Acme Notes demo](docs/dashboard.png)

- **A coverage matrix** — one row per feature, with a weight (how much it matters)
  and a level on a five-step validation ladder, L0 *renders* → L4 *hardened*.
- **Evidence or it didn't happen** — a level only rises through a recorded QA run,
  and a read-only run can never certify anything that writes data.
- **Findings are permanent** — never deleted, only re-statused, linked to features.
- **A UI surface checklist** (optional) — every view, tab, dialog and button, so the
  things nobody has ever pressed show up as ⬜ instead of hiding under "L2".
- **Built for AI agents** — a CLI that validates every write, a generated
  `STATUS.md` any model can read, and an `AGENTS.md` with the rules.
- **Built for people** — a local dashboard to adjust priorities and statuses and
  export a PDF for the team.
- **Just files in your repo** — reviewable in pull requests, diffable, no server,
  no account. One runtime dependency (`yaml`).

## Quick start

```bash
npx qa-tracker init                      # creates ./qa-tracker with empty data files
npx qa-tracker add-feature sign-in --name "Sign in" --area Auth --weight 4
npx qa-tracker add-feature search  --name "Search"  --area Core --weight 3
npx qa-tracker serve                     # dashboard at http://localhost:4300
```

After a QA pass (by you, a teammate or an agent):

```bash
npx qa-tracker add-issue --feature sign-in --severity high --title "Login button does nothing on Safari"
npx qa-tracker add-run --blast-radius sandbox --levels sign-in=L2,search=L1 --opened QA-1
npx qa-tracker plan                      # what to validate next, ranked
```

Every write validates the whole dataset first and regenerates `STATUS.md`. Commit
the `qa-tracker/` directory like any other code.

Want to look around first? Clone the repo and run `npm run demo` to open the
[Acme Notes demo](examples/demo/STATUS.md).

## The model

### The validation ladder

Each feature has a `current_level` (the highest level whose checks **fully
passed** in a recorded run) and a `target_level` (how deep it should go).

| Level | Passes when |
|---|---|
| L0 | Renders; no console errors or blank states |
| L1 | Displayed data is correct and internally consistent |
| L2 | Non-mutating interactions work (filters, tabs, modals, sort) |
| L3 | Create, edit, delete and run exercised and verified |
| L4 | Edge cases, empty and error states, concurrency, regressions re-checked |

The ladder is cumulative: if an L1 check fails, the feature is L0 however well L2
went. The target defaults from the feature's weight (4–5 → L4, 3 → L3, 1–2 → L2).

### Features, issues, runs

| File | Holds | Who writes it |
|---|---|---|
| `features.yaml` | The matrix rows: weight, target, current level, quality dimensions (functionality, usability, code health), linked issues | People own `weight`, `target_level`, `name`, `area`, `routes`. Runs own the rest |
| `issues.yaml` | Every finding: severity, category, complexity, type, feature, status (`open` → `fixed` → `verified-fixed`, or `wont-fix`) | Anyone; never delete, only re-status |
| `assessments.yaml` | Optional append-only log of Jev judgments, one entry per `assess` run | `qa-tracker assess` |
| `runs.yaml` | Append-only log of QA runs: blast radius, level changes, issues opened and verified | Whoever ran it |
| `surfaces/*.yaml` | Optional nested UI checklist with a verdict per surface | People describe; runs record verdicts |

`STATUS.md` and `SURFACES.md` are generated from those files. Don't edit them by hand.

### The rules (enforced by `qa-tracker validate`)

1. **No run, no level bump.** `current_level` only moves through `add-run --levels`.
   `validate` replays `runs.yaml` from L0 and rejects a level the runs don't reach,
   and a `verified-fixed` issue that no run verified.
2. **Read-only runs cap at L2** and can only pass surfaces whose effect is `read`
   or `navigate`. L3/L4 need a `sandbox` or `test-account` run, never real data.
3. **People own priority.** A run never overwrites `weight` or `target_level`.
4. **Findings are permanent.** Ids are never reused or renumbered.
5. **References resolve.** Every issue points at a real feature, every verdict at
   a real run, and every `component`/`test_refs` path at a file that exists, so the
   tracker can't quietly outlive the code it describes.

Full schema: [docs/SCHEMA.md](docs/SCHEMA.md).

## Using it with AI agents

qa-tracker was built for agent-driven QA, where a model drives a browser through
your app and reports back. Without guard rails, agents tend to declare things
"working" on thin evidence. The tracker turns that into a contract the agent can't
skip: findings need a feature, levels need a run, and a read-only pass can't
certify a delete button.

- `init` writes **`qa-tracker/AGENTS.md`**, the rules and the commands. Point your
  agent at it, or reference it from your root `AGENTS.md` / `CLAUDE.md`.
- A ready-made **skill** lives in [`skills/qa-tracker/SKILL.md`](skills/qa-tracker/SKILL.md).
  Copy it to `.claude/skills/qa-tracker/` (Claude Code) or `.agents/skills/qa-tracker/`
  (Codex and others).
- For browser agents, `qa-tracker surfaces --json` gives each surface's id and
  `expected` text. Hand a list to each agent and ask for a verdict per id:

```bash
npx qa-tracker verdict notes.list.sort broken --run run-2026-01-20 --issues QA-3
npx qa-tracker verdict notes.list.empty blocked --run run-2026-01-20 --notes "needs a fresh account"
```

Everything has a `--json` mode, and every command exits non-zero on rejection.

## Triage with Jev

Every finding carries three **triage fields**. They answer different questions:

| Field | Values | Answers |
|---|---|---|
| `severity` | `critical` · `high` · `medium` · `low` | How badly does it hurt users? (impact) |
| `complexity` | 1–10 | How much work is the fix? (effort) |
| `category` | `functional`, `accessibility`, `performance`, … (11 defaults plus `other`) | What kind of defect is it? |

`status` is separate again: where the finding is in its lifecycle (`open` →
`fixed` → `verified-fixed`, or `wont-fix`). `type` (`code`, `functionality`,
`usability`) follows from the category. The category and complexity tables are in
[docs/SCHEMA.md](docs/SCHEMA.md); `STATUS.md` and the dashboard show Severity,
Category and Cx (complexity) side by side, with a legend (on the dashboard, a
tooltip on each column header).

TypeSafe's Jev can judge the three fields for you. Code, not a person, decides
what happens to each answer. It is optional: without a key nothing is sent
anywhere and everything still works by hand.

### The flow

1. File a finding with details and no severity:
   `qa-tracker add-issue --feature sign-in --title "…" --details "steps and what you saw"`.
2. `qa-tracker assess` asks Jev about every open issue that still has a gap. Each
   answer carries a confidence, and a value is applied only past a gate: category
   at 70% (and never `other`), complexity when its most likely level has 50%,
   severity at 85%. Every judgment, applied or not, is logged in
   `assessments.yaml` with its model, rubric version and probabilities, and each
   applied value gets a `triage` entry pointing at that assessment. The gates are
   code constants, not config.
3. `qa-tracker triage` lists what is left, the **triage queue**. Agents resolve it
   with `set`.

**Explicit beats inferred.** A value set on purpose (`set`, an `add-issue` flag,
the dashboard or a hand edit) is never overwritten by Jev. Jev fills gaps and
refreshes only its own earlier values (`assess --refresh`). Editing a Jev value by
hand makes it an explicit one.

### The triage queue

`qa-tracker triage [--json]` (also the "Triage queue" in `STATUS.md` and the
dashboard) lists open issues with:

- **needs-triage**: a missing value, or a category outside the list. The reason
  says why Jev did not fill it: `low confidence (42%)`, `category other`,
  `category not in list` or `not assessed`.
- **disagrees**: an explicit value that a later, confident Jev answer contradicts.
  For complexity this needs a difference of 2 or more levels.

An agent resolves an item by deciding and recording the value:

```bash
qa-tracker triage
qa-tracker set QA-3 complexity 2      # whether or not it matches Jev
qa-tracker set QA-4 severity high
```

`set` records that you have seen the latest assessment, so the item leaves the
queue even when the value is unchanged, and the same Jev answer does not bring it
back. `get <issue>` shows where each value came from and the latest assessment's
answers.

### What is sent to TypeSafe

`assess` makes one request per issue to `https://api.typesafe.ai/v1/systemone`.
It contains the app title from the config; the issue's **title** and
**`details`** (first 4,000 characters); its feature's name, area and routes; and
the name, `ui`, `expected` text and effect of each surface that lists the issue.
The recorded severity, category, complexity, type, status, `source` and `triage`
entries are left out, so Jev's answer does not depend on them. No file contents are sent.

`details` is free text. Logs, URLs, e-mail addresses or customer data you put in
it are sent to TypeSafe too, so keep sensitive data out of it. `assess --dry-run`
prints the exact request bodies as one JSON array, with no key and no network, so
you can check before anything leaves your machine.

### Setup

Put the key in the environment. It is never written to a file or printed:

```bash
export TYPESAFE_API_KEY=…
qa-tracker assess              # open issues that need triage
qa-tracker assess QA-3 QA-7    # these issues
qa-tracker assess --all        # every issue, any status
```

`assess` keeps up to 4 requests in flight and retries rate limits and timeouts.
If some issues fail, the others are still recorded and the exit code is 1.

**Auto-assess is off by default.** Having the key in your environment sends
nothing. To assess each new issue as it is filed, opt in per project:

```json
{ "jev": { "auto_assess": true } }
```

in `qa-tracker.config.json`, or pass `--assess` / `--no-assess` to one
`add-issue`. If the key is missing or the request fails, the issue is still saved
and a warning is printed.

### ᴶ values are model judgments

A value marked **ᴶ** in `STATUS.md` and the dashboard was set by Jev and nobody
has confirmed it. It is a model's estimate, not a verdict, and it can be wrong.
Confirm or correct it with `set <issue> <field> <value>` when it matters.

## CLI

| Command | Does |
|---|---|
| `init [--title T]` | Scaffold the data directory |
| `serve [--port 4300] [--host 127.0.0.1]` | Local dashboard: edit weights, re-verify flags and issue statuses; export PDF |
| `status` | Print the Markdown snapshot |
| `plan [--json]` | Features ranked by `weight × levels below target`, plus re-verify |
| `get <id> [--json]` | One feature, issue or run (an issue also shows its triage provenance, latest assessment and warnings) |
| `validate` | Check every rule; non-zero exit on any error (warnings print and exit 0) |
| `add-feature <id> --name --area [--weight] [--target] [--routes a,b]` | New matrix row at L0 |
| `add-issue --feature --title [--severity] [--details] [--category] [--complexity] [--type] [--id] [--source] [--assess\|--no-assess]` | New finding (ids default to `QA-n`), linked from its feature; without `--severity` it joins the triage queue |
| `triage [--json]` | The triage queue: open issues with a missing value, or a Jev answer that disagrees with an explicit one |
| `assess [ids…] [--all] [--refresh] [--dry-run] [--json]` | Ask Jev for category, complexity and severity; apply confident answers, queue the rest. Needs `TYPESAFE_API_KEY` unless `--dry-run` (see [Triage with Jev](#triage-with-jev)) |
| `add-run --blast-radius [--levels f=L2,g=L3] [--features] [--opened] [--verified] [--profiles] [--report]` | Record a run and apply it: levels, `last_validated`, `verified-fixed` |
| `set <feature> weight\|target\|reverify\|functionality\|usability\|code_health <value>` | Edit a feature field |
| `set <issue> status <open\|fixed\|wont-fix>` | Re-status a finding (`verified-fixed` comes only from `add-run --verified`) |
| `set <issue> category\|complexity\|severity\|details <value>` | Record an explicit value (confirms or overrides Jev) |
| `surfaces [--json]`, `surface <id>` | The UI checklist |
| `verdict <surface> <pass\|broken\|blocked\|unchecked> --run <id> [--issues] [--notes]` | Record a surface verdict |
| `render` | Regenerate `STATUS.md` / `SURFACES.md` |

Global options: `--dir <path>` (default `./qa-tracker`, or `$QA_TRACKER_DIR`) and
`--root <path>`.

## Configuration

`qa-tracker/qa-tracker.config.json` (optional, written by `init`):

```json
{
  "title": "Acme Notes — QA Tracker",
  "root": ".."
}
```

`root` is the repository root that surface paths (`component`, `test_refs`)
resolve against, relative to the data directory.

Two optional keys tune triage:

```json
{
  "categories": {
    "checkout": { "type": "functionality", "description": "Cart, payment and order flow fail or misbehave." },
    "visual":   { "type": "usability",     "description": "Layout, styling and imagery are broken." }
  },
  "jev": { "auto_assess": true }
}
```

`categories` **replaces** the default list (order is kept and `other` is
appended). Each entry needs a kebab-case name, a `type` of `code`,
`functionality` or `usability`, and a `description`, which Jev uses as the
criterion. `jev.auto_assess` defaults to `false`.

## In CI

Fail the build when the tracker is invalid or `STATUS.md` is stale:

```yaml
- run: npx qa-tracker validate
- run: npx qa-tracker render && git diff --exit-code qa-tracker/STATUS.md
```

## The dashboard

`qa-tracker serve` serves the matrix, open and closed issues, the surface
roll-up and the next-run plan. In **Edit mode** you can change weights, toggle
re-verify, re-status issues and set an issue's category, complexity and
severity (recorded as explicit values, like `set`). A "Triage queue" lists what
still needs a person. The server never contacts TypeSafe. Each edit is
validated and written straight back to the YAML, keeping comments and
formatting. **Export PDF** uses the browser's print dialog.

**Summary.** Above the coverage matrix sit four cards and three panels, all
computed from the same data as the `## Summary` block at the top of `STATUS.md`:

- **Open issues** — how many are open out of the total, with a bar split by
  severity (critical, high, medium, low, and *unrated* for issues with no severity).
  The card is outlined when any open issue is critical.
- **Fixed** — issues fixed or verified-fixed out of those that are not wont-fix,
  as a count and a percentage, split into verified and awaiting a re-check.
- **Coverage** — features at their target level, and the weighted coverage: each
  feature's progress toward its target, weighted by its `weight`.
- **Hotspot** — the feature with the worst open issues, its worst issue, and a
  score that adds up its open issues: critical 8, high 4, medium 2, low 1,
  unrated 1 (hover the score for the weights). Ties go to the feature with more
  open issues, then to file order.
- **Issues by feature** (panel) — one bar per feature with open issues, worst
  first, coloured by severity and labelled with the counts.
- **Severity × status** (panel) — a table of issue counts: each severity by open,
  fixed, verified and wont-fix.
- **Work queue** (panel) — the next three features to validate (the same ranking as
  `plan`), the size of the triage queue, and the quick wins: open issues with
  complexity 3 or less.

The same numbers are available from `summarize(data)` in the programmatic API.
Every bar sits next to its count, so no number depends on colour alone.

**Legends.** The column legends are tooltips on the table headers (hover, or
keyboard focus on the header label) instead of a block above the tables. A
tooltip cannot print, so **Export PDF** adds the legend as a short block after
each table.

The server binds to `127.0.0.1` and only accepts same-origin JSON requests with a
loopback `Host`, so a web page you visit can't write to your tracker.
Adding features, issues and runs stays a CLI action.

## Programmatic API

```js
import { resolveConfig, createStore, nextRunPlan } from 'qa-tracker';

const store = createStore(resolveConfig({ dir: 'qa-tracker' }));
const data = store.data();                    // { features, issues, runs, surfaces }
console.log(nextRunPlan(data)[0]);
const res = store.commit({ kind: 'issue-status', issue: 'QA-1', value: 'fixed' });
if (!res.ok) throw new Error(res.error);
```

## FAQ

**How is this different from a test management tool?** Those manage test cases
and executions. qa-tracker answers a coarser, more useful question: *for each
feature, how far has it been verified, and on what evidence?* It lives in your
repo, it is small enough for an agent to read in one go, and it refuses claims
the evidence doesn't support.

**Does it replace my issue tracker?** No. Keep tracking work in GitHub, Linear or
Jira, and reuse their ids (`GH-123`) in `issues.yaml`. The tracker records which
feature a finding hurts and whether a run has re-checked the fix.

**Does it need a browser?** Only the optional dashboard does. Everything else is
the CLI and plain files.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
`npm test` runs the suite (Node ≥ 20, no other setup).

## Origin

qa-tracker was extracted from the QA process of
[Stability Monitor](https://stabilitymonitor.com), where it tracks AI browser agents
validating a large web app.

## License

[MIT](LICENSE)
