# Issue triage with Jev: categories, complexity and severity, applied autonomously

- **Date:** 2026-10-04 (revision 2)
- **Status:** design approved in conversation; awaiting written-spec review
- **Target release:** 0.3.0 (additive; existing trackers stay valid)
- **Revision 2:** no human accept step. Jev's judgments are applied by rules in
  code; anything uncertain goes to a triage queue that agents resolve. Folds in
  the Fable review of revision 1 (non-fatal category drift, append-only log
  never fails validation, render-time disagreement, argmax complexity, file-order
  ties, injectable backoff, UTC ids).

## 1. Goal

Make findings easy to triage with no human in the loop:

1. **Richer categories** than today's three `type`s, from a default list a
   project can replace.
2. **Complexity 1–10**, meaning *effort to fix*, next to severity (impact).
3. **Severity vs status made unmistakable** in every view.
4. **TypeSafe's Jev** judges category, complexity and severity; **code** decides
   what gets applied; **agents** resolve what code will not apply. No step
   requires a person.

### Vocabulary

| Field | Values | Answers |
|---|---|---|
| `severity` | `critical` · `high` · `medium` · `low` | How badly does it hurt users? (impact) |
| `complexity` | integer `1`–`10` | How much work is the fix? (effort) |
| `category` | from the category list | What kind of defect is it? |
| `type` | `code` · `functionality` · `usability` | Coarse kind; follows from `category` |
| `status` | `open` · `fixed` · `verified-fixed` · `wont-fix` | Where is it in its lifecycle? |

The three **triage fields** are `category`, `complexity` and `severity`.

### Principles

- **Explicit beats inferred.** A triage value set on purpose (by `set`,
  `add-issue` flags, the dashboard or a hand edit) is never overwritten by Jev.
  Jev fills gaps and refreshes its own earlier values only.
- **Every applied value is traceable** to an assessment: model, rubric version,
  confidence, probabilities.
- **Uncertainty goes to agents, not people.** Below-threshold answers and
  confident disagreements with explicit values become triage-queue items.
- **The tracker never breaks because of the model.** Nothing about assessments
  or category-list drift can make `validate` fail or block a write.

### Non-goals

- Changing the next-run plan (it stays weight × level gap).
- Calling TypeSafe from the dashboard server or the browser.
- Two-level taxonomies, free tags, per-project thresholds (thresholds are code
  constants in 0.3.0).

## 2. Data model

### 2.1 `issues.yaml`

```yaml
- id: QA-3
  title: Sort menu has no keyboard focus ring
  details: Tab moves focus into the sort menu but no outline is drawn.   # NEW, optional
  severity: low                  # now optional (an agent may leave it to Jev)
  category: accessibility        # NEW, optional
  type: usability                # follows from category
  complexity: 2                  # NEW, optional, integer 1-10
  feature: notes-list
  status: open
  triage:                        # NEW, optional: where each triage value came from
    category:   { source: jev, assessment: asm-2026-10-04 }
    complexity: { source: jev, assessment: asm-2026-10-04 }
    severity:   { source: set, seen: asm-2026-10-04 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `details` | string | no | Free text: what happens, steps to reproduce. Sent to Jev (§4.1). |
| `severity` | severity | **no** (was yes) | When present, a known severity. |
| `category` | kebab-case string | no | Should be in the list in effect (warning if not, §6). |
| `complexity` | integer 1–10 | no | Fix effort (§2.3). |
| `triage` | map | no | Keys ⊆ {`category`, `complexity`, `severity`}; see 2.2. |

`type` stays required and is **derived**: it carries no provenance and is not a
triage field. Whenever a category that is in the list and is not `other` is
written (by Jev or by `set`), `type` is set to that category's type,
replacing whatever `type` was there. `--type` / a hand-set `type` is honoured
only while the category is absent or `other`. `other` never changes `type`.

### 2.2 Provenance: `triage`

| Entry | Meaning | Jev may overwrite? |
|---|---|---|
| `{ source: jev, assessment: <id> }`, value equals what `<id>` said | Value was applied from that assessment | Yes, by a later assessment that passes the gate |
| `{ source: jev, … }`, value differs from what `<id>` said, or `<id>` missing | Someone edited a Jev value by hand | No — treated as explicit with no `seen` |
| `{ source: set, seen: <id> }` | Value was set on purpose after assessment `<id>` existed | No |
| `{ source: set }` | Value was set on purpose before any assessment of this issue | No |
| no entry, value present | Legacy or hand-edited value; treated as `set` with nothing seen | No |
| no entry, value absent | Gap | Jev may fill it |

- `set`, `add-issue` flags and dashboard edits of a triage field write
  `{ source: set, seen: <latest assessment id of this issue, if any> }`, even
  when the value is unchanged. That is how an agent **confirms** a value and
  clears a disagreement.
- An assessment is "newer than `seen`" when it appears later in
  `assessments.yaml` (file order is the log's order). A `seen` naming an
  assessment that does not exist is treated as no `seen`.

### 2.3 Categories

Default list (in `src/categories.mjs`), in this order. `other` is reserved and
always last.

| Category | Type | Description (also the Jev criterion) |
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
| `other` | (unchanged) | None of the other categories fits. |

A project replaces the list (not merges) in `qa-tracker.config.json`; order is
preserved and `other` is appended:

```json
{
  "title": "Acme Notes",
  "categories": {
    "checkout": { "type": "functionality", "description": "Cart, payment and order flow fail or misbehave." },
    "visual":   { "type": "usability",     "description": "Layout, styling and imagery are broken." }
  }
}
```

The only other `jev` config key is the boolean `auto_assess` (§4.2).

Config rules, enforced by `resolveConfig` (throws, like invalid JSON today):
names kebab-case; each entry has `type` ∈ `code|functionality|usability` and a
non-empty `description`; at most 254 entries; an entry named `other` is
rejected. `validate` and `applyChange` receive the resolved list.

### 2.4 Complexity levels (fix effort)

Used verbatim as the Jev Score criteria (low → high) and in docs/SCHEMA.md.

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

### 2.5 `assessments.yaml` — append-only log

```yaml
# Jev judgments, append-only. Written once per assess run; never edited.
- id: asm-2026-10-04             # asm-YYYY-MM-DD[-n], UTC date; -2, -3 … for later runs that day
  date: 2026-10-04
  model: jev-1.13.0              # exactly as returned by the API
  rubric: 1                      # RUBRIC_VERSION of the code-owned question text
  issues:
    QA-3:
      category:   { value: accessibility, confidence: 0.91, probabilities: { functional: 0.01, …, accessibility: 0.91, …, other: 0.01 } }
      complexity: { value: 2, top: 0.71, score: 1.3, confidence: 0.74, probabilities: { "1": 0.12, "2": 0.71, … } }
      severity:   { value: medium, confidence: 0.81, probabilities: { critical: 0.02, high: 0.09, medium: 0.81, low: 0.08 } }
      applied: [ category, complexity ]
```

- `complexity.value` = the level with the highest probability (ties → lower
  level); `top` = that probability; `score` = the API's weighted position,
  re-based to 1–10, kept for information.
- `applied` records which fields this assessment wrote to `issues.yaml`,
  decided at write time (§3.2). It never changes afterwards.
- No `recorded`/`differs` fields: disagreement is computed when rendering, from
  current data (§5.2).
- The file is created on the first `assess`; trackers without it are valid.
- Nested maps are written in flow style, one line per judgment.

## 3. Applying judgments (code policy, `src/triage-policy.mjs`)

### 3.1 Gates (constants)

| Field | Applied when | Constant |
|---|---|---|
| category | `confidence ≥ 0.70`, value ≠ `other`, value in the list in effect | `CATEGORY_MIN = 0.70` |
| complexity | `top ≥ 0.50` | `COMPLEXITY_MIN_TOP = 0.50` |
| severity | `confidence ≥ 0.85` | `SEVERITY_MIN = 0.85` |

These are starting values (within TypeSafe's guidance of >0.9 act, 0.5–0.9
confirm, <0.5 escalate), to be tuned on real data. Severity starts stricter
because it drives sort order and nothing checks it later. Confidence measures
how peaked the distribution is: for a 4-option Choice, 0.70 corresponds to a
top probability of roughly 0.78, and for 12 categories roughly 0.72. Full
probabilities are stored so re-evaluating needs no new requests.

### 3.2 Apply rule (inside `applyChange('add-assessment')`)

Evaluated against the documents being written, not a pre-request snapshot. For
each assessed issue that still exists and each triage field:

1. **Writable?** The field is writable when its value is absent, or its
   `triage` entry has `source: jev` **and** the value still equals what that
   entry's assessment said. Otherwise (explicit value, including a hand-edited
   Jev value) skip.
2. **Gate passes?** If writable and the gate passes: set the value (category
   also sets `type`), set `triage.<field> = { source: jev, assessment: <id> }`,
   add the field to `applied`.
3. If writable and the gate fails: leave the field as it is (an earlier Jev
   value stays; a gap stays a gap).

Issues that no longer exist when the commit is applied are dropped from the
entry before it is written (and reported as failed in the command output).

### 3.3 Triage queue (computed at render time)

For each issue with status `open`, each triage field yields at most one item:

| Item | Condition |
|---|---|
| `needs-triage` | Value absent, or category not in the list in effect. Reason from the latest assessment of the issue: `low confidence (42%)`, `category other`, `category not in list`, or `not assessed`. |
| `disagrees` | Value is explicit (§2.2); the latest assessment of the issue is newer than its `seen` (or there is no `seen`); that assessment's suggestion differs from the current value with the field's gate passing (for complexity, only when the levels differ by 2 or more); **and** that suggestion differs from what the `seen` assessment suggested for the field (so re-assessing an already-confirmed issue with the same answer does not resurrect the item). |

When both conditions hold for one field, `needs-triage` wins: one item per
field.

The queue is sorted by issue file order, then field (`severity`, `category`,
`complexity`). Agents resolve items with `set` (§4.3), which records
`source: set, seen: <latest>`, removing the item.

## 4. Commands

### 4.1 `qa-tracker assess`

```
qa-tracker assess                 # open issues with a needs-triage field
qa-tracker assess --refresh       # also open issues with source: jev fields (lets Jev revise its own values)
qa-tracker assess QA-3 QA-7       # these issues
qa-tracker assess --all           # every issue, any status
qa-tracker assess --dry-run       # print the exact request bodies; no network, no key needed
qa-tracker assess --json          # machine-readable result (shape below)
```

- Reads `TYPESAFE_API_KEY` from the environment; missing (and not `--dry-run`)
  → error before any request. The key is never written, logged or printed.
- One request per issue, all three questions together, at most 4 in flight.
- One commit: append the assessment (successful issues only) and apply §3.2.
  Validated and written atomically; STATUS.md regenerated.
- Human output per issue: `QA-3  category accessibility 91% ✓applied ·
  complexity 2 (71%) ✓applied · severity medium 81% (kept: low, set) ⚠disagrees`.
  Percentages are `Math.round(x * 100)`. Ends with the token usage summed from
  `usage`.
- `--json`: `{ assessment, model, rubric, issues: { "<id>": { "<field>": {
  value, confidence, applied, queue } } }, failed: { "<id>": "<reason>" },
  usage: { input_tokens, output_tokens } }`, where `queue` is
  `null | "needs-triage" | "disagrees"`.
- Exit 0 when all succeeded; 1 when any failed (successes are still written).
  No issues selected → "nothing to assess", exit 0.
- `assessments.yaml` grows by one entry per run; there is no compaction.

### 4.2 `qa-tracker add-issue` (auto-assess)

```
qa-tracker add-issue --feature notes-list --title "…" [--details "…"] \
          [--severity low] [--category accessibility] [--complexity 2] [--type …] [--assess | --no-assess]
```

- `--severity` is now optional.
- Given triage flags are explicit values (`triage.<field> = { source: set }`).
- **Auto-assess is opt-in per project:** `"jev": { "auto_assess": true }` in
  `qa-tracker.config.json` (default `false`). `--assess` / `--no-assess`
  override it for one call. Having `TYPESAFE_API_KEY` in the environment alone
  never sends anything.
- When auto-assess applies, after the issue is saved it prints
  `sending QA-9 to TypeSafe (api.typesafe.ai)…` and runs `assess <new-id>` as a
  second commit. If that fails (including a missing key), the issue stays
  saved, a warning is printed, exit code is 0, and the issue remains in the
  triage queue.
- `--type` with a non-`other` `--category` must agree; with `--category other`
  or no category, `type` comes from `--type` (default `functionality`).

### 4.3 `qa-tracker set` (agent resolution)

```
qa-tracker set QA-3 category accessibility     # also sets type unless other
qa-tracker set QA-3 complexity 4
qa-tracker set QA-3 severity high
qa-tracker set QA-3 details "…"
```

Each triage-field `set` records `{ source: set, seen: <latest assessment of
QA-3> }` (omit `seen` when none), even if the value is unchanged.

### 4.4 `qa-tracker triage`

```
qa-tracker triage            # the queue, one line per item
qa-tracker triage --json     # [{ issue, field, kind, current, suggested, confidence, reason }]
```

`suggested` and `confidence` are `null` when the reason is `not assessed`.

Exit 0 always (an empty queue prints "Triage queue empty."). `get <issue>`
also prints `triage` provenance and the latest assessment's answers.

## 5. The Jev request

`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer
$TYPESAFE_API_KEY`, body `{ model: "jev-latest", state, questions }`. The
response `model` (e.g. `jev-1.13.0`) is stored.

### 5.1 State (per issue)

```json
{
  "app": "<config title>",
  "issue":    { "title": "…", "details": "…" },
  "feature":  { "name": "…", "area": "…", "routes": ["…"] },
  "surfaces": [{ "name": "…", "ui": "…", "expected": "…", "effect": "read" }]
}
```

- `surfaces`: those whose `issues` list contains the issue id.
- `details` is truncated to 4,000 characters, with ` […truncated]` appended.
- **Never sent:** recorded `severity`, `type`, `category`, `complexity`,
  `triage`, `status`, `source`, any file contents. Recorded labels are left out
  so Jev's answer is independent of them.
- Empty or missing optional fields are omitted.

### 5.2 Questions (`src/jev-rubric.mjs`, `RUBRIC_VERSION = 1`)

| id | type | instructions | criteria (fixed order) |
|---|---|---|---|
| `category` | choice | What kind of defect does `issue` describe? Judge the problem itself, not the feature it sits in. | categories in list order, `other` last: "None of the other categories fits." |
| `complexity` | score | How much engineering work would a typical developer on this app need to fix `issue`, including tests? Judge the likely fix, not how harmful the problem is. | the 10 situations of §2.4, low → high |
| `severity` | choice | How badly does `issue` hurt the people using the app? Judge the harm to users, not how hard it is to fix. | `critical`: data loss, a security hole, or a core flow blocked for everyone · `high`: a core flow broken for some people, or with no reasonable workaround · `medium`: degraded, with a workaround · `low`: cosmetic or a minor annoyance |

`RUBRIC_VERSION` covers the code-owned text (instructions, complexity levels,
severity criteria, state shape). A project's category list is recorded by the
option keys of `category.probabilities`.

### 5.3 Mapping answers

- category: `choice`, `confidence`, `probabilities`.
- complexity: API levels `0…9` → complexity `1…10`; `value` = argmax + 1 (ties
  → lower); `top`; `score + 1`; `confidence`; re-keyed `probabilities`.
- severity: `choice`, `confidence`, `probabilities`.
- An answer of the wrong type, or with a value outside the options asked, fails
  that issue.

## 6. Validation

**API.** `validate(data, opts) → string[]` is unchanged and returns errors
only, so existing callers and `store.commit` keep gating on errors. New
`validateAll(data, opts) → { errors, warnings }` (exported from
`src/index.mjs`); `store.validate()` keeps returning errors and new
`store.check()` returns `{ errors, warnings }`. `qa-tracker validate` prints
errors to stderr and warnings as `warning: …` lines to stdout, and exits 1 only
when there are errors.

Errors block writes; warnings never do.

Errors:
1. `severity`, when present, is a known severity.
2. `complexity`, when present, is an integer 1–10.
3. `category`, when present, is a kebab-case string.
4. When `category` is in the list and is not `other`, `type` equals its type.
5. `details`, when present, is a string.
6. `triage`, when present: a map whose keys ⊆ triage fields; each entry has
   `source` ∈ `jev|set`; `jev` entries have a string `assessment`; `set`
   entries may have a string `seen`.
7. `assessments.yaml`, when present: a list of mappings; ids match
   `^asm-\d{4}-\d{2}-\d{2}(-\d+)?$` and are unique; `date` is `YYYY-MM-DD`;
   `model` a non-empty string; `rubric` a positive integer; `issues` a map;
   each judgment has `confidence` in [0, 1]; complexity value integer 1–10;
   severity value a known severity; `applied` ⊆ triage fields.

Warnings:
1. `category` not in the list in effect.
2. An assessment names an issue id that does not exist.
3. A `triage` entry references an assessment id that does not exist, or one
   that does not contain the issue.
4. A `source: jev` value differs from what its assessment said (hand-edited;
   §2.2 treats it as explicit).

Warnings 1 and 4 are about issues and are listed in STATUS.md. Warnings 2 and
3 are about the append-only log, cannot be cleared by editing it, and are
printed only by `validate` and `get`.

Config problems are caught earlier by `resolveConfig` (§2.3).

## 7. Errors (`assess`)

| Condition | Behaviour |
|---|---|
| No `TYPESAFE_API_KEY` (not `--dry-run`) | Error before any request; exit 1 |
| 401 | Stop the run; nothing written; exit 1 |
| 422 | That issue fails with the API message and a hint: "request rejected; if `details` is long, shorten it" |
| 429, 529, network error, 30 s timeout | Up to 3 retries, backoff 1 s / 2 s / 4 s; then that issue fails |
| Wrong answer type or value | That issue fails |
| Validation of the commit fails | Nothing written; error shown; exit 1 |

`askJev` takes `fetch`, `sleep` and `timeoutMs` options so tests run with no
network and no real delays.

## 8. Generated files and dashboard

### 8.1 Issue tables (STATUS.md and dashboard)

Columns: `ID | Severity | Category | Cx | Feature | Title | Status` (`—` when
unset). A value whose `triage` source is `jev` is marked `ᴶ` in STATUS.md and
with a "Jev 91%" tooltip in the dashboard. Open issues sort by severity
(unset last), then complexity ascending (unset last), then file order. Closed
issues keep today's order (status, then severity) with unset severity last. An
unset severity renders with class `sev none`. Percentages are shown as whole
percent everywhere (`Math.round(x * 100)`). Legend:

> **Severity** = impact on users (critical → low) · **Complexity** = effort to
> fix, 1–10 · **Status** = lifecycle (open → fixed → verified-fixed, or
> wont-fix) · ᴶ = set by Jev, not yet confirmed.

### 8.2 STATUS.md "Triage queue" and warnings

The §3.3 queue as a table (issue, field, kind, current, suggested, confidence,
reason); empty → "_Triage queue empty._". Issue warnings (§6 warnings 1 and 4)
are listed under it. Deterministic: depends only on the files and code
constants; `status` (stdout) and `STATUS.md` are rendered from the same input.

### 8.3 Dashboard

- Edit mode gains selects for category, complexity (1–10) and severity beside
  status. They write explicit values with the `set` semantics of §4.3.
- A "Triage queue" section mirrors 8.2.
- New browser change kinds: `issue-category`, `issue-complexity`,
  `issue-severity`. The server never reads `TYPESAFE_API_KEY` and never makes
  outbound requests.

## 9. Modules

| File | Responsibility |
|---|---|
| `src/categories.mjs` (new) | Default list; `resolveCategories(rawConfig)` with config checks |
| `src/jev-rubric.mjs` (new) | `RUBRIC_VERSION`, complexity levels, `buildState(issue, data, cfg)`, `buildQuestions(categories)` |
| `src/jev-client.mjs` (new) | `askJev(body, { apiKey, fetch, sleep, timeoutMs })`: retries, error classes |
| `src/triage-policy.mjs` (new) | Gates, `mapAnswers`, `applyAssessment` (§3.2), `triageQueue` (§3.3) — pure |
| `src/assess.mjs` (new) | Select issues, build requests, run with concurrency 4, return entry + failures |
| `src/config.mjs` | Resolve `categories` |
| `src/edit.mjs` | Kinds `issue-category`, `issue-complexity`, `issue-severity`, `issue-details`, `add-assessment`; `add-issue` fields; `set` provenance |
| `src/store.mjs` | Load/write `assessments.yaml`; pass categories to validate |
| `src/validate.mjs` | Errors and warnings of §6 |
| `src/markdown.mjs`, `src/dashboard.mjs`, `src/server.mjs` | §8 |
| `src/cli.mjs` | `assess`, `triage`, `add-issue`/`set` changes |

No new runtime dependency (Node ≥ 20 global `fetch`). `main()` accepts
`io.fetch`, `io.sleep` and `io.env` for tests.

## 10. Testing

- **Policy (pure):** each gate at, below and above its threshold; writable
  rules (absent, `jev`, `set`, legacy explicit); category sets `type`, `other`
  never does; skipped missing issues; queue items for every reason; `disagrees`
  cleared by `seen`; complexity ±1 not a disagreement.
- **Rubric:** state omits recorded labels, `triage`, `status`; `details`
  truncation; criteria order with `other` last; argmax with ties.
- **Client (fake fetch + fake sleep):** 401 stops; 429 then 200 succeeds; 422
  surfaces message and hint; malformed answer fails; timeout retried.
- **CLI end-to-end (fake fetch):** `add-issue` auto-assesses and applies;
  `--no-assess`; missing key leaves the issue queued; `assess` partial failure;
  `--dry-run` sends nothing and needs no key; `set` confirms and clears a
  disagreement; `triage --json`; replacing the category list leaves writes
  working and reports warnings.
- **Validation:** every error and warning of §6; an assessment naming a deleted
  issue does not fail `validate`.
- **Server:** the three new kinds work and record `source: set`; no route
  triggers an assessment.
- **Schema docs:** every category, complexity level and new field appears in
  docs/SCHEMA.md.
- **Demo:** demo issues gain categories and complexity (mixed `jev` and `set`
  sources) and one example assessment with `model: jev-example` and realistic
  probabilities, so the queue shows at least one `needs-triage` and one
  `disagrees` item; demo STATUS.md regenerated.
- **Policy additions:** a hand-edited `source: jev` value is not overwritten;
  `type` follows a written category; re-assessing a confirmed issue with the
  same suggestion does not resurrect `disagrees`; `needs-triage` wins over
  `disagrees`; auto-assess only with `jev.auto_assess` or `--assess`.
- **Live smoke (not in CI):** `npm run smoke:jev` assesses one demo issue when
  `TYPESAFE_API_KEY` is set and prints the result without writing.
- No test or CI job contacts the real API.

## 11. Documentation and release

- README: triage section — fields, autonomous flow, the explicit-beats-inferred
  rule, the triage queue, exactly what is sent to TypeSafe (note that `details`
  is free text and may contain sensitive data), key setup, that ᴶ values are
  model judgments.
- docs/SCHEMA.md: new fields, `triage`, category and complexity tables,
  `assessments.yaml`, errors and warnings.
- templates/AGENTS.md and the skill: log findings with `add-issue --details`,
  run `triage` and resolve items with `set`; `--severity` is no longer required
  (update `templates/AGENTS.md`, `skills/qa-tracker/SKILL.md`,
  `templates/issues.yaml`, and `ISSUE_FIELDS.severity.required` in
  `src/schema.mjs`).
- CHANGELOG `[Unreleased]` entries as features land; release as 0.3.0.
