// Triage policy: answer mapping, gates, provenance (writability), apply plans and the triage queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCategories } from '../src/categories.mjs';
import { pct } from '../src/format.mjs';
import {
  CATEGORY_MIN, COMPLEXITY_MIN_TOP, SEVERITY_MIN, COMPLEXITY_DISAGREE_LEVELS,
  mapAnswers, gatePasses, isWritable, planApply, triageQueue,
} from '../src/triage-policy.mjs';

const categories = resolveCategories();

const cat = (value, confidence) => ({ value, confidence, probabilities: { [value]: confidence } });
const cx = (value, top) => ({ value, top, score: value, confidence: top, probabilities: { [value]: top } });
const sev = (value, confidence) => ({ value, confidence, probabilities: { [value]: confidence } });
const asm = (id, issues) => ({ id, date: id.slice(4, 14), model: 'jev-1.13.0', rubric: 1, issues });

const answers = over => ({
  category: { type: 'choice', choice: 'accessibility', confidence: 0.91, probabilities: { accessibility: 0.91, other: 0.09 } },
  complexity: { type: 'score', score: 1.3, confidence: 0.74, probabilities: { 0: 0.1, 1: 0.45, 2: 0.45 }, legend: {} },
  severity: { type: 'choice', choice: 'medium', confidence: 0.81, probabilities: { critical: 0.02, high: 0.09, medium: 0.81, low: 0.08 } },
  ...over,
});

test('constants and pct', () => {
  assert.equal(CATEGORY_MIN, 0.70);
  assert.equal(COMPLEXITY_MIN_TOP, 0.50);
  assert.equal(SEVERITY_MIN, 0.85);
  assert.equal(COMPLEXITY_DISAGREE_LEVELS, 2);
  assert.equal(pct(0.91), '91%');
  assert.equal(pct(0.42), '42%');
  assert.equal(pct(1), '100%');
});

test('mapAnswers picks the argmax complexity, ties to the lower level', () => {
  const j = mapAnswers(answers(), categories);
  assert.deepEqual(j.complexity, {
    value: 2, top: 0.45, score: 2.3, confidence: 0.74, probabilities: { 1: 0.1, 2: 0.45, 3: 0.45 },
  });
  assert.deepEqual(Object.keys(j.complexity.probabilities), ['1', '2', '3']);
  assert.deepEqual(j.category, { value: 'accessibility', confidence: 0.91, probabilities: { accessibility: 0.91, other: 0.09 } });
  assert.deepEqual(j.severity, { value: 'medium', confidence: 0.81, probabilities: { critical: 0.02, high: 0.09, medium: 0.81, low: 0.08 } });
  assert.deepEqual(Object.keys(j), ['category', 'complexity', 'severity']);
});

test('mapAnswers rejects a wrong type or an unknown option', () => {
  assert.throws(() => mapAnswers(answers({ category: { type: 'score', score: 1, confidence: 0.9, probabilities: {} } }), categories), /^Error: category: /);
  assert.throws(() => mapAnswers(answers({ category: { type: 'choice', choice: 'checkout', confidence: 0.9, probabilities: {} } }), categories), /^Error: category: /);
  assert.throws(() => mapAnswers(answers({ severity: { type: 'choice', choice: 'urgent', confidence: 0.9, probabilities: {} } }), categories), /^Error: severity: /);
  assert.throws(() => mapAnswers(answers({ complexity: { type: 'choice', choice: '3', confidence: 0.9, probabilities: {} } }), categories), /^Error: complexity: /);
  assert.throws(() => mapAnswers(answers({ complexity: { type: 'score', score: 10, confidence: 0.9, probabilities: { 10: 1 } } }), categories), /^Error: complexity: /);
  assert.throws(() => mapAnswers(answers({ severity: undefined }), categories), /^Error: severity: /);
  assert.throws(() => mapAnswers(undefined, categories), /^Error: category: /);
});

test('gates sit exactly at their thresholds', () => {
  assert.equal(gatePasses('category', cat('accessibility', 0.70), categories), true);
  assert.equal(gatePasses('category', cat('accessibility', 0.69), categories), false);
  assert.equal(gatePasses('category', cat('other', 0.99), categories), false);
  assert.equal(gatePasses('category', cat('checkout', 0.99), categories), false);
  assert.equal(gatePasses('complexity', cx(3, 0.50), categories), true);
  assert.equal(gatePasses('complexity', cx(3, 0.49), categories), false);
  assert.equal(gatePasses('severity', sev('high', 0.85), categories), true);
  assert.equal(gatePasses('severity', sev('high', 0.84), categories), false);
  assert.equal(gatePasses('severity', undefined, categories), false);
});

test('writable: gaps and untouched Jev values only', () => {
  const assessments = [asm('asm-2026-10-01', { 'QA-1': { severity: sev('medium', 0.9) } })];
  const jev = { source: 'jev', assessment: 'asm-2026-10-01' };
  assert.equal(isWritable({ id: 'QA-1' }, 'severity', assessments), true);
  assert.equal(isWritable({ id: 'QA-1', severity: 'medium', triage: { severity: jev } }, 'severity', assessments), true);
  assert.equal(isWritable({ id: 'QA-1', severity: 'high', triage: { severity: jev } }, 'severity', assessments), false);
  assert.equal(isWritable({ id: 'QA-1', severity: 'medium', triage: { severity: { source: 'jev', assessment: 'asm-2026-09-01' } } }, 'severity', assessments), false);
  assert.equal(isWritable({ id: 'QA-1', severity: 'medium', triage: { severity: { source: 'set' } } }, 'severity', assessments), false);
  assert.equal(isWritable({ id: 'QA-1', severity: 'medium' }, 'severity', assessments), false);
});

test('planApply sets type from an applied category but never for other', () => {
  const opts = { assessmentId: 'asm-2026-10-04', assessments: [], categories };
  const judgments = { category: cat('accessibility', 0.91), complexity: cx(2, 0.71), severity: sev('medium', 0.81) };
  assert.deepEqual(planApply({ id: 'QA-1', type: 'code' }, judgments, opts), {
    values: { category: 'accessibility', complexity: 2 },
    type: 'usability',
    triage: {
      category: { source: 'jev', assessment: 'asm-2026-10-04' },
      complexity: { source: 'jev', assessment: 'asm-2026-10-04' },
    },
    applied: ['category', 'complexity'],
  });
  const explicitOther = planApply({ id: 'QA-2', type: 'code', category: 'other' }, judgments, opts);
  assert.equal('type' in explicitOther, false);
  assert.equal('category' in explicitOther.values, false);
  const jevOther = planApply({ id: 'QA-3', type: 'code' }, { category: cat('other', 0.99) }, opts);
  assert.deepEqual(jevOther, { values: {}, triage: {}, applied: [] });
});

test('planApply leaves explicit values and below-gate answers alone', () => {
  const opts = { assessmentId: 'asm-2026-10-04', assessments: [], categories };
  const plan = planApply(
    { id: 'QA-1', type: 'code', severity: 'low' },
    { severity: sev('medium', 0.95), complexity: cx(4, 0.3), category: cat('checkout', 0.99) },
    opts,
  );
  assert.deepEqual(plan, { values: {}, triage: {}, applied: [] });
  // A Jev value nobody touched is replaced by a later confident assessment.
  const assessments = [asm('asm-2026-10-01', { 'QA-1': { severity: sev('low', 0.9) } })];
  const replanned = planApply(
    { id: 'QA-1', type: 'code', severity: 'low', triage: { severity: { source: 'jev', assessment: 'asm-2026-10-01' } } },
    { severity: sev('high', 0.9) },
    { ...opts, assessments },
  );
  assert.deepEqual(replanned.values, { severity: 'high' });
  assert.deepEqual(replanned.applied, ['severity']);
});

test('queue: needs-triage reasons', () => {
  const issues = [
    { id: 'QA-1', status: 'open', type: 'code', severity: 'low', complexity: 2 },
    { id: 'QA-2', status: 'open', type: 'code', severity: 'low', complexity: 2 },
    { id: 'QA-3', status: 'open', type: 'code', severity: 'low', complexity: 2 },
    { id: 'QA-4', status: 'open', type: 'code', severity: 'low', complexity: 2, category: 'checkout' },
    { id: 'QA-5', status: 'open', type: 'code', severity: 'low', complexity: 2 },
  ];
  const assessments = [asm('asm-2026-10-04', {
    'QA-2': { category: cat('other', 0.95) },
    'QA-3': { category: cat('data', 0.42) },
    'QA-5': { category: cat('checkout', 0.95) },
  })];
  const queue = triageQueue({ issues, assessments }, categories);
  assert.deepEqual(queue, [
    { issue: 'QA-1', field: 'category', kind: 'needs-triage', current: null, suggested: null, confidence: null, reason: 'not assessed' },
    { issue: 'QA-2', field: 'category', kind: 'needs-triage', current: null, suggested: 'other', confidence: 0.95, reason: 'category other' },
    { issue: 'QA-3', field: 'category', kind: 'needs-triage', current: null, suggested: 'data', confidence: 0.42, reason: 'low confidence (42%)' },
    { issue: 'QA-4', field: 'category', kind: 'needs-triage', current: 'checkout', suggested: null, confidence: null, reason: 'category not in list' },
    { issue: 'QA-5', field: 'category', kind: 'needs-triage', current: null, suggested: 'checkout', confidence: 0.95, reason: 'category not in list' },
  ]);
  // The unlisted Jev answer is never applied.
  const plan = planApply(issues[4], assessments[0].issues['QA-5'], { assessmentId: 'asm-2026-10-05', assessments, categories });
  assert.deepEqual(plan.applied, []);
  // Severity and complexity gaps report the confidence their gate uses.
  const gaps = triageQueue({
    issues: [{ id: 'QA-9', status: 'open', type: 'code', category: 'data' }],
    assessments: [asm('asm-2026-10-04', { 'QA-9': { severity: sev('high', 0.6), complexity: cx(5, 0.31) } })],
  }, categories);
  assert.deepEqual(gaps.map(i => [i.field, i.suggested, i.confidence, i.reason]), [
    ['severity', 'high', 0.6, 'low confidence (60%)'],
    ['complexity', 5, 0.31, 'low confidence (31%)'],
  ]);
});

test('queue: a gap with an above-gate answer says not applied, never low confidence', () => {
  // A Jev-applied value deleted afterwards.
  const deleted = { id: 'QA-1', status: 'open', type: 'code', category: 'data', complexity: 2,
    triage: { severity: { source: 'jev', assessment: 'asm-2026-10-04' } } };
  const assessments = [asm('asm-2026-10-04', { 'QA-1': { severity: sev('high', 0.9) } })];
  assert.deepEqual(triageQueue({ issues: [deleted], assessments }, categories), [{
    issue: 'QA-1', field: 'severity', kind: 'needs-triage', current: null, suggested: 'high', confidence: 0.9, reason: 'not applied (re-run assess)',
  }]);
  // A category added to the list after the assessment named it.
  const gap = { id: 'QA-2', status: 'open', type: 'code', severity: 'low', complexity: 2 };
  const named = [asm('asm-2026-10-04', { 'QA-2': { category: cat('checkout', 0.95) } })];
  const widened = resolveCategories({ checkout: { type: 'functionality', description: 'Cart and payment fail.' } });
  assert.deepEqual(triageQueue({ issues: [gap], assessments: named }, widened), [{
    issue: 'QA-2', field: 'category', kind: 'needs-triage', current: null, suggested: 'checkout', confidence: 0.95, reason: 'not applied (re-run assess)',
  }]);
});

test('queue: disagrees and how set clears it', () => {
  const base = { id: 'QA-1', status: 'open', type: 'code', category: 'data', complexity: 2, severity: 'low' };
  const first = asm('asm-2026-10-01', { 'QA-1': { severity: sev('medium', 0.9) } });
  const queue = triageQueue({ issues: [base], assessments: [first] }, categories);
  assert.deepEqual(queue, [{
    issue: 'QA-1', field: 'severity', kind: 'disagrees', current: 'low', suggested: 'medium', confidence: 0.9, reason: 'Jev suggests medium (90%)',
  }]);
  const confirmed = { ...base, triage: { severity: { source: 'set', seen: 'asm-2026-10-01' } } };
  assert.deepEqual(triageQueue({ issues: [confirmed], assessments: [first] }, categories), []);
  const same = asm('asm-2026-10-02', { 'QA-1': { severity: sev('medium', 0.9) } });
  assert.deepEqual(triageQueue({ issues: [confirmed], assessments: [first, same] }, categories), []);
  const changed = asm('asm-2026-10-03', { 'QA-1': { severity: sev('high', 0.9) } });
  assert.deepEqual(triageQueue({ issues: [confirmed], assessments: [first, same, changed] }, categories).map(i => [i.kind, i.reason]), [
    ['disagrees', 'Jev suggests high (90%)'],
  ]);
  // Below the gate there is nothing to disagree with.
  const weak = asm('asm-2026-10-01', { 'QA-1': { severity: sev('medium', 0.84) } });
  assert.deepEqual(triageQueue({ issues: [base], assessments: [weak] }, categories), []);
  // A hand-edited Jev value is explicit with nothing seen.
  const edited = { ...base, triage: { severity: { source: 'jev', assessment: 'asm-2026-10-01' } } };
  assert.equal(triageQueue({ issues: [edited], assessments: [first] }, categories).length, 1);
  // An untouched Jev value is not explicit, so it never disagrees.
  const untouched = { ...base, severity: 'medium', triage: { severity: { source: 'jev', assessment: 'asm-2026-10-01' } } };
  assert.deepEqual(triageQueue({ issues: [untouched], assessments: [first, changed] }, categories), []);
});

test('queue: complexity off by one is not a disagreement', () => {
  const issue = { id: 'QA-1', status: 'open', type: 'code', category: 'data', severity: 'low', complexity: 3 };
  const at = value => [asm('asm-2026-10-04', { 'QA-1': { complexity: cx(value, 0.8) } })];
  assert.deepEqual(triageQueue({ issues: [issue], assessments: at(4) }, categories), []);
  assert.deepEqual(triageQueue({ issues: [issue], assessments: at(5) }, categories), [{
    issue: 'QA-1', field: 'complexity', kind: 'disagrees', current: 3, suggested: 5, confidence: 0.8, reason: 'Jev suggests 5 (80%)',
  }]);
});

test('queue: needs-triage wins and closed issues are skipped', () => {
  const issue = { id: 'QA-1', status: 'open', type: 'code', category: 'checkout', severity: 'low', complexity: 2 };
  const assessments = [asm('asm-2026-10-04', { 'QA-1': { category: cat('data', 0.95) } })];
  assert.deepEqual(triageQueue({ issues: [issue], assessments }, categories), [{
    issue: 'QA-1', field: 'category', kind: 'needs-triage', current: 'checkout', suggested: 'data', confidence: 0.95, reason: 'category not in list',
  }]);
  assert.deepEqual(triageQueue({ issues: [{ ...issue, status: 'fixed' }], assessments }, categories), []);
});

test('queue: file order, then severity, category, complexity', () => {
  const issues = [
    { id: 'QA-2', status: 'open', type: 'code' },
    { id: 'QA-1', status: 'open', type: 'code', category: 'data', complexity: 2 },
  ];
  const queue = triageQueue({ issues, assessments: undefined }, categories);
  assert.deepEqual(queue.map(i => `${i.issue} ${i.field}`), [
    'QA-2 severity', 'QA-2 category', 'QA-2 complexity', 'QA-1 severity',
  ]);
});
