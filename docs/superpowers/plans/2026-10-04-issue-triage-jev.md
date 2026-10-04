# Issue Triage with Jev — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `category`, `complexity` (1–10, fix effort) and optional `severity` to issues, judged by TypeSafe's Jev and applied autonomously by rules in code, with a triage queue agents resolve via `set`.

**Architecture:** Pure modules decide everything (`categories`, `triage-policy`, `jev-rubric`); one I/O module talks to TypeSafe (`jev-client`); `assess` orchestrates and commits one `add-assessment` change through the existing validated `store.commit`. Provenance lives per field in `issue.triage`; the append-only `assessments.yaml` is the evidence. Renderers compute the triage queue from current files, so output stays deterministic.

**Tech Stack:** Node ≥ 20 ESM, `node:test`, `yaml` (only runtime dependency), Node global `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-04-issue-triage-jev-design.md` (revision 2.1). Section numbers below (§) refer to it.

## Global Constraints

- No new runtime dependency. HTTP uses global `fetch`.
- No test or CI job contacts `api.typesafe.ai`; every network path takes an injected `fetch` and `sleep`.
- `TYPESAFE_API_KEY` is read only from `io.env` / `process.env`; it is never written to disk, logged, printed, or included in an error message.
- The dashboard server never reads `TYPESAFE_API_KEY` and never makes outbound requests.
- Every write goes through `store.commit` (validated, `writeAtomic`, STATUS.md regenerated). `validate(data, opts)` keeps returning `string[]` of errors only.
- Generated files stay deterministic (no timestamps, sorted output). After any renderer change run `npm run demo:render` and commit the regenerated `examples/demo/STATUS.md` (and `SURFACES.md`) — `test/cli.test.mjs` checks it is current.
- `src/schema.mjs` and `docs/SCHEMA.md` change in the same commit (`test/schema.test.mjs`).
- Constants (exact): `CATEGORY_MIN = 0.70`, `COMPLEXITY_MIN_TOP = 0.50`, `SEVERITY_MIN = 0.85`, `COMPLEXITY_DISAGREE_LEVELS = 2`, `RUBRIC_VERSION = 1`, `DETAILS_MAX = 4000`, concurrency `4`, timeout `30000` ms, retry delays `[1000, 2000, 4000]` ms, model `"jev-latest"`, endpoint `https://api.typesafe.ai/v1/systemone`.
- Percentages are rendered as `Math.round(x * 100) + '%'` everywhere.
- Dates/ids are UTC: `new Date().toISOString().slice(0, 10)`; assessment ids `asm-YYYY-MM-DD`, then `-2`, `-3` … the same day.
- Each user-visible task adds a line under `## [Unreleased]` in `CHANGELOG.md` and is committed on `feat/issue-triage-jev` with the attribution trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code style: match the surrounding files — short JSDoc on exported functions, file header comment, two-space indent, single quotes, no semicolon-free style changes.

## Review Focus

1. **A 0.2.0 tracker upgraded in place** (no `assessments.yaml`, no new fields, every issue with explicit `severity`/`type`) must validate with zero errors and zero warnings, render, and serve. → test in Task 2.
2. **Applying Jev values must keep `issues.yaml` diffs minimal** — header comments and untouched issues byte-identical, one-line flow maps. → test in Task 4.
3. **The category list changes between building a request and committing it** (Jev answers a category no longer in the list): not applied; queue reason `category not in list`. → test in Task 3.
4. **An issue is deleted while `assess` is waiting on the network:** dropped from the entry, reported as failed, other issues still committed. → test in Task 4.
5. **The API key never leaks** — not in thrown errors, `--json` output, `--dry-run` output, or `assessments.yaml`. → tests in Task 6 and Task 7.

---

### Task 1: Category list and config

**Files:**
- Create: `src/categories.mjs`
- Modify: `src/config.mjs` (`resolveConfig` return value)
- Test: `test/categories.test.mjs`

**Interfaces:**
- Produces:
  - `DEFAULT_CATEGORIES: Array<{ name: string, type: 'code'|'functionality'|'usability', description: string }>` — the 11 entries of §2.3, in that order, descriptions verbatim.
  - `OTHER = { name: 'other', type: null, description: 'None of the other categories fits.' }`
  - `resolveCategories(raw?: object) → Array<Category>` — `raw` is the config file's `categories` object (or `undefined` → defaults); returns entries in config order with `OTHER` appended. Throws `Error` with a message naming the bad entry on: non-kebab-case name, missing/invalid `type`, empty `description`, more than 254 entries, an entry named `other`.
  - `categoryByName(categories, name) → Category | undefined`
  - `resolveConfig(...)` additionally returns `categories: Array<Category>` and `jev: { autoAssess: boolean }` (from `raw.jev.auto_assess`, default `false`; throws if `jev` has keys other than `auto_assess` or it is not a boolean). Errors are prefixed with the config path like the existing invalid-JSON error.

- [ ] **Step 1: Write the failing tests** in `test/categories.test.mjs`:
  - `default list has 11 categories plus other last` — `resolveCategories()` length 12, last `.name === 'other'`, `categoryByName(c, 'accessibility').type === 'usability'`, `categoryByName(c, 'security').type === 'code'`.
  - `a config list replaces the defaults and keeps its order` — `resolveCategories({ visual: { type: 'usability', description: 'x' }, checkout: { type: 'functionality', description: 'y' } }).map(c => c.name)` deep-equals `['visual', 'checkout', 'other']`.
  - `bad config entries throw` — each of `{ 'Bad Name': {...} }`, `{ a: { type: 'ux', description: 'd' } }`, `{ a: { type: 'code', description: ' ' } }`, `{ other: { type: 'code', description: 'd' } }`, and 255 valid entries throws (`assert.throws`).
  - `resolveConfig reads categories and jev.auto_assess` — write a temp `qa-tracker.config.json` with `{ "categories": { "visual": {...} }, "jev": { "auto_assess": true } }`; assert `cfg.categories[0].name === 'visual'`, `cfg.jev.autoAssess === true`; without the keys → defaults and `false`; `{ "jev": { "auto_assess": "yes" } }` throws `/auto_assess/`.

- [ ] **Step 2: Run** `node --test test/categories.test.mjs` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/categories.mjs` and extend `resolveConfig`. Reuse `FEATURE_ID` from `src/schema.mjs` for the kebab-case check and `ISSUE_TYPES` for `type`.
- [ ] **Step 4: Run** `node --test` — all pass (existing 60 + new).
- [ ] **Step 5: Commit** `feat: category list with per-project override` (CHANGELOG: "Issue categories: a default list of 11, replaceable in `qa-tracker.config.json`.").

---

### Task 2: Schema, validation errors and warnings

**Files:**
- Modify: `src/schema.mjs`, `src/validate.mjs`, `src/store.mjs` (`check`), `src/index.mjs`, `docs/SCHEMA.md`
- Create: `src/assessments.mjs`
- Test: `test/validate.test.mjs`, `test/schema.test.mjs`

**Interfaces:**
- Consumes: `resolveCategories`, `categoryByName` (Task 1).
- Produces:
  - `schema.mjs`: `TRIAGE_FIELDS = ['severity', 'category', 'complexity']` (also the queue's field order); `TRIAGE_SOURCES = ['jev', 'set']`; `COMPLEXITY_LEVELS: string[10]` (§2.4 text verbatim, index 0 = level 1); `ASSESSMENT_ID = /^asm-\d{4}-\d{2}-\d{2}(-\d+)?$/`; `ISSUE_FIELDS.severity.required = false`; new `ISSUE_FIELDS` entries `details`, `category`, `complexity`, `triage`; `ASSESSMENT_FIELDS` (id, date, model, rubric, issues).
  - `assessments.mjs`: `assessmentIndex(assessments, id) → number` (-1 if absent); `judgmentOf(assessments, asmId, issueId, field) → object | undefined`; `latestFor(assessments, issueId) → { entry, index } | null` (last entry in file order whose `issues` has `issueId`).
  - `validate(data, { exists, categories })` → `string[]` (errors, §6 errors 1–7 added). `data.assessments` defaults to `[]`; `categories` defaults to `resolveCategories()`.
  - `validateAll(data, opts) → { errors: string[], warnings: string[] }` (§6 warnings 1–4). Each warning string is prefixed with its scope so renderers can filter: `issue QA-3: …` for warnings 1 and 4, `assessment asm-…: …` / `issue QA-3: triage …` for 2 and 3 — expose `isLogWarning(w) → boolean` true for warnings 2 and 3.
  - `store.check() → { errors, warnings }`; `store.validate()` unchanged (errors only).
  - `index.mjs` also exports `validateAll`, `resolveCategories`, `DEFAULT_CATEGORIES`.

- [ ] **Step 1: Write the failing tests** in `test/validate.test.mjs` (extend `goodData()` with `assessments: []`):
  - `a 0.2.0-shaped tracker has no errors and no warnings` — the existing `goodData()` with no new fields: `validateAll` → `{ errors: [], warnings: [] }`. *(Review Focus 1)*
  - `severity is optional but must be known when present` — delete `issues[0].severity` → no errors; set `'urgent'` → error `/severity invalid/`.
  - `complexity must be an integer 1-10` — `0`, `11`, `2.5`, `'3'` each error; `10` ok.
  - `category must be kebab-case and type must follow a listed category` — `category: 'Bad Cat'` error; `category: 'accessibility', type: 'functionality'` error `/type must be usability/`; `category: 'other', type: 'code'` no error.
  - `a category missing from the list is a warning, not an error` — `category: 'checkout'` → errors `[]`, warnings match `/category checkout is not in the category list/`.
  - `triage entries are shape-checked` — `{ severity: { source: 'ai' } }` error; `{ category: { source: 'jev' } }` (no assessment) error; `{ wat: { source: 'set' } }` error.
  - `assessments.yaml shape errors` — bad id `'asm-1'`, duplicate ids, empty `model`, `rubric: 0`, `confidence: 1.2`, complexity value `11`, severity value `'urgent'`, `applied: ['type']` → each an error.
  - `log problems are warnings that never fail validation` — assessment naming `QA-404` → warning (and `isLogWarning` true); issue `triage.category = { source: 'jev', assessment: 'asm-2099-01-01' }` (missing) → warning; `source: jev` value differing from its assessment → warning (`isLogWarning` false); errors stay `[]` in all three.
  - `schema.test.mjs`: every `DEFAULT_CATEGORIES` name and each `COMPLEXITY_LEVELS` entry appears in `docs/SCHEMA.md`; `ISSUE_FIELDS` keys `details`, `category`, `complexity`, `triage` appear.
- [ ] **Step 2: Run** `node --test test/validate.test.mjs test/schema.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** schema constants, `src/assessments.mjs`, `validate`/`validateAll` (share one internal pass that pushes to `errs`/`warns`), `store.check`, exports. Update `docs/SCHEMA.md`: issue table (new fields, severity optional), `triage` provenance table (§2.2), category table (§2.3), complexity table (§2.4), `assessments.yaml` example (§2.5), errors vs warnings (§6).
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: schema and validation for categories, complexity and triage provenance` (CHANGELOG: new optional issue fields; `severity` no longer required; `validate` prints warnings).

---

### Task 3: Triage policy (pure)

**Files:**
- Create: `src/triage-policy.mjs`
- Modify: `src/format.mjs` (`pct`)
- Test: `test/triage-policy.test.mjs`

**Interfaces:**
- Consumes: `categoryByName` (Task 1); `judgmentOf`, `latestFor`, `assessmentIndex` (Task 2).
- Produces:
  - Constants `CATEGORY_MIN`, `COMPLEXITY_MIN_TOP`, `SEVERITY_MIN`, `COMPLEXITY_DISAGREE_LEVELS` (values in Global Constraints).
  - `format.mjs`: `pct(x: number) → string` (`'91%'`).
  - `mapAnswers(answers, categories) → { category, complexity, severity }` — converts an API `answers` object to stored judgments per §5.3: category `{ value, confidence, probabilities }`; complexity `{ value, top, score, confidence, probabilities }` with levels re-keyed `"1"…"10"`, `value` = argmax + 1 (ties → lower), `score` = API score + 1; severity `{ value, confidence, probabilities }`. Throws `Error('<field>: …')` when an answer is missing, has the wrong `type`, or a value outside the options asked (category not in `categories`, severity not in `SEVERITIES`).
  - `gatePasses(field, judgment, categories) → boolean` (§3.1: category also requires value ≠ `other` and in list).
  - `isWritable(issue, field, assessments) → boolean` (§2.2 / §3.2 rule 1, including the hand-edited-`jev` case).
  - `planApply(issue, judgments, { assessmentId, assessments, categories }) → { values: object, type?: string, triage: object, applied: string[] }` — fields to write, the derived `type` when a non-`other` listed category is applied, new `triage` entries `{ source: 'jev', assessment: assessmentId }`, and the applied field names in `TRIAGE_FIELDS` order.
  - `triageQueue({ issues, assessments }, categories) → Array<{ issue, field, kind: 'needs-triage'|'disagrees', current, suggested, confidence, reason }>` — open issues only, file order then `TRIAGE_FIELDS` order, one item per field with `needs-triage` winning (§3.3). `suggested`/`confidence` are `null` for reason `not assessed`. Reasons exactly: `` `low confidence (${pct(c)})` ``, `'category other'`, `'category not in list'`, `'not assessed'`; `disagrees` reason `` `Jev suggests ${value} (${pct(c)})` ``.

- [ ] **Step 1: Write the failing tests** in `test/triage-policy.test.mjs` (fixtures: a categories list from `resolveCategories()`, small issue/assessment objects):
  - `mapAnswers picks the argmax complexity, ties to the lower level` — probabilities `{ "0": 0.1, "1": 0.45, "2": 0.45 }` → `value 2`, `top 0.45`; re-keyed keys `"1".."3"`; `score` + 1.
  - `mapAnswers rejects a wrong type or an unknown option` — category answer `{ type: 'score' }` throws `/category/`; severity `'urgent'` throws.
  - `gates sit exactly at their thresholds` — category 0.70 passes, 0.69 fails, `other` at 0.99 fails, unlisted at 0.99 fails; complexity `top` 0.50 passes, 0.49 fails; severity 0.85 passes, 0.84 fails.
  - `writable: gaps and untouched Jev values only` — absent → true; `source: jev` and value equals its assessment → true; `source: jev` but value differs → false; `source: set` → false; value present with no `triage` (legacy) → false.
  - `planApply sets type from an applied category but never for other` — accessibility applied → `type: 'usability'`; explicit `category: other` issue → no `type`.
  - `planApply leaves explicit values and below-gate answers alone` — explicit severity `low`, Jev `medium` 0.95 → severity not in `values`; complexity top 0.3 on a gap → not applied.
  - `queue: needs-triage reasons` — gap never assessed → `not assessed` with `suggested: null`; gap with category `other` → `category other`; listed-category answer at 0.42 → `low confidence (42%)`; explicit category not in list → `category not in list`. *(Review Focus 3: also a Jev answer naming a category absent from the current list on a gap → not applied by `planApply`, queue reason `category not in list`.)*
  - `queue: disagrees and how set clears it` — explicit `severity: low` (no `seen`), latest assessment `medium` 0.9 → `disagrees`; add `triage.severity = { source: 'set', seen: <that id> }` → no item; a newer assessment with the same `medium` → still no item; a newer assessment with `high` 0.9 → `disagrees`.
  - `queue: complexity off by one is not a disagreement` — explicit 3 vs Jev 4 (top 0.8) → none; vs 5 → `disagrees`.
  - `queue: needs-triage wins and closed issues are skipped` — explicit unlisted category with a confident different suggestion → one `needs-triage` item; same issue with `status: fixed` → no items.
- [ ] **Step 2: Run** `node --test test/triage-policy.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `src/triage-policy.mjs` and `pct`. Keep every function pure (no fs, no Date).
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: triage policy — gates, provenance and the triage queue` (no CHANGELOG line; not user-visible yet).

---

### Task 4: Edits and the assessment commit

**Files:**
- Modify: `src/edit.mjs`, `src/store.mjs`, `src/config.mjs` (`filesIn` adds `assessments`)
- Test: `test/edit.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `filesIn(dir).assessments` = `<dir>/assessments.yaml`; store `ENTITIES` = `['features', 'issues', 'runs', 'assessments']`; `store.data()` includes `assessments`; `commit` passes `{ ...opts, categories: cfg.categories }` to `applyChange` and `{ exists, categories }` to `validate`.
  - `applyChange(docs, change, { today, categories })` — `docs` gains `assessments`. New `CHANGE_KINDS`:
    - `{ kind: 'issue-category' | 'issue-complexity' | 'issue-severity', issue, value }` — sets the field and `triage.<field> = { source: 'set', seen? }` where `seen` is `latestFor(assessments, issue)?.entry.id` (omitted when none), even when the value is unchanged. `issue-category` with a listed non-`other` value also sets `type`. Complexity value must be an integer 1–10; severity a known severity; category kebab-case.
    - `{ kind: 'issue-details', issue, value }` — sets `details` (string), no provenance.
    - `{ kind: 'add-assessment', assessment: { model, rubric, date?, issues: { [id]: judgments } } }` → `{ ok, id, applied: { [issueId]: string[] }, dropped: string[] }`. Appends `{ id, date, model, rubric, issues }` where each issue's judgments carry `applied` from `planApply`; issues missing from `issues.yaml` are removed from the entry and listed in `dropped`. Applies `planApply` results to the issue nodes. Flow style for every judgment map and `applied` list; `triage` written as a block map whose entries are flow maps.
    - `add-issue` accepts `details`, `category`, `complexity`, optional `severity`, optional `type` (default `functionality`); given triage fields get `triage.<field> = { source: 'set' }`; a listed non-`other` category sets `type` and rejects a conflicting explicit `type` (`type X does not match category Y (Z)`).
  - `nextAssessmentId(doc, date) → 'asm-YYYY-MM-DD[-n]'` in `edit.mjs` (same suffix rule as `nextRunId`).

- [ ] **Step 1: Write the failing tests** in `test/edit.test.mjs` (extend `docs()` with `assessments: parseDocument('[]\n')` and pass `{ categories: resolveCategories() }`):
  - `set-style triage edits record provenance and seen` — `issue-severity` `high` → `severity: high` and `triage` contains `severity: { source: set }`; after an `add-assessment` for QA-1, `issue-severity` with the same value records `seen: asm-…`.
  - `issue-category sets type; other leaves it` — `accessibility` → `type: usability`; `other` → `type` unchanged.
  - `add-assessment appends an entry, applies gated values and records applied` — judgments: category accessibility 0.91, complexity value 2 top 0.71, severity medium 0.6 on an issue whose severity is explicit `high` → entry id `asm-2026-01-20`, issue gets `category`, `type: usability`, `complexity: 2`, `triage.category/complexity` with `source: jev`; severity stays `high`; entry `applied: [ category, complexity ]`.
  - `applying keeps the issues.yaml diff minimal` — a two-issue doc with a header comment: after `add-assessment` touching QA-1 only, the header comment and the whole QA-2 block are byte-identical to before. *(Review Focus 2)*
  - `an issue deleted before commit is dropped, the rest applies` — judgments for `QA-1` and `QA-9` (absent) → `dropped: ['QA-9']`, entry contains only `QA-1`. *(Review Focus 4)*
  - `second assessment the same day gets -2` — two `add-assessment` with `today: '2026-01-20'` → ids `asm-2026-01-20`, `asm-2026-01-20-2`.
  - `add-issue with category, complexity and no severity` — succeeds; `type: usability` for accessibility; `--type code` with accessibility → `ok: false` `/does not match/`.
- [ ] **Step 2: Run** `node --test test/edit.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** the change kinds, `nextAssessmentId`, store entity and categories plumbing.
- [ ] **Step 4: Run** `node --test` — all pass (an empty `assessments.yaml` is never created by commits that don't touch it).
- [ ] **Step 5: Commit** `feat: triage edits and the add-assessment commit` (no CHANGELOG line yet).

---

### Task 5: Jev request builder

**Files:**
- Create: `src/jev-rubric.mjs`
- Test: `test/jev-rubric.test.mjs`

**Interfaces:**
- Consumes: `COMPLEXITY_LEVELS` (Task 2), categories (Task 1).
- Produces:
  - `RUBRIC_VERSION = 1`, `DETAILS_MAX = 4000`, `MODEL = 'jev-latest'`.
  - `buildState(issue, data, { title }) → object` — exactly §5.1: `{ app, issue: { title, details? }, feature: { name, area, routes? }, surfaces?: [{ name, ui, expected, effect }] }`; surfaces from `flattenSurfaces(data.surfaces)` whose `issues` include `issue.id`; `details` truncated to 4,000 chars + `' […truncated]'`; empty/absent optional keys omitted.
  - `buildQuestions(categories) → { category, complexity, severity }` — §5.2 instructions verbatim; category criteria an object in list order with `other` last; complexity criteria = `COMPLEXITY_LEVELS`; severity criteria object in order `critical, high, medium, low` with §5.2 descriptions verbatim.
  - `buildRequest(issue, data, { title, categories }) → { model, state, questions }`.

- [ ] **Step 1: Write the failing tests:**
  - `state never contains recorded labels` — for an issue with severity, type, category, complexity, triage, status, source set: `JSON.stringify(buildState(...))` contains none of the values `'high'`, `'usability'`, `'accessibility'`, `'"complexity"'`, `'triage'`, `'open'`, the source URL.
  - `state includes linked surfaces only and omits empty fields` — two surfaces, one linking the issue → `surfaces.length === 1`; issue without details → no `details` key.
  - `long details are truncated` — 5,000-char details → length `4000 + ' […truncated]'.length`, ends with `' […truncated]'`.
  - `questions: types, fixed order, other last` — `Object.keys(q.category.criteria).at(-1) === 'other'`; `q.complexity.type === 'score'` and `criteria.length === 10`; `Object.keys(q.severity.criteria)` deep-equals `['critical', 'high', 'medium', 'low']`.
- [ ] **Step 2: Run** `node --test test/jev-rubric.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `src/jev-rubric.mjs`.
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: Jev request builder (rubric 1)`.

---

### Task 6: Jev client

**Files:**
- Create: `src/jev-client.mjs`
- Test: `test/jev-client.test.mjs`

**Interfaces:**
- Produces:
  - `API_URL = 'https://api.typesafe.ai/v1/systemone'`.
  - `class JevError extends Error` with `status: number | null` and `fatal: boolean` (true only for 401).
  - `askJev(body, { apiKey, fetch = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 30000, delays = [1000, 2000, 4000] }) → Promise<{ model, answers, usage }>` — POST JSON with `Authorization: Bearer <apiKey>`; timeout via `AbortSignal.timeout(timeoutMs)`; retries 429, 529, network errors and timeouts once per entry in `delays`; 401 → `JevError('TypeSafe rejected the API key (401)', { status: 401, fatal: true })`; 422 → `JevError` with the API's message plus `'request rejected; if `details` is long, shorten it'`; other non-2xx → `JevError` with status; a 2xx body without `answers` → `JevError('malformed response')`. No error message or property ever contains `apiKey`.

- [ ] **Step 1: Write the failing tests** (fake `fetch` returning `{ ok, status, json() }`; fake `sleep` recording delays):
  - `sends the documented request` — asserts URL, `method: 'POST'`, `authorization` header `Bearer k`, body round-trips.
  - `401 is fatal and not retried` — one call; `err.fatal === true`.
  - `429 then 200 succeeds after one backoff` — two calls; sleeps `[1000]`.
  - `persistent 529 gives up after three retries` — four calls; sleeps `[1000, 2000, 4000]`; rejects with `status 529`.
  - `422 surfaces the API message and the size hint` — message includes the API text and `/shorten it/`.
  - `a network error and a malformed body` — fetch throws once then OK → resolves; body `{}` → rejects `/malformed/`.
  - `the key never appears in errors` — for 401, 422, 529 and a thrown network error: `String(err) + JSON.stringify(err)` does not include the key `'sk-secret-123'`. *(Review Focus 5)*
- [ ] **Step 2: Run** `node --test test/jev-client.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `src/jev-client.mjs`.
- [ ] **Step 4: Run** `node --test` — all pass, suite still well under a second (no real sleeps).
- [ ] **Step 5: Commit** `feat: TypeSafe Jev client with retries`.

---

### Task 7: `qa-tracker assess`

**Files:**
- Create: `src/assess.mjs`
- Modify: `src/cli.mjs` (command, help, `io.fetch` / `io.sleep`)
- Test: `test/assess.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - `selectIssues(data, { ids, all, refresh, categories }) → issue[]` — `ids` given → those (unknown id → throw `unknown issue: X`); `all` → every issue; default → open issues with any queue item of kind `needs-triage`; `refresh` adds open issues having any `triage.*.source === 'jev'`. File order, deduplicated.
  - `runAssess({ data, issues, title, categories, ask, concurrency = 4 }) → Promise<{ model, judgments: { [id]: object }, failed: { [id]: string }, usage: { input_tokens, output_tokens } }>` — `ask(body)` returns the API response; per issue `mapAnswers`; a non-fatal failure records `failed[id] = message`; a fatal `JevError` rejects the whole run.
  - CLI `assess [ids…] [--all] [--refresh] [--dry-run] [--json]`; `BOOLEAN_FLAGS` gains `all`, `refresh`, `dry-run`. Flow: select → `--dry-run` prints `JSON.stringify(buildRequest(...), null, 2)` per issue and exits 0 without a key → else require `TYPESAFE_API_KEY` (`io.env ?? process.env`) → `runAssess` with `ask = body => askJev(body, { apiKey, fetch: io.fetch, sleep: io.sleep })` → if any judgments, `store.commit({ kind: 'add-assessment', assessment: { model, rubric: RUBRIC_VERSION, issues: judgments } })` → print. Ids in `dropped` join `failed` with reason `issue no longer exists`.
  - Human line per issue (§4.1), e.g. `QA-3  category accessibility 91% ✓applied · complexity 2 (71%) ✓applied · severity medium 81% (kept: low, set) ⚠disagrees`, then `tokens: <in> in / <out> out`. `--json` prints exactly the §4.1 shape. Exit 1 when `failed` is non-empty or on a fatal error/missing key; `nothing to assess` exit 0.

- [ ] **Step 1: Write the failing tests** in `test/assess.test.mjs` using `main(argv, { cwd, env: { TYPESAFE_API_KEY: 'sk-secret-123' }, fetch: fakeFetch, sleep: async () => {}, out, err })` on a scratch tracker (helper copied from `test/cli.test.mjs`); `fakeFetch` answers by issue title:
  - `assess applies confident judgments and logs the assessment` — exit 0; `issues.yaml` has `category: accessibility`, `complexity: 2`, `source: jev`; `assessments.yaml` has one entry with `model: jev-1.13.0`, `rubric: 1`; `validate` exit 0.
  - `default selection skips fully triaged issues; --refresh and ids widen it` — count fake-fetch calls per run.
  - `--dry-run needs no key and sends nothing` — env `{}`; fetch never called; stdout parses as JSON containing `"model": "jev-latest"`; stdout does not contain `sk-`.
  - `missing key fails before any request` — env `{}`; exit 1; `/TYPESAFE_API_KEY/`; fetch never called.
  - `a partial failure still commits the successes` — one issue's fetch returns 422 → exit 1; the other issue applied; `--json` `failed` has the 422 issue.
  - `401 stops the run and writes nothing` — `assessments.yaml` absent afterwards.
  - `--json output and the log never contain the key` — `out` and `assessments.yaml` do not include `'sk-secret-123'`. *(Review Focus 5)*
- [ ] **Step 2: Run** `node --test test/assess.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `src/assess.mjs` and the CLI command (a small worker pool for `concurrency`).
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: qa-tracker assess — Jev judgments applied by policy` (CHANGELOG: `assess` command, what is sent, key via `TYPESAFE_API_KEY`).

---

### Task 8: Agent-facing CLI — `set`, `add-issue`, `triage`, `get`, `validate`

**Files:**
- Modify: `src/cli.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 2, 4, 7.
- Produces:
  - `set <issue> category|complexity|severity|details <value>` → change kinds of Task 4 (`complexity` parsed with `Number`, integer check in `applyChange`).
  - `add-issue … [--details] [--category] [--complexity] [--severity] [--type] [--assess|--no-assess]`; `--severity` no longer required (usage error only without `--feature` or `--title`). Auto-assess when `cfg.jev.autoAssess` or `--assess`, unless `--no-assess`: print `sending QA-9 to TypeSafe (api.typesafe.ai)…`, run the Task 7 flow for the new id; on any failure print `warning: …` and still exit 0. `BOOLEAN_FLAGS` gains `assess`, `no-assess`.
  - `triage [--json]` — one line per item `QA-3  severity  disagrees  low → medium (90%)  Jev suggests medium (90%)`; `--json` prints the `triageQueue` array; empty → `Triage queue empty.`; exit 0.
  - `get <issue>` adds `triage` provenance, `latest assessment: <id>` with each judgment `value (pct)`, and any `store.check()` warnings that mention the issue (including log warnings 2 and 3, which STATUS.md omits).
  - `validate` uses `store.check()`: errors → stderr, exit 1; warnings → stdout `warning: …`; success line unchanged.
  - Help text updated for every command above.

- [ ] **Step 1: Write the failing tests** in `test/cli.test.mjs`:
  - `set confirms a value and clears its disagreement` — tracker with an issue `severity: low` and a fixture `assessments.yaml` suggesting `medium` 0.9: `triage --json` has one `disagrees`; `set QA-1 severity low` → `triage --json` is `[]`.
  - `add-issue without severity lands in the triage queue` — exit 0; `triage` output contains `QA-1  severity  needs-triage` and `not assessed`.
  - `add-issue auto-assesses only when opted in` — config `jev.auto_assess: true` + fake fetch → issue gets `source: jev` values; without the config → fetch not called; `--no-assess` with config → not called; opted in with no key → exit 0, `warning:` on stderr, issue saved.
  - `validate prints warnings but passes` — issue `category: checkout` (not listed) → exit 0, stdout `warning: issue QA-1: category checkout is not in the category list`.
  - `get shows provenance and log warnings` — issue with `triage.category = { source: 'jev', assessment: 'asm-2099-01-01' }` (missing) → `get QA-1` output contains `latest assessment` (or `none`) and a `warning:` line naming `asm-2099-01-01`.
  - `replacing the category list never blocks writes` — set config `categories` to `{ visual: … }` with an existing `accessibility` issue → `set QA-1 complexity 3` exit 0.
- [ ] **Step 2: Run** `node --test test/cli.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** the CLI changes.
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: triage queue and agent resolution via set` (CHANGELOG: `triage`, `set` triage fields, optional `--severity`, opt-in auto-assess).

---

### Task 9: STATUS.md — issue columns, legend, triage queue

**Files:**
- Modify: `src/markdown.mjs`, `src/store.mjs` (pass `categories` and issue warnings to `renderMarkdown`), `src/cli.mjs` (`status` uses the same input)
- Test: `test/render.test.mjs`; regenerate `examples/demo/STATUS.md`

**Interfaces:**
- Consumes: `triageQueue`, `pct` (Task 3); `validateAll`, `isLogWarning` (Task 2).
- Produces: `renderMarkdown(data, { title, categories, warnings })` — issue tables `| ID | Severity | Category | Cx | Feature | Title | Status |` (`—` when unset; values with `triage.<f>.source === 'jev'` suffixed `ᴶ`); open issues sorted severity (unset last) → complexity asc (unset last) → file order; closed issues status → severity (unset last) → file order; §8.1 legend line verbatim; `## Triage queue` table `| Issue | Field | Kind | Current | Suggested | Confidence | Reason |` or `_Triage queue empty._`; issue warnings (non-log) listed under it.

- [ ] **Step 1: Write the failing tests** in `test/render.test.mjs`:
  - `issue table shows category, complexity and the Jev marker` — row for an issue with `category: accessibility` (`source: jev`) and `complexity: 2` contains `| accessibilityᴶ | 2ᴶ |` when both are Jev-owned.
  - `open issues sort by severity, then complexity, unset last` — ids in table order for severities `[high, —, high, low]` and complexities `[5, 1, 2, —]` deep-equal the expected order.
  - `legend explains severity, complexity and status` — contains `**Severity** = impact on users` and `**Complexity** = effort to fix, 1–10`.
  - `triage queue renders deterministically` — rendering twice yields identical strings; empty queue → `_Triage queue empty._`.
- [ ] **Step 2: Run** `node --test test/render.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement**; then `npm run demo:render`.
- [ ] **Step 4: Run** `node --test` — all pass, including the demo-currency test.
- [ ] **Step 5: Commit** `feat: STATUS.md triage columns and queue` (CHANGELOG: new columns, legend, triage queue).

---

### Task 10: Dashboard and server

**Files:**
- Modify: `src/dashboard.mjs`, `src/server.mjs`
- Test: `test/server.test.mjs`

**Interfaces:**
- Consumes: Tasks 3, 4, 9.
- Produces: issue tables with the Task 9 columns; class `sev none` for unset severity; Jev-owned cells carry `title="Jev 91%"`; edit-mode selects `data-act="icategory"` (categories in list order), `"icomplexity"` (1–10), `"iseverity"` (with an empty `—` option when unset) beside status; a "Triage queue" section mirroring Task 9; `BROWSER_KINDS` adds `issue-category`, `issue-complexity`, `issue-severity`; client JS posts `{ kind, issue, value }` (complexity as a number).

- [ ] **Step 1: Write the failing tests** in `test/server.test.mjs`:
  - `the dashboard can set category, complexity and severity` — three edits return 200; `issues.yaml` contains the values and `source: set`.
  - `the page shows triage columns and the queue` — GET `/` contains `data-act="icomplexity"` and `Triage queue`.
  - `no route triggers an assessment` — POST `{ kind: 'add-assessment', … }` → 400; a server created while `process.env.TYPESAFE_API_KEY` is set makes no `fetch` call during GET `/` and an edit (stub `globalThis.fetch` to throw and restore it after).
- [ ] **Step 2: Run** `node --test test/server.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement**; check it in the Browser pane with the `demo-dashboard` launch config (selects save, queue renders, light and dark).
- [ ] **Step 4: Run** `node --test` — all pass.
- [ ] **Step 5: Commit** `feat: dashboard triage fields and queue` (CHANGELOG line).

---

### Task 11: Docs, templates, demo data and live smoke

**Files:**
- Modify: `README.md`, `templates/AGENTS.md`, `templates/issues.yaml`, `skills/qa-tracker/SKILL.md`, `examples/demo/issues.yaml`, `package.json` (`scripts.smoke:jev`)
- Create: `examples/demo/assessments.yaml`, `scripts/smoke-jev.mjs`
- Test: existing demo tests; `npm run check`

**Interfaces:**
- Consumes: everything above.
- Produces: README triage section (§11 list, including the `details`-may-contain-sensitive-data note and that ᴶ values are model judgments); agent docs without `--severity` as required and with the `add-issue --details` → `triage` → `set` loop; demo issues with categories and complexity (mixed `jev`/`set`) plus one `model: jev-example` assessment yielding at least one `needs-triage` and one `disagrees` item; `scripts/smoke-jev.mjs` assessing demo issue `QA-4` via the real API when `TYPESAFE_API_KEY` is set (prints the mapped judgments, writes nothing; exits 0 with a skip message when the key is absent); `"smoke:jev": "node scripts/smoke-jev.mjs"`; `files` in `package.json` unchanged (scripts are not shipped).

- [ ] **Step 1:** Update demo data; `npm run demo:render`; `node bin/qa-tracker.mjs triage --dir examples/demo` shows ≥ 1 `needs-triage` and ≥ 1 `disagrees`.
- [ ] **Step 2:** Update README, templates, skill; run `node --test` (schema/AGENTS ladder test stays green).
- [ ] **Step 3:** Add the smoke script; `npm run smoke:jev` with no key prints the skip message and exits 0.
- [ ] **Step 4:** Run `npm run check` and `npm pack --dry-run` — tests pass, demo validates, package file list unchanged apart from new `src/*.mjs`.
- [ ] **Step 5: Commit** `docs: triage with Jev — README, agent guide, demo` (CHANGELOG: docs line).
