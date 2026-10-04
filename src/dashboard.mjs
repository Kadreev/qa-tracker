// HTML rendering for the local dashboard (src/server.mjs): the stylesheet and the
// data content (matrix, issues, triage queue, surfaces roll-up, next-run plan). No script here;
// the server adds the toolbar and the edit wiring.
import { LEVELS, DIMS, ISSUE_STATUS } from './schema.mjs';
import { nextRunPlan } from './plan.mjs';
import { flattenSurfaces, surfaceStats } from './surfaces.mjs';
import { DEFAULT_TITLE } from './config.mjs';
import { DIM_ICON, SEV_ORDER, pct, openOrder, closedOrder } from './format.mjs';
import { resolveCategories } from './categories.mjs';
import { triageQueue } from './triage-policy.mjs';
import { judgmentOf } from './assessments.mjs';

const idx = l => LEVELS.indexOf(l);
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STYLE = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#667; --line:#e3e5ea; --pass:#16a34a; --todo:#c3c9d4; --tgt:#2563eb; --ok:#16a34a; --bad:#dc2626; --warn:#d97706; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0f1115; --fg:#e6e8ee; --muted:#9aa2b1; --line:#2a2e37; --todo:#3a4150; } }
  :root[data-theme="dark"] { --bg:#0f1115; --fg:#e6e8ee; --muted:#9aa2b1; --line:#2a2e37; --todo:#3a4150; }
  body { margin: 0; background: var(--bg); }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px; color: var(--fg); background: var(--bg); font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 32px; }
  .meta { color: var(--muted); }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.lvl { text-align: center; width: 34px; font-size: 16px; color: var(--todo); }
  td.lvl.pass { color: var(--pass); } td.lvl.target { outline: 1px dashed var(--tgt); }
  .sub { color: var(--muted); font-size: 12px; }
  .legend { color: var(--muted); font-size: 12px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; margin: 8px 0 4px; display: grid; gap: 3px; }
  .legend b { color: var(--fg); font-weight: 600; }
  .legend .dot-pass { color: var(--pass); } .legend .dot-tgt { color: var(--tgt); }
  .sev.critical, .sev.high { color: var(--bad); font-weight: 600; } .sev.medium { color: var(--warn); } .sev.low, .sev.none { color: var(--muted); }
  .closed-issues tbody { color: var(--muted); }
  .edit-only { display: none; }
  .editing .edit-only { display: inline-block; }
  .editing .iv, .editing .wv { display: none; }
  #toolbar { position: sticky; top: 0; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; z-index: 2; }
  #save-status { color: var(--ok); font-size: 12px; }
  button { cursor: pointer; }
  @media print {
    :root { --bg:#fff; --fg:#111; --muted:#555; --line:#bbb; --todo:#bbb; }
    #toolbar { display: none; }
    .edit-only { display: none !important; }
    main { max-width: none; padding: 0; }
    .tablewrap { overflow: visible; }
    h2 { margin-top: 20px; }
    table, tr, td, th { break-inside: avoid; }
    thead { display: table-header-group; }
    .sev.critical, .sev.high { color: #b00 !important; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }`;

const COMPLEXITIES = Array.from({ length: 10 }, (_, n) => n + 1);
const SEVERITIES = Object.keys(SEV_ORDER);

/** A title attribute naming Jev (with its confidence) on a cell Jev set and nobody has confirmed. */
function jevTitle(issue, field, assessments) {
  const t = issue.triage?.[field];
  if (t?.source !== 'jev') return '';
  const judgment = typeof t.assessment === 'string' ? judgmentOf(assessments, t.assessment, issue.id, field) : undefined;
  const confidence = field === 'complexity' ? judgment?.top : judgment?.confidence;
  return ` title="${typeof confidence === 'number' ? `Jev ${pct(confidence)}` : 'Jev'}"`;
}

/** An edit-mode <select>; an unset field shows a disabled — so it cannot be submitted. */
function triageSelect(act, label, issue, values, current) {
  const list = current == null || values.includes(current) ? values : [...values, current];
  const options = list.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const none = current == null ? '<option value="" disabled selected>—</option>' : '';
  return `<select class="edit-only" data-act="${act}" aria-label="${label} of ${esc(issue.id)}">${none}${options}</select>`;
}

const ISSUE_HEAD = '<thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Cx</th><th>Feature</th><th>Title</th><th>Status</th></tr></thead>';

/**
 * The data content — heading, matrix, issues, triage queue, surfaces, plan. No toolbar, no script.
 * `categories` is the list in effect: it feeds the category select and the triage queue.
 */
export function renderContent(data, { title = DEFAULT_TITLE, categories = resolveCategories() } = {}) {
  const { features = [], issues = [], runs = [] } = data;
  const open = issues.filter(i => i.status === 'open');
  const closed = issues.filter(i => i.status !== 'open');
  const plan = nextRunPlan(data);
  const lastRun = runs[runs.length - 1];

  const matrixRows = features.map(f => {
    const cells = LEVELS.map((l, i) => {
      const passed = i <= idx(f.current_level);
      const isTarget = l === f.target_level;
      return `<td class="lvl ${passed ? 'pass' : 'todo'} ${isTarget ? 'target' : ''}">${passed ? '●' : (isTarget ? '◎' : '·')}</td>`;
    }).join('');
    const dims = DIMS.map(d => DIM_ICON[f.dimensions?.[d]] ?? '❔').join(' ');
    return `<tr data-feature="${esc(f.id)}">
      <td>${esc(f.name)}<div class="sub">${esc(f.area)} · ${esc((f.issues ?? []).join(', ')) || 'no issues'}</div></td>
      <td class="w"><span class="wv">${esc(f.weight)}</span>
        <span class="edit-only"><button data-act="w-" title="lower weight">−</button><button data-act="w+" title="raise weight">+</button></span></td>
      ${cells}<td class="dims">${dims}</td>
      <td class="edit-only"><label><input type="checkbox" data-act="reverify" ${f.reverify ? 'checked' : ''}>re-verify</label></td>
    </tr>`;
  }).join('\n');

  const names = categories.map(c => c.name);
  const renderIssueRows = list => list.map(i => `
    <tr data-issue="${esc(i.id)}"><td>${esc(i.id)}</td>
    <td class="sev ${esc(i.severity ?? 'none')}"${jevTitle(i, 'severity', data.assessments)}><span class="iv">${esc(i.severity ?? '—')}</span>${triageSelect('iseverity', 'Severity', i, SEVERITIES, i.severity)}</td>
    <td${jevTitle(i, 'category', data.assessments)}><span class="iv">${esc(i.category ?? '—')}</span>${triageSelect('icategory', 'Category', i, names, i.category)}</td>
    <td${jevTitle(i, 'complexity', data.assessments)}><span class="iv">${esc(i.complexity ?? '—')}</span>${triageSelect('icomplexity', 'Complexity', i, COMPLEXITIES, i.complexity)}</td>
    <td>${esc(i.feature)}</td><td>${esc(i.title)}</td>
    <td><span class="iv">${esc(i.status)}</span><select class="edit-only" data-act="istatus" aria-label="Status of ${esc(i.id)}">
      ${ISSUE_STATUS.map(s => `<option ${s === i.status ? 'selected' : (s === 'verified-fixed' ? 'disabled title="Recorded by a run: add-run --verified"' : '')}>${s}</option>`).join('')}
    </select></td></tr>`).join('\n');
  const openRows = renderIssueRows([...open].sort(openOrder));
  const closedRows = renderIssueRows([...closed].sort(closedOrder));

  const queueRows = triageQueue(data, categories).map(q => `<tr><td>${esc(q.issue)}</td><td>${esc(q.field)}</td><td>${esc(q.kind)}</td>
    <td>${esc(q.current ?? '—')}</td><td>${esc(q.suggested ?? '—')}</td><td class="num">${q.confidence == null ? '—' : pct(q.confidence)}</td><td>${esc(q.reason)}</td></tr>`).join('\n');
  const queueBlock = queueRows ? `<div class="tablewrap"><table>
    <thead><tr><th>Issue</th><th>Field</th><th>Kind</th><th>Current</th><th>Suggested</th><th>Confidence</th><th>Reason</th></tr></thead>
    <tbody>${queueRows}</tbody>
  </table></div>` : '<p class="meta">Triage queue empty.</p>';

  const flat = flattenSurfaces(data.surfaces ?? []);
  const featName = Object.fromEntries(features.map(f => [f.id, f.name]));
  const surfaceRows = surfaceStats(flat).map(s => `<tr><td>${esc(featName[s.feature] ?? s.feature)}</td>
    <td class="num">${s.total}</td><td class="num">${s.pass}</td><td class="num">${s.broken}</td>
    <td class="num">${s.blocked}</td><td class="num">${s.unchecked}</td><td class="num">${s.e2e} / ${s.automated}</td></tr>`).join('\n');
  const surfacesBlock = flat.length ? `
  <h2>UI surfaces</h2>
  <p class="meta">${flat.length} surfaces. Full nested checklist in SURFACES.md.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Feature</th><th>Surfaces</th><th>✅ pass</th><th>❌ broken</th><th>⛔ blocked</th><th>⬜ unchecked</th><th>e2e / automated</th></tr></thead>
    <tbody>${surfaceRows}</tbody>
  </table></div>` : '';

  const planItems = plan.map(p => `<li><strong>${esc(p.name)}</strong> (w${esc(p.weight)}) — ${esc(p.reason)}</li>`).join('\n');
  const runMeta = lastRun ? `${esc(lastRun.id)} (${esc(lastRun.date)}, ${esc(lastRun.blast_radius)})` : 'none';

  return `<h1>${esc(title)}</h1>
  <p class="meta">Last run: ${runMeta} · ${features.length} features · ${open.length} open issues · ${closed.length} closed issues</p>
  <h2>Coverage matrix</h2>
  <div class="legend">
    <div><b>W</b> = weight (priority / risk, 1–5). Higher weight ⇒ must be validated deeper.</div>
    <div><b>L0–L4</b> = validation depth reached: <b>L0</b> Renders · <b>L1</b> Read validated · <b>L2</b> Interactions · <b>L3</b> CRUD · <b>L4</b> Hardened. Cumulative — the highest level fully passed.</div>
    <div><span class="dot-pass">●</span> level passed &nbsp; <span class="dot-tgt">◎</span> target level (dashed box) &nbsp; <span>·</span> not yet reached</div>
    <div><b>Func/UX/Code</b> = functionality / usability / code-health status: ✅ pass &nbsp; ⚠️ has issues &nbsp; ❔ unknown / not exercised</div>
  </div>
  <div class="tablewrap"><table>
    <thead><tr><th>Feature</th><th>W</th>${LEVELS.map(l => `<th>${l}</th>`).join('')}<th>Func/UX/Code</th><th class="edit-only"></th></tr></thead>
    <tbody>${matrixRows || '<tr><td colspan="9" class="meta">No features yet. Add one with <code>qa-tracker add-feature</code>.</td></tr>'}</tbody>
  </table></div>
  <h2>Open issues</h2>
  <div class="legend">
    <div><b>Severity</b> = impact on users (critical → low) · <b>Complexity</b> = effort to fix, 1–10 · <b>Status</b> = lifecycle (open → fixed → verified-fixed, or wont-fix) · ᴶ = set by Jev, not yet confirmed.</div>
  </div>
  <div class="tablewrap"><table>
    ${ISSUE_HEAD}
    <tbody>${openRows || '<tr><td colspan="7" class="meta">No open issues.</td></tr>'}</tbody>
  </table></div>
  <h2>Closed issues</h2>
  <div class="tablewrap closed-issues"><table>
    ${ISSUE_HEAD}
    <tbody>${closedRows || '<tr><td colspan="7" class="meta">No closed issues yet.</td></tr>'}</tbody>
  </table></div>
  <h2>Triage queue</h2>
  ${queueBlock}${surfacesBlock}
  <h2>Next run plan</h2>
  <ol>${planItems || '<li>All features at target.</li>'}</ol>`;
}
