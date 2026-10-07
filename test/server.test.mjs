// The dashboard server: serves the page, applies same-origin JSON edits, and
// refuses anything a hostile web page could send through the user's browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { main } from '../src/cli.mjs';
import { resolveConfig } from '../src/config.mjs';
import { createStore } from '../src/store.mjs';
import { createServer } from '../src/server.mjs';

let dir, server, port;
const quiet = { env: {}, out: () => {}, err: () => {} };

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'qa-tracker-srv-'));
  await main(['init', '--title', 'Srv'], { ...quiet, cwd: dir });
  await main(['add-feature', 'a', '--name', 'A', '--area', 'X'], { ...quiet, cwd: dir });
  await main(['add-issue', '--feature', 'a', '--title', 'Unrated'], { ...quiet, cwd: dir });
  server = createServer(createStore(resolveConfig({ cwd: dir, env: {} })));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

function request(method, pathname, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { host: `localhost:${port}`, ...headers } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const edit = (change, headers = {}) => request('POST', '/api/edit', {
  body: JSON.stringify(change),
  headers: { 'content-type': 'application/json', ...headers },
});

test('serves the dashboard and the JSON data', async () => {
  const page = await request('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>Srv<\/title>/);
  assert.match(page.body, /data-feature="a"/);
  const data = JSON.parse((await request('GET', '/api/data')).body);
  assert.equal(data.features[0].id, 'a');
});

test('a same-origin JSON edit is validated and saved', async () => {
  const ok = await edit({ kind: 'weight', feature: 'a', value: 5 }, { origin: `http://localhost:${port}` });
  assert.equal(ok.status, 200, ok.body);
  assert.match(readFileSync(path.join(dir, 'qa-tracker', 'features.yaml'), 'utf8'), /weight: 5/);
  const bad = await edit({ kind: 'weight', feature: 'a', value: 50 });
  assert.equal(bad.status, 400);
});

test('refuses cross-origin, non-JSON, foreign-Host and non-dashboard edits', async () => {
  assert.equal((await edit({ kind: 'weight', feature: 'a', value: 1 }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await edit({ kind: 'weight', feature: 'a', value: 1 }, { origin: 'null' })).status, 403);
  assert.equal((await edit({ kind: 'weight', feature: 'a', value: 1 }, { origin: `http://localhost:${port + 1}` })).status, 403);
  assert.equal((await request('POST', '/api/edit', { body: '{"kind":"weight","feature":"a","value":1}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('GET', '/', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await edit({ kind: 'add-feature', feature: { id: 'b' } })).status, 400);
  assert.doesNotMatch(readFileSync(path.join(dir, 'qa-tracker', 'features.yaml'), 'utf8'), /weight: 1\b/);
});

test('a malformed edit body is a 400, not a 500', async () => {
  for (const body of ['{not json', 'null', '[1,2]', '"weight"']) {
    const r = await request('POST', '/api/edit', { body, headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400, body);
    assert.equal(JSON.parse(r.body).ok, false);
  }
});

test('unknown paths are 404', async () => {
  assert.equal((await request('GET', '/nope')).status, 404);
});

test('the dashboard can set category, complexity and severity', async () => {
  const origin = `http://localhost:${port}`;
  for (const change of [
    { kind: 'issue-category', issue: 'QA-1', value: 'accessibility' },
    { kind: 'issue-complexity', issue: 'QA-1', value: 4 },
    { kind: 'issue-severity', issue: 'QA-1', value: 'high' },
  ]) {
    const r = await edit(change, { origin });
    assert.equal(r.status, 200, r.body);
  }
  const yaml = readFileSync(path.join(dir, 'qa-tracker', 'issues.yaml'), 'utf8');
  assert.match(yaml, /category: accessibility/);
  assert.match(yaml, /complexity: 4/);
  assert.match(yaml, /severity: high/);
  assert.equal((yaml.match(/source: set/g) ?? []).length, 3);
  assert.equal((await edit({ kind: 'issue-severity', issue: 'QA-1', value: 'urgent' }, { origin })).status, 400);
});

test('the page shows triage columns and the queue', async () => {
  const { body } = await request('GET', '/');
  assert.match(body, /data-act="icomplexity"/);
  assert.match(body, /data-act="icategory"/);
  assert.match(body, /data-act="iseverity"/);
  assert.match(body, /Triage queue/);
  assert.match(body, />Category<\/span><span class="tiptext" role="tooltip" id="tip-cat-open">/);
  assert.match(body, />Cx<\/span><span class="tiptext" role="tooltip" id="tip-cx-open">/);
});

test('the page has summary cards and header tooltips', async () => {
  const { body } = await request('GET', '/');
  assert.match(body, /class="cards"/);
  assert.match(body, /Hotspot/);
  assert.match(body, /role="tooltip"/);
  assert.match(body, /aria-describedby="tip-W"/);
  const legendClasses = [...body.matchAll(/class="([^"]*)"/g)].map(m => m[1].split(/\s+/)).flat().filter(c => /legend/.test(c));
  assert.ok(legendClasses.length > 0);
  assert.deepEqual([...new Set(legendClasses)], ['legend-print']);
  const ids = [...body.matchAll(/ id="(tip-[^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'tooltip ids are unique');
  for (const m of body.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(ids.includes(m[1]), m[1]);
});

test('no route triggers an assessment', async () => {
  assert.equal((await edit({ kind: 'add-assessment', assessment: { issues: {} } })).status, 400);
  const realFetch = globalThis.fetch;
  const hadKey = Object.hasOwn(process.env, 'TYPESAFE_API_KEY');
  const priorKey = process.env.TYPESAFE_API_KEY;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('the dashboard server must not make outbound requests'); };
  process.env.TYPESAFE_API_KEY = 'test-key-not-real';
  const guarded = createServer(createStore(resolveConfig({ cwd: dir, env: { TYPESAFE_API_KEY: 'test-key-not-real' } })));
  await new Promise(r => guarded.listen(0, '127.0.0.1', r));
  try {
    const gport = guarded.address().port;
    const send = (method, pathname, body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: gport, method, path: pathname, headers: { host: `localhost:${gport}`, 'content-type': 'application/json' } }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
    assert.equal((await send('GET', '/')).status, 200);
    const r = await send('POST', '/api/edit', JSON.stringify({ kind: 'issue-complexity', issue: 'QA-1', value: 5 }));
    assert.equal(r.status, 200, r.body);
    assert.equal(calls, 0);
  } finally {
    guarded.close();
    globalThis.fetch = realFetch;
    if (hadKey) process.env.TYPESAFE_API_KEY = priorKey; else delete process.env.TYPESAFE_API_KEY;
  }
});

test('the page carries the data version and /api/version changes after any write', async () => {
  const page = await request('GET', '/');
  const rendered = /data-version="([^"]*)"/.exec(page.body)[1];
  const before = JSON.parse((await request('GET', '/api/version')).body).version;
  assert.ok(before);
  assert.equal(rendered.replace(/&amp;/g, '&'), before);
  await new Promise(r => setTimeout(r, 20)); // a distinct mtime on coarse filesystems
  await main(['add-issue', '--feature', 'a', '--title', 'Written by the CLI'], { ...quiet, cwd: dir });
  const after = JSON.parse((await request('GET', '/api/version')).body).version;
  assert.notEqual(after, before);
});
