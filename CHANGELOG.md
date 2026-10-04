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
  and no network.

### Changed
- `severity` is no longer required on an issue; when present it must still be
  one of `critical`, `high`, `medium` or `low`.

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
