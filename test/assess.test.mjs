// `qa-tracker assess` end to end in a scratch tracker, with a fake fetch that
// answers by issue title and a no-op sleep — nothing here touches the network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.mjs';
import { resolveCategories } from '../src/categories.mjs';
import { JevError } from '../src/jev-client.mjs';
import { selectIssues, runAssess, formatAssessLine } from '../src/assess.mjs';

const KEY = 'sk-secret-123';
const ENV = { TYPESAFE_API_KEY: KEY };
const categories = resolveCategories();

const scratch = [];
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

async function run(cwd, { env = ENV, fetch } = {}, ...argv) {
  let out = '', err = '';
  const code = await main(argv, { cwd, env, fetch, sleep: async () => {}, out: s => { out += s; }, err: s => { err += s; } });
  return { code, out, err };
}

const dataDir = cwd => path.join(cwd, 'qa-tracker');
const read = (cwd, f) => readFileSync(path.join(dataDir(cwd), f), 'utf8');
const has = (cwd, f) => existsSync(path.join(dataDir(cwd), f));

const ISSUES = `- id: QA-1
  title: Sort menu has no focus ring
  severity: low
  type: usability
  feature: notes
  status: open
- id: QA-2
  title: Export drops rows
  severity: high
  category: data
  complexity: 4
  type: functionality
  feature: notes
  status: open
  triage:
    severity: { source: set }
    category: { source: set }
    complexity: { source: set }
- id: QA-3
  title: Old crash on save
  severity: low
  type: code
  feature: notes
  status: fixed
- id: QA-4
  title: Huge paste freezes editor
  severity: medium
  type: functionality
  feature: notes
  status: open
`;

/** A scratch tracker with one feature and the given issues.yaml. */
async function tracker(issues = ISSUES) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-tracker-'));
  scratch.push(dir);
  const cwd = path.join(dir, 'acme');
  mkdirSync(cwd);
  await run(cwd, {}, 'init', '--title', 'Acme');
  await run(cwd, {}, 'add-feature', 'notes', '--name', 'Notes', '--area', 'Core');
  writeFileSync(path.join(dataDir(cwd), 'issues.yaml'), issues);
  return cwd;
}

/** API answers: `top` on `level`, the rest spread evenly over the other nine levels. */
function answers({ category, catConf, level, top, severity, sevConf }) {
  const levels = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), i === level - 1 ? top : (1 - top) / 9]));
  return {
    category: { type: 'choice', choice: category, confidence: catConf, probabilities: { [category]: catConf, other: 1 - catConf } },
    complexity: { type: 'score', score: level - 1, confidence: top, probabilities: levels, legend: {} },
    severity: { type: 'choice', choice: severity, confidence: sevConf, probabilities: { [severity]: sevConf } },
  };
}
const ok = a => ({ status: 200, body: { model: 'jev-1.13.0', answers: answers(a), usage: { input_tokens: 100, output_tokens: 7 } } });

const REPLIES = {
  'Sort menu has no focus ring': ok({ category: 'accessibility', catConf: 0.91, level: 2, top: 0.71, severity: 'medium', sevConf: 0.9 }),
  'Export drops rows': ok({ category: 'data', catConf: 0.95, level: 4, top: 0.8, severity: 'high', sevConf: 0.95 }),
  'Old crash on save': ok({ category: 'functional', catConf: 0.8, level: 3, top: 0.6, severity: 'low', sevConf: 0.9 }),
  'Huge paste freezes editor': ok({ category: 'performance', catConf: 0.88, level: 5, top: 0.3, severity: 'medium', sevConf: 0.6 }),
};

/** A fetch that replies by the issue title in the request; records each title asked. */
function fakeFetch(overrides = {}) {
  const calls = [];
  async function fetch(url, init) {
    const title = JSON.parse(init.body).state.issue.title;
    calls.push(title);
    const { status, body } = overrides[title] ?? REPLIES[title];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  fetch.calls = calls;
  return fetch;
}

test('assess applies confident judgments and logs the assessment', async () => {
  const cwd = await tracker();
  const fetch = fakeFetch();
  const r = await run(cwd, { fetch }, 'assess');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fetch.calls.sort(), ['Huge paste freezes editor', 'Sort menu has no focus ring']);

  const issues = read(cwd, 'issues.yaml');
  assert.match(issues, /category: accessibility/);
  assert.match(issues, /complexity: 2/);
  assert.match(issues, /source: jev/);
  const log = read(cwd, 'assessments.yaml');
  assert.equal(log.match(/^- id: asm-/gm).length, 1);
  assert.match(log, /model: jev-1\.13\.0/);
  assert.match(log, /rubric: 1/);
  assert.equal((await run(cwd, {}, 'validate')).code, 0);

  const lines = r.out.trim().split('\n');
  assert.equal(lines[0], 'QA-1  category accessibility 91% ✓applied · complexity 2 (71%) ✓applied · severity medium 90% (kept: low, set) ⚠disagrees');
  assert.equal(lines[1], 'QA-4  category performance 88% ✓applied · complexity 5 (30%) ⚠needs-triage · severity medium 60% (kept: medium, set)');
  assert.match(r.out, /^ok: recorded asm-\d{4}-\d{2}-\d{2}  \(STATUS\.md regenerated\)$/m);
  assert.equal(lines.at(-1), 'tokens: 200 in / 14 out');
});

test('default selection skips fully triaged issues; --refresh and ids widen it', async () => {
  const cwd = await tracker();
  const count = async (...argv) => {
    const fetch = fakeFetch();
    const r = await run(cwd, { fetch }, 'assess', ...argv);
    assert.equal(r.code, 0, r.err);
    return fetch.calls.length;
  };
  assert.equal(await count(), 2);                       // QA-1, QA-4 have gaps; QA-2 is triaged; QA-3 is closed
  assert.equal(await count(), 1);                       // only QA-4's complexity gap is left
  assert.equal(await count('--refresh'), 2);            // QA-1 now has jev values
  assert.equal(await count('QA-2', 'QA-3', 'QA-2'), 2); // ids: any status, deduplicated
  assert.equal(await count('--all'), 4);

  const fetch = fakeFetch();
  const unknown = await run(cwd, { fetch }, 'assess', 'QA-9');
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown issue: QA-9/);
  assert.equal(fetch.calls.length, 0);
});

test('nothing to assess exits 0 without a key or a request', async () => {
  const cwd = await tracker(ISSUES.split('- id: QA-3')[0].replace(/- id: QA-1[\s\S]*?(?=- id: QA-2)/, ''));
  const fetch = fakeFetch();
  const r = await run(cwd, { env: {}, fetch }, 'assess');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'nothing to assess');
  const dry = await run(cwd, { env: {}, fetch }, 'assess', '--dry-run');
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual(JSON.parse(dry.out), []);
  const json = JSON.parse((await run(cwd, { env: {}, fetch }, 'assess', '--json')).out);
  assert.deepEqual(json, { assessment: null, model: null, rubric: 1, issues: {}, failed: {}, usage: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(fetch.calls.length, 0);
  assert.equal(has(cwd, 'assessments.yaml'), false);
});

test('--dry-run needs no key and sends nothing', async () => {
  const cwd = await tracker();
  for (const env of [{}, ENV]) {
    const fetch = fakeFetch();
    const r = await run(cwd, { env, fetch }, 'assess', '--dry-run');
    assert.equal(r.code, 0, r.err);
    assert.equal(fetch.calls.length, 0);
    const bodies = JSON.parse(r.out); // one JSON document: an array, one request per selected issue
    assert.ok(Array.isArray(bodies));
    assert.equal(bodies[0].model, 'jev-latest');
    assert.match(r.out, /"model": "jev-latest"/);
    assert.deepEqual(bodies.map(b => b.state.issue.title), ['Sort menu has no focus ring', 'Huge paste freezes editor']);
    assert.ok(!r.out.includes('sk-'));
  }
  assert.equal(has(cwd, 'assessments.yaml'), false);
});

test('missing key fails before any request', async () => {
  const cwd = await tracker();
  const fetch = fakeFetch();
  const r = await run(cwd, { env: {}, fetch }, 'assess');
  assert.equal(r.code, 1);
  assert.match(r.err, /TYPESAFE_API_KEY/);
  assert.equal(r.err, 'error: TYPESAFE_API_KEY is not set; export it (or use --dry-run to see what would be sent)\n');
  assert.equal(fetch.calls.length, 0);
  assert.equal(has(cwd, 'assessments.yaml'), false);
});

test('a partial failure still commits the successes', async () => {
  const cwd = await tracker();
  const fetch = fakeFetch({ 'Huge paste freezes editor': { status: 422, body: { error: { message: 'state too large' } } } });
  const r = await run(cwd, { fetch }, 'assess', '--json');
  assert.equal(r.code, 1);
  const out = JSON.parse(r.out);
  assert.deepEqual(Object.keys(out), ['assessment', 'model', 'rubric', 'issues', 'failed', 'usage']);
  assert.match(out.assessment, /^asm-\d{4}-\d{2}-\d{2}$/);
  assert.equal(out.model, 'jev-1.13.0');
  assert.equal(out.rubric, 1);
  assert.deepEqual(Object.keys(out.issues), ['QA-1']);
  assert.deepEqual(out.issues['QA-1'], {
    category: { value: 'accessibility', confidence: 0.91, applied: true, queue: null },
    complexity: { value: 2, confidence: 0.71, applied: true, queue: null },
    severity: { value: 'medium', confidence: 0.9, applied: false, queue: 'disagrees' },
  });
  assert.deepEqual(Object.keys(out.failed), ['QA-4']);
  assert.match(out.failed['QA-4'], /state too large.*shorten/);
  assert.deepEqual(out.usage, { input_tokens: 100, output_tokens: 7 });
  assert.match(read(cwd, 'issues.yaml'), /category: accessibility/);
  assert.doesNotMatch(read(cwd, 'assessments.yaml'), /QA-4/);
});

test('401 stops the run and writes nothing', async () => {
  const cwd = await tracker();
  const before = read(cwd, 'issues.yaml');
  const rejected = { status: 401, body: { error: { message: 'bad key' } } };
  const fetch = fakeFetch(Object.fromEntries(Object.keys(REPLIES).map(t => [t, rejected])));
  const r = await run(cwd, { fetch }, 'assess');
  assert.equal(r.code, 1);
  assert.equal(r.err, 'error: TypeSafe rejected the API key (401)\n');
  assert.equal(has(cwd, 'assessments.yaml'), false);
  assert.equal(read(cwd, 'issues.yaml'), before);
});

test('--json output and the log never contain the key', async () => {
  for (const json of [['--json'], []]) {
    const cwd = await tracker();
    // The API echoing the key back in an error must not leak it either.
    const fetch = fakeFetch({ 'Huge paste freezes editor': { status: 422, body: { error: { message: `bad request for ${KEY}` } } } });
    const r = await run(cwd, { fetch }, 'assess', ...json);
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(KEY), r.out);
    assert.ok(!r.err.includes(KEY), r.err);
    assert.match(r.out, /QA-4/);
    for (const f of readdirSync(dataDir(cwd)).filter(f => f.endsWith('.yaml') || f.endsWith('.md')))
      assert.ok(!read(cwd, f).includes(KEY), f);
    assert.match(read(cwd, 'assessments.yaml'), /QA-1/);
  }
});

// --- the pure parts, used by add-issue's auto-assess too ---

const issue = (id, over) => ({ id, title: id, type: 'usability', feature: 'notes', status: 'open', ...over });

test('selectIssues: file order, unknown ids rejected', () => {
  const data = { issues: [issue('A'), issue('B', { severity: 'low', category: 'content', complexity: 1 }), issue('C', { status: 'fixed' })], assessments: [] };
  assert.deepEqual(selectIssues(data, { categories }).map(i => i.id), ['A']);
  assert.deepEqual(selectIssues(data, { ids: ['C', 'A'], categories }).map(i => i.id), ['A', 'C']);
  assert.deepEqual(selectIssues(data, { all: true, categories }).map(i => i.id), ['A', 'B', 'C']);
  assert.throws(() => selectIssues(data, { ids: ['Z'], categories }), /^Error: unknown issue: Z$/);
});

test('runAssess keeps at most 4 requests in flight and reports in file order', async () => {
  const issues = Array.from({ length: 10 }, (_, i) => issue(`QA-${i + 1}`));
  let inFlight = 0, most = 0;
  const reply = REPLIES['Export drops rows'].body;
  const ask = async body => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise(r => setTimeout(r, body.state.issue.title === 'QA-1' ? 20 : 1));
    inFlight--;
    if (body.state.issue.title === 'QA-3') throw new JevError('TypeSafe returned 500', { status: 500 });
    return reply;
  };
  const res = await runAssess({ data: { features: [], surfaces: [] }, issues, title: 'Acme', categories, ask });
  assert.equal(most, 4);
  assert.equal(res.model, 'jev-1.13.0');
  assert.deepEqual(Object.keys(res.judgments), ['QA-1', 'QA-2', 'QA-4', 'QA-5', 'QA-6', 'QA-7', 'QA-8', 'QA-9', 'QA-10']);
  assert.deepEqual(res.failed, { 'QA-3': 'TypeSafe returned 500' });
  assert.deepEqual(res.usage, { input_tokens: 900, output_tokens: 63 });
  assert.equal(res.judgments['QA-1'].complexity.value, 4);

  const fatal = async () => { throw new JevError('TypeSafe rejected the API key (401)', { status: 401, fatal: true }); };
  await assert.rejects(runAssess({ data: {}, issues, title: 'Acme', categories, ask: fatal }), /401/);
});

test('formatAssessLine: kept values name their source; empty fields show only the queue', () => {
  const judgments = {
    category: { value: 'content', confidence: 0.42 },
    complexity: { value: 3, top: 0.66, confidence: 0.5 },
    severity: { value: 'high', confidence: 0.86 },
  };
  const current = issue('QA-7', { complexity: 3, severity: 'low', triage: { complexity: { source: 'jev', assessment: 'asm-2026-10-01' } } });
  const queue = [{ issue: 'QA-7', field: 'category', kind: 'needs-triage' }, { issue: 'QA-8', field: 'severity', kind: 'disagrees' }];
  assert.equal(formatAssessLine('QA-7', judgments, { issue: current, applied: ['severity'], queue }),
    'QA-7  category content 42% ⚠needs-triage · complexity 3 (66%) (kept: 3, jev) · severity high 86% ✓applied');
});
