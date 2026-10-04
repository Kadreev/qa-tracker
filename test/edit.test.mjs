import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { applyChange, nextId, nextRunId, nextAssessmentId } from '../src/edit.mjs';
import { resolveCategories } from '../src/categories.mjs';
import { main } from '../src/cli.mjs';
import { resolveConfig } from '../src/config.mjs';
import { createStore, YAML_OUT } from '../src/store.mjs';

const categories = resolveCategories();
const opts = { today: '2026-01-20', categories };

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
    assessments: parseDocument('[]\n'),
  };
}

/** Judgments as mapAnswers returns them: category and complexity pass their gates, severity does not. */
const judgments = () => ({
  category: { value: 'accessibility', confidence: 0.91, probabilities: { functional: 0.04, accessibility: 0.91, other: 0.05 } },
  complexity: { value: 2, top: 0.71, score: 1.3, confidence: 0.74, probabilities: { 1: 0.12, 2: 0.71, 3: 0.17 } },
  severity: { value: 'medium', confidence: 0.6, probabilities: { critical: 0.02, high: 0.09, medium: 0.81, low: 0.08 } },
});
const assess = (issues, date) => ({ kind: 'add-assessment', assessment: { model: 'jev-1.13.0', rubric: 1, ...(date ? { date } : {}), issues } });
const issueOf = (d, id) => d.issues.toJS().find(i => i.id === id);

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

test('add-run refuses a level change that does not start at the current level', () => {
  const d = docs();
  const r = applyChange(d, { kind: 'add-run', run: { blast_radius: 'sandbox', level_changes: { 'notes-list': 'L2->L3' } } });
  assert.equal(r.ok, false);
  assert.match(r.error, /notes-list is at L0, not L2/);
});

test('a backdated run does not overwrite a newer last_validated', () => {
  const d = docs();
  applyChange(d, { kind: 'add-run', run: { blast_radius: 'sandbox', features_touched: ['notes-list'], date: '2026-02-01' } });
  applyChange(d, { kind: 'add-run', run: { blast_radius: 'sandbox', features_touched: ['notes-list'], date: '2026-01-15' } });
  assert.match(d.features.toString(), /last_validated: 2026-02-01 \(run-2026-02-01\)/);
});

test('verified-fixed is set by a run, not by a status edit', () => {
  const d = docs();
  const r = applyChange(d, { kind: 'issue-status', issue: 'QA-1', value: 'verified-fixed' });
  assert.equal(r.ok, false);
  assert.match(r.error, /add-run --verified QA-1/);
  assert.equal(applyChange(d, { kind: 'issue-status', issue: 'QA-1', value: 'fixed' }).ok, true);
});

test('id helpers', () => {
  const d = docs();
  assert.equal(nextId(d.issues, 'QA-'), 'QA-2');
  assert.equal(nextId(d.issues, 'GH-'), 'GH-1');
  assert.equal(nextRunId(d.runs, '2026-02-01'), 'run-2026-02-01');
});

test('set-style triage edits record provenance and seen', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'issue-severity', issue: 'QA-1', value: 'high' }, opts).ok, true);
  let out = d.issues.toString();
  assert.match(out, /severity: high/);
  assert.match(out, /triage:\n {4}severity: \{ source: set \}/);
  assert.equal(applyChange(d, assess({ 'QA-1': judgments() }), opts).ok, true);
  assert.equal(applyChange(d, { kind: 'issue-severity', issue: 'QA-1', value: 'high' }, opts).ok, true);
  out = d.issues.toString();
  assert.match(out, /severity: \{ source: set, seen: asm-2026-01-20 \}/);
  assert.equal(applyChange(d, { kind: 'issue-complexity', issue: 'QA-1', value: 4 }, opts).ok, true);
  assert.deepEqual(issueOf(d, 'QA-1').triage.complexity, { source: 'set', seen: 'asm-2026-01-20' });
  for (const change of [
    { kind: 'issue-complexity', issue: 'QA-1', value: 11 },
    { kind: 'issue-complexity', issue: 'QA-1', value: 2.5 },
    { kind: 'issue-severity', issue: 'QA-1', value: 'urgent' },
    { kind: 'issue-category', issue: 'QA-1', value: 'Not Kebab' },
    { kind: 'issue-severity', issue: 'QA-9', value: 'low' },
    { kind: 'issue-details', issue: 'QA-1', value: 42 },
  ]) assert.equal(applyChange(d, change, opts).ok, false, JSON.stringify(change));
});

test('issue-category sets type; other leaves it', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'issue-category', issue: 'QA-1', value: 'accessibility' }, opts).ok, true);
  assert.deepEqual([issueOf(d, 'QA-1').category, issueOf(d, 'QA-1').type], ['accessibility', 'usability']);
  const e = docs();
  assert.equal(applyChange(e, { kind: 'issue-category', issue: 'QA-1', value: 'other' }, opts).ok, true);
  assert.deepEqual([issueOf(e, 'QA-1').category, issueOf(e, 'QA-1').type], ['other', 'functionality']);
  assert.deepEqual(issueOf(e, 'QA-1').triage, { category: { source: 'set' } });
});

test('issue-details sets details without provenance', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'issue-details', issue: 'QA-1', value: 'Tab skips the menu.' }, opts).ok, true);
  assert.equal(issueOf(d, 'QA-1').details, 'Tab skips the menu.');
  assert.equal(issueOf(d, 'QA-1').triage, undefined);
});

test('issue-details with an empty string removes the field', () => {
  const d = docs();
  assert.equal(applyChange(d, { kind: 'issue-details', issue: 'QA-1', value: 'Tab skips the menu.' }, opts).ok, true);
  assert.equal(applyChange(d, { kind: 'issue-details', issue: 'QA-1', value: '' }, opts).ok, true);
  assert.equal('details' in issueOf(d, 'QA-1'), false);
  assert.doesNotMatch(String(d.issues), /details/);
  // clearing a field that was never set is not an error
  assert.equal(applyChange(d, { kind: 'issue-details', issue: 'QA-1', value: '' }, opts).ok, true);
});

test('add-assessment appends an entry, applies gated values and records applied', () => {
  const d = docs();
  const r = applyChange(d, assess({ 'QA-1': judgments() }), opts);
  assert.deepEqual(r, { ok: true, id: 'asm-2026-01-20', touched: ['assessments', 'issues'], applied: { 'QA-1': ['category', 'complexity'] }, dropped: [] });
  const issue = issueOf(d, 'QA-1');
  assert.equal(issue.category, 'accessibility');
  assert.equal(issue.type, 'usability');
  assert.equal(issue.complexity, 2);
  assert.equal(issue.severity, 'high');
  assert.deepEqual(issue.triage, {
    category: { source: 'jev', assessment: 'asm-2026-01-20' },
    complexity: { source: 'jev', assessment: 'asm-2026-01-20' },
  });
  assert.match(d.issues.toString(), /triage:\n {4}category: \{ source: jev, assessment: asm-2026-01-20 \}\n {4}complexity: \{ source: jev, assessment: asm-2026-01-20 \}/);
  const [entry] = d.assessments.toJS();
  assert.deepEqual(Object.keys(entry), ['id', 'date', 'model', 'rubric', 'issues']);
  assert.deepEqual([entry.id, entry.date, entry.model, entry.rubric], ['asm-2026-01-20', '2026-01-20', 'jev-1.13.0', 1]);
  assert.deepEqual(entry.issues['QA-1'].applied, ['category', 'complexity']);
  assert.equal(entry.issues['QA-1'].severity.value, 'medium');
  const out = d.assessments.toString(YAML_OUT);
  assert.match(out, /^- id: asm-2026-01-20$/m);
  assert.match(out, /^ {4}QA-1:\n {6}category: \{ value: accessibility, confidence: 0\.91, probabilities: \{ functional: 0\.04, accessibility: 0\.91, other: 0\.05 \} \}$/m);
  assert.match(out, /complexity: \{ value: 2, top: 0\.71, score: 1\.3, confidence: 0\.74, probabilities: \{ "1": 0\.12, "2": 0\.71, "3": 0\.17 \} \}/);
  assert.match(out, /^ {6}applied: \[ category, complexity \]$/m);
});

test('applying keeps the issues.yaml diff minimal', () => {
  const d = docs();
  const header = '# Issues found by QA runs. Hand edits welcome.\n';
  const qa2 = `- id: QA-2
  title: "Export fails: CSV is empty"
  severity: low # agreed in triage
  type: code
  feature: notes-list
  status: fixed
  source: { run: run-2026-01-02 }
`;
  d.issues = parseDocument(`${header}- id: QA-1
  title: Broken
  severity: high
  type: functionality
  feature: notes-list
  status: open
${qa2}`);
  const before = d.issues.toString(YAML_OUT);
  assert.ok(before.startsWith(header) && before.endsWith(qa2), 'fixture is in the form the tools write');
  assert.equal(applyChange(d, assess({ 'QA-1': judgments() }), opts).ok, true);
  const out = d.issues.toString(YAML_OUT);
  assert.ok(out.startsWith(header), out);
  assert.ok(out.endsWith(qa2), out);
  assert.match(out, /category: accessibility/);
});

test('an issue deleted before commit is dropped, the rest applies', () => {
  const d = docs();
  const r = applyChange(d, assess({ 'QA-1': judgments(), 'QA-9': judgments() }), opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dropped, ['QA-9']);
  assert.deepEqual(r.applied, { 'QA-1': ['category', 'complexity'] });
  assert.deepEqual(Object.keys(d.assessments.toJS()[0].issues), ['QA-1']);
  const e = docs();
  const none = applyChange(e, assess({ 'QA-9': judgments() }), opts);
  assert.deepEqual(none, { ok: false, error: 'no assessed issues exist' });
  assert.equal(e.assessments.toString(), '[]\n');
});

test('second assessment the same day gets -2', () => {
  const d = docs();
  assert.equal(applyChange(d, assess({ 'QA-1': judgments() }), opts).id, 'asm-2026-01-20');
  const second = applyChange(d, assess({ 'QA-1': judgments() }), opts);
  assert.equal(second.id, 'asm-2026-01-20-2');
  // The first assessment's values are still Jev's and unchanged, so the second may rewrite them.
  assert.deepEqual(second.applied, { 'QA-1': ['category', 'complexity'] });
  assert.equal(issueOf(d, 'QA-1').triage.category.assessment, 'asm-2026-01-20-2');
  assert.equal(nextAssessmentId(d.assessments, '2026-01-21'), 'asm-2026-01-21');
  assert.equal(applyChange(d, assess({ 'QA-1': judgments() }, '2026-02-01'), opts).id, 'asm-2026-02-01');
});

test('add-issue with category, complexity and no severity', () => {
  const d = docs();
  const r = applyChange(d, { kind: 'add-issue', issue: { title: 'No focus ring', feature: 'notes-list', details: 'Tab moves focus but no outline.', category: 'accessibility', complexity: 2 } }, opts);
  assert.deepEqual([r.ok, r.id], [true, 'QA-2']);
  const issue = issueOf(d, 'QA-2');
  assert.equal(issue.severity, undefined);
  assert.equal(issue.type, 'usability');
  assert.equal(issue.details, 'Tab moves focus but no outline.');
  assert.deepEqual(issue.triage, { category: { source: 'set' }, complexity: { source: 'set' } });
  const bad = applyChange(d, { kind: 'add-issue', issue: { title: 'x', feature: 'notes-list', category: 'accessibility', type: 'code' } }, opts);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not match/);
  assert.equal(bad.error, 'type code does not match category accessibility (usability)');
  // With category other (or none), the given type is honoured.
  const other = applyChange(d, { kind: 'add-issue', issue: { title: 'y', feature: 'notes-list', category: 'other', type: 'code', severity: 'low' } }, opts);
  assert.equal(other.ok, true);
  assert.equal(issueOf(d, other.id).type, 'code');
  assert.deepEqual(issueOf(d, other.id).triage, { severity: { source: 'set' }, category: { source: 'set' } });
  assert.equal(applyChange(d, { kind: 'add-issue', issue: { title: 'z', feature: 'notes-list', complexity: 0 } }, opts).ok, false);
});

test('store: assessments.yaml is created by add-assessment only', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-tracker-edit-'));
  try {
    const quiet = { env: {}, out: () => {}, err: () => {} };
    await main(['init'], { ...quiet, cwd: dir });
    await main(['add-feature', 'a', '--name', 'A', '--area', 'X'], { ...quiet, cwd: dir });
    const store = createStore(resolveConfig({ cwd: dir, env: {} }));
    const file = store.config.files.assessments;
    assert.equal(store.commit({ kind: 'add-issue', issue: { title: 'T', feature: 'a', severity: 'low' } }).ok, true);
    assert.equal(store.commit({ kind: 'issue-category', issue: 'QA-1', value: 'accessibility' }).ok, true);
    assert.equal(existsSync(file), false);
    assert.deepEqual(store.data().assessments, []);
    const r = store.commit(assess({ 'QA-1': judgments(), 'QA-7': judgments() }), { today: '2026-01-20' });
    assert.deepEqual([r.ok, r.id, r.applied, r.dropped], [true, 'asm-2026-01-20', { 'QA-1': ['complexity'] }, ['QA-7']]);
    assert.match(readFileSync(file, 'utf8'), /^# Jev judgments, append-only/);
    assert.equal(store.data().assessments.length, 1);
    assert.equal(store.data().issues[0].complexity, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
