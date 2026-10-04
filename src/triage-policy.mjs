// Triage policy: when a Jev judgment may be applied, and what still needs a person.
//
// Pure decision logic (no fs, network or clock) shared by the add-assessment edit,
// the assess command and the renderers. The rules are those of the triage spec:
// gates (§3.1), provenance and the apply rule (§2.2, §3.2), the queue (§3.3) and
// the mapping of API answers to stored judgments (§5.3).
import { categoryByName, OTHER } from './categories.mjs';
import { assessmentIndex, judgmentOf, latestFor } from './assessments.mjs';
import { SEVERITIES, TRIAGE_FIELDS } from './schema.mjs';
import { pct } from './format.mjs';

/** Gate thresholds: a judgment is applied only at or above these (§3.1). */
export const CATEGORY_MIN = 0.70;
export const COMPLEXITY_MIN_TOP = 0.50;
export const SEVERITY_MIN = 0.85;
/** Complexity levels must differ by at least this much to count as a disagreement. */
export const COMPLEXITY_DISAGREE_LEVELS = 2;

const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
const isAbsent = v => v === undefined || v === null;
/** The number a field's gate looks at: `top` for complexity, `confidence` otherwise. */
const gateConfidence = (field, judgment) => (field === 'complexity' ? judgment.top : judgment.confidence);

function answerOf(answers, field, type) {
  const answer = isMapping(answers) ? answers[field] : undefined;
  if (!isMapping(answer)) throw new Error(`${field}: no answer`);
  if (answer.type !== type) throw new Error(`${field}: expected a ${type} answer, got ${answer.type ?? 'none'}`);
  if (typeof answer.confidence !== 'number') throw new Error(`${field}: confidence must be a number`);
  if (!isMapping(answer.probabilities)) throw new Error(`${field}: probabilities must be an object`);
  return answer;
}

function mapChoice(answers, field, options) {
  const answer = answerOf(answers, field, 'choice');
  if (!options.includes(answer.choice)) throw new Error(`${field}: "${answer.choice}" is not one of the options asked`);
  return { value: answer.choice, confidence: answer.confidence, probabilities: { ...answer.probabilities } };
}

/** API levels "0"…"9" become complexity "1"…"10"; the most likely level wins, ties to the lower. */
function mapScore(answers) {
  const answer = answerOf(answers, 'complexity', 'score');
  if (typeof answer.score !== 'number') throw new Error('complexity: score must be a number');
  const keys = Object.keys(answer.probabilities);
  if (!keys.length) throw new Error('complexity: probabilities are empty');
  const probabilities = {};
  let value = 0, top = -1;
  for (const key of keys.sort((a, b) => a - b)) {
    const p = answer.probabilities[key];
    if (!/^\d$/.test(key)) throw new Error(`complexity: level "${key}" is not one of the options asked`);
    if (typeof p !== 'number') throw new Error(`complexity: probability of level ${key} must be a number`);
    const level = Number(key) + 1;
    probabilities[level] = p;
    if (p > top) { value = level; top = p; }
  }
  return { value, top, score: answer.score + 1, confidence: answer.confidence, probabilities };
}

/**
 * mapAnswers(answers, categories) → { category, complexity, severity } stored judgments.
 * Throws `Error('<field>: …')` for a missing answer, a wrong answer type, or a
 * value outside the options asked.
 */
export function mapAnswers(answers, categories) {
  return {
    category: mapChoice(answers, 'category', categories.map(c => c.name)),
    complexity: mapScore(answers),
    severity: mapChoice(answers, 'severity', SEVERITIES),
  };
}

/** gatePasses(field, judgment, categories) → true when the judgment is confident enough to apply. */
export function gatePasses(field, judgment, categories) {
  if (!isMapping(judgment)) return false;
  if (field === 'category') {
    return judgment.confidence >= CATEGORY_MIN && judgment.value !== OTHER.name
      && categoryByName(categories, judgment.value) !== undefined;
  }
  if (field === 'complexity') return judgment.top >= COMPLEXITY_MIN_TOP;
  if (field === 'severity') return judgment.confidence >= SEVERITY_MIN;
  return false;
}

/**
 * isWritable(issue, field, assessments) → true when Jev may set the field: it is
 * absent, or it is a `jev` value that still equals what its assessment said.
 */
export function isWritable(issue, field, assessments) {
  const value = issue[field];
  if (isAbsent(value)) return true;
  const entry = issue.triage?.[field];
  if (entry?.source !== 'jev' || typeof entry.assessment !== 'string') return false;
  return judgmentOf(assessments, entry.assessment, issue.id, field)?.value === value;
}

/**
 * planApply(issue, judgments, { assessmentId, assessments, categories }) →
 * { values, type?, triage, applied }: the fields assessment `assessmentId` writes
 * (writable and past the gate), the `type` implied by an applied category, the
 * new `triage` entries, and the applied field names in TRIAGE_FIELDS order.
 */
export function planApply(issue, judgments, { assessmentId, assessments, categories }) {
  const plan = { values: {}, triage: {}, applied: [] };
  for (const field of TRIAGE_FIELDS) {
    const judgment = judgments?.[field];
    if (!isWritable(issue, field, assessments) || !gatePasses(field, judgment, categories)) continue;
    plan.values[field] = judgment.value;
    plan.triage[field] = { source: 'jev', assessment: assessmentId };
    plan.applied.push(field);
  }
  if ('category' in plan.values) plan.type = categoryByName(categories, plan.values.category).type;
  return plan;
}

const suggestion = (field, judgment) => (judgment
  ? { suggested: judgment.value, confidence: gateConfidence(field, judgment) }
  : { suggested: null, confidence: null });

function gapReason(field, judgment, categories) {
  if (!judgment) return 'not assessed';
  // Above the gate yet still a gap: the value was deleted, or the category listed later.
  if (gatePasses(field, judgment, categories)) return 'not applied (re-run assess)';
  if (field === 'category' && judgment.value === OTHER.name) return 'category other';
  if (field === 'category' && !categoryByName(categories, judgment.value)) return 'category not in list';
  return `low confidence (${pct(gateConfidence(field, judgment))})`;
}

/** A gap, or a category outside the list in effect. */
function needsTriage(issue, field, judgment, categories) {
  const current = issue[field] ?? null;
  const unlisted = field === 'category' && current !== null && !categoryByName(categories, current);
  if (current !== null && !unlisted) return null;
  const reason = unlisted ? 'category not in list' : gapReason(field, judgment, categories);
  return { kind: 'needs-triage', current, ...suggestion(field, judgment), reason };
}

/** An explicit value the latest confident assessment, newer than `seen`, says something new about. */
function disagreement(issue, field, latest, judgment, assessments, categories) {
  if (isWritable(issue, field, assessments) || !gatePasses(field, judgment, categories)) return null;
  const current = issue[field];
  const differs = field === 'complexity'
    ? Math.abs(judgment.value - current) >= COMPLEXITY_DISAGREE_LEVELS
    : judgment.value !== current;
  if (!differs) return null;
  const entry = issue.triage?.[field];
  const seen = entry?.source === 'set' && typeof entry.seen === 'string' ? entry.seen : null;
  const seenIndex = seen === null ? -1 : assessmentIndex(assessments, seen);
  if (latest.index <= seenIndex) return null;
  if (seenIndex >= 0 && judgmentOf(assessments, seen, issue.id, field)?.value === judgment.value) return null;
  const confidence = gateConfidence(field, judgment);
  return { kind: 'disagrees', current, suggested: judgment.value, confidence, reason: `Jev suggests ${judgment.value} (${pct(confidence)})` };
}

/**
 * triageQueue({ issues, assessments }, categories) → items for open issues, in file
 * order then TRIAGE_FIELDS order, at most one per field (`needs-triage` wins):
 * { issue, field, kind, current, suggested, confidence, reason }.
 */
export function triageQueue({ issues, assessments }, categories) {
  const queue = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!isMapping(issue) || issue.status !== 'open') continue;
    const latest = latestFor(assessments, issue.id);
    const judgments = latest ? latest.entry.issues[issue.id] : undefined;
    for (const field of TRIAGE_FIELDS) {
      const judgment = isMapping(judgments?.[field]) ? judgments[field] : undefined;
      const item = needsTriage(issue, field, judgment, categories)
        ?? disagreement(issue, field, latest, judgment, assessments, categories);
      if (item) queue.push({ issue: issue.id, field, ...item });
    }
  }
  return queue;
}
