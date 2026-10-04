// Surfaces: the vocabulary is documented, the validator rejects what the schema
// forbids, and the renderer makes never-checked functionality visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SURFACE_KINDS, SURFACE_EFFECTS, SURFACE_COVERAGE, SURFACE_VERDICTS,
  COVERAGE_MEANING, VERDICT_MEANING, SURFACE_FIELDS,
} from '../src/schema.mjs';
import { flattenSurfaces, validateSurfaces, renderSurfaces, surfaceStats } from '../src/surfaces.mjs';

const doc = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'SCHEMA.md'), 'utf8');

const refs = {
  featureIds: new Set(['notes-list']),
  issueIds: new Set(['QA-1']),
  runIds: new Set(['run-2026-01-20', 'run-2026-01-12']),
  runRadius: new Map([['run-2026-01-20', 'sandbox'], ['run-2026-01-12', 'read-only']]),
};
const exists = p => ['src/List.tsx', 'tests/list.spec.ts'].includes(p);
const base = () => [{
  file: 'notes.yaml', area: 'Notes', roots: [{
    id: 'notes.list', feature: 'notes-list', kind: 'view', name: 'Notes list',
    route: '/notes', component: 'src/List.tsx',
    ui: 'grid', expected: 'loads', effect: 'read', coverage: 'e2e',
    test_refs: ['tests/list.spec.ts'], verdict: 'unchecked',
    children: [{
      id: 'notes.list.new', kind: 'action', name: 'New note', ui: 'button', expected: 'opens editor',
      effect: 'mutate', coverage: 'none', verdict: 'unchecked',
    }],
  }],
}];

test('surface vocabulary is documented in SCHEMA.md', () => {
  for (const v of [...SURFACE_KINDS, ...SURFACE_EFFECTS, ...SURFACE_COVERAGE, ...SURFACE_VERDICTS])
    assert.ok(doc.includes('`' + v + '`'), `SCHEMA.md does not mention "${v}"`);
  for (const k of Object.keys(SURFACE_FIELDS)) assert.ok(doc.includes('`' + k + '`'), `SCHEMA.md does not mention field ${k}`);
  for (const v of SURFACE_COVERAGE) assert.ok(COVERAGE_MEANING[v]);
  for (const v of SURFACE_VERDICTS) assert.ok(VERDICT_MEANING[v]);
});

test('children inherit feature and route and get a depth', () => {
  const flat = flattenSurfaces(base());
  assert.equal(flat.length, 2);
  assert.deepEqual([flat[1].feature, flat[1].route, flat[1].depth, flat[1].parent], ['notes-list', '/notes', 1, 'notes.list']);
});

test('a valid inventory has no errors', () => {
  assert.deepEqual(validateSurfaces(base(), refs, { exists }), []);
});

test('the validator enforces the schema rules', () => {
  const child = s => s[0].roots[0].children[0];
  const cases = [
    [s => { child(s).id = 'other.new'; }, /extend parent id/],
    [s => { s[0].roots[0].feature = 'nope'; }, /unknown feature/],
    [s => { delete s[0].roots[0].route; }, /needs a route/],
    [s => { s[0].roots[0].expected = ''; }, /expected must be/],
    [s => { s[0].roots[0].effect = 'write'; }, /effect invalid/],
    [s => { s[0].roots[0].component = 'src/Missing.tsx'; }, /component path does not exist/],
    [s => { s[0].roots[0].test_refs = ['tests/missing.ts']; }, /test_refs path does not exist/],
    [s => { child(s).coverage = 'e2e'; }, /needs test_refs/],
    [s => { child(s).verdict = 'pass'; }, /needs checked/],
    [s => { Object.assign(child(s), { verdict: 'pass', checked: '2026-01-20 (run-nope)' }); }, /unknown run/],
    [s => { Object.assign(child(s), { verdict: 'broken', checked: '2026-01-20 (run-2026-01-20)' }); }, /needs at least one issue/],
    [s => { Object.assign(child(s), { verdict: 'broken', checked: '2026-01-20 (run-2026-01-20)', issues: ['QA-9'] }); }, /unknown issue ref/],
    [s => { Object.assign(child(s), { verdict: 'blocked', checked: '2026-01-20 (run-2026-01-20)' }); }, /needs notes/],
    [s => { s[0].roots[0].children.push({ ...child(s) }); }, /duplicate id/],
    [s => { Object.assign(child(s), { verdict: 'pass', checked: '2026-01-12 (run-2026-01-12)' }); }, /read-only and cannot pass an effect: mutate/],
  ];
  for (const [mutate, expected] of cases) {
    const data = base();
    mutate(data);
    const errs = validateSurfaces(data, refs, { exists });
    assert.ok(errs.some(e => expected.test(e)), `expected ${expected} in: ${errs.join(' | ') || '(no errors)'}`);
  }
});

test('a read-only run may still pass a read or navigate surface', () => {
  const data = base();
  Object.assign(data[0].roots[0], { verdict: 'pass', checked: '2026-01-12 (run-2026-01-12)' });
  assert.deepEqual(validateSurfaces(data, refs, { exists }), []);
});

test('the renderer lists never-checked, non-automated surfaces and rolls up per feature', () => {
  const data = base();
  Object.assign(data[0].roots[0], { verdict: 'pass', checked: '2026-01-20 (run-2026-01-20)' });
  const md = renderSurfaces(data, { features: [{ id: 'notes-list', name: 'Notes list' }] });
  assert.match(md, /## Never checked and not automated[\s\S]*`notes\.list\.new`/);
  assert.match(md, /✅ \*\*Notes list\*\*/);
  assert.match(md, /⬜ \*\*New note\*\* `notes\.list\.new` · action \*\*mutate\*\*/);
  const [st] = surfaceStats(flattenSurfaces(data));
  assert.deepEqual({ total: st.total, pass: st.pass, unchecked: st.unchecked, automated: st.automated }, { total: 2, pass: 1, unchecked: 1, automated: 1 });
});
