// The qa-tracker command line. main(argv, io) → exit code; `serve` resolves once
// the server is listening and keeps the process alive.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createServer } from './server.mjs';
import { initTracker } from './init.mjs';
import { nextRunPlan } from './plan.mjs';
import { renderMarkdown } from './markdown.mjs';
import { flattenSurfaces, renderSurfaces } from './surfaces.mjs';
import { DIMS, LEVELS } from './schema.mjs';

const PKG = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const BOOLEAN_FLAGS = new Set(['json', 'force', 'help', 'version', 'allow-any-host']);

export const HELP = `qa-tracker ${PKG.version} — evidence-based QA coverage tracking in plain YAML

Usage: qa-tracker <command> [options]

Setup
  init [--title "My App"]            scaffold ./qa-tracker (or --dir) with empty data files
  serve [--port 4300] [--host 127.0.0.1]
                                     local dashboard: edit in place, export PDF

Read
  status                             print the Markdown snapshot (STATUS.md) to stdout
  plan [--json]                      what to validate next, ranked
  get <id> [--json]                  one feature or issue
  surfaces [--json]                  the UI surface checklist (SURFACES.md) or flat JSON
  surface <id> [--json]              one surface
  validate                           check every rule; non-zero exit on any error

Write (each validates the whole dataset first, then regenerates STATUS.md)
  add-feature <id> --name <name> --area <area> [--weight 1-5] [--target L0-L4]
                   [--routes /a,/b] [--notes <text>]
  add-issue --feature <id> --severity <critical|high|medium|low> --title <text>
            [--type code|functionality|usability] [--id <id>] [--source <url>]
  add-run --blast-radius <read-only|sandbox|test-account> [--levels feat=L2,other=L3]
          [--features a,b] [--opened QA-1] [--verified QA-2] [--profiles x,y]
          [--report <path>] [--date YYYY-MM-DD] [--id run-…]
  set <feature> weight|target|reverify|functionality|usability|code_health <value>
  set <issue> status <open|fixed|verified-fixed|wont-fix>
  verdict <surface> <pass|broken|blocked|unchecked> --run <run-id> [--issues a,b] [--notes <text>]
  render                             rewrite STATUS.md (and SURFACES.md)

Global options
  --dir <path>    data directory (default ./qa-tracker, or $QA_TRACKER_DIR)
  --root <path>   repo root that surface paths resolve against (default: the data dir's parent)
  --help, --version

Docs: ${PKG.homepage}`;

/** Minimal argv parser: positionals, --flag, --key value, --key=value. */
export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (eq > 0) opt[key] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) opt[key] = true;
    else opt[key] = argv[++i];
  }
  return { pos, opt };
}

const list = v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);

/** "--levels sign-in=L2,search=L3" (or "sign-in:L0->L2") → { feature: "Lcur->Lnew" } */
export function parseLevels(spec, features) {
  const out = {};
  for (const part of list(spec) ?? []) {
    const m = /^([a-z0-9-]+)(?:=|:)(?:(L[0-4])->)?(L[0-4])$/.exec(part);
    if (!m) throw new Error(`--levels entry must look like feature=L2, got "${part}"`);
    const from = m[2] ?? features.find(f => f.id === m[1])?.current_level;
    if (!from) throw new Error(`--levels: unknown feature ${m[1]}`);
    out[m[1]] = `${from}->${m[3]}`;
  }
  return out;
}

export async function main(argv, io = {}) {
  const out = io.out ?? (s => process.stdout.write(s));
  const err = io.err ?? (s => process.stderr.write(s));
  const println = s => out(s + '\n');
  const fail = msg => { err(`error: ${msg}\n`); return 1; };

  const { pos, opt } = parseArgs(argv);
  const [cmd, ...args] = pos;
  if (opt.version) { println(PKG.version); return 0; }
  if (!cmd || cmd === 'help' || opt.help) { println(HELP); return cmd && cmd !== 'help' && !opt.help ? 1 : 0; }

  let cfg;
  try {
    cfg = resolveConfig({ dir: opt.dir, root: opt.root, cwd: io.cwd, env: io.env });
  } catch (e) {
    return fail(e.message);
  }

  if (cmd === 'init') {
    const title = typeof opt.title === 'string' ? opt.title : `${path.basename(path.dirname(cfg.dir))} — QA Tracker`;
    const res = initTracker(cfg.dir, { title, force: Boolean(opt.force) });
    if (!res.ok) return fail(res.error);
    createStore(resolveConfig({ dir: cfg.dir })).writeStatus();
    for (const f of res.written) println(`created ${path.relative(io.cwd ?? process.cwd(), f) || f}`);
    println(`\nNext: qa-tracker add-feature <id> --name "…" --area "…" --weight 3${opt.dir ? ` --dir ${opt.dir}` : ''}`);
    return 0;
  }

  const store = createStore(cfg);
  const show = (obj, asJson) => {
    if (asJson) return println(JSON.stringify(obj, null, 2));
    for (const [k, v] of Object.entries(obj))
      println(`${k}: ${Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : v)}`);
  };
  const committed = (res, msg) => {
    if (!res.ok) return fail(res.error);
    println(`ok: ${msg(res)}  (STATUS.md regenerated)`);
    return 0;
  };

  try {
    switch (cmd) {
      case 'status':
        out(renderMarkdown(store.data(), { title: cfg.title }));
        return 0;
      case 'render':
        store.writeStatus();
        println(`wrote ${path.relative(process.cwd(), cfg.files.status)}`);
        return 0;
      case 'validate': {
        const errs = store.validate();
        if (errs.length) { err(errs.join('\n') + '\n'); return 1; }
        println('qa-tracker data valid');
        return 0;
      }
      case 'plan': {
        const plan = nextRunPlan(store.data());
        if (opt.json) { println(JSON.stringify(plan, null, 2)); return 0; }
        if (!plan.length) println('All features at target.');
        plan.forEach((p, i) => println(`${i + 1}. ${p.name} (${p.id}, w${p.weight}) — ${p.reason}`));
        return 0;
      }
      case 'get': {
        const [id] = args;
        if (!id) return fail('usage: get <id>');
        const d = store.data();
        const hit = d.features.find(f => f.id === id) ?? d.issues.find(i => i.id === id) ?? d.runs.find(r => r.id === id);
        if (!hit) return fail(`unknown id: ${id}`);
        show(hit, opt.json);
        return 0;
      }
      case 'surfaces': {
        const d = store.data();
        if (opt.json) { println(JSON.stringify(flattenSurfaces(d.surfaces), null, 2)); return 0; }
        out(renderSurfaces(d.surfaces, { features: d.features, title: `${cfg.title} — UI surfaces` }));
        return 0;
      }
      case 'surface': {
        const [id] = args;
        if (!id) return fail('usage: surface <id>');
        const hit = flattenSurfaces(store.data().surfaces).find(s => s.id === id);
        if (!hit) return fail(`unknown surface: ${id}`);
        show(hit, opt.json);
        return 0;
      }
      case 'verdict': {
        const [id, verdict] = args;
        if (!id || !verdict) return fail('usage: verdict <surface-id> <pass|broken|blocked|unchecked> --run <run-id> [--issues a,b] [--notes "…"]');
        const res = store.setVerdict({ id, verdict, run: opt.run, issues: list(opt.issues), notes: typeof opt.notes === 'string' ? opt.notes : undefined });
        return committed(res, () => `${id} verdict = ${verdict}`);
      }
      case 'set': {
        const [id, field, ...rest] = args;
        const value = rest.join(' ');
        if (!id || !field || !value) return fail('usage: set <id> <field> <value>');
        const change = {
          weight: () => ({ kind: 'weight', feature: id, value: Number(value) }),
          target: () => ({ kind: 'target', feature: id, value }),
          reverify: () => ({ kind: 'reverify', feature: id, value: value === 'true' || value === '1' }),
          status: () => ({ kind: 'issue-status', issue: id, value }),
          ...Object.fromEntries(DIMS.map(d => [d, () => ({ kind: 'dimension', feature: id, dim: d, value })])),
        }[field];
        if (field === 'current_level') return fail('current_level only moves through a recorded run: qa-tracker add-run --levels');
        if (!change) return fail(`unknown field: ${field} (weight|target|reverify|${DIMS.join('|')}|status)`);
        return committed(store.commit(change()), () => `${id} ${field} = ${value}`);
      }
      case 'add-feature': {
        const [id] = args;
        if (!id) return fail('usage: add-feature <id> --name <name> --area <area> [--weight 1-5]');
        if (opt.target && !LEVELS.includes(opt.target)) return fail(`--target must be one of ${LEVELS.join('|')}`);
        const feature = {
          id,
          name: typeof opt.name === 'string' ? opt.name : undefined,
          area: typeof opt.area === 'string' ? opt.area : undefined,
          weight: opt.weight != null ? Number(opt.weight) : undefined,
          target_level: opt.target,
          routes: list(opt.routes),
          notes: typeof opt.notes === 'string' ? opt.notes : undefined,
        };
        return committed(store.commit({ kind: 'add-feature', feature }), r => `added feature ${r.id}`);
      }
      case 'add-issue': {
        const issue = { id: opt.id, title: opt.title, severity: opt.severity, type: opt.type, feature: opt.feature, source: opt.source, status: opt.status };
        if (!issue.feature || !issue.severity || typeof issue.title !== 'string')
          return fail('usage: add-issue --feature <id> --severity <critical|high|medium|low> --title <text>');
        return committed(store.commit({ kind: 'add-issue', issue }), r => `added issue ${r.id}`);
      }
      case 'add-run': {
        if (!opt['blast-radius']) return fail('usage: add-run --blast-radius <read-only|sandbox|test-account> [--levels feat=L2]');
        const run = {
          id: opt.id,
          date: opt.date,
          blast_radius: opt['blast-radius'],
          profiles: list(opt.profiles),
          features_touched: list(opt.features),
          level_changes: parseLevels(opt.levels, store.data().features),
          issues_opened: list(opt.opened),
          issues_verified: list(opt.verified),
          report: opt.report,
        };
        return committed(store.commit({ kind: 'add-run', run }), r => `recorded ${r.id}`);
      }
      case 'serve': {
        const port = Number(opt.port ?? process.env.PORT ?? 4300);
        const host = typeof opt.host === 'string' ? opt.host : '127.0.0.1';
        const server = createServer(store, { allowAnyHost: Boolean(opt['allow-any-host']) });
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, host, resolve);
        });
        const shown = host === '127.0.0.1' || host === '::1' ? 'localhost' : host;
        println(`qa-tracker dashboard at http://${shown}:${server.address().port}  (Ctrl+C to stop)`);
        println(`Edits save to ${cfg.dir}`);
        io.onServer?.(server);
        return 0;
      }
      default:
        err(`unknown command: ${cmd}\n\n`);
        println(HELP);
        return 1;
    }
  } catch (e) {
    return fail(e.message);
  }
}
