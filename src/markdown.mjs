// Renders tracker data to a Markdown snapshot (STATUS.md) any person or agent can read.
// Deterministic (no timestamp) so regeneration only diffs on real data changes.
import { nextRunPlan } from './plan.mjs';
import { flattenSurfaces, surfaceStats } from './surfaces.mjs';
import { DEFAULT_TITLE } from './config.mjs';
import { DIM_ICON, cell, pct, openOrder, closedOrder } from './format.mjs';
import { resolveCategories } from './categories.mjs';
import { triageQueue } from './triage-policy.mjs';
import { summarize, SEVERITY_KEYS, QUICK_WIN_MAX } from './summary.mjs';

/** A field's value, or — when unset; suffixed ᴶ while its triage source is Jev. */
const triaged = (issue, field) =>
  (issue[field] == null ? '—' : `${cell(issue[field])}${issue.triage?.[field]?.source === 'jev' ? 'ᴶ' : ''}`);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The `## Summary` bullets: issues, fixed, coverage, hotspot, quick wins, triage queue. */
function summaryBlock(s) {
  const { issues, coverage, hotspot } = s;
  const open = issues.total
    ? `${issues.open} — ${SEVERITY_KEYS.map(k => `${k} ${issues.openBySeverity[k]}`).join(' · ')}`
    : 'No issues yet';
  const fixable = issues.total - issues.wontFix;
  const fixed = !issues.total ? 'No issues yet'
    : issues.fixedPct === null ? 'Nothing to fix (every issue is wont-fix)'
      : `${issues.fixed + issues.verified} of ${fixable} (${issues.fixedPct}%) — ${issues.verified} verified · ${issues.fixed} awaiting check`;
  const cover = coverage.features
    ? `${coverage.atTarget} of ${plural(coverage.features, 'feature')} at target · weighted ${coverage.weightedPct}%`
    : 'No features yet';
  const hot = hotspot
    ? `${cell(hotspot.name)} (\`${hotspot.feature}\`) — ${cell(hotspot.worst.id)} (${hotspot.worst.severity}), score ${hotspot.score}`
    : 'none';
  return `## Summary
- **Open issues:** ${open}
- **Fixed:** ${fixed}
- **Coverage:** ${cover}
- **Hotspot:** ${hot}
- **Quick wins:** ${plural(s.quickWins, 'open issue')} with complexity ≤ ${QUICK_WIN_MAX}
- **Triage queue:** ${plural(s.triage, 'item')}
`;
}

/**
 * renderMarkdown(data, { title, categories, warnings }) → the STATUS.md text.
 * `categories` is the list in effect (the triage queue needs it); `warnings` are
 * the issue warnings printed under the queue. The rest comes from `data`.
 */
export function renderMarkdown(data, { title = DEFAULT_TITLE, categories = resolveCategories(), warnings = [] } = {}) {
  const { features = [], issues = [], runs = [] } = data;
  const open = issues.filter(i => i.status === 'open');
  const closed = issues.filter(i => i.status !== 'open');
  const lastRun = runs[runs.length - 1];
  const plan = nextRunPlan(data);

  const matrix = features.map(f => {
    const d = f.dimensions ?? {};
    return `| ${cell(f.name)} | ${cell(f.area)} | ${f.weight} | ${f.current_level} | ${f.target_level} `
      + `| ${DIM_ICON[d.functionality] ?? '❔'} | ${DIM_ICON[d.usability] ?? '❔'} | ${DIM_ICON[d.code_health] ?? '❔'} `
      + `| ${cell((f.issues ?? []).join(', ')) || '—'} |`;
  }).join('\n');

  const issueRows = (list, compare) => [...list].sort(compare)
    .map(i => `| ${cell(i.id)} | ${triaged(i, 'severity')} | ${triaged(i, 'category')} | ${triaged(i, 'complexity')} `
      + `| ${cell(i.feature)} | ${cell(i.title)} | ${cell(i.status)} |`)
    .join('\n');
  const issueHeader = '| ID | Severity | Category | Cx | Feature | Title | Status |\n|---|---|---|---|---|---|---|';
  const noIssues = '| — | — | — | — | — | none | — |';

  const queueRows = triageQueue(data, categories).map(q =>
    `| ${cell(q.issue)} | ${cell(q.field)} | ${cell(q.kind)} | ${cell(q.current ?? '—')} | ${cell(q.suggested ?? '—')} `
    + `| ${q.confidence == null ? '—' : pct(q.confidence)} | ${cell(q.reason)} |`).join('\n');
  const queueBlock = queueRows
    ? `| Issue | Field | Kind | Current | Suggested | Confidence | Reason |\n|---|---|---|---|---|---|---|\n${queueRows}\n`
    : '_Triage queue empty._\n';
  const warningBlock = warnings.length ? `\n**Warnings**\n${warnings.map(w => `- ${cell(w)}`).join('\n')}\n` : '';

  const flatSurfaces = flattenSurfaces(data.surfaces ?? []);
  const count = v => flatSurfaces.filter(s => s.verdict === v).length;
  const surfaceRows = surfaceStats(flatSurfaces).map(s =>
    `| \`${s.feature}\` | ${s.total} | ${s.pass} | ${s.broken} | ${s.blocked} | ${s.unchecked} | ${s.e2e} / ${s.automated} |`).join('\n');
  const surfaceBlock = flatSurfaces.length ? `
## UI surfaces (see \`SURFACES.md\` for the nested checklist)
_${flatSurfaces.length} surfaces · ✅ ${count('pass')} · ❌ ${count('broken')} · ⛔ ${count('blocked')} · ⬜ ${count('unchecked')} never checked._

| Feature | Surfaces | ✅ | ❌ | ⛔ | ⬜ | e2e / any automated |
|---|---|---|---|---|---|---|
${surfaceRows}
` : '';

  const planRows = plan.map((p, n) => `${n + 1}. **${cell(p.name)}** (\`${p.id}\`, w${p.weight}) — ${cell(p.reason)}`).join('\n');

  return `# ${cell(title)}

_Last run: ${cell(lastRun?.id ?? 'none')}${lastRun ? ` (${cell(lastRun.date)}, ${cell(lastRun.blast_radius)})` : ''} · ${features.length} features · ${open.length} open issues · ${closed.length} closed issues._

${summaryBlock(summarize(data, { categories }))}
> Generated from the YAML files next to this one — do not edit by hand; run \`qa-tracker render\`.

## Legend
- **W** — weight (priority/risk, 1–5). Higher ⇒ must be validated deeper.
- **Cur / Tgt** — validation level reached / target. Ladder (cumulative, highest passed): **L0** Renders · **L1** Read validated · **L2** Interactions · **L3** CRUD · **L4** Hardened.
- **Func / UX / Code** — functionality / usability / code-health: ✅ pass · ⚠️ has issues · ❔ unknown.
- **Severity** = impact on users (critical → low) · **Complexity** = effort to fix, 1–10 · **Status** = lifecycle (open → fixed → verified-fixed, or wont-fix) · ᴶ = set by Jev, not yet confirmed.

## Coverage matrix
| Feature | Area | W | Cur | Tgt | Func | UX | Code | Issues |
|---|---|---|---|---|---|---|---|---|
${matrix || '| — | — | — | — | — | — | — | — | — |'}

## Open issues (by severity)
${issueHeader}
${issueRows(open, openOrder) || noIssues}

## Closed issues
${issueHeader}
${issueRows(closed, closedOrder) || noIssues}

## Triage queue
${queueBlock}${warningBlock}${surfaceBlock}
## Next run plan (ranked by weight × levels-below-target, + re-verify)
${planRows || '_All features at target._'}
`;
}
