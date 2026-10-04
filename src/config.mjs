// Resolves where the tracker's data lives and how it is presented.
//
// Precedence for the data directory: --dir flag > QA_TRACKER_DIR env > ./qa-tracker.
// An optional qa-tracker.config.json inside the data directory sets the title
// and the repo root that surface paths (`component`, `test_refs`) resolve against.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'qa-tracker.config.json';
export const DEFAULT_DIR = 'qa-tracker';
export const DEFAULT_TITLE = 'QA Validation Tracker';

/** Paths of every file the tracker reads or writes inside a data directory. */
export function filesIn(dir) {
  return {
    config: path.join(dir, CONFIG_FILE),
    features: path.join(dir, 'features.yaml'),
    issues: path.join(dir, 'issues.yaml'),
    runs: path.join(dir, 'runs.yaml'),
    status: path.join(dir, 'STATUS.md'),
    surfaces: path.join(dir, 'SURFACES.md'),
    surfacesDir: path.join(dir, 'surfaces'),
  };
}

/**
 * resolveConfig({ dir, root, cwd, env }) → { dir, root, title, files }
 * `dir` and `root` given here are relative to `cwd`; `root` in the config file
 * is relative to the data directory (default "..", the directory above it).
 */
export function resolveConfig({ dir, root, cwd = process.cwd(), env = process.env } = {}) {
  const dataDir = path.resolve(cwd, dir ?? env.QA_TRACKER_DIR ?? DEFAULT_DIR);
  const files = filesIn(dataDir);
  let raw = {};
  if (existsSync(files.config)) {
    try {
      raw = JSON.parse(readFileSync(files.config, 'utf8'));
    } catch (err) {
      throw new Error(`${files.config}: invalid JSON (${err.message})`);
    }
  }
  return {
    dir: dataDir,
    root: root != null ? path.resolve(cwd, root) : path.resolve(dataDir, raw.root ?? '..'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : DEFAULT_TITLE,
    files,
  };
}
