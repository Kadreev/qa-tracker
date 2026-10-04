import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validate.mjs';
import { LEVELS } from '../src/schema.mjs';

function goodData() {
  return {
    features: [{
      id: 'notes-list', name: 'Notes list', area: 'Notes',
      routes: ['/notes'], weight: 5, target_level: 'L4', current_level: 'L2',
      dimensions: { functionality: 'issues', usability: 'pass', code_health: 'pass' },
      issues: ['QA-2'], reverify: false, last_validated: '2026-01-12 (run-2026-01-12)', notes: '',
    }],
    issues: [{
      id: 'QA-2', title: 'Deleting a pinned note leaves an empty card', severity: 'high',
      type: 'functionality', feature: 'notes-list', status: 'open', source: 'https://example.test/2',
    }],
    runs: [{
      id: 'run-2026-01-12', date: '2026-01-12', profiles: ['bug-hunter'], blast_radius: 'read-only',
      features_touched: ['notes-list'], level_changes: { 'notes-list': 'L0->L2' },
      issues_opened: ['QA-2'], issues_verified: [],
    }],
  };
}

test('valid data passes', () => {
  assert.deepEqual(validate(goodData()), []);
});

test('empty data passes', () => {
  assert.deepEqual(validate({}), []);
});

test('a top-level that is not a list is reported, not thrown', () => {
  assert.match(validate({ features: { id: 'x' } }).join(), /features.yaml must be a YAML list/);
});

test('duplicate ids fail', () => {
  const d = goodData();
  d.features.push({ ...d.features[0] });
  assert.ok(validate(d).some(e => e.includes('duplicate feature id: notes-list')));
});

test('bad enums and missing required fields fail', () => {
  const d = goodData();
  d.features[0].weight = 7;
  d.features[0].current_level = 'L9';
  d.features[0].dimensions.usability = 'meh';
  d.features[0].name = '';
  d.issues[0].severity = 'catastrophic';
  d.issues[0].status = 'maybe';
  d.issues[0].title = ' ';
  const errs = validate(d).join('\n');
  for (const needle of ['weight', 'current_level', 'dimensions.usability', 'name is required', 'severity', 'status', 'title is required'])
    assert.ok(errs.includes(needle), `expected "${needle}" in:\n${errs}`);
});

test('ids and dates must have their documented shape', () => {
  const d = goodData();
  d.features[0].id = 'Notes List';
  d.issues[0].feature = 'Notes List';
  d.runs[0].id = 'second-run';
  d.runs[0].date = '12/01/2026';
  d.features[0].last_validated = '';
  const errs = validate(d).join('\n');
  assert.match(errs, /id must be kebab-case/);
  assert.match(errs, /id must look like run-YYYY-MM-DD/);
  assert.match(errs, /date must be YYYY-MM-DD/);
});

test('unresolved references fail', () => {
  const d = goodData();
  d.issues[0].feature = 'ghost-feature';
  d.features[0].issues = ['QA-404'];
  d.features[0].last_validated = '2026-01-12 (run-2026-01-13; notes)';
  const errs = validate(d).join('\n');
  assert.match(errs, /ghost-feature/);
  assert.match(errs, /QA-404/);
  assert.match(errs, /unknown run run-2026-01-13/);
});

test('a read-only run cannot raise a level above L2', () => {
  const d = goodData();
  d.runs[0].level_changes = { 'notes-list': 'L2->L3' };
  assert.match(validate(d).join(), /read-only run cannot raise notes-list above L2/);
  d.runs[0].blast_radius = 'sandbox';
  assert.deepEqual(validate(d), []);
});

test('level changes must be well-formed', () => {
  const d = goodData();
  d.runs[0].level_changes = { 'notes-list': 'up two' };
  assert.match(validate(d).join(), /must look like "L0->L2"/);
});

test('current above target is allowed; every level is valid', () => {
  const d = goodData();
  d.features[0].target_level = 'L2';
  for (const lvl of LEVELS) {
    d.features[0].current_level = lvl;
    assert.deepEqual(validate(d), []);
  }
});
