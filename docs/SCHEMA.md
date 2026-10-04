# qa-tracker schema

The shape of `features.yaml`, `issues.yaml`, `runs.yaml` and `surfaces/*.yaml`,
and the coverage matrix they produce.

The machine-readable copy is [`src/schema.mjs`](../src/schema.mjs), which the
validator imports, so the vocabulary below is the one actually enforced.
`test/schema.test.mjs` fails if this document and that module disagree.

## Data directory

```
qa-tracker/                 # default; override with --dir or $QA_TRACKER_DIR
  qa-tracker.config.json    # { "title": "...", "root": ".." }   optional
  features.yaml             # the matrix rows
  issues.yaml               # every finding, forever
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
  severity: low                 # critical | high | medium | low
  type: usability               # code | functionality | usability
  feature: notes-list           # must match a feature id
  status: open                  # open | fixed | verified-fixed | wont-fix
  source: https://github.com/acme/notes/issues/21
```

**Ids are permanent handles.** If the finding also lives in an issue tracker,
reuse its id (`GH-21`, `ENG-482`) so the two records cross-reference without a
lookup table. Never reuse or renumber an id.

**Status.** `fixed` means the change shipped. `verified-fixed` means a later QA
run re-checked it against a running app. `wont-fix` records a deliberate
decision.

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
3. **Read-only runs cap at L2.**
4. **Never overwrite user intent** (`weight`, `target_level`, `name`, `area`, `routes`).
5. **Keep YAML in serializer shape.** The tools write with `{ lineWidth: 0 }`;
   prefer the CLI so diffs stay on the changed line.

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
