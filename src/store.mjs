// Persistence: load the data, apply a validated change, keep STATUS.md and
// SURFACES.md regenerated. Used by both the server and the CLI.
//
//   const store = createStore(resolveConfig({ dir: 'qa-tracker' }));
//   store.commit({ kind: 'issue-status', issue: 'QA-1', value: 'fixed' });
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parse, parseDocument, isSeq, isMap } from 'yaml';
import { validate } from './validate.mjs';
import { applyChange } from './edit.mjs';
import { renderMarkdown } from './markdown.mjs';
import { loadSurfaceFiles, renderSurfaces, surfaceFile } from './surfaces.mjs';
import { SURFACE_VERDICTS } from './schema.mjs';

/** The tools write with lineWidth 0 so a one-field edit is a one-line diff. */
export const YAML_OUT = { lineWidth: 0 };
const ENTITIES = ['features', 'issues', 'runs'];

const readText = file => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/**
 * Write via a temp file and a rename, so a crash or a sync client (OneDrive,
 * Dropbox) never sees a truncated file: readers get the old or the new content.
 */
export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
const asList = v => (v == null ? [] : v);

export function createStore(cfg) {
  const { files } = cfg;
  const exists = p => existsSync(path.resolve(cfg.root, p));

  const readDocs = () => Object.fromEntries(ENTITIES.map(k => [k, parseDocument(readText(files[k]))]));

  const data = () => ({
    ...Object.fromEntries(ENTITIES.map(k => [k, asList(parse(readText(files[k])))])),
    surfaces: loadSurfaceFiles(files.surfacesDir),
  });

  const check = d => validate(d, { exists });

  function writeStatus(d = data()) {
    writeAtomic(files.status, renderMarkdown(d, { title: cfg.title }));
    if (d.surfaces.length)
      writeAtomic(files.surfaces, renderSurfaces(d.surfaces, { features: d.features, title: `${cfg.title} — UI surfaces` }));
    else rmSync(files.surfaces, { force: true }); // generated; stale once the last surfaces file is gone
  }

  /** Apply one change, validate the would-be dataset, then write. → { ok, id? } | { ok:false, error } */
  function commit(change, opts) {
    const docs = readDocs();
    const before = Object.fromEntries(ENTITIES.map(k => [k, docs[k].toString(YAML_OUT)]));
    const applied = applyChange(docs, change, opts);
    if (!applied.ok) return applied;

    const next = {
      ...Object.fromEntries(ENTITIES.map(k => [k, asList(docs[k].toJS())])),
      surfaces: loadSurfaceFiles(files.surfacesDir),
    };
    const errs = check(next);
    if (errs.length) return { ok: false, error: 'validation failed: ' + errs.join('; ') };

    for (const k of ENTITIES) {
      const out = docs[k].toString(YAML_OUT);
      if (out !== before[k]) writeAtomic(files[k], out);
    }
    writeStatus(next);
    return { ok: true, id: applied.id };
  }

  /**
   * Record a verdict on one surface. `run` is required for any verdict but
   * `unchecked`; `date` defaults to today (UTC). → { ok, file } | { ok:false, error }
   */
  function setVerdict({ id, verdict, run, issues, notes, date }) {
    if (!SURFACE_VERDICTS.includes(verdict)) return { ok: false, error: `verdict must be one of ${SURFACE_VERDICTS.join('|')}` };
    if (verdict !== 'unchecked' && !run) return { ok: false, error: `verdict ${verdict} needs --run <run-id>` };
    if (!existsSync(files.surfacesDir)) return { ok: false, error: `no surfaces directory at ${files.surfacesDir}` };

    for (const file of readdirSync(files.surfacesDir).filter(f => f.endsWith('.yaml')).sort()) {
      const full = path.join(files.surfacesDir, file);
      const doc = parseDocument(readFileSync(full, 'utf8'));
      const root = doc.contents;
      const node = findSurface(isSeq(root) ? root : (isMap(root) ? root.get('surfaces') : null), id);
      if (!node) continue;

      node.set('verdict', verdict);
      if (verdict === 'unchecked') node.delete('checked');
      else node.set('checked', `${date ?? new Date().toISOString().slice(0, 10)} (${run})`);
      if (issues !== undefined) {
        if (issues.length) node.set('issues', issues); else node.delete('issues');
      }
      if (notes !== undefined) node.set('notes', notes);

      // Validate against the would-be state before touching disk.
      const d = data();
      d.surfaces[d.surfaces.findIndex(s => s.file === file)] = surfaceFile(file, doc.toJS());
      const errs = check(d);
      if (errs.length) return { ok: false, error: 'validation failed: ' + errs.join('; ') };

      writeAtomic(full, doc.toString(YAML_OUT));
      writeStatus(d);
      return { ok: true, file };
    }
    return { ok: false, error: `unknown surface: ${id}` };
  }

  return { config: cfg, data, readDocs, validate: () => check(data()), writeStatus, commit, setVerdict };
}

function findSurface(seq, id) {
  if (!isSeq(seq)) return null;
  for (const item of seq.items) {
    if (!isMap(item)) continue;
    if (item.get('id') === id) return item;
    const hit = findSurface(item.get('children'), id);
    if (hit) return hit;
  }
  return null;
}
