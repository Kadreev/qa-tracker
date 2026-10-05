// Validates tracker data.
//
//   validate(data, opts)    -> string[]                 errors only (empty = valid)
//   validateAll(data, opts) -> { errors, warnings }     errors block writes; warnings never do
//
// `opts.exists(repoPath)` answers whether a path named by a surface (`component`,
// `test_refs`) exists; the store passes one rooted at the configured repo root.
// `opts.categories` is the resolved category list in effect (default: the built-in one).
import {
  LEVELS, DIM_STATUS, SEVERITIES, ISSUE_TYPES, ISSUE_STATUS, DIMS, BLAST_RADIUS,
  READ_ONLY_LEVEL_CAP, FEATURE_ID, RUN_ID, DATE, LEVEL_CHANGE, RUN_REF,
  TRIAGE_FIELDS, TRIAGE_SOURCES, ASSESSMENT_ID,
} from './schema.mjs';
import { validateSurfaces } from './surfaces.mjs';
import { resolveCategories, categoryByName } from './categories.mjs';
import { assessmentIndex, judgmentOf } from './assessments.mjs';

export { RUN_REF }; // kept here too: 0.1.0 exported it from this module

function dupes(ids) {
  const seen = new Set(), out = new Set();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

const blank = v => typeof v !== 'string' || !v.trim();
const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
const present = v => v !== undefined && v !== null;
const isComplexity = v => Number.isInteger(v) && v >= 1 && v <= 10;

/**
 * Whether a warning is about the append-only assessments log rather than an
 * issue. Those cannot be cleared by editing the log, so renderers that list
 * issue warnings (STATUS.md) leave them out; `validate` and `get` print them.
 */
export function isLogWarning(w) {
  return w.startsWith('assessment ') || /^issue \S+: triage /.test(w);
}

/** validate(data, opts) → string[] of errors. Warnings are not reported here; see validateAll. */
export function validate(data, opts = {}) {
  return run(data, opts).errs;
}

/** validateAll(data, opts) → { errors, warnings }. Warnings never block a write. */
export function validateAll(data, opts = {}) {
  const { errs, warns } = run(data, opts);
  return { errors: errs, warnings: warns };
}

function run({ features = [], issues = [], runs = [], surfaces = [], assessments = [] }, opts) {
  const { categories = resolveCategories() } = opts;
  const errs = [], warns = [];
  const lists = [['features.yaml', features], ['issues.yaml', issues], ['runs.yaml', runs], ['assessments.yaml', assessments]];
  for (const [label, list] of lists)
    if (!Array.isArray(list)) errs.push(`${label} must be a YAML list`);
  if (errs.length) return { errs, warns };

  // A bare "-" or a scalar item is reported here and left out of every later check.
  for (const [label, list] of lists)
    list.forEach((x, i) => { if (!isMapping(x)) errs.push(`${label} entry ${i + 1} must be a mapping, got ${JSON.stringify(x)}`); });
  [features, issues, runs, assessments] = [features, issues, runs, assessments].map(list => list.filter(isMapping));

  const featIds = new Set(features.map(f => f.id));
  const issueIds = new Set(issues.map(i => i.id));
  const runIds = new Set(runs.map(r => r.id));
  const runRadius = new Map(runs.map(r => [r.id, r.blast_radius]));

  for (const [label, list] of [['feature', features], ['issue', issues], ['run', runs], ['assessment', assessments]])
    for (const d of dupes(list.map(x => x.id)))
      errs.push(`duplicate ${label} id: ${d}`);

  for (const f of features) {
    const at = `feature ${f.id}`;
    if (typeof f.id !== 'string' || !FEATURE_ID.test(f.id)) errs.push(`${at}: id must be kebab-case`);
    if (blank(f.name)) errs.push(`${at}: name is required`);
    if (blank(f.area)) errs.push(`${at}: area is required`);
    if (!Number.isInteger(f.weight) || f.weight < 1 || f.weight > 5)
      errs.push(`${at}: weight must be integer 1-5, got ${f.weight}`);
    if (!LEVELS.includes(f.target_level))
      errs.push(`${at}: target_level invalid: ${f.target_level}`);
    if (!LEVELS.includes(f.current_level))
      errs.push(`${at}: current_level invalid: ${f.current_level}`);
    for (const dim of DIMS)
      if (!DIM_STATUS.includes(f.dimensions?.[dim]))
        errs.push(`${at}: dimensions.${dim} invalid: ${f.dimensions?.[dim]}`);
    for (const iss of f.issues ?? [])
      if (!issueIds.has(iss)) errs.push(`${at}: unknown issue ref ${iss}`);
    const runRef = RUN_REF.exec(f.last_validated ?? '')?.[1];
    if (runRef && !runIds.has(runRef))
      errs.push(`${at}: last_validated references unknown run ${runRef}`);
  }

  // A category that is not in the list is drift, not corruption: warn, never block.
  function checkCategory(i, at) {
    if (!present(i.category)) return;
    if (typeof i.category !== 'string' || !FEATURE_ID.test(i.category)) {
      errs.push(`${at}: category must be kebab-case, got ${JSON.stringify(i.category)}`);
      return;
    }
    const cat = categoryByName(categories, i.category);
    if (!cat) warns.push(`${at}: category ${i.category} is not in the category list`);
    else if (cat.type && ISSUE_TYPES.includes(i.type) && i.type !== cat.type)
      errs.push(`${at}: type must be ${cat.type} for category ${cat.name}, got ${i.type}`);
  }

  // Provenance shape is an error; what a reference points at is only ever a warning.
  function checkTriage(i, at) {
    if (!present(i.triage)) return;
    if (!isMapping(i.triage)) { errs.push(`${at}: triage must be a mapping`); return; }
    for (const [field, entry] of Object.entries(i.triage)) {
      const t = `${at}: triage.${field}`;
      if (!TRIAGE_FIELDS.includes(field)) { errs.push(`${t}: unknown triage field (use ${TRIAGE_FIELDS.join(', ')})`); continue; }
      if (!isMapping(entry)) { errs.push(`${t} must be a mapping`); continue; }
      if (!TRIAGE_SOURCES.includes(entry.source)) { errs.push(`${t}: source must be jev or set`); continue; }
      const ref = entry.source === 'jev' ? entry.assessment : entry.seen;
      if (entry.source === 'jev' && typeof ref !== 'string') { errs.push(`${t}: source jev needs an assessment id`); continue; }
      if (entry.source === 'set' && present(ref) && typeof ref !== 'string') { errs.push(`${t}: seen must be a string`); continue; }
      if (typeof ref !== 'string') continue;

      const logAt = `${at}: triage ${field}`;
      const idx = assessmentIndex(assessments, ref);
      if (idx < 0) { warns.push(`${logAt}: assessment ${ref} does not exist`); continue; }
      if (!isMapping(assessments[idx].issues) || !Object.hasOwn(assessments[idx].issues, i.id)) {
        warns.push(`${logAt}: assessment ${ref} does not mention this issue`);
        continue;
      }
      // A jev value that no longer matches its assessment was edited by hand (spec 2.2: treated as explicit).
      const said = judgmentOf(assessments, ref, i.id, field);
      if (entry.source === 'jev' && said && present(i[field]) && said.value !== i[field])
        warns.push(`${at}: ${field} ${i[field]} differs from what assessment ${ref} said (${said.value}); treated as set by hand`);
    }
  }

  for (const i of issues) {
    const at = `issue ${i.id}`;
    if (blank(i.id)) errs.push(`${at}: id is required`);
    if (blank(i.title)) errs.push(`${at}: title is required`);
    if (present(i.severity) && !SEVERITIES.includes(i.severity)) errs.push(`${at}: severity invalid: ${i.severity}`);
    if (!ISSUE_TYPES.includes(i.type)) errs.push(`${at}: type invalid: ${i.type}`);
    if (!ISSUE_STATUS.includes(i.status)) errs.push(`${at}: status invalid: ${i.status}`);
    if (!featIds.has(i.feature)) errs.push(`${at}: unknown feature ref ${i.feature}`);
    if (present(i.details) && typeof i.details !== 'string') errs.push(`${at}: details must be a string`);
    if (present(i.complexity) && !isComplexity(i.complexity))
      errs.push(`${at}: complexity must be an integer 1-10, got ${JSON.stringify(i.complexity)}`);
    checkCategory(i, at);
    checkTriage(i, at);
  }

  function checkJudgments(j, at) {
    for (const field of TRIAGE_FIELDS) {
      if (!present(j[field])) continue;
      if (!isMapping(j[field])) { errs.push(`${at}.${field} must be a mapping`); continue; }
      const { value, confidence } = j[field];
      if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1))
        errs.push(`${at}: ${field}.confidence must be a number from 0 to 1, got ${JSON.stringify(confidence)}`);
      if (field === 'complexity' && !isComplexity(value))
        errs.push(`${at}: complexity.value must be an integer 1-10, got ${JSON.stringify(value)}`);
      if (field === 'severity' && !SEVERITIES.includes(value)) errs.push(`${at}: severity.value invalid: ${value}`);
    }
    if (!present(j.applied)) return;
    if (!Array.isArray(j.applied)) errs.push(`${at}: applied must be a list`);
    else for (const f of j.applied)
      if (!TRIAGE_FIELDS.includes(f)) errs.push(`${at}: applied has unknown field ${f}`);
  }

  // assessments.yaml: shape errors block; naming a missing issue is a log warning.
  for (const a of assessments) {
    const at = `assessment ${a.id}`;
    if (typeof a.id !== 'string' || !ASSESSMENT_ID.test(a.id)) errs.push(`${at}: id must look like asm-YYYY-MM-DD[-n]`);
    if (!DATE.test(String(a.date ?? ''))) errs.push(`${at}: date must be YYYY-MM-DD, got ${a.date}`);
    if (blank(a.model)) errs.push(`${at}: model is required`);
    if (!Number.isInteger(a.rubric) || a.rubric < 1) errs.push(`${at}: rubric must be a positive integer, got ${JSON.stringify(a.rubric)}`);
    if (!isMapping(a.issues)) { errs.push(`${at}: issues must be a mapping of issue id to judgments`); continue; }
    for (const [iid, j] of Object.entries(a.issues)) {
      if (!issueIds.has(iid)) warns.push(`${at}: issue ${iid} does not exist`);
      if (!isMapping(j)) { errs.push(`${at}: issues.${iid} must be a mapping`); continue; }
      checkJudgments(j, `${at}: issues.${iid}`);
    }
  }

  const cap = LEVELS.indexOf(READ_ONLY_LEVEL_CAP);
  for (const r of runs) {
    const at = `run ${r.id}`;
    if (typeof r.id !== 'string' || !RUN_ID.test(r.id)) errs.push(`${at}: id must look like run-YYYY-MM-DD[-n]`);
    if (!DATE.test(String(r.date ?? ''))) errs.push(`${at}: date must be YYYY-MM-DD, got ${r.date}`);
    if (!BLAST_RADIUS.includes(r.blast_radius))
      errs.push(`${at}: blast_radius invalid: ${r.blast_radius}`);
    for (const fid of r.features_touched ?? [])
      if (!featIds.has(fid)) errs.push(`${at}: unknown feature ${fid}`);
    for (const iid of [...(r.issues_opened ?? []), ...(r.issues_verified ?? [])])
      if (!issueIds.has(iid)) errs.push(`${at}: unknown issue ${iid}`);
    for (const [fid, change] of Object.entries(r.level_changes ?? {})) {
      if (!featIds.has(fid)) errs.push(`${at}: level_changes unknown feature ${fid}`);
      const m = LEVEL_CHANGE.exec(String(change));
      if (!m) { errs.push(`${at}: level_changes.${fid} must look like "L0->L2", got ${change}`); continue; }
      // Rule 3: a read-only run never pressed a control that writes, so it
      // cannot be the evidence behind CRUD (L3) or hardening (L4).
      if (r.blast_radius === 'read-only' && LEVELS.indexOf(m[2]) > cap)
        errs.push(`${at}: read-only run cannot raise ${fid} above ${READ_ONLY_LEVEL_CAP} (got ${m[2]})`);
    }
  }

  // Rule 1: no run, no level bump. Replay runs.yaml in file order (it is
  // append-only) from L0; every change must start where the previous runs left
  // the feature, and each feature's current_level must be where the replay ends.
  const replayed = new Map([...featIds].map(id => [id, 'L0']));
  for (const r of runs)
    for (const [fid, change] of Object.entries(r.level_changes ?? {})) {
      const m = LEVEL_CHANGE.exec(String(change));
      if (!m || !replayed.has(fid)) continue; // reported above
      if (m[1] !== replayed.get(fid))
        errs.push(`run ${r.id}: ${fid} change ${change} starts from ${m[1]}, but earlier runs put it at ${replayed.get(fid)}`);
      replayed.set(fid, m[2]);
    }
  for (const f of features)
    if (LEVELS.includes(f.current_level) && replayed.has(f.id) && f.current_level !== replayed.get(f.id))
      errs.push(`feature ${f.id}: current_level ${f.current_level} is not backed by runs (runs give ${replayed.get(f.id)}); record the run with add-run --levels`);

  // verified-fixed means a run re-checked it, so some run must say so.
  const verified = new Set(runs.flatMap(r => r.issues_verified ?? []));
  for (const i of issues)
    if (i.status === 'verified-fixed' && !verified.has(i.id))
      errs.push(`issue ${i.id}: status verified-fixed but no run lists it in issues_verified; record it with add-run --verified`);

  errs.push(...validateSurfaces(surfaces, { featureIds: featIds, issueIds, runIds, runRadius }, opts));
  return { errs, warns };
}
