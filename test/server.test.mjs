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
