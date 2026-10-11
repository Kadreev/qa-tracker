import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderActivity, trackerActivity } from '../src/activity.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-activity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const surfacesDir = path.join(root, 'surfaces');
  mkdirSync(surfacesDir);
  const files = Object.fromEntries(['features', 'issues', 'runs'].map(name => {
    const file = path.join(root, `${name}.yaml`);
    writeFileSync(file, `${name}: []\n`);
    return [name, file];
  }));
  files.surfacesDir = surfacesDir;
  return { root, files, surfacesDir };
}

function setMtime(file, timestamp) {
  const date = new Date(timestamp);
  utimesSync(file, date, date);
}

test('trackerActivity uses data-file mtimes and includes individual surface files', t => {
  const { files, surfacesDir } = fixture(t);
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  writeFileSync(path.join(surfacesDir, 'workspace.yaml'), 'surfaces: []\n');
  for (const file of [files.features, files.issues, files.runs, path.join(surfacesDir, 'workspace.yaml')]) {
    setMtime(file, now - 120_000);
  }

  const activity = trackerActivity(files, now);
  assert.equal(activity.overall.status, 'fresh');
  assert.equal(activity.overall.lastUpdatedAt, new Date(now - 120_000).toISOString());
  assert.deepEqual(activity.sources.map(source => source.name), [
    'Features', 'Issues', 'Runs', 'Surface data: workspace.yaml',
  ]);
  assert.ok(activity.sources.every(source => source.status === 'fresh'));
});

test('trackerActivity marks old files stale and missing data files never updated', t => {
  const { files } = fixture(t);
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  setMtime(files.features, now - 600_001);
  rmSync(files.issues);
  rmSync(files.runs);

  const activity = trackerActivity(files, now, 600_000);
  assert.equal(activity.sources[0].status, 'stale');
  assert.equal(activity.sources[1].status, 'never');
  assert.equal(activity.sources[2].status, 'never');
  assert.equal(activity.overall.status, 'stale');
});

test('trackerActivity marks future times and invalid cutoffs unknown', t => {
  const { files } = fixture(t);
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  setMtime(files.features, now + 1_000);
  assert.equal(trackerActivity(files, now).sources[0].status, 'unknown');
  setMtime(files.features, now);
  assert.equal(trackerActivity(files, now, -1).sources[0].status, 'unknown');
  assert.equal(trackerActivity(files, Number.NaN).sources[0].status, 'unknown');
});

test('renderActivity escapes source text and distinguishes never from unknown', () => {
  const html = renderActivity({
    overall: { status: 'unknown', lastUpdatedAt: null, ageMs: null },
    sources: [
      { name: '<img src=x>', status: 'never', lastUpdatedAt: null, ageMs: null },
      { name: 'Bad "path"', status: 'unknown', lastUpdatedAt: null, ageMs: null },
      { name: 'Runs', status: 'fresh', lastUpdatedAt: '2026-10-11T12:00:00.000Z', ageMs: 30_000 },
    ],
  });
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /Never updated/);
  assert.match(html, /Update time unknown/);
  assert.match(html, /less than a minute ago/);
});
