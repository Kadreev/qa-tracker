// End-to-end: drive the CLI in a scratch project the way a person or agent would.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
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
