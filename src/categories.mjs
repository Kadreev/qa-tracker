// Issue categories: the default list and the per-project override.
//
// Each category has a `type` (the existing issue type it implies) and a
// `description` that doubles as the criterion Jev is asked about. A project's
// qa-tracker.config.json may replace the list; `other` is reserved and always last.
import { FEATURE_ID, ISSUE_TYPES } from './schema.mjs';

/** Most config entries allowed; with `other` appended the list stays at 255. */
const MAX_CONFIG_CATEGORIES = 254;

/** The default categories, in display order (`other` is appended separately). */
export const DEFAULT_CATEGORIES = [
  { name: 'functional', type: 'functionality', description: 'A feature does the wrong thing or nothing: a button, form, flow or action fails to do what it should.' },
  { name: 'data', type: 'functionality', description: 'Displayed or stored data is wrong, stale, missing, duplicated or inconsistent.' },
  { name: 'error-handling', type: 'functionality', description: 'Failures are handled badly: crashes, misleading or unhelpful errors, missing empty or error states, input lost on failure.' },
  { name: 'integration', type: 'functionality', description: 'A problem at the boundary with another system: third-party service, API, e-mail, payments, sign-in provider, import or export.' },
  { name: 'ui-layout', type: 'usability', description: 'Visual presentation is broken: overlapping, misaligned or clipped elements, wrong responsive behaviour, broken styling.' },
  { name: 'usability', type: 'usability', description: 'It works but is confusing, slow to use or easy to get wrong: unclear labels, flow or feedback.' },
  { name: 'accessibility', type: 'usability', description: 'People using a keyboard, screen reader, zoom or high contrast cannot use it: missing focus, labels, contrast or semantics.' },
  { name: 'content', type: 'usability', description: 'Wrong, misleading, outdated or misspelled text, translations or images.' },
  { name: 'performance', type: 'code', description: 'Slow loading or interactions, excessive memory or network use, timeouts.' },
  { name: 'security', type: 'code', description: 'Data or capability exposed to someone who should not have it: authentication, permissions, injection, secrets.' },
  { name: 'code-quality', type: 'code', description: 'The code itself is the problem with no user-visible defect yet: dead code, duplication, fragile structure, missing tests, warnings.' },
];

/** The reserved fallback category; always last and never configurable. */
export const OTHER = { name: 'other', type: null, description: 'None of the other categories fits.' };

/**
 * resolveCategories(raw?) → Category[]
 * `raw` is the config file's `categories` object; `undefined` yields the defaults.
 * Entries keep config order with OTHER appended. Throws on a malformed entry.
 */
export function resolveCategories(raw) {
  if (raw === undefined) return [...DEFAULT_CATEGORIES, OTHER];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('categories must be an object of name -> { type, description }');
  }
  const names = Object.keys(raw);
  if (names.length > MAX_CONFIG_CATEGORIES) {
    throw new Error(`categories has ${names.length} entries; at most ${MAX_CONFIG_CATEGORIES} are allowed`);
  }
  const list = names.map(name => {
    if (name === OTHER.name) throw new Error('category "other" is reserved and added automatically');
    if (!FEATURE_ID.test(name)) throw new Error(`category "${name}": name must be kebab-case (a-z, 0-9, -)`);
    const entry = raw[name];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`category "${name}": must be an object with type and description`);
    }
    if (!ISSUE_TYPES.includes(entry.type)) {
      throw new Error(`category "${name}": type must be one of ${ISSUE_TYPES.join(', ')}`);
    }
    if (typeof entry.description !== 'string' || !entry.description.trim()) {
      throw new Error(`category "${name}": description must be a non-empty string`);
    }
    return { name, type: entry.type, description: entry.description };
  });
  return [...list, OTHER];
}

/** categoryByName(categories, name) → Category | undefined */
export function categoryByName(categories, name) {
  return categories.find(c => c.name === name);
}
