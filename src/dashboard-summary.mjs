// The dashboard's summary: four cards (open issues, fixed, coverage, hotspot) and three
// panels (issues by feature, severity × status, work queue) above the coverage matrix.
// Renders a Summary from src/summary.mjs; plain HTML and CSS, no script. Every bar is a
// <div> with a percentage width and sits next to its count, so no number is colour-only.
import { SEVERITY_KEYS, SEVERITY_WEIGHT, QUICK_WIN_MAX } from './summary.mjs';
import { esc } from './format.mjs';

export const SUMMARY_STYLE = `
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .summary { display: grid; gap: 12px; margin: 16px 0 8px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; }
  .panels { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  @media (min-width: 720px) {
    .panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panels > .panel-features { grid-column: 1 / -1; }
  }
  @media (min-width: 1100px) {
    .panels { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr); }
    .panels > .panel-features { grid-column: auto; }
  }
  .card, .panel { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .card-crit { border-color: var(--bad); box-shadow: inset 3px 0 0 var(--bad); }
  .card-label, .panel-title { margin: 0; color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .card-value { font-size: 30px; font-weight: 650; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .card-value .unit { margin-left: 6px; color: var(--muted); font-size: 13px; font-weight: 400; }
  .card-name { font-size: 18px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
  .card-sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .card-empty { color: var(--muted); font-size: 14px; margin: auto 0; }
  .bar { display: flex; height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
  .bar > div { height: 100%; }
  .fill-ok { background: var(--ok); }
  .s-critical { background: var(--bad); } .s-high { background: var(--warn); } .s-medium { background: var(--warn); opacity: .5; }
  .s-low { background: var(--muted); } .s-unrated { background: var(--todo); }
  .key { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 12px; color: var(--muted); font-size: 12px; }
  .key .sw { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; vertical-align: 0; }
  .key .crit { color: var(--bad); font-weight: 600; }
  .feat-rows { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .feat-more { display: grid; gap: 10px; }
  .feat-more > summary { cursor: pointer; color: var(--muted); font-size: 12px; width: max-content; max-width: 100%; }
  .feat-more > summary:hover { color: var(--fg); }
  .feat-more > summary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px; }
  .feat-more[open] > summary { order: 1; }
  .feat-more .more-open, .feat-more[open] .more-closed { display: none; }
  .feat-more[open] .more-open { display: inline; }
  .feat-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 13px; }
  .feat-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .feat-count { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .table-scroll { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
  .sev-status { font-size: 13px; width: 100%; }
  .sev-status th, .sev-status td { padding: 4px 6px; }
  .sev-status thead th { color: var(--muted); font-size: 12px; font-weight: 600; }
  .sev-status td { text-align: right; font-variant-numeric: tabular-nums; }
  .sev-status thead th:not(:first-child) { text-align: right; }
  .sev-status .zero { color: var(--muted); }
  .queue { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 13px; }
  .queue .why { color: var(--muted); font-size: 12px; }
  .facts { margin: 0; display: grid; gap: 2px; font-size: 13px; }
  .facts b { font-variant-numeric: tabular-nums; }
  @media print {
    .summary { margin-top: 8px; }
    .card, .panel { break-inside: avoid; box-shadow: none; }
    .feat-more > summary { display: none; }
    .card-crit { border-color: #b00; border-left-width: 3px; }
  }`;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bar = segments => `<div class="bar" aria-hidden="true">${segments.map(([cls, w]) => `<div class="${cls}" style="width:${w}"></div>`).join('')}</div>`;

/**
 * Severity segments scaled against `scale` (the bar's full length, as an issue count).
 * Widths are rounded cumulatively, so a full bar's segments add up to exactly 100%.
 */
function severityBar(counts, scale) {
  let seen = 0;
  return bar(SEVERITY_KEYS.filter(k => counts[k]).map(k => {
    const from = Math.round(100 * seen / scale);
    seen += counts[k];
    return [`s-${k}`, `${Math.round(100 * seen / scale) - from}%`];
  }));
}

/** "1 critical · 2 low" with a colour swatch per entry; zero buckets are left out. */
const severityKey = counts => `<ul class="key">${SEVERITY_KEYS.filter(k => counts[k])
  .map(k => `<li${k === 'critical' ? ' class="crit"' : ''}><span class="sw s-${k}"></span>${counts[k]} ${k}</li>`).join('')}</ul>`;

/** The table/text class for a severity bucket (`.sev.none` styles a missing severity). */
const sevClass = k => (k === 'unrated' ? 'none' : k);

const card = (label, body, cls = '') => `<div class="card${cls ? ` ${cls}` : ''}"><h3 class="card-label">${label}</h3>${body}</div>`;
const empty = text => `<p class="card-empty">${text}</p>`;

function openCard({ issues }) {
  if (!issues.total) return card('Open issues', empty('No issues yet'));
  const body = issues.open
    ? `<div class="card-value">${issues.open}<span class="unit">of ${issues.total} total</span></div>${severityBar(issues.openBySeverity, issues.open)}${severityKey(issues.openBySeverity)}`
    : `<div class="card-value">0<span class="unit">of ${issues.total} total</span></div><div class="card-sub">Nothing open.</div>`;
  return card('Open issues', body, issues.openBySeverity.critical ? 'card-crit' : '');
}

function fixedCard({ issues }) {
  if (!issues.total) return card('Fixed', empty('No issues yet'));
  if (issues.fixedPct === null) return card('Fixed', empty('Nothing to fix: every issue is wont-fix'));
  const done = issues.fixed + issues.verified;
  return card('Fixed', `<div class="card-value">${done}<span class="unit">of ${issues.total - issues.wontFix} · ${issues.fixedPct}%</span></div>
    ${bar([['fill-ok', `${issues.fixedPct}%`]])}
    <div class="card-sub">${issues.verified} verified · ${issues.fixed} awaiting check</div>`);
}

function coverageCard({ coverage }) {
  if (!coverage.features) return card('Coverage', empty('No features yet'));
  return card('Coverage', `<div class="card-value">${coverage.atTarget}<span class="unit">of ${plural(coverage.features, 'feature')} at target</span></div>
    ${bar([['fill-ok', `${coverage.weightedPct}%`]])}
    <div class="card-sub">${coverage.weightedPct}% weighted coverage (levels reached toward target, by weight)</div>`);
}

const WEIGHTS = `Score per open issue: ${SEVERITY_KEYS.map(k => `${k} ${SEVERITY_WEIGHT[k]}`).join(', ')}`;

function hotspotCard({ issues, hotspot, byFeature }) {
  if (!issues.total) return card('Hotspot', empty('No issues yet'));
  if (!hotspot) return card('Hotspot', empty('No open issues'));
  const { worst } = hotspot;
  const open = byFeature[0].open;
  const counts = SEVERITY_KEYS.filter(k => open[k]).map(k => `${open[k]} ${k}`).join(' · ');
  return card('Hotspot', `<div class="card-name">${esc(hotspot.name)}</div>
    <div class="card-sub">Worst: <span class="sev ${sevClass(worst.severity)}">${esc(worst.id)} · ${esc(worst.severity)}</span> — ${esc(worst.title)}</div>
    <div class="card-sub" title="${WEIGHTS}">Score ${hotspot.score} · ${counts}</div>`);
}

const panel = (title, body, cls = '') => `<div class="panel${cls ? ` ${cls}` : ''}"><h3 class="panel-title">${title}</h3>${body}</div>`;

/** How many feature rows stay visible; the rest fold behind "Show all". */
export const FEATURE_ROWS_VISIBLE = 8;

function featurePanel({ issues, byFeature }) {
  if (!issues.total) return panel('Issues by feature', empty('No issues yet'), 'panel-features');
  if (!byFeature.length) return panel('Issues by feature', empty('No open issues'), 'panel-features');
  const scale = Math.max(...byFeature.map(f => SEVERITY_KEYS.reduce((n, k) => n + f.open[k], 0)));
  const row = f => {
    const counts = SEVERITY_KEYS.filter(k => f.open[k]).map(k => `${f.open[k]} ${k}`).join(' · ');
    return `<li><div class="feat-head"><span class="feat-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="feat-count">${counts}</span></div>${severityBar(f.open, scale)}</li>`;
  };
  // The worst features stay in view; a long tail would otherwise stretch every panel in
  // the row to its height. <details> keeps the rest one click away with no script.
  const top = byFeature.slice(0, FEATURE_ROWS_VISIBLE).map(row).join('');
  const rest = byFeature.slice(FEATURE_ROWS_VISIBLE);
  const more = rest.length
    ? `<details class="feat-more"><summary><span class="more-closed">Show all ${byFeature.length} features</span><span class="more-open">Show fewer</span></summary><ul class="feat-rows">${rest.map(row).join('')}</ul></details>`
    : '';
  return panel('Issues by feature', `<ul class="feat-rows">${top}</ul>${more}`, 'panel-features');
}

function severityPanel({ issues }) {
  if (!issues.total) return panel('Severity × status', empty('No issues yet'));
  const cellOf = n => `<td${n ? '' : ' class="zero"'}>${n}</td>`;
  const rows = SEVERITY_KEYS.map(k => {
    const c = issues.bySeverityStatus[k];
    return `<tr><th scope="row" class="sev ${sevClass(k)}">${k}</th>${[c.open, c.fixed, c.verified, c.wontFix].map(cellOf).join('')}</tr>`;
  }).join('');
  return panel('Severity × status', `<div class="table-scroll"><table class="sev-status">
    <thead><tr><th scope="col">Severity</th><th scope="col">Open</th><th scope="col">Fixed</th><th scope="col">Verified</th><th scope="col">Won't fix</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`);
}

function queuePanel({ coverage, plan, triage, quickWins }) {
  const next = !coverage.features ? empty('No features yet')
    : plan.length ? `<ol class="queue">${plan.map(p => `<li><strong>${esc(p.name)}</strong> <span class="why">${esc(p.reason)}</span></li>`).join('')}</ol>`
      : '<p class="card-sub">All features at target.</p>';
  return panel('Work queue', `${next}
    <p class="facts"><span><b>${plural(triage, 'item')}</b> in the triage queue</span>
    <span><b>${plural(quickWins, 'quick win')}</b>: open, complexity ≤ ${QUICK_WIN_MAX}</span></p>`);
}

/** renderSummary(summary) → the cards and panels HTML; every data value is escaped. */
export function renderSummary(summary) {
  return `<section class="summary" aria-labelledby="summary-title"><h2 id="summary-title" class="sr-only">Summary</h2>
  <div class="cards">${openCard(summary)}${fixedCard(summary)}${coverageCard(summary)}${hotspotCard(summary)}</div>
  <div class="panels">${featurePanel(summary)}${severityPanel(summary)}${queuePanel(summary)}</div>
  </section>`;
}
