// Applies one change to the tracker's YAML Documents in place, preserving comments
// and the existing formatting. Shared by the dashboard server and the CLI.
//
//   applyChange(docs, change, { today, categories }) -> { ok: true, touched: ['features', …], id? } | { ok: false, error }
//
// `docs` is { features, issues, runs, assessments } as yaml Documents. Validation
// of the whole dataset happens in the store after the change is applied; this
// module only checks what it needs to apply the change safely.
import { isSeq, isMap } from 'yaml';
import {
  LEVELS, DIMS, DIM_STATUS, ISSUE_STATUS, SEVERITIES, ISSUE_TYPES, BLAST_RADIUS,
  LEVEL_CHANGE, FEATURE_ID, TRIAGE_FIELDS, targetLevelForWeight,
} from './schema.mjs';
import { resolveCategories, categoryByName } from './categories.mjs';
import { latestFor } from './assessments.mjs';
import { planApply } from './triage-policy.mjs';

/** Kinds of change and the files each may touch. */
export const CHANGE_KINDS = [
  'weight', 'target', 'reverify', 'dimension', 'issue-status',
  'issue-category', 'issue-complexity', 'issue-severity', 'issue-details',
  'add-feature', 'add-issue', 'add-run', 'add-assessment',
];

/** Header written when an assessment creates assessments.yaml. */
const ASSESSMENTS_HEADER = ' Jev judgments, append-only. Written once per assess run; never edited.';

const fail = error => ({ ok: false, error });

/** The top-level list of a document, created (block style) when the file is empty or `[]`. */
function seqOf(doc) {
  if (!isSeq(doc.contents)) {
    const empty = doc.contents == null || doc.contents.value === null;
    if (!empty) throw new Error('top level must be a YAML list');
    doc.contents = doc.createNode([]);
  }
  doc.contents.flow = false;
  return doc.contents;
}

function findById(doc, id) {
  const seq = doc.contents;
  if (!isSeq(seq)) return null;
  for (const item of seq.items)
    if (isMap(item) && item.get('id') === id) return item;
  return null;
}

const ids = doc => (isSeq(doc.contents) ? doc.contents.items : [])
  .filter(isMap).map(i => i.get('id'));

/** Next free id with a prefix: QA-1, QA-2, … (looks at every id in the doc). */
export function nextId(doc, prefix = 'QA-') {
  let max = 0;
  for (const id of ids(doc)) {
    const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`).exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** <prefix><date>, or <prefix><date>-2, -3 … when that day already has one. */
function nextDatedId(doc, prefix, date) {
  const taken = new Set(ids(doc));
  let id = `${prefix}${date}`;
  for (let n = 2; taken.has(id); n++) id = `${prefix}${date}-${n}`;
  return id;
}

/** run-YYYY-MM-DD, or run-YYYY-MM-DD-2, -3 … when that day already has runs. */
export const nextRunId = (doc, date) => nextDatedId(doc, 'run-', date);

/** asm-YYYY-MM-DD, or asm-YYYY-MM-DD-2, -3 … when that day already has assessments. */
export const nextAssessmentId = (doc, date) => nextDatedId(doc, 'asm-', date);

/** Append `value` to the list at `key` of a map node unless it is already there. */
function pushUnique(map, key, value, doc) {
  const cur = map.get(key);
  if (isSeq(cur)) {
    if (!cur.items.some(n => (n?.value ?? n) === value)) cur.add(doc.createNode(value));
  } else {
    const list = Array.isArray(cur) ? cur : [];
    if (!list.includes(value)) map.set(key, doc.createNode([...list, value], { flow: true }));
  }
}

const featureOf = (docs, id) => findById(docs.features, id);

const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
const isAbsent = v => v === undefined || v === null;

/** The assessments log as plain JS (an empty list when the file is missing or empty). */
const assessmentsOf = docs => {
  const list = docs.assessments?.toJS();
  return Array.isArray(list) ? list : [];
};

/** Why a triage value is malformed, or null when it is fine. */
function triageError(field, value) {
  if (field === 'severity' && !SEVERITIES.includes(value)) return `severity must be one of ${SEVERITIES.join('|')}`;
  if (field === 'category' && !(typeof value === 'string' && FEATURE_ID.test(value))) return `category must be kebab-case, got ${value}`;
  if (field === 'complexity' && !(Number.isInteger(value) && value >= 1 && value <= 10)) return `complexity must be an integer 1-10, got ${value}`;
  return null;
}

/** The type a category implies: null for `other` and for categories outside the list. */
const impliedType = (categories, name) => categoryByName(categories, name)?.type ?? null;

/** Set a key on a map node; a new key goes before `triage` so provenance stays last. */
function setField(item, key, value, doc) {
  if (item.has(key)) {
    item.set(key, value);
    return;
  }
  const pair = doc.createPair(key, value);
  const at = item.items.findIndex(p => (p.key?.value ?? p.key) === 'triage');
  if (at < 0) item.items.push(pair);
  else item.items.splice(at, 0, pair);
}

/** Record where a triage value came from: `triage` is a block map of flow-map entries. */
function setProvenance(item, field, entry, doc) {
  let triage = item.get('triage');
  if (!isMap(triage)) {
    triage = doc.createNode({});
    item.set('triage', triage);
  }
  triage.flow = false;
  triage.set(field, doc.createNode(entry, { flow: true }));
}

export function applyChange(docs, change, {
  today = new Date().toISOString().slice(0, 10),
  categories = resolveCategories(),
} = {}) {
  const { kind } = change ?? {};
  try {
    switch (kind) {
      case 'weight': {
        const w = change.value;
        if (!Number.isInteger(w) || w < 1 || w > 5) return fail(`weight must be an integer 1-5, got ${w}`);
        const item = featureOf(docs, change.feature);
        if (!item) return fail(`unknown feature: ${change.feature}`);
        item.set('weight', w);
        return { ok: true, touched: ['features'] };
      }
      case 'target': {
        if (!LEVELS.includes(change.value)) return fail(`target must be one of ${LEVELS.join('|')}`);
        const item = featureOf(docs, change.feature);
        if (!item) return fail(`unknown feature: ${change.feature}`);
        item.set('target_level', change.value);
        return { ok: true, touched: ['features'] };
      }
      case 'reverify': {
        const item = featureOf(docs, change.feature);
        if (!item) return fail(`unknown feature: ${change.feature}`);
        item.set('reverify', Boolean(change.value));
        return { ok: true, touched: ['features'] };
      }
      case 'dimension': {
        if (!DIMS.includes(change.dim)) return fail(`dimension must be one of ${DIMS.join('|')}`);
        if (!DIM_STATUS.includes(change.value)) return fail(`${change.dim} must be one of ${DIM_STATUS.join('|')}`);
        const item = featureOf(docs, change.feature);
        if (!item) return fail(`unknown feature: ${change.feature}`);
        const dims = item.get('dimensions');
        if (isMap(dims)) dims.set(change.dim, change.value);
        else item.set('dimensions', docs.features.createNode({ ...Object.fromEntries(DIMS.map(d => [d, 'unknown'])), [change.dim]: change.value }, { flow: true }));
        return { ok: true, touched: ['features'] };
      }
      case 'issue-status': {
        if (!ISSUE_STATUS.includes(change.value)) return fail(`invalid status: ${change.value}`);
        const item = findById(docs.issues, change.issue);
        if (!item) return fail(`unknown issue: ${change.issue}`);
        // verified-fixed means a run re-checked it; only a run may say so.
        if (change.value === 'verified-fixed' && item.get('status') !== 'verified-fixed')
          return fail(`verified-fixed is recorded by a run: qa-tracker add-run --verified ${change.issue}`);
        item.set('status', change.value);
        return { ok: true, touched: ['issues'] };
      }
      case 'issue-category':
      case 'issue-complexity':
      case 'issue-severity':
        return setTriageField(docs, change, kind.slice('issue-'.length), categories);
      case 'issue-details': {
        if (typeof change.value !== 'string') return fail('details must be a string');
        const item = findById(docs.issues, change.issue);
        if (!item) return fail(`unknown issue: ${change.issue}`);
        setField(item, 'details', change.value, docs.issues);
        return { ok: true, touched: ['issues'] };
      }
      case 'add-feature': return addFeature(docs, change.feature ?? {});
      case 'add-issue': return addIssue(docs, change.issue ?? {}, categories);
      case 'add-run': return addRun(docs, change.run ?? {}, today);
      case 'add-assessment': return addAssessment(docs, change.assessment ?? {}, today, categories);
      default: return fail(`unknown change kind: ${kind}`);
    }
  } catch (err) {
    return fail(String(err?.message ?? err));
  }
}

function addFeature(docs, f) {
  if (!f.id) return fail('add-feature needs an id');
  if (findById(docs.features, f.id)) return fail(`feature already exists: ${f.id}`);
  const weight = f.weight ?? 3;
  const node = {
    id: f.id,
    name: f.name ?? f.id,
    area: f.area ?? 'General',
    ...(f.routes?.length ? { routes: f.routes } : {}),
    weight,
    target_level: f.target_level ?? targetLevelForWeight(weight),
    current_level: 'L0',
    dimensions: Object.fromEntries(DIMS.map(d => [d, 'unknown'])),
    issues: [],
    reverify: false,
    ...(f.notes ? { notes: f.notes } : {}),
  };
  const created = docs.features.createNode(node);
  for (const key of ['routes', 'dimensions', 'issues']) {
    const child = created.get(key);
    if (child) child.flow = true;
  }
  seqOf(docs.features).add(created);
  return { ok: true, touched: ['features'], id: f.id };
}

/**
 * A `set`-style edit of one triage field: sets the value (a listed category
 * other than `other` also sets `type`) and records { source: set, seen? },
 * even when the value is unchanged — that is how a value is confirmed.
 */
function setTriageField(docs, { issue: id, value }, field, categories) {
  const err = triageError(field, value);
  if (err) return fail(err);
  const item = findById(docs.issues, id);
  if (!item) return fail(`unknown issue: ${id}`);
  setField(item, field, value, docs.issues);
  const type = field === 'category' ? impliedType(categories, value) : null;
  if (type) setField(item, 'type', type, docs.issues);
  const seen = latestFor(assessmentsOf(docs), id)?.entry.id;
  setProvenance(item, field, { source: 'set', ...(typeof seen === 'string' ? { seen } : {}) }, docs.issues);
  return { ok: true, touched: ['issues'] };
}

function addIssue(docs, i, categories) {
  const id = i.id ?? nextId(docs.issues, 'QA-');
  if (findById(docs.issues, id)) return fail(`issue already exists: ${id}`);
  if (!i.title) return fail('add-issue needs a title');
  const given = TRIAGE_FIELDS.filter(field => !isAbsent(i[field]));
  for (const field of given) {
    const err = triageError(field, i[field]);
    if (err) return fail(err);
  }
  if (!isAbsent(i.details) && typeof i.details !== 'string') return fail('details must be a string');
  if (!ISSUE_TYPES.includes(i.type ?? 'functionality')) return fail(`type must be one of ${ISSUE_TYPES.join('|')}`);
  // A listed category decides the type; a given type is honoured only for `other` or no category.
  const implied = isAbsent(i.category) ? null : impliedType(categories, i.category);
  if (implied && !isAbsent(i.type) && i.type !== implied) return fail(`type ${i.type} does not match category ${i.category} (${implied})`);
  const feat = featureOf(docs, i.feature);
  if (!feat) return fail(`unknown feature: ${i.feature}`);
  const node = docs.issues.createNode({
    id,
    title: i.title,
    ...(isAbsent(i.details) ? {} : { details: i.details }),
    ...(isAbsent(i.severity) ? {} : { severity: i.severity }),
    ...(isAbsent(i.category) ? {} : { category: i.category }),
    type: implied ?? i.type ?? 'functionality',
    ...(isAbsent(i.complexity) ? {} : { complexity: i.complexity }),
    feature: i.feature,
    status: i.status ?? 'open',
    ...(i.source ? { source: i.source } : {}),
    ...(given.length ? { triage: Object.fromEntries(given.map(field => [field, { source: 'set' }])) } : {}),
  });
  for (const pair of node.get('triage')?.items ?? []) pair.value.flow = true;
  seqOf(docs.issues).add(node);
  // Link it from its feature so the matrix row shows it.
  pushUnique(feat, 'issues', id, docs.features);
  return { ok: true, touched: ['issues', 'features'], id };
}

function addRun(docs, r, today) {
  const date = r.date ?? today;
  const id = r.id ?? nextRunId(docs.runs, date);
  if (findById(docs.runs, id)) return fail(`run already exists: ${id}`);
  if (!BLAST_RADIUS.includes(r.blast_radius)) return fail(`blast_radius must be one of ${BLAST_RADIUS.join('|')}`);
  const levelChanges = r.level_changes ?? {};
  for (const [fid, change] of Object.entries(levelChanges)) {
    const feat = featureOf(docs, fid);
    if (!feat) return fail(`level change for unknown feature: ${fid}`);
    const m = LEVEL_CHANGE.exec(change);
    if (!m) return fail(`level change for ${fid} must look like L0->L2, got ${change}`);
    if (m[1] !== feat.get('current_level')) return fail(`level change ${fid}: ${change}, but ${fid} is at ${feat.get('current_level')}, not ${m[1]}`);
  }
  const touched = [...new Set([...(r.features_touched ?? []), ...Object.keys(levelChanges)])];
  const run = docs.runs.createNode({
    id,
    date,
    profiles: r.profiles ?? [],
    blast_radius: r.blast_radius,
    features_touched: touched,
    level_changes: levelChanges,
    issues_opened: r.issues_opened ?? [],
    issues_verified: r.issues_verified ?? [],
    ...(r.report ? { report: r.report } : {}),
  });
  for (const key of ['profiles', 'features_touched', 'level_changes', 'issues_opened', 'issues_verified'])
    run.get(key).flow = true;
  seqOf(docs.runs).add(run);

  // The run is the evidence; apply what it proves.
  // last_validated only moves forward: a backdated run keeps the newer stamp.
  const stamp = `${date} (${id})`;
  for (const fid of touched) {
    const feat = featureOf(docs, fid);
    const prev = String(feat?.get('last_validated') ?? '').slice(0, 10);
    if (feat && !(prev > String(date))) feat.set('last_validated', stamp);
  }
  for (const [fid, change] of Object.entries(levelChanges))
    featureOf(docs, fid).set('current_level', LEVEL_CHANGE.exec(change)[2]);
  for (const iid of r.issues_verified ?? []) {
    const issue = findById(docs.issues, iid);
    if (!issue) return fail(`unknown issue in issues_verified: ${iid}`);
    issue.set('status', 'verified-fixed');
  }
  return { ok: true, touched: ['runs', 'features', 'issues'], id };
}

/**
 * Append one assessment and apply what it may write (§3.2), against the
 * documents as they are now. Issues no longer in issues.yaml are dropped from
 * the entry. → { ok, id, touched, applied: { [issueId]: field[] }, dropped }
 */
function addAssessment(docs, a, today, categories) {
  if (!isMapping(a.issues)) return fail('add-assessment needs issues');
  const dropped = [], kept = [];
  for (const [iid, judgments] of Object.entries(a.issues)) {
    if (!isMapping(judgments)) return fail(`judgments for ${iid} must be a map`);
    (findById(docs.issues, iid) ? kept : dropped).push(iid);
  }
  if (!kept.length) return fail('no assessed issues exist');

  const date = a.date ?? today;
  const id = nextAssessmentId(docs.assessments, date);
  const entry = { id, date, model: a.model, rubric: a.rubric, issues: Object.fromEntries(kept.map(iid => [iid, { ...a.issues[iid] }])) };
  // Include the new entry so a jev entry naming it is judged against what it says.
  const assessments = [...assessmentsOf(docs), entry];
  const applied = {};
  for (const iid of kept) {
    const item = findById(docs.issues, iid);
    const plan = planApply(item.toJS(docs.issues), a.issues[iid], { assessmentId: id, assessments, categories });
    for (const [field, value] of Object.entries(plan.values)) setField(item, field, value, docs.issues);
    if (plan.type) setField(item, 'type', plan.type, docs.issues);
    for (const [field, provenance] of Object.entries(plan.triage)) setProvenance(item, field, provenance, docs.issues);
    entry.issues[iid].applied = plan.applied;
    applied[iid] = plan.applied;
  }

  const doc = docs.assessments;
  if (doc.contents == null || doc.contents.value === null) doc.commentBefore ??= ASSESSMENTS_HEADER;
  const node = doc.createNode(entry);
  // One line per judgment: every judgment map and `applied` list in flow style.
  for (const { value: issue } of node.get('issues').items)
    for (const { value } of issue.items) value.flow = true;
  seqOf(doc).add(node);
  return { ok: true, id, touched: ['assessments', 'issues'], applied, dropped };
}
