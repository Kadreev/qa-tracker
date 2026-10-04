// Presentation helpers shared by the Markdown snapshots (STATUS.md, SURFACES.md)
// and the HTML dashboard, so the two views cannot drift apart.

/** Matrix glyph for a dimension status. */
export const DIM_ICON = { pass: '✅', issues: '⚠️', unknown: '❔' };

/** Sort rank for issue severity, most severe first. */
export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Sort rank for a closed issue's status. */
export const STATUS_ORDER = { fixed: 0, 'verified-fixed': 1, 'wont-fix': 2 };

/** Make a value safe inside a Markdown table cell: escape pipes, fold newlines. */
export const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A 0-1 fraction as a whole percentage: 0.91 → '91%'. */
export const pct = x => Math.round(x * 100) + '%';

// Issue ordering shared by STATUS.md and the dashboard. Array.prototype.sort is
// stable, so ties keep file order.
const UNSET = 99; // sorts after every real rank
const rank = (order, key) => order[key] ?? UNSET;
const bySeverity = (a, b) => rank(SEV_ORDER, a.severity) - rank(SEV_ORDER, b.severity);
const byComplexity = (a, b) => (a.complexity ?? UNSET) - (b.complexity ?? UNSET);
const byStatus = (a, b) => rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status);

/** Open issues: severity, then complexity ascending; unset last in both. */
export const openOrder = (a, b) => bySeverity(a, b) || byComplexity(a, b);

/** Closed issues: status, then severity; unset severity last. */
export const closedOrder = (a, b) => byStatus(a, b) || bySeverity(a, b);
