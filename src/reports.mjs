import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { esc } from './format.mjs';
export const reportHref = file => '/reports?file=' + encodeURIComponent(file);
export function reportFiles(dir) {
  const root = path.join(dir, 'reports');
  const files = [];
  function walk(folder) {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && /\.(md|json)$/i.test(item.name)) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  try { walk(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return files.sort().reverse();
}
export function readReport(dir, file) {
  if (!file || !/\.(md|json)$/i.test(file)) return null;
  try {
    const root = realpathSync(path.join(dir, 'reports'));
    const target = realpathSync(path.resolve(root, file));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return readFileSync(target, 'utf8');
  } catch { return null; }
}
export function renderReports(dir) {
  const files = reportFiles(dir);
  return `<section id="reports"><h2>Reports and test evidence</h2><p class="meta">Recorded test counts, execution results, scope limits and evidence. Reports may overlap; their totals must not be added together.</p><details><summary>${files.length} report and evidence files</summary><ul>${files.map(f => `<li><a href="${esc(reportHref(f))}">${esc(f)}</a></li>`).join('')}</ul></details></section>`;
}
