// Validates tracker data. validate(data, opts) -> array of error strings (empty = valid).
//
// `opts.exists(repoPath)` answers whether a path named by a surface (`component`,
// `test_refs`) exists; the store passes one rooted at the configured repo root.
import {
  LEVELS, DIM_STATUS, SEVERITIES, ISSUE_TYPES, ISSUE_STATUS, DIMS, BLAST_RADIUS,
  READ_ONLY_LEVEL_CAP, FEATURE_ID, RUN_ID, DATE, LEVEL_CHANGE,
} from './schema.mjs';
import { validateSurfaces } from './surfaces.mjs';

/** Pulls the run id out of "2026-09-05 (run-2026-09-05)" or "… (run-2026-09-05-2; notes)". */
export const RUN_REF = /\((run-[\w-]+)/;

function dupes(ids) {
  const seen = new Set(), out = new Set();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

const blank = v => typeof v !== 'string' || !v.trim();

export function validate({ features = [], issues = [], runs = [], surfaces = [] }, opts = {}) {
  const errs = [];
  for (const [label, list] of [['features.yaml', features], ['issues.yaml', issues], ['runs.yaml', runs]])
    if (!Array.isArray(list)) errs.push(`${label} must be a YAML list`);
  if (errs.length) return errs;

  const featIds = new Set(features.map(f => f.id));
  const issueIds = new Set(issues.map(i => i.id));
  const runIds = new Set(runs.map(r => r.id));
  const runRadius = new Map(runs.map(r => [r.id, r.blast_radius]));

  for (const [label, list] of [['feature', features], ['issue', issues], ['run', runs]])
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

  for (const i of issues) {
    const at = `issue ${i.id}`;
    if (blank(i.id)) errs.push(`${at}: id is required`);
    if (blank(i.title)) errs.push(`${at}: title is required`);
    if (!SEVERITIES.includes(i.severity)) errs.push(`${at}: severity invalid: ${i.severity}`);
    if (!ISSUE_TYPES.includes(i.type)) errs.push(`${at}: type invalid: ${i.type}`);
    if (!ISSUE_STATUS.includes(i.status)) errs.push(`${at}: status invalid: ${i.status}`);
    if (!featIds.has(i.feature)) errs.push(`${at}: unknown feature ref ${i.feature}`);
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

  errs.push(...validateSurfaces(surfaces, { featureIds: featIds, issueIds, runIds, runRadius }, opts));
  return errs;
}
