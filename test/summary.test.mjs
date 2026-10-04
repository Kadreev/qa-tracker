// summarize(): the numbers behind the dashboard cards and the STATUS.md Summary block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, SEVERITY_WEIGHT } from '../src/summary.mjs';

const feature = (id, extra = {}) => ({ id, name: `Feature ${id}`, area: 'X', weight: 3, target_level: 'L3', current_level: 'L0', ...extra });
const issue = (id, extra = {}) => ({ id, title: `Issue ${id}`, type: 'functionality', feature: 'a', status: 'open', ...extra });
const cats = [{ name: 'functional' }, { name: 'accessibility' }];

test('counts and percentages', () => {
  const s = summarize({
    features: [feature('a')],
    issues: [
      issue('QA-1', { severity: 'critical' }),
      issue('QA-2', { severity: 'low' }),
      issue('QA-3'),
      issue('QA-4', { severity: 'medium', status: 'fixed' }),
      issue('QA-5', { severity: 'high', status: 'verified-fixed' }),
      issue('QA-6', { severity: 'low', status: 'wont-fix' }),
    ],
  }, { categories: cats });
  assert.equal(s.issues.total, 6);
  assert.equal(s.issues.open, 3);
  assert.equal(s.issues.fixed, 1);
  assert.equal(s.issues.verified, 1);
  assert.equal(s.issues.wontFix, 1);
  assert.equal(s.issues.fixedPct, 40);
  assert.deepEqual(s.issues.openBySeverity, { critical: 1, high: 0, medium: 0, low: 1, unrated: 1 });
  assert.deepEqual(s.issues.bySeverityStatus.low, { open: 1, fixed: 0, verified: 0, wontFix: 1 });
  assert.deepEqual(s.issues.bySeverityStatus.high, { open: 0, fixed: 0, verified: 1, wontFix: 0 });
  assert.deepEqual(s.issues.bySeverityStatus.unrated, { open: 1, fixed: 0, verified: 0, wontFix: 0 });
});

test('weighted coverage', () => {
  const s = summarize({
    features: [
      feature('a', { weight: 4, current_level: 'L3', target_level: 'L4' }),
      feature('b', { weight: 2, current_level: 'L2', target_level: 'L2' }),
    ],
  }, { categories: cats });
  assert.deepEqual(s.coverage, { features: 2, atTarget: 1, weightedPct: 83 });
});

test('a target of L0 counts as fully covered', () => {
  const s = summarize({ features: [feature('a', { weight: 1, current_level: 'L0', target_level: 'L0' })] }, { categories: cats });
  assert.deepEqual(s.coverage, { features: 1, atTarget: 1, weightedPct: 100 });
});

test('hotspot prefers one critical over three lows', () => {
  const s = summarize({
    features: [feature('b'), feature('a')],
    issues: [
      issue('QA-1', { feature: 'b', severity: 'low' }),
      issue('QA-2', { feature: 'b', severity: 'low' }),
      issue('QA-3', { feature: 'b', severity: 'low' }),
      issue('QA-4', { feature: 'a', severity: 'critical', title: 'Data loss' }),
    ],
  }, { categories: cats });
  assert.equal(SEVERITY_WEIGHT.critical, 8);
  assert.deepEqual(s.byFeature.map(f => [f.feature, f.score]), [['a', 8], ['b', 3]]);
  assert.deepEqual(s.byFeature[1].open, { critical: 0, high: 0, medium: 0, low: 3, unrated: 0 });
  assert.deepEqual(s.hotspot, { feature: 'a', name: 'Feature a', score: 8, worst: { id: 'QA-4', title: 'Data loss', severity: 'critical' } });
});

test('ties break by open count then file order', () => {
  const s = summarize({
    features: [feature('c'), feature('a'), feature('b'), feature('d')],
    issues: [
      issue('QA-1', { feature: 'b', severity: 'medium' }),
      issue('QA-2', { feature: 'a', severity: 'low' }),
      issue('QA-3', { feature: 'a', severity: 'low' }),
      issue('QA-4', { feature: 'd', severity: 'low' }),
      issue('QA-5', { feature: 'c', severity: 'low' }),
      issue('QA-6', { feature: 'd', status: 'fixed', severity: 'critical' }),
    ],
  }, { categories: cats });
  // a and b both score 2: a has more open issues. c and d both score 1 with one open: file order.
  assert.deepEqual(s.byFeature.map(f => f.feature), ['a', 'b', 'c', 'd']);
  // The worst open issue ties on severity: file order.
  assert.equal(s.hotspot.worst.id, 'QA-2');
});

test('the worst issue of an all-unrated hotspot is reported as unrated', () => {
  const s = summarize({ features: [feature('a')], issues: [issue('QA-1')] }, { categories: cats });
  assert.deepEqual(s.hotspot.worst, { id: 'QA-1', title: 'Issue QA-1', severity: 'unrated' });
  assert.equal(s.hotspot.score, SEVERITY_WEIGHT.unrated);
});

test('quick wins and triage count', () => {
  const s = summarize({
    features: [feature('a', { current_level: 'L0', target_level: 'L2' }), feature('b', { current_level: 'L2', target_level: 'L2' })],
    issues: [
      issue('QA-1', { severity: 'low', category: 'functional', complexity: 3 }),
      issue('QA-2', { severity: 'low', category: 'functional', complexity: 4 }),
      issue('QA-3', { severity: 'low', category: 'functional', complexity: 1, status: 'fixed' }),
      issue('QA-4', { complexity: 2 }),
    ],
  }, { categories: cats });
  assert.equal(s.quickWins, 2);
  assert.equal(s.triage, 2); // QA-4 lacks severity and category
  assert.deepEqual(s.plan, [{ id: 'a', name: 'Feature a', reason: '2 level(s) below target L2' }]);
});

test('the plan keeps the first three entries', () => {
  const features = ['a', 'b', 'c', 'd'].map((id, n) => feature(id, { weight: 5 - n }));
  assert.deepEqual(summarize({ features }, { categories: cats }).plan.map(p => p.id), ['a', 'b', 'c']);
});

test('empty tracker', () => {
  const s = summarize({}, { categories: cats });
  assert.equal(s.issues.total, 0);
  assert.equal(s.issues.fixedPct, null);
  assert.deepEqual(s.coverage, { features: 0, atTarget: 0, weightedPct: null });
  assert.equal(s.hotspot, null);
  assert.deepEqual(s.byFeature, []);
  assert.equal(s.quickWins, 0);
  assert.equal(s.triage, 0);
  assert.deepEqual(s.plan, []);
});

test('only wont-fix issues leave fixedPct null', () => {
  const s = summarize({ features: [feature('a')], issues: [issue('QA-1', { status: 'wont-fix' })] }, { categories: cats });
  assert.equal(s.issues.fixedPct, null);
  assert.equal(s.hotspot, null);
});
