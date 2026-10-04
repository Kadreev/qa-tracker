// qa-tracker schema — the single source of truth for the shape of the data.
//
// Everything that validates, renders, or edits the tracker imports its
// vocabulary from here, so the schema cannot drift away from the code that
// enforces it. docs/SCHEMA.md is the prose companion; if you change a constant
// here, change the table there in the same commit (test/schema.test.mjs checks
// that the two agree).
//
// Why a module and not a JSON Schema file: the validator has no runtime
// dependency budget, and a plain ESM module is both machine-readable and
// directly importable by the validator, the CLI, and the server.

/** Validation ladder. Cumulative: a feature cannot reach L3 if an L1 check fails. */
export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];

export const LEVEL_MEANING = {
  L0: 'Renders; no console errors or blank states',
  L1: 'Displayed data is correct and internally consistent',
  L2: 'Non-mutating interactions work (filters, tabs, modals, sort)',
  L3: 'Create, edit, delete and run exercised and verified',
  L4: 'Edge cases, empty and error states, concurrency, regressions re-checked',
};

/** Per-feature quality dimensions shown in the matrix. */
export const DIMS = ['functionality', 'usability', 'code_health'];
export const DIM_STATUS = ['pass', 'issues', 'unknown'];

/** Issue vocabulary. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const ISSUE_TYPES = ['code', 'functionality', 'usability'];
export const ISSUE_STATUS = ['open', 'fixed', 'verified-fixed', 'wont-fix'];

/** How far a QA run is allowed to go. Read-only runs cap the ladder at L2. */
export const BLAST_RADIUS = ['read-only', 'sandbox', 'test-account'];
export const READ_ONLY_LEVEL_CAP = 'L2';

/** Weight (1-5, user-owned) implies a target level unless the user overrides it. */
export function targetLevelForWeight(weight) {
  if (weight >= 4) return 'L4';
  if (weight === 3) return 'L3';
  return 'L2';
}

/** Ids: features are kebab-case; runs are run-YYYY-MM-DD with an optional suffix. */
export const FEATURE_ID = /^[a-z0-9][a-z0-9-]*$/;
export const RUN_ID = /^run-\d{4}-\d{2}-\d{2}(-[\w-]+)?$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A level change in runs.yaml: "L0->L2". */
export const LEVEL_CHANGE = /^(L[0-4])->(L[0-4])$/;
/** Pulls the run id out of "2026-09-05 (run-2026-09-05)" or "… (run-2026-09-05-2; notes)". */
export const RUN_REF = /\((run-[\w-]+)/;

/**
 * The coverage matrix: one row per feature, these columns in this order.
 * `source` is the field the column reads; `owner` says who may change it —
 * `user` fields are never overwritten by a QA run.
 */
export const MATRIX_COLUMNS = [
  { key: 'name', label: 'Feature', source: 'name', owner: 'user' },
  { key: 'area', label: 'Area', source: 'area', owner: 'user' },
  { key: 'weight', label: 'W', source: 'weight', owner: 'user', note: 'priority/risk 1-5' },
  { key: 'current_level', label: 'Cur', source: 'current_level', owner: 'run', note: 'highest level fully passed' },
  { key: 'target_level', label: 'Tgt', source: 'target_level', owner: 'user', note: 'defaults from weight' },
  { key: 'functionality', label: 'Func', source: 'dimensions.functionality', owner: 'run' },
  { key: 'usability', label: 'UX', source: 'dimensions.usability', owner: 'run' },
  { key: 'code_health', label: 'Code', source: 'dimensions.code_health', owner: 'run' },
  { key: 'issues', label: 'Issues', source: 'issues', owner: 'run', note: 'linked issue ids' },
];

/** Field specs per entity. `required` is enforced by the validator. */
export const FEATURE_FIELDS = {
  id: { type: 'string', required: true, note: 'kebab-case, unique, stable forever' },
  name: { type: 'string', required: true, owner: 'user' },
  area: { type: 'string', required: true, owner: 'user', note: 'nav or subsystem grouping' },
  routes: { type: 'string[]', required: false, owner: 'user' },
  weight: { type: 'integer 1-5', required: true, owner: 'user' },
  target_level: { type: 'level', required: true, owner: 'user' },
  current_level: { type: 'level', required: true, owner: 'run' },
  dimensions: { type: '{functionality,usability,code_health: pass|issues|unknown}', required: true, owner: 'run' },
  issues: { type: 'issue id[]', required: false, owner: 'run' },
  reverify: { type: 'boolean', required: false, owner: 'run', note: 'a linked issue was fixed and needs re-checking' },
  last_validated: { type: 'YYYY-MM-DD (run-id)', required: false, owner: 'run' },
  notes: { type: 'string', required: false },
};

export const ISSUE_FIELDS = {
  id: { type: 'string', required: true, note: 'unique and permanent; reuse the id your issue tracker gives the finding' },
  title: { type: 'string', required: true },
  severity: { type: SEVERITIES.join('|'), required: true },
  type: { type: ISSUE_TYPES.join('|'), required: true },
  feature: { type: 'feature id', required: true },
  status: { type: ISSUE_STATUS.join('|'), required: true },
  source: { type: 'path or url', required: false, note: 'the report or record that raised it' },
};

export const RUN_FIELDS = {
  id: { type: 'run-YYYY-MM-DD[-n]', required: true },
  date: { type: 'YYYY-MM-DD', required: true },
  profiles: { type: 'string[]', required: false },
  blast_radius: { type: BLAST_RADIUS.join('|'), required: true },
  features_touched: { type: 'feature id[]', required: false },
  level_changes: { type: '{feature id: "L0->L2"}', required: false },
  issues_opened: { type: 'issue id[]', required: false },
  issues_verified: { type: 'issue id[]', required: false },
  report: { type: 'path or url', required: false },
};

// ---------------------------------------------------------------------------
// Surfaces — the UI capability inventory (<data dir>/surfaces/*.yaml).
//
// A feature is a matrix row; a surface is one thing a user can see or do
// inside that feature, nested to every level (view → tab → panel → control).
// The inventory exists so functionality that has never been checked is visible
// as an explicit `unchecked` row instead of being invisible under a feature.
// ---------------------------------------------------------------------------

/** What kind of UI thing a surface is. */
export const SURFACE_KINDS = ['view', 'tab', 'panel', 'dialog', 'control', 'action', 'step', 'rail', 'state'];

/** Safety class of exercising the surface. Read-only runs may only verify read|navigate. */
export const SURFACE_EFFECTS = ['read', 'navigate', 'mutate', 'run', 'external'];
export const READ_ONLY_EFFECTS = ['read', 'navigate'];

/** How the surface is exercised by automated tests today. */
export const SURFACE_COVERAGE = ['none', 'contract', 'unit', 'e2e'];
export const COVERAGE_MEANING = {
  none: 'No automated test touches it',
  contract: 'A static or source-level assertion pins its wiring',
  unit: 'A unit, component or route test exercises its logic without a browser',
  e2e: 'A browser test drives it through the real UI',
};

/** Outcome of the last recorded browser verification. */
export const SURFACE_VERDICTS = ['unchecked', 'pass', 'broken', 'blocked'];
export const VERDICT_MEANING = {
  unchecked: 'Never verified through the UI in a recorded run',
  pass: 'Behaved as `expected` in the run named by `checked`',
  broken: 'Did not behave as `expected`; `issues` names the finding',
  blocked: 'Could not be exercised (missing data, gated, environment); reason in `notes`',
};

export const SURFACE_FIELDS = {
  id: { type: 'string', required: true, note: 'dotted path, unique across all surfaces files; a child id extends its parent id with "." + segment' },
  feature: { type: 'feature id', required: 'root', note: 'matrix row this surface rolls up into; children inherit' },
  kind: { type: SURFACE_KINDS.join('|'), required: true },
  name: { type: 'string', required: true },
  route: { type: 'route pattern', required: 'view', note: 'e.g. /projects/:id/settings; children inherit' },
  component: { type: 'repo path', required: false, note: 'file that renders it; must exist' },
  ui: { type: 'string', required: true, note: 'what the user sees' },
  expected: { type: 'string', required: true, note: 'what must happen when it is used' },
  effect: { type: SURFACE_EFFECTS.join('|'), required: true },
  api: { type: 'string[]', required: false, note: 'METHOD /path calls it makes' },
  coverage: { type: SURFACE_COVERAGE.join('|'), required: true },
  test_refs: { type: 'repo path[]', required: false, note: 'tests that give the coverage; must exist' },
  verdict: { type: SURFACE_VERDICTS.join('|'), required: true, owner: 'run' },
  checked: { type: 'YYYY-MM-DD (run-id)', required: 'verdict != unchecked', owner: 'run' },
  issues: { type: 'issue id[]', required: 'verdict == broken', owner: 'run' },
  notes: { type: 'string', required: false },
  children: { type: 'surface[]', required: false },
};
