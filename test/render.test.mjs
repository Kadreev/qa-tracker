import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.mjs';
import { renderContent } from '../src/dashboard.mjs';
import { nextRunPlan } from '../src/plan.mjs';

const data = {
  features: [
    { id: 'notes-list', name: 'Notes list', area: 'Notes', weight: 5, target_level: 'L4', current_level: 'L0',
      dimensions: { functionality: 'issues', usability: 'pass', code_health: 'pass' }, issues: ['QA-1'], reverify: false },
    { id: 'settings', name: 'Settings', area: 'Settings', weight: 2, target_level: 'L2', current_level: 'L2',
      dimensions: { functionality: 'pass', usability: 'pass', code_health: 'pass' }, issues: [], reverify: true },
  ],
  issues: [
    { id: 'QA-1', title: 'Broken <thing>', severity: 'high', type: 'functionality', feature: 'notes-list', status: 'open' },
    { id: 'QA-2', title: 'Closed thing', severity: 'low', type: 'code', feature: 'settings', status: 'verified-fixed' },
  ],
  runs: [{ id: 'run-2026-01-12', date: '2026-01-12', blast_radius: 'read-only' }],
  surfaces: [],
};

test('nextRunPlan ranks weight × gap first and includes re-verify entries', () => {
  const plan = nextRunPlan(data);
  assert.equal(plan[0].id, 'notes-list');
  assert.ok(plan.some(p => p.id === 'settings' && p.reason.includes('re-verify')));
});

test('renderMarkdown has the title, matrix, issues and plan, and is deterministic', () => {
  const md = renderMarkdown(data, { title: 'Acme QA' });
  assert.match(md, /^# Acme QA$/m);
  for (const h of ['## Coverage matrix', '## Open issues', '## Closed issues', '## Next run plan']) assert.ok(md.includes(h), h);
  assert.match(md, /\| Notes list \| Notes \| 5 \| L0 \| L4 \|/);
  assert.equal(md, renderMarkdown(data, { title: 'Acme QA' }));
});

test('renderMarkdown escapes pipes and copes with an empty tracker', () => {
  const d = structuredClone(data);
  d.issues[0].title = 'a | b';
  assert.match(renderMarkdown(d), /a \\\| b/);
  assert.match(renderMarkdown({}), /Last run: none/);
});

test('renderContent escapes HTML and carries the edit hooks the server script uses', () => {
  const html = renderContent(data, { title: 'Acme <QA>' });
  assert.ok(html.includes('<h1>Acme &lt;QA&gt;</h1>'));
  assert.ok(html.includes('Broken &lt;thing&gt;'));
  assert.ok(!html.includes('Broken <thing>'));
  assert.ok(html.includes('data-feature="notes-list"'));
  assert.ok(html.includes('data-act="istatus"'));
  assert.ok(html.indexOf('QA-1') < html.indexOf('Closed issues'));
  assert.ok(html.indexOf('QA-2') > html.indexOf('Closed issues'));
});

const issue = (id, extra = {}) => ({ id, title: `Issue ${id}`, type: 'functionality', feature: 'settings', status: 'open', ...extra });
const rowIds = (md, heading) => {
  const section = md.split(heading)[1].split(/\n## /)[0];
  return section.split('\n').filter(l => /^\| QA-/.test(l)).map(l => l.split('|')[1].trim());
};

test('issue table shows category, complexity and the Jev marker', () => {
  const d = structuredClone(data);
  d.issues = [
    issue('QA-1', { severity: 'high', category: 'accessibility', complexity: 2,
      triage: { category: { source: 'jev', assessment: 'asm-2026-10-04' }, complexity: { source: 'jev', assessment: 'asm-2026-10-04' } } }),
    issue('QA-2', { severity: 'low', category: 'accessibility', complexity: 3, triage: { category: { source: 'set' } } }),
    issue('QA-3'),
  ];
  const md = renderMarkdown(d);
  assert.ok(md.includes('| ID | Severity | Category | Cx | Feature | Title | Status |'));
  assert.ok(md.includes('| QA-1 | high | accessibilityᴶ | 2ᴶ | settings |'));
  assert.ok(md.includes('| QA-2 | low | accessibility | 3 | settings |'));
  assert.ok(md.includes('| QA-3 | — | — | — | settings |'));
  assert.ok(!md.includes('| Type |'));
});

test('open issues sort by severity, then complexity, unset last', () => {
  const d = structuredClone(data);
  d.issues = [
    issue('QA-1', { severity: 'high', complexity: 5 }),
    issue('QA-2', { complexity: 1 }),
    issue('QA-3', { severity: 'high', complexity: 2 }),
    issue('QA-4', { severity: 'low' }),
    issue('QA-5', { severity: 'high' }),
    issue('QA-6', { severity: 'high' }),
  ];
  assert.deepEqual(rowIds(renderMarkdown(d), '## Open issues'), ['QA-3', 'QA-1', 'QA-5', 'QA-6', 'QA-4', 'QA-2']);
});

test('closed issues sort by status, then severity with unset last', () => {
  const d = structuredClone(data);
  d.issues = [
    issue('QA-1', { status: 'wont-fix', severity: 'critical' }),
    issue('QA-2', { status: 'verified-fixed', severity: 'low' }),
    issue('QA-3', { status: 'fixed' }),
    issue('QA-4', { status: 'fixed', severity: 'medium' }),
  ];
  assert.deepEqual(rowIds(renderMarkdown(d), '## Closed issues'), ['QA-4', 'QA-3', 'QA-2', 'QA-1']);
});

test('legend explains severity, complexity and status', () => {
  const md = renderMarkdown(data);
  assert.ok(md.includes('**Severity** = impact on users (critical → low)'));
  assert.ok(md.includes('**Complexity** = effort to fix, 1–10'));
  assert.ok(md.includes('**Status** = lifecycle (open → fixed → verified-fixed, or wont-fix) · ᴶ = set by Jev, not yet confirmed.'));
  assert.ok(md.indexOf('**Severity** = ') < md.indexOf('## Open issues'));
});

test('triage queue renders deterministically', () => {
  const d = structuredClone(data);
  d.issues = [issue('QA-9', { severity: 'low', category: 'accessibility', complexity: 2 })];
  assert.ok(renderMarkdown(d).includes('## Triage queue\n_Triage queue empty._'));
  d.issues = [issue('QA-1', { category: 'accessibility', complexity: 2 }), issue('QA-2', { severity: 'low', complexity: 3, category: 'other' })];
  const md = renderMarkdown(d, { warnings: ['issue QA-2: category "other" is not in the category list | x'] });
  assert.equal(md, renderMarkdown(d, { warnings: ['issue QA-2: category "other" is not in the category list | x'] }));
  assert.ok(md.includes('| Issue | Field | Kind | Current | Suggested | Confidence | Reason |'));
  assert.ok(md.includes('| QA-1 | severity | needs-triage | — | — | — | not assessed |'));
  assert.ok(md.indexOf('## Closed issues') < md.indexOf('## Triage queue'));
  assert.ok(md.indexOf('## Triage queue') < md.indexOf('## Next run plan'));
  assert.ok(md.includes('**Warnings**\n- issue QA-2: category "other" is not in the category list \\| x'));
});

test('triage queue lists Jev disagreements with a percentage', () => {
  const d = structuredClone(data);
  d.issues = [issue('QA-1', { severity: 'low', category: 'accessibility', complexity: 2 })];
  d.assessments = [{ id: 'asm-2026-10-04', date: '2026-10-04', model: 'jev-latest', rubric: 1,
    issues: { 'QA-1': { severity: { value: 'high', confidence: 0.91, probabilities: { high: 0.91 } } } } }];
  const md = renderMarkdown(d);
  assert.ok(md.includes('| QA-1 | severity | disagrees | low | high | 91% | Jev suggests high (91%) |'), md);
});

test('no warnings, no Warnings block', () => {
  assert.ok(!renderMarkdown(data).includes('**Warnings**'));
});
