import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { esc } from './format.mjs';

const DATA_FILES = [
  ['features', 'Features'],
  ['issues', 'Issues'],
  ['runs', 'Runs'],
];

const formatAge = ageMs => {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

function sourceActivity(name, file, now, staleAfterMs, cutoffValid) {
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch (error) {
    return {
      name,
      file,
      status: error.code === 'ENOENT' ? 'never' : 'unknown',
      lastUpdatedAt: null,
      ageMs: null,
    };
  }

  if (!Number.isFinite(mtimeMs) || mtimeMs > now || !cutoffValid) {
    return { name, file, status: 'unknown', lastUpdatedAt: null, ageMs: null };
  }

  const ageMs = now - mtimeMs;
  return {
    name,
    file,
    status: ageMs <= staleAfterMs ? 'fresh' : 'stale',
    lastUpdatedAt: new Date(mtimeMs).toISOString(),
    ageMs,
  };
}

/**
 * Summarize freshness from the actual modification times of tracker data files.
 * `files` is the store's config.files object; generated STATUS/SURFACES outputs
 * are intentionally excluded because they are not source data.
 */
export function trackerActivity(files, now = Date.now(), staleAfterMs = 600_000) {
  const cutoffValid = Number.isFinite(staleAfterMs) && staleAfterMs >= 0 && Number.isFinite(now);
  const sources = DATA_FILES
    .filter(([key]) => typeof files?.[key] === 'string')
    .map(([key, label]) => sourceActivity(label, files[key], now, staleAfterMs, cutoffValid));

  const surfacesDir = files?.surfacesDir;
  if (typeof surfacesDir === 'string') {
    try {
      const surfaceFiles = readdirSync(surfacesDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.yaml'))
        .map(entry => entry.name)
        .sort();
      for (const name of surfaceFiles) {
        const file = path.join(surfacesDir, name);
        sources.push(sourceActivity(`Surface data: ${name}`, file, now, staleAfterMs, cutoffValid));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        sources.push({ name: 'Surface data files', file: surfacesDir, status: 'unknown', lastUpdatedAt: null, ageMs: null });
      }
    }
  }

  const known = sources.filter(source => source.lastUpdatedAt).sort((a, b) => b.ageMs - a.ageMs);
  const latest = known.reduce((newest, source) => !newest || source.ageMs < newest.ageMs ? source : newest, null);
  const overall = latest
    ? { status: latest.status, lastUpdatedAt: latest.lastUpdatedAt, ageMs: latest.ageMs }
    : { status: sources.length && sources.every(source => source.status === 'never') ? 'never' : 'unknown', lastUpdatedAt: null, ageMs: null };

  return { overall, sources };
}

/** Render a safe, compact HTML view of tracker data freshness. */
export function renderActivity(activity) {
  const overall = activity?.overall ?? { status: 'unknown', lastUpdatedAt: null, ageMs: null };
  const sources = Array.isArray(activity?.sources) ? activity.sources : [];
  const overallTime = overall.lastUpdatedAt
    ? `${esc(overall.lastUpdatedAt)} (${esc(formatAge(overall.ageMs))})`
    : 'No known data update';
  const rows = sources.map(source => {
    const updated = source.lastUpdatedAt
      ? `${esc(source.lastUpdatedAt)} (${esc(formatAge(source.ageMs))})`
      : source.status === 'never' ? 'Never updated' : 'Update time unknown';
    return `<li class="activity-source"><span>${esc(source.name)}</span><span class="activity-status activity-${esc(source.status)}">${esc(source.status)}</span><time>${updated}</time></li>`;
  }).join('');

  return `<section class="activity" aria-label="Tracker data freshness"><h2>Data freshness</h2><p class="meta">Local file updates; stale after 10 minutes. Not agent activity or QA completion.</p><p class="activity-overall">Latest data update: <strong class="activity-status activity-${esc(overall.status)}">${esc(overall.status)}</strong> <time>${overallTime}</time></p>${rows ? `<details><summary>Update times by data source</summary><ul>${rows}</ul></details>` : '<p>No tracker data sources found.</p>'}</section>`;
}
