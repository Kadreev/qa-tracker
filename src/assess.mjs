// `qa-tracker assess`: ask Jev about issues, commit what it says, report it.
//
// selectIssues picks the issues, runAssess sends one request per issue (at most
// `concurrency` in flight) and maps the answers, assessAndCommit ties both to one
// add-assessment commit. The formatters are pure and shared with add-issue's
// auto-assess. The API key is only ever handed to askJev; nothing here prints,
// stores or puts it in an error.
import { askJev, JevError } from './jev-client.mjs';
import { buildRequest, RUBRIC_VERSION } from './jev-rubric.mjs';
import { mapAnswers, triageQueue } from './triage-policy.mjs';
import { TRIAGE_FIELDS } from './schema.mjs';
import { pct } from './format.mjs';

/** Requests in flight at once. */
export const CONCURRENCY = 4;
/** Fields in the order the assess output shows them. */
const SHOWN_FIELDS = ['category', 'complexity', 'severity'];

const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
const usedJev = issue => TRIAGE_FIELDS.some(f => issue.triage?.[f]?.source === 'jev');

/**
 * selectIssues(data, { ids, all, refresh, categories }) → issues in file order, deduplicated.
 * `ids` → those issues, any status (throws `unknown issue: X`); `all` → every issue;
 * otherwise open issues with a `needs-triage` item, plus, with `refresh`, open
 * issues holding a value Jev set.
 */
export function selectIssues(data, { ids, all, refresh, categories }) {
  const seen = new Set();
  const issues = (Array.isArray(data.issues) ? data.issues : [])
    .filter(i => isMapping(i) && !seen.has(i.id) && seen.add(i.id));
  if (ids?.length) {
    const known = new Set(issues.map(i => i.id));
    const missing = ids.find(id => !known.has(id));
    if (missing !== undefined) throw new Error(`unknown issue: ${missing}`);
    const wanted = new Set(ids);
    return issues.filter(i => wanted.has(i.id));
  }
  if (all) return issues;
  const needs = new Set(triageQueue(data, categories).filter(q => q.kind === 'needs-triage').map(q => q.issue));
  return issues.filter(i => i.status === 'open' && (needs.has(i.id) || (refresh && usedJev(i))));
}

/** Run `task(item)` for every item with at most `limit` running; stops starting new ones after a rejection. */
async function pool(items, limit, task) {
  let next = 0, stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (err) {
        stopped = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * runAssess({ data, issues, title, categories, ask, concurrency }) →
 * { model, judgments: { [id]: judgments }, failed: { [id]: reason }, usage }.
 * `ask(body)` returns the API response. A failed request or an unusable answer
 * fails that issue only; a fatal error (JevError 401) rejects the whole run.
 * Keys follow `issues` order; `model` is the first answering response's; usage
 * is summed over every response received.
 */
export async function runAssess({ data, issues, title, categories, ask, concurrency = CONCURRENCY }) {
  const results = new Map();
  await pool(issues, concurrency, async issue => {
    let usage;
    try {
      const res = await ask(buildRequest(issue, data, { title, categories }));
      usage = res.usage;
      if (typeof res.model !== 'string' || !res.model) throw new Error('response names no model');
      results.set(issue.id, { usage, model: res.model, judgments: mapAnswers(res.answers, categories) });
    } catch (err) {
      if (err instanceof JevError && err.fatal) throw err;
      results.set(issue.id, { usage, error: String(err?.message ?? err) });
    }
  });

  const out = { model: null, judgments: {}, failed: {}, usage: { input_tokens: 0, output_tokens: 0 } };
  for (const { id } of issues) {
    const r = results.get(id);
    if (!r) continue;
    for (const k of ['input_tokens', 'output_tokens'])
      if (Number.isFinite(r.usage?.[k])) out.usage[k] += r.usage[k];
    if (r.error !== undefined) { out.failed[id] = r.error; continue; }
    out.model ??= r.model;
    out.judgments[id] = r.judgments;
  }
  return out;
}

/**
 * assessAndCommit({ store, ids, all, refresh, apiKey, fetch, sleep }) →
 * { id, model, judgments, applied, failed, usage, selected }.
 * Selects, asks Jev and commits one add-assessment entry for the successes.
 * `id` is null when nothing was committed; issues deleted before the commit are
 * moved to `failed` ('issue no longer exists'); `selected` lists the ids asked
 * about, in file order. Throws on a fatal JevError (401) and on a failed commit.
 * The caller checks that `apiKey` is set.
 */
export async function assessAndCommit({ store, ids, all, refresh, apiKey, fetch, sleep }) {
  const { title, categories } = store.config;
  const data = store.data();
  const issues = selectIssues(data, { ids, all, refresh, categories });
  const ask = body => askJev(body, { apiKey, fetch, sleep });
  const run = await runAssess({ data, issues, title, categories, ask });

  const result = { ...emptyAssessResult(), model: run.model, judgments: run.judgments, failed: run.failed, usage: run.usage, selected: issues.map(i => i.id) };
  if (!Object.keys(run.judgments).length) return result;
  const res = store.commit({ kind: 'add-assessment', assessment: { model: run.model, rubric: RUBRIC_VERSION, issues: run.judgments } });
  if (!res.ok) throw new Error(res.error);
  result.id = res.id;
  result.applied = res.applied;
  for (const gone of res.dropped) {
    delete result.judgments[gone];
    result.failed[gone] = 'issue no longer exists';
  }
  return result;
}

/** emptyAssessResult() → the assessAndCommit result of a run that asked about nothing. */
export function emptyAssessResult() {
  return { id: null, model: null, judgments: {}, applied: {}, failed: {}, usage: { input_tokens: 0, output_tokens: 0 }, selected: [] };
}

/** The number shown for a judgment: `top` for complexity, `confidence` otherwise. */
export const shownConfidence = (field, j) => (field === 'complexity' ? j.top : j.confidence);

/**
 * assessFields(judgments, { issue, applied, queue }) → { [field]: { value, confidence, applied, queue } }
 * for one issue (the §4.1 --json shape). `issue` is the issue after the commit,
 * `applied` the fields this assessment wrote, `queue` the triageQueue after the
 * commit; `queue` is null, 'needs-triage' or 'disagrees'.
 */
export function assessFields(judgments, { issue, applied = [], queue = [] }) {
  const out = {};
  for (const field of SHOWN_FIELDS) {
    const j = judgments[field];
    if (!isMapping(j)) continue;
    const item = queue.find(q => q.issue === issue.id && q.field === field);
    out[field] = { value: j.value, confidence: shownConfidence(field, j), applied: applied.includes(field), queue: item?.kind ?? null };
  }
  return out;
}

/**
 * formatAssessLine(issueId, judgments, { issue, applied, queue }) → one human line, e.g.
 * `QA-3  category accessibility 91% ✓applied · complexity 2 (71%) ✓applied · severity medium 81% (kept: low, set) ⚠disagrees`.
 * Arguments as for assessFields; a value not applied shows `(kept: <value>, <source>)`
 * when the issue has one (source `set` for a value with no triage entry).
 */
export function formatAssessLine(issueId, judgments, { issue, applied = [], queue = [] }) {
  const fields = assessFields(judgments, { issue: { ...issue, id: issueId }, applied, queue });
  const parts = Object.entries(fields).map(([field, f]) => {
    let s = field === 'complexity' ? `complexity ${f.value} (${pct(f.confidence)})` : `${field} ${f.value} ${pct(f.confidence)}`;
    if (f.applied) s += ' ✓applied';
    else if (issue[field] != null) s += ` (kept: ${issue[field]}, ${issue.triage?.[field]?.source ?? 'set'})`;
    if (f.queue) s += ` ⚠${f.queue}`;
    return s;
  });
  return `${issueId}  ${parts.join(' · ')}`;
}

/** Per-issue context for the formatters, from the data after the commit. */
function contextFor(result, data, categories) {
  const queue = triageQueue(data, categories);
  const byId = new Map((data.issues ?? []).filter(isMapping).map(i => [i.id, i]));
  return id => ({ issue: byId.get(id) ?? { id }, applied: result.applied[id] ?? [], queue });
}

/** Issue ids of a result in report order: selection (file) order, then any others. */
const reportOrder = result => [...new Set([...(result.selected ?? []), ...Object.keys(result.judgments), ...Object.keys(result.failed)])];

/**
 * assessJson(result, data, categories) → the §4.1 --json object
 * { assessment, model, rubric, issues, failed, usage }; `data` is the store's data after the commit.
 */
export function assessJson(result, data, categories) {
  const ctx = contextFor(result, data, categories);
  const issues = {}, failed = {};
  for (const id of reportOrder(result)) {
    if (result.judgments[id]) issues[id] = assessFields(result.judgments[id], ctx(id));
    else if (id in result.failed) failed[id] = result.failed[id];
  }
  return { assessment: result.id, model: result.model, rubric: RUBRIC_VERSION, issues, failed, usage: { ...result.usage } };
}

/**
 * formatAssessReport(result, data, categories) → human output lines: one per issue
 * (`<id>  failed: <reason>` for a failure), the commit, then `tokens: <in> in / <out> out`.
 */
export function formatAssessReport(result, data, categories) {
  const ctx = contextFor(result, data, categories);
  const lines = [];
  for (const id of reportOrder(result)) {
    if (result.judgments[id]) lines.push(formatAssessLine(id, result.judgments[id], ctx(id)));
    else if (id in result.failed) lines.push(`${id}  failed: ${result.failed[id]}`);
  }
  if (result.id) lines.push(`ok: recorded ${result.id}  (STATUS.md regenerated)`);
  lines.push(`tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
  return lines;
}

/** dryRunRequests(store, issues) → the exact request bodies, one per issue, in the order given. */
export function dryRunRequests(store, issues) {
  const data = store.data();
  const { title, categories } = store.config;
  return issues.map(issue => buildRequest(issue, data, { title, categories }));
}
