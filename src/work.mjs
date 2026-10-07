// The work loop an agent runs against the tracker: list issues in the order the
// dashboard shows them, take the next open one, and append dated notes to it.
// The order is the dashboard's (format.mjs), so the person watching the
// dashboard sees the agent work its open-issues table from the top.
import { ISSUE_STATUS, SEVERITIES } from './schema.mjs';
import { openOrder, closedOrder } from './format.mjs';

/**
 * listIssues(issues, { status, severity, feature, category }) → issues in dashboard order.
 * status: one of ISSUE_STATUS, 'closed' (everything but open) or 'all'; default 'open'.
 * Open issues sort by severity then complexity; closed ones by status then severity.
 */
export function listIssues(issues, { status = 'open', severity, feature, category } = {}) {
  if (!['all', 'closed', ...ISSUE_STATUS].includes(status))
    throw new Error(`status must be one of all|closed|${ISSUE_STATUS.join('|')}, got "${status}"`);
  if (severity !== undefined && !SEVERITIES.includes(severity))
    throw new Error(`severity must be one of ${SEVERITIES.join('|')}, got "${severity}"`);
  const keep = i =>
    (status === 'all' || (status === 'closed' ? i.status !== 'open' : i.status === status))
    && (severity === undefined || i.severity === severity)
    && (feature === undefined || i.feature === feature)
    && (category === undefined || i.category === category);
  const open = issues.filter(i => i.status === 'open' && keep(i)).sort(openOrder);
  const closed = issues.filter(i => i.status !== 'open' && keep(i)).sort(closedOrder);
  return [...open, ...closed];
}

/** nextIssue(issues, filters) → the first open issue in dashboard order, or null. */
export const nextIssue = (issues, filters = {}) => listIssues(issues, { ...filters, status: 'open' })[0] ?? null;

/** One line per issue: id, severity, complexity, feature, status (when not open), title. */
export function formatIssueLine(i, width = 0) {
  const cx = i.complexity == null ? 'cx-' : `cx${i.complexity}`;
  const status = i.status === 'open' ? '' : `  [${i.status}]`;
  return `${i.id.padEnd(width)}  ${(i.severity ?? 'unrated').padEnd(8)} ${cx.padEnd(4)} ${i.feature}${status}  ${i.title}`;
}

/**
 * appendNote(details, note, date) → details with "YYYY-MM-DD: note" as a new paragraph.
 * The note is one paragraph: newlines inside it are folded to spaces, so it
 * can come straight from a shell argument or a file.
 */
export function appendNote(details, note, date) {
  const text = String(note ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (!text) throw new Error('note text is empty');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
  return [details, `${date}: ${text}`].filter(Boolean).join('\n\n');
}
