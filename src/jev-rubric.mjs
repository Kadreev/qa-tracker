// The Jev request: per-issue state and the three fixed questions.
//
// Pure — no filesystem, network or clock. `buildRequest` produces the JSON body
// for POST https://api.typesafe.ai/v1/systemone. Recorded labels (severity, type,
// category, complexity, triage, status, source) are never put in the state, so
// Jev's answers stay independent of them. Bump RUBRIC_VERSION whenever the
// instructions, complexity levels, severity criteria or state shape change.
import { COMPLEXITY_LEVELS } from './schema.mjs';
import { flattenSurfaces } from './surfaces.mjs';

/** Version of the code-owned rubric text; stored with each assessment. */
export const RUBRIC_VERSION = 1;
/** Most characters of an issue's details sent to Jev. */
export const DETAILS_MAX = 4000;
/** The model requested from the API. */
export const MODEL = 'jev-latest';

const TRUNCATED = ' […truncated]';

const SEVERITY_CRITERIA = {
  critical: 'data loss, a security hole, or a core flow blocked for everyone',
  high: 'a core flow broken for some people, or with no reasonable workaround',
  medium: 'degraded, with a workaround',
  low: 'cosmetic or a minor annoyance',
};

/**
 * buildState(issue, data, { title }) → state object (spec §5.1).
 * `data` is { features, surfaces, … }. Optional keys that are empty or unknown
 * (details, feature, routes, surfaces) are omitted.
 */
export function buildState(issue, data, { title }) {
  const state = { app: title, issue: { title: issue.title } };
  if (typeof issue.details === 'string' && issue.details.trim()) {
    state.issue.details = issue.details.length > DETAILS_MAX
      ? issue.details.slice(0, DETAILS_MAX) + TRUNCATED
      : issue.details;
  }

  const feature = (data.features ?? []).find(f => f.id === issue.feature);
  if (feature) {
    state.feature = { name: feature.name, area: feature.area };
    if (feature.routes?.length) state.feature.routes = [...feature.routes];
  }

  const surfaces = flattenSurfaces(data.surfaces ?? [])
    .filter(s => s.issues?.includes(issue.id))
    .map(s => ({ name: s.name, ui: s.ui, expected: s.expected, effect: s.effect }));
  if (surfaces.length) state.surfaces = surfaces;
  return state;
}

/**
 * buildQuestions(categories) → { category, complexity, severity } (spec §5.2).
 * `categories` is resolveCategories() output: `other` last, criteria in that order.
 */
export function buildQuestions(categories) {
  return {
    category: {
      type: 'choice',
      instructions: 'What kind of defect does `issue` describe? Judge the problem itself, not the feature it sits in.',
      criteria: Object.fromEntries(categories.map(c => [c.name, c.description])),
    },
    complexity: {
      type: 'score',
      instructions: 'How much engineering work would a typical developer on this app need to fix `issue`, including tests? Judge the likely fix, not how harmful the problem is.',
      criteria: [...COMPLEXITY_LEVELS],
    },
    severity: {
      type: 'choice',
      instructions: 'How badly does `issue` hurt the people using the app? Judge the harm to users, not how hard it is to fix.',
      criteria: { ...SEVERITY_CRITERIA },
    },
  };
}

/** buildRequest(issue, data, { title, categories }) → { model, state, questions } */
export function buildRequest(issue, data, { title, categories }) {
  return {
    model: MODEL,
    state: buildState(issue, data, { title }),
    questions: buildQuestions(categories),
  };
}
