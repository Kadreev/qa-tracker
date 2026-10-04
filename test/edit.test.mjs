import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
import { applyChange, nextId, nextRunId } from '../src/edit.mjs';

function docs() {
  return {
    features: parseDocument(`# header comment
- id: notes-list
  name: Notes list
  area: Notes
  weight: 5
  target_level: L4
  current_level: L0
  dimensions: { functionality: unknown, usability: unknown, code_health: unknown }
  issues: [ QA-1 ]
  reverify: false
`),
    issues: parseDocument(`- id: QA-1
  title: Broken
  severity: high
  type: functionality
  feature: notes-list
  status: open
`),
    runs: parseDocument(`# runs header
[]
`),
  };
}

test('weight change updates the feature and preserves the header comment', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'weight', feature: 'notes-list', value: 3 }).ok, true);
  const out = d.features.toString();
  assert.match(out, /weight: 3/);
  assert.match(out, /# header comment/);
});

test('reverify, target and dimension edits', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'reverify', feature: 'notes-list', value: true }).ok, true);
  assert.equal(applyChange(d, { kind: 'target', feature: 'notes-list', value: 'L3' }).ok, true);
  assert.equal(applyChange(d, { kind: 'dimension', feature: 'notes-list', dim: 'usability', value: 'issues' }).ok, true);
  const out = d.features.toString();
  assert.match(out, /reverify: true/);
  assert.match(out, /target_level: L3/);
  assert.match(out, /dimensions: \{ functionality: unknown, usability: issues, code_health: unknown \}/);
});

test('issue-status change updates the issue', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'issue-status', issue: 'QA-1', value: 'fixed' }).ok, true);
  assert.match(d.issues.toString(), /status: fixed/);
});

test('unknown ids, bad values and unknown kinds are rejected without mutating', () => {
  const d = docs();
  const before = d.features.toString();
  for (const change of [
    { kind: 'weight', feature: 'ghost', value: 3 },
    { kind: 'weight', feature: 'notes-list', value: 9 },
    { kind: 'target', feature: 'notes-list', value: 'L7' },
    { kind: 'dimension', feature: 'notes-list', dim: 'speed', value: 'pass' },
    { kind: 'issue-status', issue: 'QA-1', value: 'nonsense' },
    { kind: 'bogus' },
  ]) assert.equal(applyChange(d, change).ok, false, JSON.stringify(change));
  assert.equal(d.features.toString(), before);
});

test('add-feature appends a block entry with flow-style lists and a weight-derived target', () => {
  const d = docs();
  const r = applyChange(d, { kind: 'add-feature', feature: { id: 'search', name: 'Search', area: 'Notes', weight: 3, routes: ['/search'] } });
  assert.equal(r.ok, true);
  const out = d.features.toString();
  assert.match(out, /- id: search\n {2}name: Search/);
  assert.match(out, /target_level: L3/);
  assert.match(out, /current_level: L0/);
  assert.match(out, /routes: \[ \/search \]/);
  assert.equal(applyChange(d, { kind: 'add-feature', feature: { id: 'search' } }).ok, false);
});

test('add-issue numbers the id, links it from its feature and requires a known feature', () => {
  const d = docs();
  const r = applyChange(d, { kind: 'add-issue', issue: { title: 'Sort broken', severity: 'low', feature: 'notes-list' } });
  assert.deepEqual([r.ok, r.id], [true, 'QA-2']);
  assert.match(d.features.toString(), /issues: \[ QA-1, QA-2 \]/);
  assert.equal(applyChange(d, { kind: 'add-issue', issue: { title: 'x', severity: 'low', feature: 'ghost' } }).ok, false);
  assert.equal(applyChange(d, { kind: 'add-issue', issue: { title: 'x', severity: 'urgent', feature: 'notes-list' } }).ok, false);
});

test('add-run turns `[]` into a block list, keeps the comment and applies its evidence', () => {
  const d = docs();
  const r = applyChange(d, {
    kind: 'add-run',
    run: { blast_radius: 'sandbox', level_changes: { 'notes-list': 'L0->L3' }, issues_verified: ['QA-1'] },
  }, { today: '2026-01-20' });
  assert.deepEqual([r.ok, r.id], [true, 'run-2026-01-20']);
  const runs = d.runs.toString();
  assert.match(runs, /# runs header/);
  assert.match(runs, /^- id: run-2026-01-20$/m);
  assert.match(runs, /features_touched: \[ notes-list \]/);
  const features = d.features.toString();
  assert.match(features, /current_level: L3/);
  assert.match(features, /last_validated: 2026-01-20 \(run-2026-01-20\)/);
  assert.match(d.issues.toString(), /status: verified-fixed/);
  // second run the same day gets a suffix
  assert.equal(applyChange(d, { kind: 'add-run', run: { blast_radius: 'read-only' } }, { today: '2026-01-20' }).id, 'run-2026-01-20-2');
});

test('add-run rejects unknown features and malformed level changes', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'add-run', run: { blast_radius: 'sandbox', level_changes: { ghost: 'L0->L1' } } }).ok, false);
  assert.equal(applyChange(d, { kind: 'add-run', run: { blast_radius: 'sandbox', level_changes: { 'notes-list': 'L9' } } }).ok, false);
  assert.equal(applyChange(d, { kind: 'add-run', run: { blast_radius: 'yolo' } }).ok, false);
});

test('id helpers', () => {
  const d = docs();
  assert.equal(nextId(d.issues, 'QA-'), 'QA-2');
  assert.equal(nextId(d.issues, 'GH-'), 'GH-1');
  assert.equal(nextRunId(d.runs, '2026-02-01'), 'run-2026-02-01');
});
