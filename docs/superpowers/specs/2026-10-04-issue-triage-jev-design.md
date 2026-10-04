# Issue triage with Jev: categories, complexity and a severity check

- **Date:** 2026-10-04
- **Status:** design approved in conversation; awaiting written-spec review
- **Target release:** 0.3.0 (additive; existing trackers stay valid)

## 1. Goal

Make findings easier to triage and harder to mislabel:

1. **Richer categories** than today's three `type`s, from a default list a
   project can replace.
2. **Complexity 1–10**, meaning *effort to fix*, next to severity (impact).
3. **Severity vs status made unmistakable**, and a second opinion on severity
   that flags likely mislabels.
4. **TypeSafe's Jev** (System One model) suggests category, complexity and
   severity. Code owns every rule; Jev supplies judgments; a person accepts.

### Vocabulary this design keeps apart

| Field | Values | Answers |
|---|---|---|
| `severity` | `critical` · `high` · `medium` · `low` | How badly does it hurt users? (impact) |
| `complexity` | integer `1`–`10` | How much work is the fix? (effort) |
| `category` | from the category list | What kind of defect is it? |
| `type` | `code` · `functionality` · `usability` | Coarse kind; follows from `category` |
| `status` | `open` · `fixed` · `verified-fixed` · `wont-fix` | Where is it in its lifecycle? |

### Non-goals

- Changing the next-run plan. It stays weight × level gap; complexity is fix
  effort, not test priority.
- Auto-applying model output. Nothing reaches `issues.yaml` without `accept`
  or a manual edit.
- Calling TypeSafe from the dashboard server or the browser.
- Two-level (category → subcategory) taxonomies or free tags.

## 2. Data model

### 2.1 `issues.yaml` — new optional fields

```yaml
- id: QA-3
  title: Sort menu has no keyboard focus ring
  details: Tab moves focus into the sort menu but no outline is drawn.   # NEW, optional
  severity: low
  category: accessibility        # NEW, optional
  type: usability                # follows from category
  complexity: 2                  # NEW, optional, integer 1-10
  feature: notes-list
  status: open
  assessment: asm-2026-10-04     # NEW, optional: assessment its accepted values came from
```

| Field | Type | Required | Owner | Rule |
|---|---|---|---|---|
| `details` | string | no | user | Free text: what happens, steps to reproduce. Sent to Jev when present. |
| `category` | category name | no | user (Jev may suggest) | Must be in the category list in effect. |
| `complexity` | integer 1–10 | no | user (Jev may suggest) | Fix effort; see 2.3. |
| `assessment` | assessment id | no | `accept` | Must reference an existing assessment. |

`type` stays required. When `category` is set and is not `other`, `type` must
equal that category's type; the CLI fills it in automatically.

### 2.2 Categories

Default list (in `src/categories.mjs`). `other` is reserved and always present.

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
| `other` | (set by hand) | None of the other categories fits. |

A project replaces the list (not merges) in `qa-tracker.config.json`:

```json
{
  "title": "Acme Notes",
  "categories": {
    "checkout": { "type": "functionality", "description": "Cart, payment and order flow fail or misbehave." },
    "visual":   { "type": "usability",     "description": "Layout, styling and imagery are broken." }
  },
  "jev": { "flag_confidence": 0.7 }
}
```

Config rules: names are kebab-case; each entry has `type` ∈ `code|functionality|usability`
and a non-empty `description`; at most 254 entries (Choice accepts 255 options
and `other` takes one); a config entry named `other` is rejected.

### 2.3 Complexity levels (fix effort)

Used verbatim as the Jev Score criteria and in docs/SCHEMA.md.

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

### 2.4 `assessments.yaml` — append-only log

```yaml
# Jev suggestions, append-only. Accepting one edits issues.yaml, never this file.
- id: asm-2026-10-04             # asm-YYYY-MM-DD[-n]
  date: 2026-10-04
  model: jev-…                   # exactly as returned by the API
  rubric: 1                      # RUBRIC_VERSION of the questions asked
  issues:
    QA-3:
      category:   { value: accessibility, confidence: 0.91, probabilities: { accessibility: 0.91, ui-layout: 0.06, other: 0.01, … } }
      complexity: { value: 2, score: 1.3, confidence: 0.74, probabilities: { "1": 0.12, "2": 0.71, … } }
      severity:   { value: medium, confidence: 0.81, recorded: low, differs: true, probabilities: { … } }
```

- `complexity.probabilities` keys are complexity levels `"1"`–`"10"` (API
  level n → complexity n + 1).
- `severity.recorded` is the severity on file when assessed; `differs` is true
  when `value ≠ recorded` and `confidence ≥ jev.flag_confidence`.
- The file is created on first `assess`; trackers without it are valid.
- Nested maps are written in flow style so each judgment is one line.

## 3. Commands

### 3.1 `qa-tracker assess`

```
qa-tracker assess                 # open issues missing category or complexity
qa-tracker assess QA-3 QA-7       # these issues
qa-tracker assess --all           # every issue (re-assess)
qa-tracker assess --dry-run       # print the exact request bodies; no network, no key needed
qa-tracker assess --json          # machine-readable result
```

- Reads `TYPESAFE_API_KEY` from the environment. Missing → error before any
  request, with how to set it. The key is never written, logged or printed.
- One request per issue (all three questions together), at most 4 in flight.
- Appends one assessment entry covering every issue that succeeded, validated
  and written like any other change; regenerates STATUS.md.
- Prints, per issue: suggested category, complexity and severity with
  confidences; ⚠ on a severity flag; "needs a person" for `other` or a
  category below 0.5 confidence.
- Exit 0 when all succeeded; 1 when any failed (successes are still logged).
- With no issues selected: prints "nothing to assess" and exits 0.

### 3.2 `qa-tracker accept`

```
qa-tracker accept QA-3                         # category + complexity from its latest assessment
qa-tracker accept QA-3 --fields severity       # severity only when named
qa-tracker accept QA-3 --fields category,complexity,severity
qa-tracker accept --all --min-confidence 0.8   # bulk
qa-tracker accept QA-3 --assessment asm-2026-10-04
```

- Default fields: `category,complexity`. Severity is accepted only when listed
  in `--fields`, including in bulk.
- "Latest assessment" for an issue is the last entry in the file that has it.
- `--all` applies to every issue with a suggestion, using `--min-confidence`
  (0.8 when omitted), and skips: suggestions below it,
  category `other`, a suggested category no longer in the list, and values
  already recorded.
- A single-issue accept has no confidence threshold, but still refuses a
  category no longer in the list.
- Accepting `category` also sets `type` from the list. Sets `assessment:` to the
  source assessment id.
- Goes through `store.commit` (validated, atomic, STATUS.md regenerated).

### 3.3 Manual edits

```
qa-tracker add-issue --feature notes-list --severity low --title "…" \
          [--category accessibility] [--complexity 2] [--details "…"] [--type …]
qa-tracker set QA-3 category accessibility     # also sets type
qa-tracker set QA-3 complexity 4
qa-tracker set QA-3 severity high              # new
qa-tracker set QA-3 details "…"
```

- `--type` still accepted. If both `--type` and a non-`other` `--category` are
  given and disagree → error. With `--category other` (or no category), `type`
  comes from `--type`, which defaults to `functionality` as today.
- `get QA-3` also prints the latest suggestion per field next to the recorded
  value.

## 4. The Jev request

Endpoint `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer
$TYPESAFE_API_KEY`, `model: "jev-latest"`. The response `model` is stored.

### 4.1 State (per issue)

```json
{
  "app": "<config title>",
  "issue":    { "title": "…", "details": "…" },
  "feature":  { "name": "…", "area": "…", "routes": ["…"] },
  "surfaces": [{ "name": "…", "ui": "…", "expected": "…", "effect": "read" }]
}
```

- `surfaces`: those whose `issues` list contains the issue id.
- **Never included:** recorded `severity`, `type`, `category`, `complexity`,
  `status`, `source`, file contents. Omitting the recorded labels keeps Jev's
  answer independent so the disagreement flag means something.
- Empty or missing optional fields are omitted, not sent as null.

### 4.2 Questions (`src/jev-rubric.mjs`, `RUBRIC_VERSION = 1`)

| id | type | instructions | criteria |
|---|---|---|---|
| `category` | choice | What kind of defect does `issue` describe? Judge the problem itself, not the feature it sits in. | each category name → its description; `other` → "None of the other categories fits." |
| `complexity` | score | How much engineering work would a typical developer on this app need to fix `issue`, including tests? Judge the likely fix, not how harmful the problem is. | the 10 situations of 2.3, low → high |
| `severity` | choice | How badly does `issue` hurt the people using the app? Judge the harm to users, not how hard it is to fix. | `critical`: data loss, a security hole, or a core flow blocked for everyone · `high`: a core flow broken for some people, or with no reasonable workaround · `medium`: degraded, with a workaround · `low`: cosmetic or a minor annoyance |

Any change to question text, criteria or state shape bumps `RUBRIC_VERSION`.

### 4.3 Mapping answers (code)

- category: `choice`, `confidence`, `probabilities` as returned.
- complexity: `value = clamp(round(score) + 1, 1, 10)`; store raw `score`;
  re-key probabilities `"0"…"9"` → `"1"…"10"`.
- severity: `choice`, `confidence`, `probabilities`; add `recorded`, `differs`.
- An answer whose type or value is outside the asked options → that issue fails.

### 4.4 Thresholds (starting values, to evaluate on real data)

| Rule | Default | Where |
|---|---|---|
| Severity flag | confidence ≥ 0.70 | `jev.flag_confidence` in config |
| Bulk accept | confidence ≥ 0.80 | `--min-confidence` |
| Needs a person | category `other` or confidence < 0.50 | fixed |

Full probabilities are stored so thresholds can change without new requests.

## 5. Generated files and dashboard

### 5.1 Issue tables (STATUS.md and dashboard)

Columns: `ID | Severity | Category | Cx | Feature | Title | Status` (`—` when
unset). Open issues sort by severity, then complexity ascending (unset last),
then id. A legend line states the three meanings:

> **Severity** = impact on users (critical → low) · **Complexity** = effort to
> fix, 1–10 · **Status** = lifecycle (open → fixed → verified-fixed, or wont-fix).

### 5.2 "Suggestions to review" (STATUS.md)

Rows for the latest suggestion per issue and field where the suggestion fills
an empty field or differs from the recorded value: issue, field, recorded,
suggested, confidence, ⚠ for severity flags. Closed issues are excluded. Empty
→ "_Nothing to review._". Deterministic: sorted by issue id then field.

### 5.3 Dashboard edit mode

- Selects for category, complexity (1–10) and severity beside status.
- A chip per pending suggestion: `Jev: accessibility · 91% [Accept]`; amber
  for a severity flag. Accept sends `{ kind: "accept", issue, fields: [field],
  assessment }`.
- New browser change kinds: `issue-category`, `issue-complexity`,
  `issue-severity`, `accept`. `assess` is not reachable from the server; the
  server never reads `TYPESAFE_API_KEY` and never makes outbound requests.

## 6. Validation rules (added to `validate`)

1. `issue.category`, when set, is in the list in effect; when not `other`,
   `issue.type` equals its type.
2. `issue.complexity`, when set, is an integer 1–10.
3. `issue.details`, when set, is a string.
4. Config `categories` and `jev.flag_confidence` (number in (0, 1]) are
   well-formed (rules in 2.2). Invalid config is a `validate` error.
5. `assessments.yaml`, when present: a list of mappings; ids match
   `^asm-\d{4}-\d{2}-\d{2}(-\d+)?$` and are unique; `date` matches; `model` is
   a non-empty string; `rubric` a positive integer; every key of `issues` is a
   known issue id; each judgment has `confidence` in [0, 1]; complexity value
   is an integer 1–10; severity value is a known severity. A suggested
   category not in the current list is allowed.
6. `issue.assessment`, when set, references an existing assessment that
   contains that issue.

## 7. Errors (`assess`)

| Condition | Behaviour |
|---|---|
| No `TYPESAFE_API_KEY` (not `--dry-run`) | Error before any request; exit 1 |
| 401 | Stop the run; nothing logged; exit 1 |
| 422 | That issue fails with the API message, reported as a qa-tracker rubric bug |
| 429, 529, network error, 30 s timeout | Up to 3 retries, backoff 1 s / 2 s / 4 s; then that issue fails |
| Missing or malformed answer | That issue fails |
| Validation of the new entry fails | Nothing written; error shown; exit 1 |

## 8. Modules

| File | Responsibility | Depends on |
|---|---|---|
| `src/categories.mjs` (new) | Default list; `resolveCategories(config)`; config checks | schema |
| `src/jev-rubric.mjs` (new) | `RUBRIC_VERSION`, complexity levels, `buildState`, `buildQuestions` | categories |
| `src/jev-client.mjs` (new) | `askJev(body, { apiKey, fetch, timeoutMs })` with retries | Node global `fetch` |
| `src/assess.mjs` (new) | Select issues, build requests, map answers → assessment entry | rubric, client |
| `src/edit.mjs` | New kinds: `issue-category`, `issue-complexity`, `issue-severity`, `issue-details`, `accept`, `add-assessment`; `add-issue` fields | categories |
| `src/store.mjs` | Load/write `assessments.yaml`; pass categories to validate | — |
| `src/validate.mjs` | Rules in section 6 | categories |
| `src/markdown.mjs`, `src/dashboard.mjs`, `src/server.mjs` | Section 5 | format |
| `src/cli.mjs` | `assess`, `accept`, new flags and `set` fields | assess |
| `src/config.mjs` | Read `categories` and `jev` from config | — |

No new runtime dependency. `io.fetch` and `io.env` on `main()` let tests
inject a fake transport.

## 9. Testing

- **Unit:** state omits recorded labels and status; complexity rounding and
  re-keying; `differs` threshold; category resolution and config errors;
  accept rules (severity never by default, bulk threshold, `other` skipped,
  stale category refused); validation rules of section 6.
- **Client (fake fetch):** 401 stops; 429 then 200 succeeds; 422 surfaces the
  message; malformed answer fails; timeout retried.
- **CLI end-to-end (fake fetch):** `assess` → `accept` → `validate`;
  `--dry-run` sends nothing and needs no key; missing key errors; partial
  failure logs the successes and exits 1.
- **Server:** browser can `accept` and set category/complexity/severity;
  no route triggers an assessment.
- **Schema docs:** every category, complexity level and new field appears in
  docs/SCHEMA.md (extend `test/schema.test.mjs`).
- **Demo:** demo issues gain categories and complexity, plus one example
  assessment with `model: jev-example`; demo STATUS.md regenerated.
- **Live smoke (not in CI):** `npm run smoke:jev` assesses one demo issue when
  `TYPESAFE_API_KEY` is set, prints the result, writes nothing.
- No test or CI job contacts the real API.

## 10. Documentation and release

- README: triage section (fields, `assess`/`accept`, what is sent, key setup).
- docs/SCHEMA.md: new fields, category table, complexity table,
  `assessments.yaml`, rules.
- templates/AGENTS.md and the skill: when to set category/complexity, that
  `accept` of severity is a person's call.
- CHANGELOG `[Unreleased]` entries as features land; release as 0.3.0.
