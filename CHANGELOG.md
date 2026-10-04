# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Kadreev/qa-tracker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Kadreev/qa-tracker/releases/tag/v0.1.0
