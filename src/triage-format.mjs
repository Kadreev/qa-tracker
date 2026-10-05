// Pure formatters for the triage CLI: queue lines, and what `get` shows about an
// issue's triage (latest assessment and the warnings that name it).
import { latestFor } from './assessments.mjs';
import { shownConfidence } from './assess.mjs';
import { TRIAGE_FIELDS } from './schema.mjs';
import { pct } from './format.mjs';

/**
 * formatTriageLine(item) → one human line for a triageQueue item, e.g.
 * `QA-3  severity  disagrees  low → medium (90%)  Jev suggests medium (90%)`.
 * The ` → …` part is left out when Jev has no suggestion.
 */
export function formatTriageLine({ issue, field, kind, current, suggested, confidence, reason }) {
  const arrow = suggested == null ? '' : ` → ${suggested}${confidence == null ? '' : ` (${pct(confidence)})`}`;
  return `${issue}  ${field}  ${kind}  ${current ?? '—'}${arrow}  ${reason}`;
}

/** warningsFor(warnings, issueId) → the check() warnings that name the issue, in order. */
export function warningsFor(warnings, issueId) {
  return warnings.filter(w => w.startsWith(`issue ${issueId}:`) || (w.startsWith('assessment ') && w.includes(`: issue ${issueId} `)));
}

/** latestAssessment(assessments, issueId) → { id, model, judgments } of the newest assessment naming the issue, or null. */
export function latestAssessment(assessments, issueId) {
  const latest = latestFor(assessments, issueId);
  return latest ? { id: latest.entry.id, model: latest.entry.model, judgments: latest.entry.issues[issueId] } : null;
}

/** formatLatestAssessment(latest) → the `latest assessment:` line and one indented line per judgment. */
export function formatLatestAssessment(latest) {
  const lines = [`latest assessment: ${latest ? latest.id : 'none'}`];
  for (const field of TRIAGE_FIELDS) {
    const j = latest?.judgments?.[field];
    if (j && typeof j === 'object') lines.push(`  ${field}: ${j.value} (${pct(shownConfidence(field, j))})`);
  }
  return lines;
}
