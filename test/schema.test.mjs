// The schema exists in two places on purpose: src/schema.mjs is what the code
// enforces, docs/SCHEMA.md is what a person or an agent reads. These tests fail
// when they disagree, so the documented matrix cannot rot while the code moves on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LEVELS, LEVEL_MEANING, DIMS, DIM_STATUS, SEVERITIES, ISSUE_TYPES, ISSUE_STATUS,
  BLAST_RADIUS, MATRIX_COLUMNS, FEATURE_FIELDS, ISSUE_FIELDS, RUN_FIELDS,
  targetLevelForWeight, COMPLEXITY_LEVELS, TRIAGE_FIELDS, TRIAGE_SOURCES, ASSESSMENT_FIELDS, ASSESSMENT_ID,
} from '../src/schema.mjs';
import { DEFAULT_CATEGORIES } from '../src/categories.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(path.join(repo, 'docs', 'SCHEMA.md'), 'utf8');
const agents = readFileSync(path.join(repo, 'templates', 'AGENTS.md'), 'utf8');

test('every vocabulary value is documented in SCHEMA.md', () => {
  const vocab = [...LEVELS, ...DIMS, ...DIM_STATUS, ...SEVERITIES, ...ISSUE_TYPES, ...ISSUE_STATUS, ...BLAST_RADIUS];
  for (const value of vocab) assert.ok(doc.includes(value), `SCHEMA.md does not mention "${value}"`);
});

test('every ladder level carries the same meaning in the schema, SCHEMA.md and the agent guide', () => {
  for (const level of LEVELS) {
    const row = `| ${level} | ${LEVEL_MEANING[level]} |`;
    assert.ok(doc.includes(row), `SCHEMA.md has no ladder row "${row}"`);
    assert.ok(agents.includes(row), `templates/AGENTS.md has no ladder row "${row}"`);
  }
});

test('every matrix column appears in the documented matrix table', () => {
  for (const col of MATRIX_COLUMNS)
    assert.ok(doc.includes(`| ${col.label} |`), `SCHEMA.md is missing matrix column "${col.label}"`);
});

test('matrix columns declare a source and an owner', () => {
  for (const col of MATRIX_COLUMNS) {
    assert.ok(col.source, `column ${col.key} has no source field`);
    assert.ok(['user', 'run'].includes(col.owner), `column ${col.key} has an invalid owner`);
  }
});

test('user-owned fields are the ones a run must not overwrite, and the doc says so', () => {
  const userOwned = Object.entries(FEATURE_FIELDS).filter(([, s]) => s.owner === 'user').map(([n]) => n);
  assert.deepEqual(userOwned.sort(), ['area', 'name', 'routes', 'target_level', 'weight']);
  for (const f of userOwned) assert.ok(doc.includes(`\`${f}\``), `SCHEMA.md does not name user-owned field ${f}`);
});

test('every entity field spec names a type', () => {
  for (const [label, fields] of [['feature', FEATURE_FIELDS], ['issue', ISSUE_FIELDS], ['run', RUN_FIELDS]])
    for (const [name, spec] of Object.entries(fields)) assert.ok(spec.type, `${label}.${name} has no type`);
});

test('target level derives from weight as documented', () => {
  assert.deepEqual([5, 4, 3, 2, 1].map(targetLevelForWeight), ['L4', 'L4', 'L3', 'L2', 'L2']);
  assert.match(doc, /4–5 → L4, 3 → L3, 1–2 → L2/);
});

test('every default category and complexity level is documented in SCHEMA.md', () => {
  assert.equal(COMPLEXITY_LEVELS.length, 10);
  for (const c of DEFAULT_CATEGORIES) assert.ok(doc.includes(`\`${c.name}\``), `SCHEMA.md does not mention category "${c.name}"`);
  COMPLEXITY_LEVELS.forEach((text, i) =>
    assert.ok(doc.includes(`| ${i + 1} | ${text} |`), `SCHEMA.md has no complexity row for level ${i + 1}`));
});

test('the triage fields, sources and assessment fields are documented', () => {
  for (const name of ['details', 'category', 'complexity', 'triage'])
    assert.ok(name in ISSUE_FIELDS, `ISSUE_FIELDS lacks ${name}`);
  for (const name of [...Object.keys(ISSUE_FIELDS), ...Object.keys(ASSESSMENT_FIELDS), ...TRIAGE_FIELDS, ...TRIAGE_SOURCES])
    assert.ok(doc.includes(`\`${name}\``), `SCHEMA.md does not mention "${name}"`);
  assert.deepEqual(TRIAGE_FIELDS, ['severity', 'category', 'complexity']);
  assert.equal(ISSUE_FIELDS.severity.required, false);
  assert.ok(ASSESSMENT_ID.test('asm-2026-10-04') && ASSESSMENT_ID.test('asm-2026-10-04-2') && !ASSESSMENT_ID.test('asm-1'));
});
