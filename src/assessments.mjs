// Read helpers for assessments.yaml, the append-only log of Jev judgments.
//
// The log's order is its file order: "later" always means "further down the
// file". Every helper tolerates malformed entries (validation reports them) so
// a bad hand edit never makes a lookup throw.
const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
const entries = assessments => (Array.isArray(assessments) ? assessments : []);
const mentions = (entry, issueId) => isMapping(entry) && isMapping(entry.issues) && Object.hasOwn(entry.issues, issueId);

/** assessmentIndex(assessments, id) → position in file order, or -1 when absent. */
export function assessmentIndex(assessments, id) {
  return entries(assessments).findIndex(e => isMapping(e) && e.id === id);
}

/**
 * judgmentOf(assessments, asmId, issueId, field) → the judgment object
 * (`{ value, confidence, … }`) that assessment `asmId` gave `issueId` for
 * `field`, or undefined when the assessment, issue or field is missing.
 */
export function judgmentOf(assessments, asmId, issueId, field) {
  const entry = entries(assessments)[assessmentIndex(assessments, asmId)];
  if (!mentions(entry, issueId)) return undefined;
  const judgment = entry.issues[issueId]?.[field];
  return isMapping(judgment) ? judgment : undefined;
}

/**
 * latestFor(assessments, issueId) → { entry, index } for the last assessment in
 * file order that includes `issueId`, or null when none does.
 */
export function latestFor(assessments, issueId) {
  const list = entries(assessments);
  for (let index = list.length - 1; index >= 0; index--)
    if (mentions(list[index], issueId)) return { entry: list[index], index };
  return null;
}
