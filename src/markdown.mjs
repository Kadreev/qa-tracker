// Renders tracker data to a Markdown snapshot (STATUS.md) any person or agent can read.
// Deterministic (no timestamp) so regeneration only diffs on real data changes.
import { nextRunPlan } from './plan.mjs';
import { flattenSurfaces, surfaceStats } from './surfaces.mjs';
import { DEFAULT_TITLE } from './config.mjs';

const DIM_ICON = { pass: '✅', issues: '⚠️', unknown: '❔' };
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(data, { title = DEFAULT_TITLE } = {}) {
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

  const issueRows = list => [...list].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
    .map(i => `| ${cell(i.id)} | ${i.severity} | ${cell(i.type)} | ${cell(i.feature)} | ${cell(i.title)} | ${cell(i.status)} |`)
    .join('\n');

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

> Generated from the YAML files next to this one — do not edit by hand; run \`qa-tracker render\`.

## Legend
- **W** — weight (priority/risk, 1–5). Higher ⇒ must be validated deeper.
- **Cur / Tgt** — validation level reached / target. Ladder (cumulative, highest passed): **L0** Renders · **L1** Read validated · **L2** Interactions · **L3** CRUD · **L4** Hardened.
- **Func / UX / Code** — functionality / usability / code-health: ✅ pass · ⚠️ has issues · ❔ unknown.

## Coverage matrix
| Feature | Area | W | Cur | Tgt | Func | UX | Code | Issues |
|---|---|---|---|---|---|---|---|---|
${matrix || '| — | — | — | — | — | — | — | — | — |'}

## Open issues (by severity)
| ID | Severity | Type | Feature | Title | Status |
|---|---|---|---|---|---|
${issueRows(open) || '| — | — | — | — | none | — |'}

## Closed issues
| ID | Severity | Type | Feature | Title | Status |
|---|---|---|---|---|---|
${issueRows(closed) || '| — | — | — | — | none | — |'}
${surfaceBlock}
## Next run plan (ranked by weight × levels-below-target, + re-verify)
${planRows || '_All features at target._'}
`;
}
