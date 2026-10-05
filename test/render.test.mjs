import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.mjs';
import { renderContent, STYLE } from '../src/dashboard.mjs';
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

// --- dashboard triage columns, controls and queue ---
const dashIssues = [
  issue('QA-1', { severity: 'high', category: 'accessibility', complexity: 5,
    triage: { category: { source: 'jev', assessment: 'asm-2026-10-04' }, complexity: { source: 'jev', assessment: 'asm-2026-10-04' }, severity: { source: 'jev', assessment: 'asm-gone' } } }),
  issue('QA-2', { complexity: 1 }),
  issue('QA-3', { severity: 'high', complexity: 2, category: 'mystery', triage: { category: { source: 'set' } } }),
  issue('QA-4', { status: 'fixed' }),
  issue('QA-5', { status: 'fixed', severity: 'low' }),
];
const dashData = {
  ...structuredClone(data),
  issues: dashIssues,
  assessments: [{ id: 'asm-2026-10-04', date: '2026-10-04', model: 'jev-latest', rubric: 1,
    issues: { 'QA-1': { category: { value: 'accessibility', confidence: 0.91 }, complexity: { value: 5, top: 0.62, probabilities: { 5: 0.62 } } } } }],
};
const dashCats = [{ name: 'functional' }, { name: 'accessibility' }, { name: 'other' }];
const dash = renderContent(dashData, { title: 'T', categories: dashCats });
const rowOf = id => dash.split(`data-issue="${id}"`)[1].split('</tr>')[0];

test('dashboard issues sort like STATUS.md; unset severity does not break ordering', () => {
  const order = [...dash.matchAll(/data-issue="(QA-\d)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['QA-3', 'QA-1', 'QA-2', 'QA-5', 'QA-4']);
});

test('dashboard issue cells: Cx column, sev none, em dash for unset', () => {
  const head = dash.split('<h2>Open issues</h2>')[1].split('</thead>')[0];
  const labels = [...head.matchAll(/<th>(?:<span class="tip"[^>]*>)?([^<]+)/g)].map(m => m[1]);
  assert.deepEqual(labels, ['ID', 'Severity', 'Category', 'Cx', 'Feature', 'Title', 'Status']);
  assert.ok(!dash.includes('<th>Type</th>'));
  assert.ok(rowOf('QA-2').includes('class="sev none"><span class="iv">—</span>'));
  assert.ok(rowOf('QA-2').includes('<td><span class="iv">—</span><select class="edit-only" data-act="icategory"'));
});

test('Jev-owned cells carry a confidence tooltip, others none', () => {
  const r = rowOf('QA-1');
  assert.ok(r.includes('title="Jev 91%"'), r);
  assert.ok(r.includes('title="Jev 62%"'), r);
  assert.ok(r.includes('title="Jev"'), 'severity whose assessment is missing gets a bare Jev title');
  assert.ok(!rowOf('QA-3').includes('title="Jev'));
  // The visible ᴶ marker matches STATUS.md; user-set and unset cells carry none.
  assert.ok(r.includes('<td title="Jev 91%"><span class="iv">accessibilityᴶ</span>'), r);
  assert.ok(r.includes('<span class="iv">5ᴶ</span>'));
  assert.ok(r.includes('<span class="iv">highᴶ</span>'));
  assert.ok(!rowOf('QA-3').includes('ᴶ'));
  assert.ok(!rowOf('QA-2').includes('ᴶ'));
});

test('edit-mode selects for category, complexity and severity', () => {
  const r = rowOf('QA-1');
  assert.match(r, /<select class="edit-only" data-act="icategory"/);
  assert.match(r, /<option value="accessibility" selected>/);
  assert.match(r, /<select class="edit-only" data-act="icomplexity"/);
  assert.match(r, /<option value="5" selected>/);
  assert.match(r, /<select class="edit-only" data-act="iseverity"/);
  assert.match(r, /<option value="high" selected>/);
  assert.ok(!r.includes('<option value="'.concat('" ')), 'no empty option when everything is set');
  assert.match(rowOf('QA-2'), /<option value="" disabled selected>—<\/option>/);
  assert.match(rowOf('QA-3'), /<option value="mystery" selected>/);
  assert.ok(r.indexOf('<option value="functional"') < r.indexOf('<option value="accessibility"'), 'categories keep list order');
});

test('dashboard has the legend line and a triage queue between closed issues and surfaces', () => {
  assert.ok(dash.includes('<b>Severity</b> = impact on users (critical → low)'));
  assert.ok(dash.includes('ᴶ = set by Jev'));
  assert.ok(dash.indexOf('Open issues') < dash.indexOf('impact on users') && dash.indexOf('impact on users') < dash.indexOf('Closed issues'));
  assert.ok(dash.indexOf('Closed issues') < dash.indexOf('Triage queue'));
  assert.ok(dash.indexOf('Triage queue') < dash.indexOf('Next run plan'));
  assert.ok(dash.includes('<th>Issue</th><th>Field</th><th>Kind</th><th>Current</th><th>Suggested</th><th>Confidence</th><th>Reason</th>'));
  const empty = renderContent({ ...structuredClone(data), issues: [issue('QA-9', { severity: 'low', category: 'accessibility', complexity: 2 })] }, { categories: dashCats });
  assert.ok(empty.includes('Triage queue empty.'));
});

// --- summary block, cards and header tooltips ---
test('STATUS.md has a Summary block after the last-run line', () => {
  const md = renderMarkdown(data);
  assert.match(md, /^_Last run: [^\n]*\n\n## Summary\n- \*\*Open issues:\*\* 1 — critical 0 · high 1 · medium 0 · low 0 · unrated 0\n/m);
  assert.ok(md.includes('- **Fixed:** 1 of 2 (50%) — 1 verified · 0 awaiting check\n'), md);
  assert.ok(md.includes('- **Coverage:** 1 of 2 features at target · weighted 29%\n'), md);
  assert.ok(md.includes('- **Hotspot:** Notes list (`notes-list`) — QA-1 (high), score 4\n'), md);
  assert.ok(md.includes('- **Quick wins:** 0 open issues with complexity ≤ 3\n'), md);
  assert.ok(md.includes('- **Triage queue:** 2 items\n'), md);
  assert.ok(md.indexOf('## Summary') < md.indexOf('## Legend'));
  const empty = renderMarkdown({});
  assert.ok(empty.includes('- **Open issues:** No issues yet\n'), empty);
  assert.ok(empty.includes('- **Fixed:** No issues yet\n'));
  assert.ok(empty.includes('- **Coverage:** No features yet\n'));
  assert.ok(empty.includes('- **Hotspot:** none\n'));
});

test('dashboard summary cards and panels sit above the coverage matrix', () => {
  const html = renderContent(data, { categories: dashCats });
  const at = s => html.indexOf(s);
  assert.ok(at('class="cards"') > at('class="meta"') && at('class="cards"') < at('<h2>Coverage matrix</h2>'));
  assert.ok(at('class="panels"') > at('class="cards"') && at('class="panels"') < at('<h2>Coverage matrix</h2>'));
  for (const label of ['Open issues', 'Fixed', 'Coverage', 'Hotspot', 'Issues by feature', 'Severity × status', 'Work queue']) {
    assert.ok(html.slice(0, at('<h2>Coverage matrix</h2>')).includes(label), label);
  }
  assert.ok(html.includes('style="width:100%"'), 'bars are divs with percentage widths');
  assert.ok(!html.includes('card-crit'), 'no critical emphasis without a critical issue');
  const crit = structuredClone(data);
  crit.issues[0].severity = 'critical';
  assert.ok(renderContent(crit, { categories: dashCats }).includes('card-crit'));
  const empty = renderContent({}, { categories: dashCats });
  assert.ok(empty.includes('No issues yet'));
  assert.ok(empty.includes('No features yet'));
});

test('a hostile feature name or issue title renders escaped in the summary', () => {
  const d = structuredClone(data);
  d.features[0].name = '<script>alert(1)</script>';
  d.issues[0].title = '<script>alert(2)</script>';
  const html = renderContent(d, { categories: dashCats });
  const summary = html.slice(0, html.indexOf('<h2>Coverage matrix</h2>'));
  assert.ok(summary.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'feature name in hotspot and by-feature panel');
  assert.ok(summary.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), 'worst issue title in the hotspot card');
  assert.ok(!html.includes('<script>'));
});

test('explained headers carry tooltips; legends print after each table', () => {
  assert.ok(dash.includes('<th><span class="tip" tabindex="0" aria-describedby="tip-W">W</span><span class="tiptext" role="tooltip" id="tip-W">'));
  for (const key of ['L0', 'L1', 'L2', 'L3', 'L4', 'dims', 'sev-open', 'cat-open', 'cx-open', 'status-open', 'sev-closed', 'cat-closed', 'cx-closed', 'status-closed']) {
    assert.ok(dash.includes(`aria-describedby="tip-${key}"`), key);
    assert.ok(dash.includes(`role="tooltip" id="tip-${key}"`), key);
  }
  const ids = [...dash.matchAll(/ id="(tip-[^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!/class="legend"/.test(dash));
  for (const h of ['Coverage matrix', 'Open issues', 'Closed issues']) {
    const section = dash.split(`<h2>${h}</h2>`)[1].split('<h2>')[0];
    assert.match(section, /<\/table><\/div>\s*<div class="legend-print">[\s\S]*<\/div>\s*$/, h);
  }
  assert.ok(STYLE.includes('.legend-print { display: none'));
  assert.match(STYLE, /@media print \{[\s\S]*\.legend-print \{ display: grid/);
});

test('issue IDs do not wrap', () => {
  assert.ok(rowOf('QA-1').startsWith('><td class="id">QA-1</td>'), rowOf('QA-1'));
  assert.match(STYLE, /td\.id \{[^}]*white-space: nowrap/);
});
