# Acme Notes — QA Tracker

_Last run: run-2026-01-20 (2026-01-20, sandbox) · 6 features · 3 open issues · 2 closed issues._

> Generated from the YAML files next to this one — do not edit by hand; run `qa-tracker render`.

## Legend
- **W** — weight (priority/risk, 1–5). Higher ⇒ must be validated deeper.
- **Cur / Tgt** — validation level reached / target. Ladder (cumulative, highest passed): **L0** Renders · **L1** Read validated · **L2** Interactions · **L3** CRUD · **L4** Hardened.
- **Func / UX / Code** — functionality / usability / code-health: ✅ pass · ⚠️ has issues · ❔ unknown.
- **Severity** = impact on users (critical → low) · **Complexity** = effort to fix, 1–10 · **Status** = lifecycle (open → fixed → verified-fixed, or wont-fix) · ᴶ = set by Jev, not yet confirmed.

## Coverage matrix
| Feature | Area | W | Cur | Tgt | Func | UX | Code | Issues |
|---|---|---|---|---|---|---|---|---|
| Sign in / sign up | Auth | 4 | L3 | L4 | ✅ | ✅ | ✅ | QA-1 |
| Notes list | Notes | 5 | L2 | L4 | ⚠️ | ⚠️ | ✅ | QA-2, QA-3 |
| Note editor | Notes | 5 | L1 | L4 | ⚠️ | ✅ | ❔ | QA-4 |
| Share a note | Collaboration | 3 | L0 | L3 | ❔ | ❔ | ❔ | — |
| Search | Notes | 3 | L2 | L3 | ✅ | ⚠️ | ✅ | QA-5 |
| Account settings | Settings | 2 | L2 | L2 | ✅ | ✅ | ✅ | — |

## Open issues (by severity)
| ID | Severity | Category | Cx | Feature | Title | Status |
|---|---|---|---|---|---|---|
| QA-4 | critical | — | — | note-editor | Autosave drops the last 2 seconds of typing when the tab is closed | open |
| QA-5 | medium | — | — | search | No-results state says "Error" instead of explaining there were no matches | open |
| QA-3 | low | — | — | notes-list | Sort menu has no keyboard focus ring | open |

## Closed issues
| ID | Severity | Category | Cx | Feature | Title | Status |
|---|---|---|---|---|---|---|
| QA-2 | high | — | — | notes-list | Deleting a pinned note leaves an empty card until reload | fixed |
| QA-1 | medium | — | — | sign-in | Sign-up form accepts an e-mail with a trailing space and then cannot sign in | verified-fixed |

## Triage queue
| Issue | Field | Kind | Current | Suggested | Confidence | Reason |
|---|---|---|---|---|---|---|
| QA-3 | category | needs-triage | — | — | — | not assessed |
| QA-3 | complexity | needs-triage | — | — | — | not assessed |
| QA-4 | category | needs-triage | — | — | — | not assessed |
| QA-4 | complexity | needs-triage | — | — | — | not assessed |
| QA-5 | category | needs-triage | — | — | — | not assessed |
| QA-5 | complexity | needs-triage | — | — | — | not assessed |

## UI surfaces (see `SURFACES.md` for the nested checklist)
_7 surfaces · ✅ 3 · ❌ 1 · ⛔ 1 · ⬜ 2 never checked._

| Feature | Surfaces | ✅ | ❌ | ⛔ | ⬜ | e2e / any automated |
|---|---|---|---|---|---|---|
| `notes-list` | 7 | 3 | 1 | 1 | 2 | 2 / 2 |

## Next run plan (ranked by weight × levels-below-target, + re-verify)
1. **Notes list** (`notes-list`, w5) — 2 level(s) below target L4; re-verify fixed issue
2. **Note editor** (`note-editor`, w5) — 3 level(s) below target L4
3. **Share a note** (`sharing`, w3) — 3 level(s) below target L3
4. **Sign in / sign up** (`sign-in`, w4) — 1 level(s) below target L4
5. **Search** (`search`, w3) — 1 level(s) below target L3
