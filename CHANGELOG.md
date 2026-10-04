# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Issue categories: a default list of 11, replaceable in `qa-tracker.config.json`.
- New optional issue fields: `details`, `category`, `complexity` (1-10, effort to
  fix) and `triage` (where each triage value came from), plus an append-only
  `assessments.yaml` log, all documented in `docs/SCHEMA.md`. Existing trackers
  stay valid without changes.
- `validateAll(data, opts)` returns `{ errors, warnings }` and `store.check()`
  runs it on the stored data; warnings (a category outside the list, a dangling
  assessment reference, a hand-edited Jev value) never block a write.
- `qa-tracker assess [ids…] [--all] [--refresh] [--json]` asks TypeSafe's Jev
  for each issue's category, complexity and severity, applies the confident
  answers by the triage policy and logs the run as one `assessments.yaml` entry.
  By default it takes open issues with a field needing triage. Only the app
  title, the issue's title and details (first 4,000 characters), its feature's
  name, area and routes, and the surfaces that list it are sent; recorded labels
  never are. The key is read from `TYPESAFE_API_KEY` and is never written or
  printed; `--dry-run` prints the exact request bodies (one JSON array) with no key
  and no network. A response with a confidence outside 0–1, or naming a
  different model than the run's first answer, fails only that issue; the rest
  of the run is still recorded.
- `qa-tracker triage [--json]` lists the issues that still need a person: a
  missing category, complexity or severity, and Jev answers that disagree with
  an explicit value. `get <issue>` shows where each value came from, the latest
  assessment and any warnings that name the issue.
- `set <issue> category|complexity|severity|details <value>` records an explicit
  value; setting a value Jev disagreed with clears it from the triage queue.
- `add-issue` takes `--details`, `--category`, `--complexity` and an optional
  `--severity`; an issue added without severity lands in the triage queue.
- Opt-in auto-assess: with `jev.auto_assess: true` in the config (or `--assess`),
  `add-issue` sends the new issue to Jev and applies the confident answers;
  `--no-assess` skips it. A missing key or a failed request prints a warning and
  the issue is still saved.
- `STATUS.md` issue tables gain Category and Cx (complexity) columns, with `ᴶ`
  marking values Jev set that nobody has confirmed, a Severity / Complexity /
  Status legend, and a "Triage queue" section (with the issue warnings under it).
  Open issues sort by severity, then complexity, unset last. `status` prints the
  same text as `STATUS.md`.
- The dashboard shows the Category and Cx columns (Jev-set values carry the ᴶ mark and a
  "Jev 91%" tooltip), a "Triage queue" section, and edit-mode selects for category,
  complexity and severity that record explicit values like `set`.
- Dashboard summary: four cards above the coverage matrix (open issues with a
  severity bar, fixed with verified / awaiting check, coverage at target and
  weighted, and the hotspot feature with its worst open issue) and three panels
  (issues by feature, severity × status, work queue with the triage queue size
  and quick wins). `summarize(data, { categories })` returns the same numbers.
- `STATUS.md` opens with a `## Summary` block of the same numbers.
- Programmatic API: `applyChange` takes the kinds `issue-category`,
  `issue-complexity`, `issue-severity`, `issue-details` and `add-assessment`
  (the last one applies the confident answers and appends the log entry in one
  commit). New exports: `resolveCategories` and `DEFAULT_CATEGORIES`,
  `assessmentIndex`, `judgmentOf` and `latestFor` (read `assessments.yaml`),
  `nextAssessmentId`, `validateAll` with `isLogWarning`, and `summarize` with
  `SEVERITY_WEIGHT`, plus the triage constants in the schema.
- `set <issue> details ""` clears an issue's details.
- Docs: a "Triage with Jev" section in the README (fields, the autonomous flow,
  the triage queue, exactly what is sent to TypeSafe, key setup, opt-in
  auto-assess), the agent guide and skill without `--severity` as required, the
  Acme Notes demo with categories, complexity and an illustrative
  `assessments.yaml`, and `npm run smoke:jev`, a live check (needs
  `TYPESAFE_API_KEY`, writes nothing, not part of CI).

### Changed
- Closed issues in `STATUS.md` and the dashboard now sort by status (fixed,
  verified-fixed, wont-fix), then severity, with unset severity last; before, they
  sorted by severity only.
- A boolean flag given as `--flag=value` takes only `true`, `1`, `false` or `0`;
  `--assess=false` used to opt in to sending the issue to TypeSafe. A 422 from
  Jev now reads `request rejected (422): <message>`, and suggests shortening
  `details` only when the message is about size.
- The dashboard legends are now tooltips on the column headers (hover or keyboard
  focus); a print-only legend follows each table so PDF exports keep them. Issue
  IDs no longer wrap.
- The `Type` column is gone from the `STATUS.md` issue tables; the category
  implies it.
- `severity` is no longer required on an issue; when present it must still be
  one of `critical`, `high`, `medium` or `low`.
- `validate` prints warnings (`warning: …`, exit 0) alongside its errors.

## [0.2.0] - 2026-10-04

Tightens the evidence rules. Trackers whose YAML was hand-edited against them
(a level with no run behind it, or `verified-fixed` with no run) now fail
`validate`; record the missing run to fix them.

### Fixed
- `validate` now enforces "no run, no level bump": it replays `runs.yaml` from
  L0 and rejects a `current_level` the runs don't reach, and a level change
  whose starting level contradicts the earlier runs. Before, a hand-edited
  `current_level` passed validation.
- `add-run --levels` refuses a change like `sign-in:L0->L4` when the feature is
  not at L0, instead of recording a run log that contradicts itself.
- A backdated run (`add-run --date`) no longer overwrites a newer
  `last_validated`.
- `set <feature> reverify` accepts only `true`/`false`/`1`/`0`; other values
  such as `yes` were silently stored as `false`.
- `validate` reports empty or scalar list entries (a bare `-`) and malformed
  surfaces (`surfaces:` or `children:` that is not a list) instead of crashing.
- Every tracker file is now written through a temp file and a rename, so a crash
  or a sync client (OneDrive, Dropbox) never sees a half-written file. Edits that
  touch two files (such as `add-issue`) still write them one after the other.
- The dashboard server answers a malformed edit body (bad JSON, `null`, an
  array) with 400 instead of 500.
- Double-clicking a dashboard weight button no longer sends the same value twice;
  the row's buttons are disabled until the save lands.
- A value flag with no value (`serve --port`, `add-run --report`) is now an error;
  before, `--port` alone made the dashboard listen on port 1 and `--report` alone
  wrote `report: true`.
- `init --root` is now written to `qa-tracker.config.json`; it was ignored.
- `render` and every write remove a stale `SURFACES.md` once the last
  `surfaces/*.yaml` file is gone.

### Changed
- `verified-fixed` is now recorded only by a run (`add-run --verified`).
  `set <issue> status verified-fixed` and the dashboard's status menu refuse it,
  and `validate` rejects a `verified-fixed` issue that no run lists in
  `issues_verified`. Hand-edited trackers that broke either evidence rule now
  fail `validate`; record the missing run to fix them.

## [0.1.0] - 2026-10-04

First public release, extracted from the in-repo tracker used by Stability Monitor.

### Added
- Coverage matrix (`features.yaml`) with the L0–L4 validation ladder, weights,
  targets and functionality / usability / code-health dimensions.
- Findings (`issues.yaml`) and the append-only run log (`runs.yaml`).
- Optional UI surface checklist (`surfaces/*.yaml`) with per-surface verdicts and
  a generated `SURFACES.md`.
- Validator enforcing references, vocabulary and the evidence rules: levels
  move only through runs, and read-only runs cap at L2 and cannot pass
  mutating surfaces.
- CLI: `init`, `serve`, `status`, `plan`, `get`, `validate`, `render`,
  `add-feature`, `add-issue`, `add-run`, `set`, `surfaces`, `surface`, `verdict`.
- Local dashboard with in-place editing and PDF export; binds to 127.0.0.1 and
  refuses cross-origin, non-JSON and foreign-Host requests.
- Configurable data directory (`--dir`, `$QA_TRACKER_DIR`) and
  `qa-tracker.config.json` (title, repo root).
- `AGENTS.md` template and an agent skill (`skills/qa-tracker/SKILL.md`).
- Programmatic API (`import { createStore } from 'qa-tracker'`).
- Acme Notes demo dataset in `examples/demo`.

[Unreleased]: https://github.com/Kadreev/qa-tracker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Kadreev/qa-tracker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kadreev/qa-tracker/releases/tag/v0.1.0
