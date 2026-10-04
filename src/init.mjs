// `qa-tracker init`: scaffold a data directory from templates/.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG_FILE } from './config.mjs';

export const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

function copyTree(from, to, written) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (statSync(src).isDirectory()) copyTree(src, dst, written);
    else if (!existsSync(dst)) { writeFileSync(dst, readFileSync(src)); written.push(dst); }
  }
}

/**
 * initTracker(dir, { title, force }) → { ok, written } | { ok:false, error }
 * Never overwrites an existing file; refuses a directory that already holds a
 * tracker unless `force` (which still only adds the files that are missing).
 */
export function initTracker(dir, { title, root, force = false } = {}) {
  if (existsSync(path.join(dir, 'features.yaml')) && !force)
    return { ok: false, error: `${dir} already holds a tracker (features.yaml exists); pass --force to add any missing files` };
  const written = [];
  copyTree(TEMPLATES_DIR, dir, written);
  const configPath = path.join(dir, CONFIG_FILE);
  if (!existsSync(configPath)) {
    const config = { title: title ?? 'QA Validation Tracker', root: root ?? '..' };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    written.push(configPath);
  }
  return { ok: true, written };
}
