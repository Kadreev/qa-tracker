# Acme Notes — QA Tracker — UI surfaces

_7 surfaces · ✅ 3 pass · ❌ 1 broken · ⛔ 1 blocked · ⬜ 2 never checked · 2 with neither a browser check nor an automated test._

> Generated from `surfaces/*.yaml` — do not edit by hand; run `qa-tracker render`.

Legend: ✅ pass · ❌ broken (finding id follows) · ⛔ blocked · ⬜ unchecked. A bold effect (**mutate**, **run**, **external**) means exercising it changes data, costs compute or leaves the app. `contract` / `unit` / `e2e` is the automated coverage that exists today.

## Roll-up by feature
| Feature | id | Surfaces | ✅ | ❌ | ⛔ | ⬜ | e2e / any automated |
|---|---|---|---|---|---|---|---|
| Notes list | `notes-list` | 7 | 3 | 1 | 1 | 2 | 2 / 2 |

## Broken now
| Surface | Name | Findings | Checked |
|---|---|---|---|
| `notes.list.sort` | Sort menu | QA-3 | 2026-01-20 (run-2026-01-20) |

## Notes

### Notes list — `/notes`

- ✅ **Notes list** `notes.list` · view `e2e` _(2026-01-12 (run-2026-01-12))_
  Grid of note cards with a toolbar (new note, sort, view toggle) and a pinned row on top → _Shows the signed-in user's notes, pinned first, newest first_
  - ✅ **New note** `notes.list.new` · action **mutate** `e2e` _(2026-01-20 (run-2026-01-20))_
    Primary button "New note" in the toolbar → _Creates an empty note and opens it in the editor_
  - ❌ **Sort menu** `notes.list.sort` · control → QA-3 _(2026-01-20 (run-2026-01-20))_
    Dropdown with Newest, Oldest, Title A–Z → _Reorders the cards without a reload; reachable and operable by keyboard_
  - ✅ **Note card** `notes.list.card` · panel _(2026-01-12 (run-2026-01-12))_
    Title, first line of the body, updated-at time and a ••• menu → _Opens the note on click; the menu offers Pin, Duplicate and Delete_
    - ⬜ **Delete note** `notes.list.card.delete` · action **mutate**
      Delete item in the card menu, with a confirm dialog → _Removes the card immediately, including from the pinned row_
    - ⬜ **Duplicate note** `notes.list.card.duplicate` · action **mutate**
      Duplicate item in the card menu → _Adds a "Copy of …" card at the top_
  - ⛔ **Empty state** `notes.list.empty` · state _(2026-01-20 (run-2026-01-20))_
    Illustration and "Write your first note" call to action → _Shown when the user has no notes; the call to action creates one_

## Never checked and not automated
| Surface | Kind | Effect | Route |
|---|---|---|---|
| `notes.list.card.delete` | action | mutate | /notes |
| `notes.list.card.duplicate` | action | mutate | /notes |
