// Local dashboard server. Serves the tracker as a real page (so the browser's
// print-to-PDF works) and writes edits straight back to the YAML files through
// the store, which validates the whole dataset first.
//
// It binds to 127.0.0.1 by default and only accepts edits that are JSON,
// same-origin and addressed to a loopback Host — a page on another site cannot
// write to your tracker through your browser.
import http from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { STYLE, renderContent, esc } from './dashboard.mjs';

/** Change kinds the browser may send. Adding entities stays a CLI/agent action. */
export const BROWSER_KINDS = [
  'weight', 'target', 'reverify', 'dimension', 'issue-status',
  'issue-category', 'issue-complexity', 'issue-severity',
];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const hostname = host => String(host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * dataVersion(files) → a string that changes whenever a data file does (size and
 * mtime of the YAML files, the config and every surfaces file). The open page
 * polls it so a dashboard someone is watching follows CLI and agent writes.
 */
export function dataVersion(files) {
  const stamp = f => {
    try { const s = statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; }
  };
  const surfaceFiles = existsSync(files.surfacesDir)
    ? readdirSync(files.surfacesDir).sort().map(n => path.join(files.surfacesDir, n))
    : [];
  return [files.config, files.features, files.issues, files.runs, files.assessments, ...surfaceFiles].map(stamp).join('|');
}

/** The full HTML page: toolbar, content and the edit script. */
export function page(data, { title, categories, version = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%2316a34a'/%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' stroke='white' stroke-width='2' fill='none'/%3E%3C/svg%3E">
<style>${STYLE}</style></head>
<body><main id="app" data-version="${esc(version)}">
  <div id="toolbar">
    <button id="toggle-edit">✏️ Edit mode</button>
    <button id="export-pdf">⬇ Export PDF</button>
    <button id="toggle-theme">◐ Theme</button>
    <span id="save-status" role="status"></span>
    <span class="meta">Edits save straight to the YAML files.</span>
  </div>
  ${renderContent(data, { title, categories })}
</main>
<script>
(function () {
  var app = document.getElementById('app');
  var status = document.getElementById('save-status');
  function flash(msg, bad) { status.textContent = msg; status.style.color = bad ? 'var(--bad)' : 'var(--ok)'; }
  // Triage edits reload the page (the queue, sort order and Jev marks all change),
  // so edit mode is remembered for the tab.
  var EDIT_KEY = 'qa-tracker-editing';
  try { if (sessionStorage.getItem(EDIT_KEY) === '1') app.classList.add('editing'); } catch (err) { /* storage blocked */ }
  document.getElementById('toggle-edit').addEventListener('click', function () {
    var on = app.classList.toggle('editing');
    try { sessionStorage.setItem(EDIT_KEY, on ? '1' : '0'); } catch (err) { /* storage blocked */ }
  });
  document.getElementById('export-pdf').addEventListener('click', function () { app.classList.remove('editing'); window.print(); });
  document.getElementById('toggle-theme').addEventListener('click', function () {
    var r = document.documentElement;
    var dark = r.getAttribute('data-theme') ? r.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.setAttribute('data-theme', dark ? 'light' : 'dark');
  });
  // The data version this page was rendered from (see dataVersion on the server).
  var version = app.getAttribute('data-version');
  // A save from this page is not an outside change: take the new version as ours.
  function syncVersion() {
    fetch('/api/version').then(function (r) { return r.json(); }).then(function (j) { if (j && j.version) version = j.version; }).catch(function () {});
  }
  function save(change, onOk, onDone) {
    flash('Saving…');
    fetch('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) { flash('Saved ✓'); syncVersion(); if (onOk) onOk(); }
        else { flash((res.j && res.j.error) || 'Rejected', true); setTimeout(function () { location.reload(); }, 1500); }
      })
      .catch(function () { flash('Network error', true); })
      .then(function () { if (onDone) onDone(); });
  }
  // Follow writes made outside this page (the CLI, an agent): poll the data
  // version and reload when it changes, unless someone is editing here.
  var busy = function () {
    var el = document.activeElement;
    return app.classList.contains('editing') || (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
  };
  setInterval(function () {
    if (document.hidden || !version) return;
    fetch('/api/version').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.version || j.version === version) return;
      if (busy()) flash('Data changed on disk; reload to see it');
      else location.reload();
    }).catch(function () { /* server stopped; keep the page as it is */ });
  }, 3000);
  app.addEventListener('click', function (e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    var row = e.target.closest('tr');
    if (act === 'w+' || act === 'w-') {
      // The cell only changes once the save lands, so a second click before
      // then would send the same value; hold the row's buttons until it does.
      var btns = row.querySelectorAll('[data-act="w+"], [data-act="w-"]');
      var setBusy = function (busy) { for (var i = 0; i < btns.length; i++) btns[i].disabled = busy; };
      var cell = row.querySelector('.wv');
      var w = Math.min(5, Math.max(1, parseInt(cell.textContent, 10) + (act === 'w+' ? 1 : -1)));
      setBusy(true);
      save({ kind: 'weight', feature: row.dataset.feature, value: w }, function () { cell.textContent = w; }, function () { setBusy(false); });
    }
    if (act === 'reverify') save({ kind: 'reverify', feature: row.dataset.feature, value: e.target.checked });
  });
  var TRIAGE = { icategory: 'issue-category', icomplexity: 'issue-complexity', iseverity: 'issue-severity' };
  app.addEventListener('change', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'istatus')
      save({ kind: 'issue-status', issue: e.target.closest('tr').dataset.issue, value: e.target.value });
    else if (TRIAGE[act]) {
      var value = act === 'icomplexity' ? Number(e.target.value) : e.target.value;
      save({ kind: TRIAGE[act], issue: e.target.closest('tr').dataset.issue, value: value }, function () { location.reload(); });
    }
  });
})();
</script></body></html>`;
}

/** No Origin (curl, same-origin GET-style tools) passes; otherwise it must be this host and port. */
function sameOrigin(origin, host) {
  if (origin == null) return true;
  try {
    return new URL(origin).host === String(host ?? '').toLowerCase();
  } catch {
    return false; // "null" (sandboxed iframe, file://) and garbage
  }
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('request body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * createServer(store, { allowAnyHost }) → http.Server
 * `allowAnyHost` disables the loopback Host check; only set it when you
 * deliberately serve the dashboard on a trusted network.
 */
export function createServer(store, { allowAnyHost = false } = {}) {
  const { title, categories } = store.config;
  return http.createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: a hostile page that points its own name at
      // 127.0.0.1 still sends its own name as Host.
      if (!allowAnyHost && !LOOPBACK.has(hostname(req.headers.host)))
        return json(res, 403, { ok: false, error: 'forbidden host' });

      const url = new URL(req.url, 'http://localhost');
      // Build each body before writing headers: a malformed YAML file throws
      // while reading, and the catch below must still be able to answer.
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = page(store.data(), { title, categories, version: dataVersion(store.config.files) });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/api/data') return json(res, 200, store.data());
      if (req.method === 'GET' && url.pathname === '/api/version') return json(res, 200, { version: dataVersion(store.config.files) });
      if (req.method === 'POST' && url.pathname === '/api/edit') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
          return json(res, 415, { ok: false, error: 'expected application/json' });
        if (!sameOrigin(req.headers.origin, req.headers.host))
          return json(res, 403, { ok: false, error: 'cross-origin edit refused' });
        const raw = await readBody(req);
        let change;
        try {
          change = JSON.parse(raw || '{}');
        } catch {
          return json(res, 400, { ok: false, error: 'body is not valid JSON' });
        }
        if (change == null || typeof change !== 'object' || Array.isArray(change))
          return json(res, 400, { ok: false, error: 'body must be a JSON object' });
        if (!BROWSER_KINDS.includes(change.kind))
          return json(res, 400, { ok: false, error: `change kind not allowed from the dashboard: ${change.kind}` });
        const result = store.commit(change);
        return json(res, result.ok ? 200 : 400, result);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      const message = String(err?.message ?? err);
      console.error('[qa-tracker] request failed:', message);
      if (res.headersSent) return res.destroy();
      json(res, 500, { ok: false, error: message });
    }
  });
}
