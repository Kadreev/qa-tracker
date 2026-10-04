// Surfaces — the per-view UI capability inventory.
//
// Data lives in <data dir>/surfaces/*.yaml, one file per area, each a list of
// root surfaces (views) with nested `children`. This module loads, flattens,
// validates and renders them. Vocabulary comes from ./schema.mjs.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  SURFACE_KINDS, SURFACE_EFFECTS, SURFACE_COVERAGE, SURFACE_VERDICTS, READ_ONLY_EFFECTS,
} from './schema.mjs';

/** Read every surfaces/*.yaml (sorted by file name) → [{ file, area, roots }]. */
export function loadSurfaceFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.yaml')).sort().map(file => {
    const doc = parse(readFileSync(path.join(dir, file), 'utf8')) ?? {};
    return surfaceFile(file, doc);
  });
}

/** Normalise one parsed surfaces file: either a bare list or { area, surfaces }. */
export function surfaceFile(file, doc) {
  const area = doc?.area ?? file.replace(/\.yaml$/, '');
  const roots = Array.isArray(doc) ? doc : (doc?.surfaces ?? []);
  return { file, area, roots };
}

/** Depth-first flatten with inheritance of feature/route and a `depth`/`parent`. */
export function flattenSurfaces(files) {
  const out = [];
  const walk = (node, ctx) => {
    const feature = node.feature ?? ctx.feature;
    const route = node.route ?? ctx.route;
    const flat = { ...node, feature, route, area: ctx.area, file: ctx.file, depth: ctx.depth, parent: ctx.parent ?? null };
    delete flat.children;
    out.push(flat);
    for (const child of listOf(node.children))
      walk(child, { ...ctx, feature, route, depth: ctx.depth + 1, parent: node.id });
  };
  for (const { file, area, roots } of files)
    for (const root of listOf(roots)) walk(root, { file, area, depth: 0 });
  return out;
}

const isMapping = v => v != null && typeof v === 'object' && !Array.isArray(v);
/** The mapping items of a list; anything else is skipped (shapeErrors reports it). */
const listOf = v => (Array.isArray(v) ? v.filter(isMapping) : []);

/** Shape problems flattenSurfaces skips over: non-list roots/children, non-mapping items. */
function shapeErrors(files) {
  const errs = [];
  const walk = (list, file, where) => list.forEach((n, i) => {
    if (!isMapping(n)) return errs.push(`${where}: entry ${i + 1} must be a mapping, got ${JSON.stringify(n)}`);
    if (n.children == null) return;
    const at = `surface ${n.id ?? '(no id)'} [${file}]`;
    if (!Array.isArray(n.children)) errs.push(`${at}: children must be a list`);
    else walk(n.children, file, `${at} children`);
  });
  for (const { file, roots } of files) {
    if (roots != null && !Array.isArray(roots)) errs.push(`${file}: surfaces must be a list`);
    else walk(roots ?? [], file, file);
  }
  return errs;
}

const RUN_REF = /\((run-[\w-]+)/;
const ID_SHAPE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

/**
 * validateSurfaces(files, { featureIds, issueIds, runIds, runRadius }, { exists, root })
 * → error strings. `exists(p)` checks a repo-relative path; by default it resolves
 * against `root` (or the working directory).
 */
export function validateSurfaces(files, { featureIds, issueIds, runIds, runRadius }, opts = {}) {
  const exists = opts.exists ?? (p => existsSync(path.resolve(opts.root ?? process.cwd(), p)));
  const errs = shapeErrors(files);
  const flat = flattenSurfaces(files);
  const seen = new Set();
  for (const s of flat) {
    const at = `surface ${s.id ?? '(no id)'} [${s.file}]`;
    if (!s.id || typeof s.id !== 'string') { errs.push(`${at}: missing id`); continue; }
    if (seen.has(s.id)) errs.push(`${at}: duplicate id`);
    seen.add(s.id);
    if (!ID_SHAPE.test(s.id)) errs.push(`${at}: id must be dotted kebab-case segments`);
    if (s.parent && !s.id.startsWith(s.parent + '.'))
      errs.push(`${at}: id must extend parent id "${s.parent}."`);
    if (!s.feature) errs.push(`${at}: no feature (set it on the root)`);
    else if (!featureIds.has(s.feature)) errs.push(`${at}: unknown feature ${s.feature}`);
    if (!SURFACE_KINDS.includes(s.kind)) errs.push(`${at}: kind invalid: ${s.kind}`);
    if (s.kind === 'view' && !s.route) errs.push(`${at}: a view needs a route`);
    if (!s.name) errs.push(`${at}: missing name`);
    for (const f of ['ui', 'expected'])
      if (typeof s[f] !== 'string' || !s[f].trim()) errs.push(`${at}: ${f} must be a non-empty string`);
    if (!SURFACE_EFFECTS.includes(s.effect)) errs.push(`${at}: effect invalid: ${s.effect}`);
    if (!SURFACE_COVERAGE.includes(s.coverage)) errs.push(`${at}: coverage invalid: ${s.coverage}`);
    if (!SURFACE_VERDICTS.includes(s.verdict)) errs.push(`${at}: verdict invalid: ${s.verdict}`);
    if (s.coverage !== 'none' && !(s.test_refs?.length))
      errs.push(`${at}: coverage ${s.coverage} needs test_refs`);
    for (const p of s.test_refs ?? [])
      if (!exists(p)) errs.push(`${at}: test_refs path does not exist: ${p}`);
    if (s.component && !exists(s.component)) errs.push(`${at}: component path does not exist: ${s.component}`);
    if (s.verdict !== 'unchecked') {
      const ref = RUN_REF.exec(s.checked ?? '')?.[1];
      if (!ref) errs.push(`${at}: verdict ${s.verdict} needs checked "YYYY-MM-DD (run-id)"`);
      else if (!runIds.has(ref)) errs.push(`${at}: checked references unknown run ${ref}`);
      // A read-only run caps at L2 — "non-mutating interactions work". It was
      // never permitted to press a control that writes, runs or calls out, so
      // it cannot be the evidence behind a pass on one.
      else if (
        s.verdict === 'pass'
        && !READ_ONLY_EFFECTS.includes(s.effect)
        && runRadius?.get(ref) === 'read-only'
      ) errs.push(`${at}: run ${ref} is read-only and cannot pass an effect: ${s.effect} surface`);
    }
    if (s.verdict === 'broken' && !(s.issues?.length)) errs.push(`${at}: verdict broken needs at least one issue id`);
    for (const i of s.issues ?? []) if (!issueIds.has(i)) errs.push(`${at}: unknown issue ref ${i}`);
    if (s.verdict === 'blocked' && !(s.notes?.trim())) errs.push(`${at}: verdict blocked needs notes with the reason`);
  }
  return errs;
}

/** Per-feature roll-up used by STATUS.md, SURFACES.md and the dashboard. */
export function surfaceStats(flat) {
  const by = new Map();
  for (const s of flat) {
    const k = s.feature ?? '(none)';
    const st = by.get(k) ?? { feature: k, total: 0, pass: 0, broken: 0, blocked: 0, unchecked: 0, e2e: 0, automated: 0 };
    st.total++;
    st[s.verdict] = (st[s.verdict] ?? 0) + 1;
    if (s.coverage === 'e2e') st.e2e++;
    if (s.coverage !== 'none') st.automated++;
    by.set(k, st);
  }
  return [...by.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

const GLYPH = { pass: '✅', broken: '❌', blocked: '⛔', unchecked: '⬜' };
const COV = { none: '', contract: ' `contract`', unit: ' `unit`', e2e: ' `e2e`' };
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Render the nested checklist. Deterministic; no timestamps. */
export function renderSurfaces(files, { features = [], title = 'UI Capability Inventory' } = {}) {
  const flat = flattenSurfaces(files);
  const stats = surfaceStats(flat);
  const featName = Object.fromEntries(features.map(f => [f.id, f.name]));
  const total = flat.length;
  const n = v => flat.filter(s => s.verdict === v).length;

  const statRows = stats.map(s =>
    `| ${cell(featName[s.feature] ?? s.feature)} | \`${s.feature}\` | ${s.total} | ${s.pass} | ${s.broken} | ${s.blocked} | ${s.unchecked} | ${s.e2e} / ${s.automated} |`).join('\n');

  const line = s => {
    const indent = '  '.repeat(s.depth);
    const iss = s.issues?.length ? ` → ${s.issues.join(', ')}` : '';
    const chk = s.checked ? ` _(${cell(s.checked)})_` : '';
    const eff = READ_ONLY_EFFECTS.includes(s.effect) ? '' : ` **${s.effect}**`;
    return `${indent}- ${GLYPH[s.verdict] ?? '⬜'} **${cell(s.name)}** \`${s.id}\` · ${s.kind}${eff}${COV[s.coverage] ?? ''}${iss}${chk}\n`
      + `${indent}  ${cell(s.ui)} → _${cell(s.expected)}_`;
  };

  const sections = files.map(({ area, roots }) => {
    const rootsFlat = flattenSurfaces([{ file: '', area, roots }]);
    const byRoot = listOf(roots).map(r => {
      const members = rootsFlat.filter(s => s.id === r.id || s.id.startsWith(r.id + '.'));
      return `### ${cell(r.name)} — \`${cell(r.route)}\`\n\n` + members.map(line).join('\n');
    }).join('\n\n');
    return `## ${cell(area)}\n\n${byRoot}`;
  }).join('\n\n');

  const never = flat.filter(s => s.verdict === 'unchecked' && s.coverage === 'none');
  const neverRows = never.map(s => `| \`${s.id}\` | ${s.kind} | ${s.effect} | ${cell(s.route)} |`).join('\n');

  const broken = flat.filter(s => s.verdict === 'broken');
  const brokenRows = broken.map(s => `| \`${s.id}\` | ${cell(s.name)} | ${(s.issues ?? []).join(', ')} | ${cell(s.checked)} |`).join('\n');

  return `# ${cell(title)}

_${total} surfaces · ✅ ${n('pass')} pass · ❌ ${n('broken')} broken · ⛔ ${n('blocked')} blocked · ⬜ ${n('unchecked')} never checked · ${never.length} with neither a browser check nor an automated test._

> Generated from \`surfaces/*.yaml\` — do not edit by hand; run \`qa-tracker render\`.

Legend: ✅ pass · ❌ broken (finding id follows) · ⛔ blocked · ⬜ unchecked. A bold effect (**mutate**, **run**, **external**) means exercising it changes data, costs compute or leaves the app. \`contract\` / \`unit\` / \`e2e\` is the automated coverage that exists today.

## Roll-up by feature
| Feature | id | Surfaces | ✅ | ❌ | ⛔ | ⬜ | e2e / any automated |
|---|---|---|---|---|---|---|---|
${statRows || '| — | — | 0 | 0 | 0 | 0 | 0 | 0 / 0 |'}

## Broken now
| Surface | Name | Findings | Checked |
|---|---|---|---|
${brokenRows || '| — | none | — | — |'}

${sections}

## Never checked and not automated
| Surface | Kind | Effect | Route |
|---|---|---|---|
${neverRows || '| — | — | — | none |'}
`;
}
