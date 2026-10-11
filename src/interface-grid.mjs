import { esc } from './format.mjs';
import { flattenSurfaces } from './surfaces.mjs';

const KNOWN_SEVERITIES = ['critical', 'high', 'medium', 'low'];

function descendants(node, childrenByParent) {
  const children = childrenByParent.get(node.id) ?? [];
  return [node, ...children.flatMap(child => descendants(child, childrenByParent))];
}

function issueCounts(nodes, issues) {
  const surfaceIssueIds = new Set(nodes.flatMap(surface => surface.issues ?? []));
  const features = new Set(nodes.map(surface => surface.feature).filter(Boolean));
  const uniqueOpenIssues = new Map();

  for (const issue of issues) {
    if (issue?.status !== 'open' || !issue.id) continue;
    if (surfaceIssueIds.has(issue.id) || (issue.feature && features.has(issue.feature))) {
      uniqueOpenIssues.set(issue.id, issue);
    }
  }

  const counts = Object.fromEntries(KNOWN_SEVERITIES.map(severity => [severity, 0]));
  counts.unknown = 0;
  for (const issue of uniqueOpenIssues.values()) {
    if (KNOWN_SEVERITIES.includes(issue.severity)) counts[issue.severity]++;
    else counts.unknown++;
  }
  return { total: uniqueOpenIssues.size, counts };
}

function surfaceCounts(nodes) {
  const passed = nodes.filter(surface => surface.verdict === 'pass').length;
  return {
    total: nodes.length,
    passed,
    percent: nodes.length ? Math.round((passed / nodes.length) * 100) : 0,
    unchecked: nodes.filter(surface => surface.verdict === 'unchecked').length,
    broken: nodes.filter(surface => surface.verdict === 'broken').length,
    blocked: nodes.filter(surface => surface.verdict === 'blocked').length,
  };
}

function renderSummary(nodes, issues) {
  const surface = surfaceCounts(nodes);
  const finding = issueCounts(nodes, issues);
  const severity = [...KNOWN_SEVERITIES, 'unknown']
    .map(level => `${level[0].toUpperCase()}${level.slice(1)} ${finding.counts[level]}`)
    .join(' · ');
  return `<span class="interface-grid__pass">${surface.passed}/${surface.total} passed (${surface.percent}%)</span>`
    + `<span class="interface-grid__states">Unchecked ${surface.unchecked} · Broken ${surface.broken} · Blocked ${surface.blocked}</span>`
    + `<span class="interface-grid__issues">${finding.total} open issues · ${severity}</span>`;
}

function renderRows(nodes, childrenByParent, allIssues) {
  if (!nodes.length) return '';
  const rows = nodes.map(node => {
    const subtree = descendants(node, childrenByParent);
    const children = childrenByParent.get(node.id) ?? [];
    const childTable = children.length
      ? `<details class="interface-grid__children"><summary>${children.length} child surfaces</summary>${renderTable(children, childrenByParent, allIssues)}</details>`
      : '<span class="interface-grid__leaf">No child surfaces</span>';
    return `<tr data-surface-id="${esc(node.id)}">`
      + `<th scope="row"><span class="interface-grid__name">${esc(node.name || node.id)}</span>`
      + `<code>${esc(node.id)}</code>${node.route ? `<span class="interface-grid__route">${esc(node.route)}</span>` : ''}</th>`
      + `<td>${renderSummary(subtree, allIssues)}</td>`
      + `<td>${childTable}</td>`
      + '</tr>';
  }).join('');
  return rows;
}

function renderTable(nodes, childrenByParent, issues) {
  return `<table class="interface-grid__table"><thead><tr>`
    + '<th scope="col">Interface</th><th scope="col">Subtree status</th><th scope="col">Children</th>'
    + `</tr></thead><tbody>${renderRows(nodes, childrenByParent, issues)}</tbody></table>`;
}

/** Render the nested interface inventory as an escaped HTML fragment. */
export function renderInterfaceGrid(data = {}) {
  const files = Array.isArray(data?.surfaces) ? data.surfaces.filter(file => file && typeof file === 'object') : [];
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const renderedAreas = [];

  for (const file of files) {
    const flat = flattenSurfaces([file]);
    if (!flat.length) continue;

    const childrenByParent = new Map();
    for (const surface of flat) {
      const key = surface.parent ?? null;
      const children = childrenByParent.get(key) ?? [];
      children.push(surface);
      childrenByParent.set(key, children);
    }

    const summary = renderSummary(flat, issues);
    const area = file.area || file.file || 'Interfaces';
    const source = file.file ? `<span class="interface-grid__source">${esc(file.file)}</span>` : '';
    renderedAreas.push(`<details class="interface-grid__area" open data-area="${esc(area)}">`
      + `<summary><span class="interface-grid__area-name">${esc(area)}</span>${source}${summary}</summary>`
      + renderTable(childrenByParent.get(null) ?? [], childrenByParent, issues)
      + '</details>');
  }

  if (!renderedAreas.length) {
    return '<section class="interface-grid interface-grid--empty" aria-label="Interface grid">'
      + '<p>No interface surfaces are available yet.</p></section>';
  }

  return '<section class="interface-grid" aria-label="Interface grid"><h2>Interfaces and nested views</h2><p class="meta">Verification = passed / inventoried checks, including each parent check. Inventory may be incomplete; this is not launch readiness. Parent and child totals overlap.</p>'
    + '<p class="interface-grid__note">Open issue counts include direct surface links and exact inherited-feature matches; feature-scoped counts may overlap across subtrees.</p>'
    + renderedAreas.join('')
    + '</section>';
}
