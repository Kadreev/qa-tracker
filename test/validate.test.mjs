import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateAll, isLogWarning } from '../src/validate.mjs';
import { assessmentIndex, judgmentOf, latestFor } from '../src/assessments.mjs';
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
    assessments: [],
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
  d.runs[0].level_changes = { 'notes-list': 'L0->L3' };
  d.features[0].current_level = 'L3';
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
  d.runs[0].blast_radius = 'sandbox';
  for (const lvl of LEVELS) {
    d.features[0].current_level = lvl;
    d.runs[0].level_changes = { 'notes-list': `L0->${lvl}` };
    assert.deepEqual(validate(d), []);
  }
});

test('current_level must be what the runs replay to (no run, no level bump)', () => {
  const d = goodData();
  d.features[0].current_level = 'L4';
  assert.match(validate(d).join(), /notes-list: current_level L4 is not backed by runs \(runs give L2\)/);
  const unrun = goodData();
  unrun.runs = [];
  unrun.issues[0].status = 'open';
  unrun.features[0].last_validated = undefined;
  assert.match(validate(unrun).join(), /current_level L2 is not backed by runs \(runs give L0\)/);
});

test('a level change must start where the previous runs left the feature', () => {
  const d = goodData();
  d.runs.push({
    id: 'run-2026-01-20', date: '2026-01-20', blast_radius: 'sandbox',
    level_changes: { 'notes-list': 'L0->L3' },
  });
  d.features[0].current_level = 'L3';
  assert.match(validate(d).join(), /run run-2026-01-20: notes-list change L0->L3 starts from L0, but earlier runs put it at L2/);
  d.runs[1].level_changes = { 'notes-list': 'L2->L3' };
  assert.deepEqual(validate(d), []);
});

test('verified-fixed needs a run that verified the issue', () => {
  const d = goodData();
  d.issues[0].status = 'verified-fixed';
  assert.match(validate(d).join(), /issue QA-2: status verified-fixed but no run lists it in issues_verified/);
  d.runs[0].issues_verified = ['QA-2'];
  assert.deepEqual(validate(d), []);
});

test('empty or scalar list entries are reported, not thrown', () => {
  const d = goodData();
  d.features.push(null);
  d.issues.push('QA-9');
  d.runs.push(42);
  const errs = validate(d).join('\n');
  assert.match(errs, /features.yaml entry 2 must be a mapping/);
  assert.match(errs, /issues.yaml entry 2 must be a mapping/);
  assert.match(errs, /runs.yaml entry 2 must be a mapping/);
});

// --- categories, complexity, triage provenance and assessments.yaml ---

const judged = (over = {}) => ({
  id: 'asm-2026-10-04', date: '2026-10-04', model: 'jev-1.13.0', rubric: 1,
  issues: {
    'QA-2': {
      category: { value: 'functional', confidence: 0.9, probabilities: { functional: 0.9, other: 0.1 } },
      complexity: { value: 3, top: 0.6, score: 3.1, confidence: 0.7, probabilities: { 3: 0.6 } },
      severity: { value: 'high', confidence: 0.9, probabilities: { high: 0.9, low: 0.1 } },
      applied: ['category'],
    },
  },
  ...over,
});

test('a 0.2.0-shaped tracker has no errors and no warnings', () => {
  assert.deepEqual(validateAll(goodData()), { errors: [], warnings: [] });
  const noAssessments = goodData();
  delete noAssessments.assessments;
  assert.deepEqual(validateAll(noAssessments), { errors: [], warnings: [] });
});

test('severity is optional but must be known when present', () => {
  const d = goodData();
  delete d.issues[0].severity;
  assert.deepEqual(validate(d), []);
  d.issues[0].severity = 'urgent';
  assert.match(validate(d).join(), /severity invalid/);
});

test('complexity must be an integer 1-10', () => {
  const d = goodData();
  for (const bad of [0, 11, 2.5, '3']) {
    d.issues[0].complexity = bad;
    assert.match(validate(d).join(), /complexity must be an integer 1-10/, `complexity ${JSON.stringify(bad)}`);
  }
  d.issues[0].complexity = 10;
  assert.deepEqual(validate(d), []);
});

test('details must be a string', () => {
  const d = goodData();
  d.issues[0].details = 'Tab moves focus but nothing is drawn.';
  assert.deepEqual(validate(d), []);
  d.issues[0].details = 42;
  assert.match(validate(d).join(), /details must be a string/);
});

test('category must be kebab-case and type must follow a listed category', () => {
  const d = goodData();
  d.issues[0].category = 'Bad Cat';
  assert.match(validate(d).join(), /category must be kebab-case/);
  d.issues[0].category = 'accessibility';
  d.issues[0].type = 'functionality';
  assert.match(validate(d).join(), /type must be usability/);
  d.issues[0].type = 'usability';
  assert.deepEqual(validate(d), []);
  d.issues[0].category = 'other';
  d.issues[0].type = 'code';
  assert.deepEqual(validate(d), []);
});

test('a category missing from the list is a warning, not an error', () => {
  const d = goodData();
  d.issues[0].category = 'checkout';
  const { errors, warnings } = validateAll(d);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ['issue QA-2: category checkout is not in the category list']);
  assert.equal(isLogWarning(warnings[0]), false);
});

test('categories come from opts.categories when given', () => {
  const d = goodData();
  d.issues[0].category = 'checkout';
  d.issues[0].type = 'usability';
  const categories = [{ name: 'checkout', type: 'usability', description: 'x' }, { name: 'other', type: null, description: 'y' }];
  assert.deepEqual(validateAll(d, { categories }), { errors: [], warnings: [] });
  d.issues[0].type = 'code';
  assert.match(validate(d, { categories }).join(), /type must be usability/);
});

test('triage entries are shape-checked', () => {
  const d = goodData();
  d.issues[0].triage = { severity: { source: 'ai' } };
  assert.match(validate(d).join(), /triage\.severity: source must be jev or set/);
  d.issues[0].triage = { category: { source: 'jev' } };
  assert.match(validate(d).join(), /triage\.category: source jev needs an assessment id/);
  d.issues[0].triage = { wat: { source: 'set' } };
  assert.match(validate(d).join(), /triage\.wat: unknown triage field/);
  d.issues[0].triage = 'jev';
  assert.match(validate(d).join(), /triage must be a mapping/);
  d.issues[0].triage = { severity: { source: 'set', seen: 7 } };
  assert.match(validate(d).join(), /triage\.severity: seen must be a string/);
  d.issues[0].triage = { severity: { source: 'set', seen: 'asm-2026-10-04' }, category: { source: 'set' } };
  assert.deepEqual(validate({ ...d, assessments: [judged()] }), []);
});

test('assessments.yaml shape errors', () => {
  const cases = [
    [judged({ id: 'asm-1' }), /id must look like asm-YYYY-MM-DD/],
    [judged({ model: '' }), /model is required/],
    [judged({ date: '04/10/2026' }), /date must be YYYY-MM-DD/],
    [judged({ rubric: 0 }), /rubric must be a positive integer/],
    [judged({ issues: [] }), /issues must be a mapping/],
    [judged({ issues: { 'QA-2': { category: { value: 'functional', confidence: 1.2 } } } }), /category\.confidence must be a number from 0 to 1/],
    [judged({ issues: { 'QA-2': { complexity: { value: 11, confidence: 0.5 } } } }), /complexity\.value must be an integer 1-10/],
    [judged({ issues: { 'QA-2': { severity: { value: 'urgent', confidence: 0.5 } } } }), /severity\.value invalid: urgent/],
    [judged({ issues: { 'QA-2': { applied: ['type'] } } }), /applied has unknown field type/],
  ];
  for (const [entry, re] of cases) {
    const d = goodData();
    d.assessments = [entry];
    assert.match(validate(d).join('\n'), re);
  }
  const dup = goodData();
  dup.assessments = [judged(), judged()];
  assert.match(validate(dup).join(), /duplicate assessment id: asm-2026-10-04/);
  const notList = goodData();
  notList.assessments = { id: 'x' };
  assert.match(validate(notList).join(), /assessments.yaml must be a YAML list/);
  const scalar = goodData();
  scalar.assessments = [null];
  assert.match(validate(scalar).join(), /assessments.yaml entry 1 must be a mapping/);
});

test('a well-formed assessment passes', () => {
  const d = goodData();
  d.assessments = [judged()];
  d.issues[0].triage = { category: { source: 'jev', assessment: 'asm-2026-10-04' } };
  d.issues[0].category = 'functional';
  assert.deepEqual(validateAll(d), { errors: [], warnings: [] });
});

test('log problems are warnings that never fail validation', () => {
  const ghost = goodData();
  ghost.assessments = [judged({ issues: { 'QA-404': { severity: { value: 'low', confidence: 0.9 } } } })];
  let r = validateAll(ghost);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['assessment asm-2026-10-04: issue QA-404 does not exist']);
  assert.ok(isLogWarning(r.warnings[0]));

  const missing = goodData();
  missing.issues[0].category = 'functional';
  missing.issues[0].triage = { category: { source: 'jev', assessment: 'asm-2099-01-01' } };
  r = validateAll(missing);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^issue QA-2: triage category: assessment asm-2099-01-01 does not exist/);
  assert.ok(isLogWarning(r.warnings[0]));

  const elsewhere = goodData();
  elsewhere.issues.push({ id: 'QA-3', title: 't', type: 'code', feature: 'notes-list', status: 'open' });
  elsewhere.assessments = [judged()];
  elsewhere.issues[1].triage = { severity: { source: 'jev', assessment: 'asm-2026-10-04' } };
  r = validateAll(elsewhere);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(), /issue QA-3: triage severity: assessment asm-2026-10-04 does not mention this issue/);

  const edited = goodData();
  edited.assessments = [judged()];
  edited.issues[0].category = 'data';
  edited.issues[0].triage = { category: { source: 'jev', assessment: 'asm-2026-10-04' } };
  r = validateAll(edited);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['issue QA-2: category data differs from what assessment asm-2026-10-04 said (functional); treated as set by hand']);
  assert.equal(isLogWarning(r.warnings[0]), false);
});

test('assessment helpers look up by file order and tolerate junk', () => {
  const log = [judged({ id: 'asm-2026-10-04' }), null, judged({ id: 'asm-2026-10-05' }), judged({ id: 'asm-2026-10-06', issues: { 'QA-9': {} } })];
  assert.equal(assessmentIndex(log, 'asm-2026-10-05'), 2);
  assert.equal(assessmentIndex(log, 'asm-1999-01-01'), -1);
  assert.equal(assessmentIndex(undefined, 'x'), -1);
  assert.equal(judgmentOf(log, 'asm-2026-10-04', 'QA-2', 'category').value, 'functional');
  assert.equal(judgmentOf(log, 'asm-2026-10-04', 'QA-9', 'category'), undefined);
  assert.equal(judgmentOf(log, 'asm-1999-01-01', 'QA-2', 'category'), undefined);
  assert.equal(latestFor(log, 'QA-2').entry.id, 'asm-2026-10-05');
  assert.equal(latestFor(log, 'QA-2').index, 2);
  assert.equal(latestFor(log, 'QA-9').index, 3);
  assert.equal(latestFor(log, 'QA-404'), null);
});
