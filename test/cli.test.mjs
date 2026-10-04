// End-to-end: drive the CLI in a scratch project the way a person or agent would.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main, parseArgs } from '../src/cli.mjs';
import { resolveConfig } from '../src/config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function run(cwd, ...argv) {
  let out = '', err = '';
  const code = await main(argv, { cwd, env: {}, out: s => { out += s; }, err: s => { err += s; } });
  return { code, out, err };
}

const scratch = [];
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-tracker-'));
  scratch.push(dir);
  const cwd = path.join(dir, 'acme');
  mkdirSync(cwd);
  return cwd;
}

const read = (cwd, f) => readFileSync(path.join(cwd, 'qa-tracker', f), 'utf8');

test('parseArgs handles positionals, flags and both value forms', () => {
  const { pos, opt } = parseArgs(['get', 'x', '--json', '--dir', 'd', '--title=A b']);
  assert.deepEqual(pos, ['get', 'x']);
  assert.deepEqual(opt, { json: true, dir: 'd', title: 'A b' });
});

test('a boolean flag takes true/1/false/0 after =, anything else is an error', () => {
  assert.deepEqual(parseArgs(['--assess=true', '--json=1', '--force=TRUE']).opt, { assess: true, json: true, force: true });
  assert.deepEqual(parseArgs(['--assess=false', '--no-assess=0', '--json=False']).opt, { assess: false, 'no-assess': false, json: false });
  assert.throws(() => parseArgs(['--assess=yes']), /--assess takes no value \(or true\/false\)/);
  assert.throws(() => parseArgs(['--json=']), /--json takes no value/);
  // a value flag keeps its string
  assert.deepEqual(parseArgs(['--title=false']).opt, { title: 'false' });
});

test('a value flag without a value is an error, not `true`', async () => {
  assert.throws(() => parseArgs(['serve', '--port']), /--port needs a value/);
  assert.throws(() => parseArgs(['add-run', '--report', '--date', '2026-01-01']), /--report needs a value/);
  const r = await run(project(), 'serve', '--port');
  assert.equal(r.code, 1);
  assert.match(r.err, /--port needs a value/);
});

test('init --root is written to the config, relative to the data directory', async () => {
  const cwd = project();
  assert.equal((await run(cwd, 'init', '--root', '..')).code, 0);
  assert.equal(JSON.parse(read(cwd, 'qa-tracker.config.json')).root, '../..');
  assert.equal(resolveConfig({ cwd, env: {} }).root, path.dirname(cwd));
});

test('writes leave no temporary files behind', async () => {
  const cwd = project();
  await run(cwd, 'init');
  await run(cwd, 'add-feature', 'a', '--name', 'A', '--area', 'X');
  await run(cwd, 'add-issue', '--feature', 'a', '--severity', 'low', '--title', 't');
  assert.deepEqual(readdirSync(path.join(cwd, 'qa-tracker')).filter(f => f.includes('.tmp')), []);
  assert.match(read(cwd, 'features.yaml'), /issues: \[ QA-1 \]/);
});

test('resolveConfig: --dir beats $QA_TRACKER_DIR beats ./qa-tracker; root defaults to the parent', () => {
  const cwd = path.resolve('/work/app');
  assert.equal(resolveConfig({ cwd, env: {} }).dir, path.join(cwd, 'qa-tracker'));
  assert.equal(resolveConfig({ cwd, env: { QA_TRACKER_DIR: 'qa' } }).dir, path.join(cwd, 'qa'));
  assert.equal(resolveConfig({ cwd, env: { QA_TRACKER_DIR: 'qa' }, dir: 'x' }).dir, path.join(cwd, 'x'));
  assert.equal(resolveConfig({ cwd, env: {} }).root, cwd);
});

test('init scaffolds a valid, empty tracker and refuses to run twice', async () => {
  const cwd = project();
  const r = await run(cwd, 'init');
  assert.equal(r.code, 0, r.err);
  for (const f of ['features.yaml', 'issues.yaml', 'runs.yaml', 'AGENTS.md', 'STATUS.md', 'qa-tracker.config.json', 'surfaces/README.md'])
    assert.ok(existsSync(path.join(cwd, 'qa-tracker', f)), f);
  assert.equal(JSON.parse(read(cwd, 'qa-tracker.config.json')).title, 'acme — QA Tracker');
  assert.match(read(cwd, 'STATUS.md'), /^# acme — QA Tracker/);
  assert.equal((await run(cwd, 'validate')).code, 0);
  const again = await run(cwd, 'init');
  assert.equal(again.code, 1);
  assert.match(again.err, /already holds a tracker/);
});

test('the full agent loop: features, an issue, a run, a fix, a re-check', async () => {
  const cwd = project();
  await run(cwd, 'init', '--title', 'Acme');
  const ok = async (...a) => { const r = await run(cwd, ...a); assert.equal(r.code, 0, `${a.join(' ')}\n${r.err}`); return r; };

  await ok('add-feature', 'sign-in', '--name', 'Sign in', '--area', 'Auth', '--weight', '4', '--routes', '/login');
  await ok('add-feature', 'search', '--name', 'Search', '--area', 'Core');
  assert.match((await ok('add-issue', '--feature', 'sign-in', '--severity', 'high', '--title', 'Login dead on Safari')).out, /added issue QA-1/);

  // read-only evidence cannot certify CRUD
  const capped = await run(cwd, 'add-run', '--blast-radius', 'read-only', '--levels', 'sign-in=L3', '--date', '2026-01-10');
  assert.equal(capped.code, 1);
  assert.match(capped.err, /cannot raise sign-in above L2/);

  await ok('add-run', '--blast-radius', 'sandbox', '--levels', 'sign-in=L2,search=L1', '--opened', 'QA-1', '--date', '2026-01-10');
  assert.match(read(cwd, 'features.yaml'), /current_level: L2\n/);
  assert.match(read(cwd, 'runs.yaml'), /level_changes: \{ sign-in: L0->L2, search: L0->L1 \}/);

  // a level never moves without a run
  const direct = await run(cwd, 'set', 'sign-in', 'current_level', 'L4');
  assert.equal(direct.code, 1);
  assert.match(direct.err, /only moves through a recorded run/);

  await ok('set', 'QA-1', 'status', 'fixed');
  await ok('set', 'sign-in', 'reverify', 'true');
  await ok('set', 'sign-in', 'usability', 'issues');
  assert.match((await ok('plan')).out, /1\. Sign in \(sign-in, w4\) — 2 level\(s\) below target L4; re-verify fixed issue/);

  await ok('add-run', '--blast-radius', 'test-account', '--verified', 'QA-1', '--features', 'sign-in', '--date', '2026-01-10');
  assert.match(read(cwd, 'runs.yaml'), /id: run-2026-01-10-2/);
  assert.match(read(cwd, 'issues.yaml'), /status: verified-fixed/);
  assert.match(read(cwd, 'STATUS.md'), /0 open issues · 1 closed issues/);

  const got = JSON.parse((await ok('get', 'sign-in', '--json')).out);
  assert.equal(got.last_validated, '2026-01-10 (run-2026-01-10-2)');
  assert.equal((await ok('validate')).out.trim(), 'qa-tracker data valid');
});

test('writes that would break the dataset are refused and leave files untouched', async () => {
  const cwd = project();
  await run(cwd, 'init');
  await run(cwd, 'add-feature', 'a', '--name', 'A', '--area', 'X');
  const before = read(cwd, 'features.yaml');
  for (const argv of [
    ['set', 'a', 'weight', '9'],
    ['set', 'ghost', 'weight', '3'],
    ['set', 'a', 'colour', 'red'],
    ['set', 'a', 'reverify', 'yes'],
    ['add-issue', '--feature', 'ghost', '--severity', 'low', '--title', 't'],
    ['add-feature', 'Bad Id', '--name', 'n', '--area', 'a'],
  ]) {
    const r = await run(cwd, ...argv);
    assert.equal(r.code, 1, argv.join(' '));
  }
  assert.equal(read(cwd, 'features.yaml'), before);
});

test('surface verdicts: recorded with a run, rejected when the run cannot vouch for them', async () => {
  const cwd = project();
  await run(cwd, 'init');
  await run(cwd, 'add-feature', 'notes', '--name', 'Notes', '--area', 'Notes');
  await run(cwd, 'add-run', '--blast-radius', 'read-only', '--id', 'run-2026-01-12', '--date', '2026-01-12');
  writeFileSync(path.join(cwd, 'qa-tracker', 'surfaces', 'notes.yaml'), `area: Notes
surfaces:
  - id: notes.list
    feature: notes
    kind: view
    name: Notes list
    route: /notes
    ui: grid
    expected: loads
    effect: read
    coverage: none
    verdict: unchecked
    children:
      - id: notes.list.delete
        kind: action
        name: Delete
        ui: menu item
        expected: removes the card
        effect: mutate
        coverage: none
        verdict: unchecked
`);
  assert.equal((await run(cwd, 'verdict', 'notes.list', 'pass', '--run', 'run-2026-01-12')).code, 0);
  assert.match(read(cwd, 'surfaces/notes.yaml'), /verdict: pass\n {4}children/);
  assert.match(read(cwd, 'SURFACES.md'), /✅ \*\*Notes list\*\*/);
  const refused = await run(cwd, 'verdict', 'notes.list.delete', 'pass', '--run', 'run-2026-01-12');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /read-only and cannot pass an effect: mutate/);
  assert.equal((await run(cwd, 'verdict', 'notes.list.delete', 'blocked', '--run', 'run-2026-01-12')).code, 1); // needs --notes
  assert.equal((await run(cwd, 'verdict', 'notes.list.delete', 'blocked', '--run', 'run-2026-01-12', '--notes', 'no data')).code, 0);
  assert.equal(JSON.parse((await run(cwd, 'surfaces', '--json')).out).length, 2);

  // removing the last surfaces file removes the generated checklist too
  rmSync(path.join(cwd, 'qa-tracker', 'surfaces', 'notes.yaml'));
  assert.equal((await run(cwd, 'render')).code, 0);
  assert.equal(existsSync(path.join(cwd, 'qa-tracker', 'SURFACES.md')), false);
});

test('the bundled demo validates and its generated files are up to date', async () => {
  const demo = path.join(REPO, 'examples', 'demo');
  const r = await run(REPO, 'validate', '--dir', demo);
  assert.equal(r.code, 0, r.err);
  const status = readFileSync(path.join(demo, 'STATUS.md'), 'utf8');
  assert.equal((await run(REPO, 'status', '--dir', demo)).out, status, 'examples/demo/STATUS.md is stale: run npm run demo:render');
});

test('help, version and unknown commands', async () => {
  assert.match((await run(REPO, '--help')).out, /Usage: qa-tracker <command>/);
  assert.match((await run(REPO, '--version')).out, /^\d+\.\d+\.\d+/);
  assert.equal((await run(REPO, 'frobnicate')).code, 1);
});

// --- triage: set, add-issue, triage, get, validate ---

/** Like run(), with an environment, a fake fetch and a no-op sleep. */
async function runWith(cwd, { env = {}, fetch } = {}, ...argv) {
  let out = '', err = '';
  const code = await main(argv, { cwd, env, fetch, sleep: async () => {}, out: s => { out += s; }, err: s => { err += s; } });
  return { code, out, err };
}

/** A scratch tracker with one feature `a` and optional issues.yaml / assessments.yaml / config contents. */
async function triageProject({ issues, assessments, config } = {}) {
  const cwd = project();
  await run(cwd, 'init', '--title', 'Acme');
  await run(cwd, 'add-feature', 'a', '--name', 'A', '--area', 'X');
  const dir = path.join(cwd, 'qa-tracker');
  if (issues) writeFileSync(path.join(dir, 'issues.yaml'), issues);
  if (assessments) writeFileSync(path.join(dir, 'assessments.yaml'), assessments);
  if (config) writeFileSync(path.join(dir, 'qa-tracker.config.json'), JSON.stringify({ title: 'Acme', ...config }));
  return cwd;
}

const TRIAGED_LOW = `- id: QA-1
  title: Sort menu has no focus ring
  severity: low
  category: functional
  complexity: 3
  type: functionality
  feature: a
  status: open
  triage:
    category: { source: set }
    complexity: { source: set }
    severity: { source: set }
`;

const SAYS_MEDIUM = `- id: asm-2026-10-01
  date: 2026-10-01
  model: jev-1.13.0
  rubric: 1
  issues:
    QA-1:
      category: { value: functional, confidence: 0.9, probabilities: { functional: 0.9 } }
      complexity: { value: 3, top: 0.8, score: 3, confidence: 0.8, probabilities: { 3: 0.8 } }
      severity: { value: medium, confidence: 0.9, probabilities: { medium: 0.9, low: 0.1 } }
`;

/** A fake fetch answering every request with the same confident judgments; counts calls. */
function jevFetch() {
  const fetch = async () => {
    fetch.calls++;
    const levels = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), i === 2 ? 0.8 : 0.2 / 9]));
    return {
      ok: true, status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        usage: { input_tokens: 10, output_tokens: 2 },
        answers: {
          category: { type: 'choice', choice: 'accessibility', confidence: 0.91, probabilities: { accessibility: 0.91, other: 0.09 } },
          complexity: { type: 'score', score: 2, confidence: 0.8, probabilities: levels, legend: {} },
          severity: { type: 'choice', choice: 'medium', confidence: 0.9, probabilities: { medium: 0.9, low: 0.1 } },
        },
      }),
    };
  };
  fetch.calls = 0;
  return fetch;
}

test('set confirms a value and clears its disagreement', async () => {
  const cwd = await triageProject({ issues: TRIAGED_LOW, assessments: SAYS_MEDIUM });
  const queue = async () => JSON.parse((await run(cwd, 'triage', '--json')).out);
  const before = await queue();
  assert.equal(before.length, 1);
  assert.deepEqual(before[0], { issue: 'QA-1', field: 'severity', kind: 'disagrees', current: 'low', suggested: 'medium', confidence: 0.9, reason: 'Jev suggests medium (90%)' });
  assert.equal((await run(cwd, 'triage')).out, 'QA-1  severity  disagrees  low → medium (90%)  Jev suggests medium (90%)\n');

  const r = await run(cwd, 'set', 'QA-1', 'severity', 'low');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(await queue(), []);
  assert.equal((await run(cwd, 'triage')).out, 'Triage queue empty.\n');
  assert.match(read(cwd, 'issues.yaml'), /severity: \{ source: set, seen: asm-2026-10-01 \}/);
});

test('set takes category, complexity, severity and details on an issue', async () => {
  const cwd = await triageProject({ issues: TRIAGED_LOW });
  const ok = async (...a) => { const r = await run(cwd, ...a); assert.equal(r.code, 0, `${a.join(' ')}\n${r.err}`); };
  await ok('set', 'QA-1', 'category', 'accessibility');
  await ok('set', 'QA-1', 'complexity', '7');
  await ok('set', 'QA-1', 'severity', 'high');
  await ok('set', 'QA-1', 'details', 'Tab skips the sort menu on Safari');
  const got = JSON.parse((await run(cwd, 'get', 'QA-1', '--json')).out);
  assert.equal(got.category, 'accessibility');
  assert.equal(got.type, 'usability');
  assert.equal(got.complexity, 7);
  assert.equal(got.severity, 'high');
  assert.equal(got.details, 'Tab skips the sort menu on Safari');
  const bad = await run(cwd, 'set', 'QA-1', 'complexity', '2.5');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /complexity/);
  assert.equal((await run(cwd, 'set', 'QA-1', 'complexity', 'big')).code, 1);
});

test('add-issue without severity lands in the triage queue', async () => {
  const cwd = await triageProject();
  const r = await run(cwd, 'add-issue', '--feature', 'a', '--title', 'Login dead on Safari');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /added issue QA-1/);
  const t = await run(cwd, 'triage');
  assert.equal(t.code, 0, t.err);
  assert.match(t.out, /QA-1  severity  needs-triage/);
  assert.match(t.out, /not assessed/);
  assert.equal((await run(cwd, 'add-issue', '--feature', 'a')).code, 1);
  assert.equal((await run(cwd, 'add-issue', '--title', 'x')).code, 1);
});

test('add-issue takes details, category, complexity and severity as set values', async () => {
  const cwd = await triageProject();
  const r = await run(cwd, 'add-issue', '--feature', 'a', '--title', 'Menu focus', '--details', 'No ring', '--category', 'accessibility', '--complexity', '2', '--severity', 'low');
  assert.equal(r.code, 0, r.err);
  const got = JSON.parse((await run(cwd, 'get', 'QA-1', '--json')).out);
  assert.equal(got.details, 'No ring');
  assert.equal(got.category, 'accessibility');
  assert.equal(got.type, 'usability');
  assert.equal(got.complexity, 2);
  assert.deepEqual(got.triage, { category: { source: 'set' }, complexity: { source: 'set' }, severity: { source: 'set' } });
  const conflict = await run(cwd, 'add-issue', '--feature', 'a', '--title', 'x', '--category', 'accessibility', '--type', 'code');
  assert.equal(conflict.code, 1);
});

test('add-issue auto-assesses only when opted in', async () => {
  const add = (cwd, io, ...extra) => runWith(cwd, io, 'add-issue', '--feature', 'a', '--title', 'Sort menu has no focus ring', ...extra);
  const env = { TYPESAFE_API_KEY: 'sk-secret-123' };

  // config opt-in: Jev values land with provenance
  const on = await triageProject({ config: { jev: { auto_assess: true } } });
  const fetch = jevFetch();
  const r = await add(on, { env, fetch });
  assert.equal(r.code, 0, r.err);
  assert.equal(fetch.calls, 1);
  assert.match(r.out, /sending QA-1 to TypeSafe \(api\.typesafe\.ai\)…/);
  assert.match(r.out, /^QA-1  category accessibility 91% ✓applied/m);
  assert.ok(r.out.indexOf('sending QA-1') < r.out.indexOf('QA-1  category'));
  assert.match(read(on, 'issues.yaml'), /source: jev/);
  assert.ok(!(r.out + r.err).includes('sk-secret'));
  assert.equal((await run(on, 'validate')).code, 0);

  // no opt-in: nothing is sent
  const off = await triageProject();
  const quiet = jevFetch();
  assert.equal((await add(off, { env, fetch: quiet })).code, 0);
  assert.equal(quiet.calls, 0);

  // --assess opts in without config
  const flagged = jevFetch();
  assert.equal((await add(off, { env, fetch: flagged }, '--id', 'QA-7', '--assess')).code, 0);
  assert.equal(flagged.calls, 1);

  // --no-assess beats the config
  const veto = jevFetch();
  const vetoed = await add(on, { env, fetch: veto }, '--id', 'QA-8', '--no-assess');
  assert.equal(vetoed.code, 0, vetoed.err);
  assert.equal(veto.calls, 0);
  assert.doesNotMatch(vetoed.out, /sending/);

  // opted in, no key: a warning, exit 0, issue saved
  const keyless = await triageProject({ config: { jev: { auto_assess: true } } });
  const nokey = jevFetch();
  const w = await add(keyless, { env: {}, fetch: nokey });
  assert.equal(w.code, 0);
  assert.match(w.err, /^warning: .*TYPESAFE_API_KEY/m);
  assert.equal(nokey.calls, 0);
  assert.match(read(keyless, 'issues.yaml'), /id: QA-1/);
});

test('add-issue --assess=false and --no-assess=false mean what they say', async () => {
  const add = (cwd, io, ...extra) => runWith(cwd, io, 'add-issue', '--feature', 'a', '--title', 'Sort menu has no focus ring', ...extra);
  const env = { TYPESAFE_API_KEY: 'sk-secret-123' };

  // --assess=false is the same as no flag: with auto_assess off nothing is sent
  const off = await triageProject({ config: { jev: { auto_assess: false } } });
  const quiet = jevFetch();
  const r = await add(off, { env, fetch: quiet }, '--assess=false');
  assert.equal(r.code, 0, r.err);
  assert.equal(quiet.calls, 0);
  assert.doesNotMatch(r.out, /sending/);

  // --no-assess=false does not veto the config opt-in
  const on = await triageProject({ config: { jev: { auto_assess: true } } });
  const sent = jevFetch();
  assert.equal((await add(on, { env, fetch: sent }, '--no-assess=false')).code, 0);
  assert.equal(sent.calls, 1);

  // --assess=true opts in, --assess=maybe is a usage error that saves nothing
  const flagged = jevFetch();
  assert.equal((await add(off, { env, fetch: flagged }, '--id', 'QA-7', '--assess=true')).code, 0);
  assert.equal(flagged.calls, 1);
  const bad = jevFetch();
  const refused = await add(off, { env, fetch: bad }, '--id', 'QA-8', '--assess=maybe');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /--assess takes no value \(or true\/false\)/);
  assert.equal(bad.calls, 0);
  assert.doesNotMatch(read(off, 'issues.yaml'), /QA-8/);
});

test('a failing auto-assess warns and still saves the issue', async () => {
  const cwd = await triageProject({ config: { jev: { auto_assess: true } } });
  const fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { message: 'state too large' } }) });
  const r = await runWith(cwd, { env: { TYPESAFE_API_KEY: 'sk-secret-123' }, fetch }, 'add-issue', '--feature', 'a', '--title', 'Menu');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^warning: /m);
  assert.ok(!r.err.includes('sk-secret'));
  assert.match(read(cwd, 'issues.yaml'), /id: QA-1/);
});

test('validate prints warnings but passes', async () => {
  const cwd = await triageProject({ issues: `- id: QA-1
  title: Pay fails
  severity: low
  category: checkout
  type: functionality
  feature: a
  status: open
` });
  const r = await run(cwd, 'validate');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^warning: issue QA-1: category checkout is not in the category list$/m);
  assert.match(r.out, /qa-tracker data valid/);
  assert.equal(r.err, '');
});

test('validate still fails on errors, on stderr', async () => {
  const cwd = await triageProject({ issues: '- id: QA-1\n  title: x\n  severity: bogus\n  type: functionality\n  feature: a\n  status: open\n' });
  const r = await run(cwd, 'validate');
  assert.equal(r.code, 1);
  assert.match(r.err, /severity invalid: bogus/);
  assert.doesNotMatch(r.out, /data valid/);
});

test('get shows provenance and log warnings', async () => {
  const cwd = await triageProject({ issues: `- id: QA-1
  title: Pay fails
  severity: low
  category: functional
  type: functionality
  feature: a
  status: open
  triage:
    category: { source: jev, assessment: asm-2099-01-01 }
` });
  const r = await run(cwd, 'get', 'QA-1');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^triage: \{"category":\{"source":"jev","assessment":"asm-2099-01-01"\}\}$/m);
  assert.match(r.out, /^latest assessment: none$/m);
  assert.match(r.out, /^warning: .*asm-2099-01-01/m);
  const json = JSON.parse((await run(cwd, 'get', 'QA-1', '--json')).out);
  assert.equal(json.latest_assessment, null);
  assert.equal(json.warnings.length, 1);
  assert.match(json.warnings[0], /asm-2099-01-01/);
});

test('get lists the latest assessment and its judgments', async () => {
  const cwd = await triageProject({ issues: TRIAGED_LOW, assessments: SAYS_MEDIUM });
  const r = await run(cwd, 'get', 'QA-1');
  assert.match(r.out, /^latest assessment: asm-2026-10-01$/m);
  assert.match(r.out, /^  category: functional \(90%\)$/m);
  assert.match(r.out, /^  complexity: 3 \(80%\)$/m);
  assert.match(r.out, /^  severity: medium \(90%\)$/m);
  const json = JSON.parse((await run(cwd, 'get', 'QA-1', '--json')).out);
  assert.equal(json.latest_assessment.id, 'asm-2026-10-01');
  assert.equal(json.latest_assessment.judgments.severity.value, 'medium');
  assert.deepEqual(json.warnings, []);
  // features and runs are unchanged
  const feature = JSON.parse((await run(cwd, 'get', 'a', '--json')).out);
  assert.equal('warnings' in feature, false);
});

test('replacing the category list never blocks writes', async () => {
  const cwd = await triageProject({
    issues: '- id: QA-1\n  title: Menu\n  severity: low\n  category: accessibility\n  type: usability\n  feature: a\n  status: open\n',
    config: { categories: { visual: { type: 'usability', description: 'Looks wrong' } } },
  });
  const r = await run(cwd, 'set', 'QA-1', 'complexity', '3');
  assert.equal(r.code, 0, r.err);
  assert.equal((await run(cwd, 'validate')).code, 0);
});

test('help lists the triage commands and flags', async () => {
  const help = (await run(REPO, '--help')).out;
  for (const s of ['triage [--json]', 'category|complexity|severity|details', '--assess', '--no-assess', '--details']) assert.ok(help.includes(s), s);
});

test('status prints exactly STATUS.md, with issue warnings but not log warnings under the queue', async () => {
  const cwd = await triageProject({
    issues: `- id: QA-1
  title: Menu
  severity: low
  category: accessibility
  complexity: 2
  type: usability
  feature: a
  status: open
  triage:
    category: { source: jev, assessment: asm-2099-01-01 }
`,
    config: { categories: { visual: { type: 'usability', description: 'Looks wrong' } } },
  });
  assert.equal((await run(cwd, 'render')).code, 0);
  const file = read(cwd, 'STATUS.md');
  assert.equal((await run(cwd, 'status')).out, file);
  assert.match(file, /\*\*Warnings\*\*\n- issue QA-1: category accessibility is not in the category list\n/);
  assert.doesNotMatch(file, /asm-2099-01-01 does not exist/); // log warnings stay out
  assert.match(file, /\| QA-1 \| low \| accessibilityᴶ \| 2 \|/);
});
