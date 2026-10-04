// The Jev request builder: the per-issue state and the three fixed questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, buildQuestions, buildRequest, RUBRIC_VERSION, DETAILS_MAX, MODEL } from '../src/jev-rubric.mjs';
import { resolveCategories } from '../src/categories.mjs';
import { COMPLEXITY_LEVELS } from '../src/schema.mjs';

const TRUNC = ' […truncated]';

function fixture(issueOver = {}) {
  const issue = {
    id: 'ISS-001',
    title: 'Cart total ignores the coupon',
    feature: 'checkout',
    severity: 'high',
    type: 'usability',
    category: 'accessibility',
    complexity: { value: 7 },
    triage: { source: 'jev' },
    status: 'open',
    source: 'https://example.test/ticket/42',
    ...issueOver,
  };
  const data = {
    features: [{ id: 'checkout', name: 'Checkout', area: 'Shop', routes: ['/cart', '/pay'] }],
    issues: [issue],
    runs: [],
    assessments: [],
    surfaces: [{
      file: 'shop.yaml',
      area: 'Shop',
      roots: [
        { id: 'cart', name: 'Cart', kind: 'view', route: '/cart', feature: 'checkout', ui: 'Cart page', expected: 'Shows the total', effect: 'read', issues: ['ISS-001'], children: [] },
        { id: 'pay', name: 'Pay', kind: 'view', route: '/pay', feature: 'checkout', ui: 'Pay page', expected: 'Takes payment', effect: 'external' },
      ],
    }],
  };
  return { issue, data };
}

test('constants', () => {
  assert.equal(RUBRIC_VERSION, 1);
  assert.equal(DETAILS_MAX, 4000);
  assert.equal(MODEL, 'jev-latest');
});

test('state never contains recorded labels', () => {
  const { issue, data } = fixture({ details: 'Applying the code leaves the total unchanged.' });
  const json = JSON.stringify(buildState(issue, data, { title: 'Demo Shop' }));
  for (const banned of ['high', 'usability', 'accessibility', '"complexity"', 'triage', 'open', issue.source])
    assert.ok(!json.includes(banned), `state leaked ${banned}`);
});

test('state includes linked surfaces only and omits empty fields', () => {
  const { issue, data } = fixture();
  const state = buildState(issue, data, { title: 'Demo Shop' });
  assert.equal(state.app, 'Demo Shop');
  assert.deepEqual(state.issue, { title: 'Cart total ignores the coupon' });
  assert.ok(!('details' in state.issue));
  assert.deepEqual(state.feature, { name: 'Checkout', area: 'Shop', routes: ['/cart', '/pay'] });
  assert.equal(state.surfaces.length, 1);
  assert.deepEqual(state.surfaces[0], { name: 'Cart', ui: 'Cart page', expected: 'Shows the total', effect: 'read' });
});

test('missing feature, routes and linked surfaces are omitted', () => {
  const { issue, data } = fixture({ id: 'ISS-002', feature: 'gone', details: '' });
  const state = buildState(issue, data, { title: 'Demo Shop' });
  assert.ok(!('feature' in state));
  assert.ok(!('surfaces' in state));
  assert.ok(!('details' in state.issue));
  data.features.push({ id: 'plain', name: 'Plain', area: 'Misc' });
  const plain = buildState({ ...issue, feature: 'plain' }, data, { title: 'Demo Shop' });
  assert.deepEqual(plain.feature, { name: 'Plain', area: 'Misc' });
});

test('long details are truncated', () => {
  const { issue, data } = fixture({ details: 'x'.repeat(5000) });
  const { details } = buildState(issue, data, { title: 'Demo Shop' }).issue;
  assert.equal(details.length, 4000 + TRUNC.length);
  assert.ok(details.endsWith(TRUNC));
  const exact = buildState({ ...issue, details: 'y'.repeat(4000) }, data, { title: 'T' }).issue.details;
  assert.equal(exact.length, 4000);
});

test('questions: types, fixed order, other last', () => {
  const q = buildQuestions(resolveCategories());
  assert.equal(q.category.type, 'choice');
  assert.equal(Object.keys(q.category.criteria).at(-1), 'other');
  assert.equal(q.category.criteria.other, 'None of the other categories fits.');
  assert.equal(Object.keys(q.category.criteria).length, 12);
  assert.equal(q.complexity.type, 'score');
  assert.equal(q.complexity.criteria.length, 10);
  assert.deepEqual(q.complexity.criteria, COMPLEXITY_LEVELS);
  assert.equal(q.severity.type, 'choice');
  assert.deepEqual(Object.keys(q.severity.criteria), ['critical', 'high', 'medium', 'low']);
  assert.equal(q.severity.criteria.low, 'cosmetic or a minor annoyance');
  assert.match(q.category.instructions, /`issue`/);
});

test('buildRequest assembles model, state and questions', () => {
  const { issue, data } = fixture();
  const categories = resolveCategories();
  const req = buildRequest(issue, data, { title: 'Demo Shop', categories });
  assert.deepEqual(Object.keys(req), ['model', 'state', 'questions']);
  assert.equal(req.model, 'jev-latest');
  assert.deepEqual(req.state, buildState(issue, data, { title: 'Demo Shop' }));
  assert.deepEqual(Object.keys(req.questions), ['category', 'complexity', 'severity']);
});
