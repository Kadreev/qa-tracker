# qa-tracker schema

The shape of `features.yaml`, `issues.yaml`, `assessments.yaml`, `runs.yaml`
and `surfaces/*.yaml`, and the coverage matrix they produce.

The machine-readable copy is [`src/schema.mjs`](../src/schema.mjs), which the
validator imports, so the vocabulary below is the one actually enforced.
`test/schema.test.mjs` fails if this document and that module disagree.

## Data directory

```
qa-tracker/                 # default; override with --dir or $QA_TRACKER_DIR
  qa-tracker.config.json    # { "title": "...", "root": ".." }   optional
  features.yaml             # the matrix rows
  issues.yaml               # every finding, forever
  assessments.yaml          # optional: append-only log of Jev judgments
  runs.yaml                 # append-only evidence
  surfaces/*.yaml           # optional UI checklist, one file per area
  STATUS.md                 # generated — do not edit
  SURFACES.md               # generated — do not edit
  AGENTS.md                 # rules for AI agents (from `init`)
```

`root` in the config is the repository root that surface paths (`component`,
`test_refs`) resolve against, relative to the data directory. Default `..`.

## The coverage matrix

One row per feature. `STATUS.md` renders these columns in this order.

| Column | Field | Owner | Meaning |
|---|---|---|---|
| Feature | `name` | user | Display name |
| Area | `area` | user | Nav or subsystem grouping |
| W | `weight` | user | Priority and risk, 1–5. Higher must be validated deeper |
| Cur | `current_level` | run | Highest ladder level fully passed |
| Tgt | `target_level` | user | Depth this feature should reach |
| Func | `dimensions.functionality` | run | `pass` · `issues` · `unknown` |
| UX | `dimensions.usability` | run | same |
| Code | `dimensions.code_health` | run | same |
| Issues | `issues` | run | Linked issue ids |

**Owner matters.** A QA run may write `current_level`, `dimensions`, `issues`,
`reverify` and `last_validated`. It must never overwrite `weight`,
`target_level`, `name`, `area` or `routes` — those carry a person's intent
about how much the feature matters.

## The ladder

Cumulative: a feature cannot be L3 if an L1 check fails.

| Level | Passes when |
|---|---|
| L0 | Renders; no console errors or blank states |
| L1 | Displayed data is correct and internally consistent |
| L2 | Non-mutating interactions work (filters, tabs, modals, sort) |
| L3 | Create, edit, delete and run exercised and verified |
| L4 | Edge cases, empty and error states, concurrency, regressions re-checked |

`target_level` defaults from weight: 4–5 → L4, 3 → L3, 1–2 → L2. People may
override it.

**A read-only run caps at L2.** L3 and L4 require a `sandbox` or a
`test-account` run, never real data. The validator rejects a `read-only` run
whose `level_changes` go above L2.

## features.yaml

```yaml
- id: notes-list                # kebab-case, unique, stable forever
  name: Notes list
  area: Notes
  routes: [ /notes ]
  weight: 5                     # user-owned
  target_level: L4              # user-owned
  current_level: L2             # highest level fully passed
  dimensions: { functionality: pass, usability: issues, code_health: pass }
  issues: [ QA-3 ]
  reverify: false               # a linked issue was fixed and needs re-checking
  last_validated: 2026-01-20 (run-2026-01-20)
  notes: ""
```

## issues.yaml

```yaml
- id: QA-3                      # unique and permanent
  title: Sort menu has no keyboard focus ring
  details: Tab moves focus into the sort menu but no outline is drawn.
  severity: low                 # critical | high | medium | low   (optional)
  category: accessibility       # from the category list              (optional)
  type: usability               # code | functionality | usability; follows from category
  complexity: 2                 # 1-10, effort to fix                 (optional)
  feature: notes-list           # must match a feature id
  status: open                  # open | fixed | verified-fixed | wont-fix
  triage:                       # optional: where each triage value came from
    category:   { source: jev, assessment: asm-2026-10-04 }
    complexity: { source: jev, assessment: asm-2026-10-04 }
    severity:   { source: set, seen: asm-2026-10-04 }
  source: https://github.com/acme/notes/issues/21
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | yes | Unique and permanent |
| `title` | string | yes | |
| `details` | string | no | Free text: what happens, steps to reproduce. Sent to Jev when an issue is assessed |
| `severity` | `critical` · `high` · `medium` · `low` | no | Impact on users. When present it must be one of these |
| `category` | kebab-case string | no | Kind of defect. Should be in the category list in effect; a name that is not is a warning, not an error |
| `type` | `code` · `functionality` · `usability` | yes | Coarse kind. When `category` is in the list and is not `other`, `type` must equal the category's type |
| `complexity` | integer 1–10 | no | Effort to fix (see below) |
| `feature` | feature id | yes | Must match a feature |
| `status` | `open` · `fixed` · `verified-fixed` · `wont-fix` | yes | Lifecycle |
| `triage` | map | no | Provenance of `severity`, `category` and `complexity`; see below |
| `source` | path or url | no | The report or record that raised it |

**Severity is impact; complexity is effort; status is lifecycle.** They answer
different questions and are never combined.

### Triage provenance

`triage` records, per triage field (`severity`, `category`, `complexity`), where
the value came from. Keys outside those three are errors.

| Entry | Meaning |
|---|---|
| `{ source: jev, assessment: <id> }` | The value was applied from that assessment. If the value no longer equals what the assessment said, it was edited by hand and is treated as explicit (warning) |
| `{ source: set, seen: <id> }` | The value was set on purpose after assessment `<id>` existed. `seen` is optional |
| `{ source: set }` | The value was set on purpose before any assessment of this issue |
| no entry, value present | Legacy or hand-edited; treated as `set` with nothing seen |
| no entry, value absent | A gap that Jev may fill |

A `jev` entry needs a string `assessment`; a `set` entry may have a string
`seen`. An explicit value is never overwritten by Jev.

### Categories

The default list, in this order. A project replaces the whole list (not merges)
with a `categories` object in `qa-tracker.config.json`; `other` is reserved and
always appended last.

| Category | Type | Meaning |
|---|---|---|
| `functional` | functionality | A feature does the wrong thing or nothing: a button, form, flow or action fails to do what it should. |
| `data` | functionality | Displayed or stored data is wrong, stale, missing, duplicated or inconsistent. |
| `error-handling` | functionality | Failures are handled badly: crashes, misleading or unhelpful errors, missing empty or error states, input lost on failure. |
| `integration` | functionality | A problem at the boundary with another system: third-party service, API, e-mail, payments, sign-in provider, import or export. |
| `ui-layout` | usability | Visual presentation is broken: overlapping, misaligned or clipped elements, wrong responsive behaviour, broken styling. |
| `usability` | usability | It works but is confusing, slow to use or easy to get wrong: unclear labels, flow or feedback. |
| `accessibility` | usability | People using a keyboard, screen reader, zoom or high contrast cannot use it: missing focus, labels, contrast or semantics. |
| `content` | usability | Wrong, misleading, outdated or misspelled text, translations or images. |
| `performance` | code | Slow loading or interactions, excessive memory or network use, timeouts. |
| `security` | code | Data or capability exposed to someone who should not have it: authentication, permissions, injection, secrets. |
| `code-quality` | code | The code itself is the problem with no user-visible defect yet: dead code, duplication, fragile structure, missing tests, warnings. |
| `other` | unchanged | None of the other categories fits. Never changes `type`. |

### Complexity levels

`complexity` is the effort to fix, from 1 (trivial) to 10 (a redesign).

| Level | Situation |
|---|---|
| 1 | A copy, style or configuration value changes in one place; no logic changes. |
| 2 | A one-line logic fix in one file, with an obvious cause. |
| 3 | A small change inside one component or function; the fix is clear and an existing test can be adjusted. |
| 4 | A change across two or three files in one module, with a new test. |
| 5 | Several files, or one tricky piece of logic (state, async, edge cases), with new tests. |
| 6 | The cause has to be investigated first, or the fix touches shared code other features depend on. |
| 7 | The fix crosses layers (frontend and backend, or several modules) and needs some design and coordinated tests. |
| 8 | A data model, API contract or widely used shared component changes, and its callers must be updated. |
| 9 | A subsystem is redesigned or a dependency replaced: several days of work with real regression risk. |
| 10 | A cross-system redesign or a migration of existing user data. |

**Ids are permanent handles.** If the finding also lives in an issue tracker,
reuse its id (`GH-21`, `ENG-482`) so the two records cross-reference without a
lookup table. Never reuse or renumber an id.

**Status.** `fixed` means the change shipped. `verified-fixed` means a later QA
run re-checked it against a running app. `wont-fix` records a deliberate
decision.

## assessments.yaml

An append-only log of Jev judgments, written once per assess run and never
edited. The file is optional: a tracker without it is valid.

```yaml
- id: asm-2026-10-04            # asm-YYYY-MM-DD, suffix -2, -3 … for later runs that day (UTC)
  date: 2026-10-04
  model: jev-1.13.0             # exactly as the API returned it
  rubric: 1                     # version of the code-owned question text
  issues:
    QA-3:
      category:   { value: accessibility, confidence: 0.91, probabilities: { accessibility: 0.91, usability: 0.05, other: 0.01 } }
      complexity: { value: 2, top: 0.71, score: 1.3, confidence: 0.74, probabilities: { "1": 0.12, "2": 0.71 } }
      severity:   { value: medium, confidence: 0.81, probabilities: { critical: 0.02, high: 0.09, medium: 0.81, low: 0.08 } }
      applied: [ category, complexity ]
```

| Field | Type | Meaning |
|---|---|---|
| `id` | `asm-YYYY-MM-DD[-n]` | Unique; file order is the log's order |
| `date` | `YYYY-MM-DD` | UTC date of the run |
| `model` | string | Non-empty |
| `rubric` | positive integer | Version of the question text the answers were given to |
| `issues` | map | Issue id → its judgments |

Per issue: `category`, `complexity` and `severity` are each
`{ value, confidence, probabilities }` with `confidence` between 0 and 1;
`complexity.value` is an integer 1–10 and `severity.value` a known severity.
`applied` lists which of the three fields this assessment wrote to
`issues.yaml`; it never changes afterwards.

## runs.yaml

```yaml
- id: run-2026-01-20            # run-YYYY-MM-DD, suffix -2 for a second run that day
  date: 2026-01-20
  profiles: [ bug-hunter, usability-reviewer ]
  blast_radius: sandbox         # read-only | sandbox | test-account
  features_touched: [ sign-in, search ]
  level_changes: { sign-in: "L2->L3", search: "L0->L2" }
  issues_opened: [ QA-3, QA-5 ]
  issues_verified: [ QA-1 ]
  report: https://github.com/acme/notes/wiki/QA-2026-01-20
```

Append-only. A run is evidence: `current_level` may only rise for checks that
actually passed in a run that exists in this file. `qa-tracker add-run` records
the run and applies it: it sets `current_level` from `level_changes`, stamps
`last_validated` on every feature touched, and marks `issues_verified` as
`verified-fixed`.

## Rules

1. **Validate before committing.** `qa-tracker validate` must pass.
2. **Level bumps need evidence.** Record the run first. No run, no bump.
   `validate` replays `runs.yaml` in file order from L0: each `level_changes`
   entry must start where the earlier runs left the feature, and `current_level`
   must equal where the replay ends. An issue may be `verified-fixed` only if a
   run lists it in `issues_verified`.
3. **Read-only runs cap at L2.**
4. **Never overwrite user intent** (`weight`, `target_level`, `name`, `area`, `routes`).
5. **Keep YAML in serializer shape.** The tools write with `{ lineWidth: 0 }`;
   prefer the CLI so diffs stay on the changed line.

## Errors and warnings

`validate` returns errors only and gates every write. `validateAll` also returns
warnings, which never block a write.

Errors for triage data:

1. `severity`, when present, is a known severity.
2. `complexity`, when present, is an integer 1–10.
3. `category`, when present, is a kebab-case string.
4. When `category` is in the list and is not `other`, `type` equals its type.
5. `details`, when present, is a string.
6. `triage`, when present, is a map of the triage fields; each entry has
   `source` `jev` or `set`; `jev` entries have a string `assessment`; `set`
   entries may have a string `seen`.
7. `assessments.yaml`, when present, is a list of mappings with unique ids
   shaped `asm-YYYY-MM-DD[-n]`, a `date`, a non-empty `model`, a positive
   integer `rubric` and an `issues` map whose judgments have `confidence` in
   [0, 1], an integer complexity value, a known severity value and `applied`
   limited to the triage fields.

Warnings:

1. `category` is not in the category list in effect.
2. An assessment names an issue id that does not exist.
3. A `triage` entry references an assessment that does not exist or does not
   contain the issue.
4. A `source: jev` value differs from what its assessment said (edited by hand).

Warnings 2 and 3 are about the append-only log and cannot be cleared by editing
it; they are reported by `validate` and `get`, not listed in `STATUS.md`.

## Surfaces

A feature is a matrix row. A **surface** is one thing a user can see or do
inside it, nested to every level: view → tab → panel → dialog → control. The
inventory exists so that functionality nobody has ever exercised shows up as an
explicit `unchecked` row instead of hiding under a feature that reads "L2".

One file per area in `surfaces/`, each either a bare list of root views or
`{ area, surfaces }`. Ids are dotted paths; a child id extends its parent id.
`feature` and `route` are set on the root and inherited.

```yaml
area: Notes
surfaces:
  - id: notes.list                    # dotted kebab-case path, unique across all files
    feature: notes-list               # matrix row it rolls up into (root only; inherited)
    kind: view                        # view | tab | panel | dialog | control | action | step | rail | state
    name: Notes list
    route: /notes                     # required on a view; inherited by children
    component: src/pages/notes/List.tsx   # optional; must exist under root
    ui: Grid of note cards with a toolbar
    expected: Shows the user's notes, pinned first, newest first
    effect: read                      # read | navigate | mutate | run | external
    api: [ GET /api/notes ]
    coverage: e2e                     # none | contract | unit | e2e
    test_refs: [ tests/notes-list.spec.ts ]   # must exist
    verdict: pass                     # unchecked | pass | broken | blocked   (run-owned)
    checked: 2026-01-12 (run-2026-01-12)      # required unless unchecked
    issues: [ QA-3 ]                  # required when broken
    notes: ""
    children:
      - id: notes.list.sort
        kind: control
        ...
```

| Field | Meaning |
|---|---|
| `kind` | `view` (a route), `tab`, `panel` (a card or section), `dialog` (modal, sheet, drawer), `control` (input, select, toggle), `action` (a button that calls an API), `step` (wizard step), `rail` (side list), `state` (an empty, error or loading state worth checking) |
| `effect` | Safety class. `read` shows data; `navigate` only moves between routes; `mutate` writes data; `run` starts background work or spends money (jobs, AI calls); `external` leaves the app. A read-only run may only verify `read` and `navigate` |
| `coverage` | Automated coverage that exists today. `none` — nothing touches it. `contract` — a static or source-level assertion pins its wiring. `unit` — a unit, component or route test exercises its logic without a browser. `e2e` — a browser test drives it through the real UI |
| `verdict` | Last browser verification. `unchecked` — never verified in a recorded run. `pass` — behaved as `expected`. `broken` — did not; `issues` names the finding. `blocked` — could not be exercised; `notes` says why |
| `checked` | `YYYY-MM-DD (run-id)`; the run must exist in `runs.yaml` |
| `component`, `api`, `test_refs`, `children`, `name`, `ui`, `expected`, `id`, `feature`, `route`, `notes`, `issues` | See the example above |

Rules, enforced by the validator:

1. Ids are unique across every file and a child id extends its parent id.
2. `ui` and `expected` are non-empty. A view has a route.
3. `component` and every `test_refs` path must exist under `root`, so the
   inventory cannot outlive the code it describes.
4. `coverage` other than `none` needs `test_refs`.
5. Any verdict but `unchecked` needs `checked` naming a run in `runs.yaml`.
   `broken` needs at least one issue id. `blocked` needs `notes`.
6. A run writes `verdict`, `checked`, `issues` and `notes`. Everything else
   describes the product and belongs to whoever maintains the inventory.
7. A `read-only` run can only pass a surface whose `effect` is `read` or
   `navigate`. It was never permitted to press a `mutate`, `run` or `external`
   control, so it cannot be the evidence behind a pass on one.

`qa-tracker verdict <surface-id> <verdict> --run <run-id> [--issues QA-1,QA-2] [--notes "..."]`
records a verdict; `render` writes both `STATUS.md` and `SURFACES.md`.
