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
