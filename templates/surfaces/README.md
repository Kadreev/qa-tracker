# surfaces/ — the UI capability inventory (optional)

A feature is one row of the matrix. A **surface** is one thing a user can see or
do inside it, nested to every level: view → tab → panel → dialog → control. The
inventory makes functionality nobody has ever exercised show up as an explicit
`unchecked` row instead of hiding under a feature that reads "L2".

One YAML file per area:

```yaml
area: Notes                    # heading used in SURFACES.md
surfaces:                      # root views, nested via children
  - id: notes.list             # dotted kebab-case; a child id extends its parent id
    feature: notes-list        # matrix row it rolls up into (root only; inherited)
    kind: view                 # view | tab | panel | dialog | control | action | step | rail | state
    name: Notes list
    route: /notes              # required on a view; inherited by children
    component: src/pages/notes/List.tsx   # optional; must exist under the repo root
    ui: Grid of note cards with a toolbar
    expected: Shows the user's notes, pinned first
    effect: read               # read | navigate | mutate | run | external
    coverage: e2e              # none | contract | unit | e2e  (automated tests today)
    test_refs: [ tests/notes.spec.ts ]    # must exist; required unless coverage is none
    verdict: unchecked         # unchecked | pass | broken | blocked  (written by runs)
    children:
      - id: notes.list.new
        kind: action
        name: New note
        ui: Primary button in the toolbar
        expected: Creates an empty note and opens it
        effect: mutate
        coverage: none
        verdict: unchecked
```

## Writing good surfaces

- **Root** = one route (`kind: view`, `route` and `feature` set).
- **Children** = tabs, panels, dialogs, controls, actions (buttons that call an
  API), wizard steps, side rails, and notable states (empty, error, loading,
  locked).
- `ui`: one sentence on what is rendered. `expected`: one sentence on what must
  happen when it is used.
- `effect` is the safety class. A `read-only` run may only pass `read` and
  `navigate` surfaces.
- Author everything as `verdict: unchecked`. Verdicts come from runs:
  `qa-tracker verdict <id> pass --run <run-id>`.
- Ids are permanent handles that findings and runs reference. Keep them short.

Full rules: https://github.com/Kadreev/qa-tracker/blob/main/docs/SCHEMA.md#surfaces
