// Presentation helpers shared by the Markdown snapshots (STATUS.md, SURFACES.md)
// and the HTML dashboard, so the two views cannot drift apart.

/** Matrix glyph for a dimension status. */
export const DIM_ICON = { pass: '✅', issues: '⚠️', unknown: '❔' };

/** Sort rank for issue severity, most severe first. */
export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Make a value safe inside a Markdown table cell: escape pipes, fold newlines. */
export const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
