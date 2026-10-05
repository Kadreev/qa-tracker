// The tracker at a glance: issue counts, coverage, the feature with the worst open
// issues and the next work. Pure numbers — the dashboard cards (src/dashboard-summary.mjs)
// and the STATUS.md Summary block (src/markdown.mjs) both render from this.
import { LEVELS, SEVERITIES } from './schema.mjs';
import { nextRunPlan } from './plan.mjs';
import { triageQueue } from './triage-policy.mjs';
import { resolveCategories } from './categories.mjs';

/** Severity buckets: the four severities, then issues with no (or an unknown) severity. */
export const SEVERITY_KEYS = [...SEVERITIES, 'unrated'];

/** Weight of one open issue in a feature's hotspot score. */
export const SEVERITY_WEIGHT = { critical: 8, high: 4, medium: 2, low: 1, unrated: 1 };

/** An open issue this effort or below counts as a quick win. */
export const QUICK_WIN_MAX = 3;

const idx = l => Math.max(0, LEVELS.indexOf(l));
const sevKey = issue => (SEVERITIES.includes(issue.severity) ? issue.severity : 'unrated');
const zeros = make => Object.fromEntries(SEVERITY_KEYS.map(k => [k, make()]));
const ratio = (part, whole) => (whole ? Math.round(100 * part / whole) : null);

/** Share of the way to target: 1 at or above it (or when the target is L0). */
const progress = f => (idx(f.target_level) === 0 ? 1 : Math.min(idx(f.current_level), idx(f.target_level)) / idx(f.target_level));

function issueCounts(issues) {
  const count = status => issues.filter(i => i.status === status).length;
  const total = issues.length;
  const [open, fixed, verified, wontFix] = ['open', 'fixed', 'verified-fixed', 'wont-fix'].map(count);
  const openBySeverity = zeros(() => 0);
  const bySeverityStatus = zeros(() => ({ open: 0, fixed: 0, verified: 0, wontFix: 0 }));
  const column = { open: 'open', fixed: 'fixed', 'verified-fixed': 'verified', 'wont-fix': 'wontFix' };
  for (const i of issues) {
    if (i.status === 'open') openBySeverity[sevKey(i)]++;
    if (column[i.status]) bySeverityStatus[sevKey(i)][column[i.status]]++;
  }
  return { total, open, fixed, verified, wontFix, fixedPct: ratio(fixed + verified, total - wontFix), openBySeverity, bySeverityStatus };
}

function coverage(features) {
  const totalWeight = features.reduce((sum, f) => sum + (Number(f.weight) || 0), 0);
  const covered = features.reduce((sum, f) => sum + (Number(f.weight) || 0) * progress(f), 0);
  return {
    features: features.length,
    atTarget: features.filter(f => idx(f.current_level) >= idx(f.target_level)).length,
    weightedPct: ratio(covered, totalWeight),
  };
}

/** Features with open issues, worst first: score, then open count, then file order (features, then unknown ids). */
function byFeature(features, open) {
  const ids = [...new Set([...features.map(f => f.id), ...open.map(i => i.feature)])];
  const name = Object.fromEntries(features.map(f => [f.id, f.name]));
  return ids
    .map(id => {
      const mine = open.filter(i => i.feature === id);
      const counts = zeros(() => 0);
      for (const i of mine) counts[sevKey(i)]++;
      const score = mine.reduce((sum, i) => sum + SEVERITY_WEIGHT[sevKey(i)], 0);
      return { feature: id, name: name[id] ?? id, open: counts, score, n: mine.length };
    })
    .filter(f => f.n > 0)
    .sort((a, b) => b.score - a.score || b.n - a.n)
    .map(({ n, ...row }) => row);
}

/**
 * summarize(data, { categories }) → { issues, coverage, byFeature, hotspot, quickWins,
 * triage, plan }. Pure and deterministic. `hotspot.worst.severity`
 * is the severity bucket, so an issue without a severity reads 'unrated'.
 */
export function summarize(data, { categories = resolveCategories() } = {}) {
  const { features = [], issues = [] } = data;
  const open = issues.filter(i => i.status === 'open');
  const rows = byFeature(features, open);
  const top = rows[0];
  let hotspot = null;
  if (top) {
    const rank = i => SEVERITY_KEYS.indexOf(sevKey(i));
    const worst = open.filter(i => i.feature === top.feature).reduce((w, i) => (rank(i) < rank(w) ? i : w));
    hotspot = { feature: top.feature, name: top.name, score: top.score, worst: { id: worst.id, title: worst.title, severity: sevKey(worst) } };
  }
  return {
    issues: issueCounts(issues),
    coverage: coverage(features),
    byFeature: rows,
    hotspot,
    quickWins: open.filter(i => typeof i.complexity === 'number' && i.complexity <= QUICK_WIN_MAX).length,
    triage: triageQueue({ issues, assessments: data.assessments }, categories).length,
    plan: nextRunPlan({ features }).slice(0, 3).map(({ id, name, reason }) => ({ id, name, reason })),
  };
}
