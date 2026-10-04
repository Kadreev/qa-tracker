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
import { flattenSurfaces, renderSurfaces } from './surfaces.mjs';
import { DIMS, LEVELS } from './schema.mjs';
import { selectIssues, assessAndCommit, assessJson, formatAssessReport, formatAssessLine, dryRunRequests, emptyAssessResult } from './assess.mjs';
import { triageQueue } from './triage-policy.mjs';
import { formatTriageLine, formatLatestAssessment, latestAssessment, warningsFor } from './triage-format.mjs';

const PKG = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const BOOLEAN_FLAGS = new Set(['json', 'force', 'help', 'version', 'allow-any-host', 'all', 'refresh', 'dry-run', 'assess', 'no-assess']);

export const HELP = `qa-tracker ${PKG.version} — evidence-based QA coverage tracking in plain YAML

Usage: qa-tracker <command> [options]

Setup
  init [--title "My App"]            scaffold ./qa-tracker (or --dir) with empty data files
  serve [--port 4300] [--host 127.0.0.1]
                                     local dashboard: edit in place, export PDF

Read
  status                             print the Markdown snapshot (STATUS.md) to stdout
  plan [--json]                      what to validate next, ranked
  get <id> [--json]                  one feature, issue or run (an issue also shows its triage
                                     provenance, latest Jev assessment and warnings)
  triage [--json]                    issues still needing a person: missing values and Jev disagreements
  surfaces [--json]                  the UI surface checklist (SURFACES.md) or flat JSON
  surface <id> [--json]              one surface
  validate                           check every rule; errors exit 1, warnings print and exit 0

Write (each validates the whole dataset first, then regenerates STATUS.md)
  add-feature <id> --name <name> --area <area> [--weight 1-5] [--target L0-L4]
                   [--routes /a,/b] [--notes <text>]
  add-issue --feature <id> --title <text> [--severity <critical|high|medium|low>]
            [--details <text>] [--category <name>] [--complexity 1-10]
            [--type code|functionality|usability] [--id <id>] [--source <url>]
            [--assess|--no-assess]   no severity: the issue lands in the triage queue; --assess
                                     sends it to Jev now, --no-assess skips jev.auto_assess
  add-run --blast-radius <read-only|sandbox|test-account> [--levels feat=L2,other=L3]
          [--features a,b] [--opened QA-1] [--verified QA-2] [--profiles x,y]
          [--report <path>] [--date YYYY-MM-DD] [--id run-…]
  set <feature> weight|target|reverify|functionality|usability|code_health <value>
  set <issue> status <open|fixed|wont-fix>   (verified-fixed: add-run --verified)
  set <issue> category|complexity|severity|details <value>
                                     an explicit value; confirms or overrides Jev's suggestion
  verdict <surface> <pass|broken|blocked|unchecked> --run <run-id> [--issues a,b] [--notes <text>]
  render                             rewrite STATUS.md (and SURFACES.md)

Triage (sends issue title, details, feature and surfaces to TypeSafe's Jev)
  assess [ids…] [--all] [--refresh] [--dry-run] [--json]
                                     judge category, complexity and severity of open issues
                                     that need triage (--refresh: also those Jev set; --all:
                                     every issue); confident answers are applied, the rest
                                     queued. Needs $TYPESAFE_API_KEY unless --dry-run
                                     (prints the request bodies as one JSON array)

Global options
  --dir <path>    data directory (default ./qa-tracker, or $QA_TRACKER_DIR)
  --root <path>   repo root that surface paths resolve against (default: the data dir's parent)
  --help, --version

Docs: ${PKG.homepage}`;

/**
 * Minimal argv parser: positionals, --flag, --key value, --key=value.
 * Throws when a value flag has no value (`serve --port` would otherwise mean port 1).
 * A boolean flag takes only true/1/false/0 after `=`, so `--assess=false` really is false.
 */
export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (eq > 0 && BOOLEAN_FLAGS.has(key)) {
      const b = { true: true, 1: true, false: false, 0: false }[a.slice(eq + 1).toLowerCase()];
      if (b === undefined) throw new Error(`--${key} takes no value (or true/false)`);
      opt[key] = b;
    } else if (eq > 0) opt[key] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(key)) opt[key] = true;
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${key} needs a value`);
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

  let pos, opt;
  try {
    ({ pos, opt } = parseArgs(argv));
  } catch (e) {
    return fail(e.message);
  }
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
    // --root is given relative to the cwd; the config file stores it relative to the data dir.
    const root = typeof opt.root === 'string'
      ? path.relative(cfg.dir, cfg.root).split(path.sep).join('/') || '.'
      : undefined;
    const res = initTracker(cfg.dir, { title, root, force: Boolean(opt.force) });
    if (!res.ok) return fail(res.error);
    createStore(resolveConfig({ dir: cfg.dir, root: cfg.root })).writeStatus();
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

  /** add-issue's opt-in assessment: never fails the add; any problem is a warning on stderr. */
  const autoAssess = async id => {
    const apiKey = (io.env ?? process.env).TYPESAFE_API_KEY;
    if (!apiKey) return err('warning: TYPESAFE_API_KEY is not set; the issue was saved without a Jev assessment\n');
    println(`sending ${id} to TypeSafe (api.typesafe.ai)…`);
    try {
      const result = await assessAndCommit({ store, ids: [id], apiKey, fetch: io.fetch, sleep: io.sleep });
      if (!result.judgments[id]) return err(`warning: Jev could not assess ${id}: ${result.failed[id] ?? 'no answer'}\n`);
      const data = store.data();
      const issue = data.issues.find(i => i.id === id) ?? { id };
      println(formatAssessLine(id, result.judgments[id], { issue, applied: result.applied[id] ?? [], queue: triageQueue(data, cfg.categories) }));
    } catch (e) {
      err(`warning: Jev assessment of ${id} failed: ${e.message}\n`);
    }
  };

  try {
    switch (cmd) {
      case 'status':
        out(store.renderStatus());
        return 0;
      case 'render':
        store.writeStatus();
        println(`wrote ${path.relative(process.cwd(), cfg.files.status)}`);
        return 0;
      case 'validate': {
        const { errors, warnings } = store.check();
        if (errors.length) { err(errors.join('\n') + '\n'); return 1; }
        for (const w of warnings) println(`warning: ${w}`);
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
        if (!d.issues.includes(hit)) { show(hit, opt.json); return 0; }
        const latest = latestAssessment(d.assessments, id);
        const warnings = warningsFor(store.check().warnings, id);
        if (opt.json) { show({ ...hit, latest_assessment: latest, warnings }, true); return 0; }
        const { triage, ...fields } = hit;
        show({ ...fields, triage: triage ?? 'none' }, false);
        for (const line of formatLatestAssessment(latest)) println(line);
        for (const w of warnings) println(`warning: ${w}`);
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
          reverify: () => {
            const b = { true: true, 1: true, false: false, 0: false }[value.toLowerCase()];
            if (b === undefined) throw new Error(`reverify must be true|false, got "${value}"`);
            return { kind: 'reverify', feature: id, value: b };
          },
          status: () => ({ kind: 'issue-status', issue: id, value }),
          category: () => ({ kind: 'issue-category', issue: id, value }),
          complexity: () => ({ kind: 'issue-complexity', issue: id, value: Number(value) }),
          severity: () => ({ kind: 'issue-severity', issue: id, value }),
          details: () => ({ kind: 'issue-details', issue: id, value }),
          ...Object.fromEntries(DIMS.map(d => [d, () => ({ kind: 'dimension', feature: id, dim: d, value })])),
        }[field];
        if (field === 'current_level') return fail('current_level only moves through a recorded run: qa-tracker add-run --levels');
        if (!change) return fail(`unknown field: ${field} (weight|target|reverify|${DIMS.join('|')}|status|category|complexity|severity|details)`);
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
        const issue = {
          id: opt.id, title: opt.title, details: opt.details, severity: opt.severity, category: opt.category,
          complexity: opt.complexity != null ? Number(opt.complexity) : undefined,
          type: opt.type, feature: opt.feature, source: opt.source, status: opt.status,
        };
        if (!issue.feature || typeof issue.title !== 'string')
          return fail('usage: add-issue --feature <id> --title <text> [--severity <critical|high|medium|low>]');
        const res = store.commit({ kind: 'add-issue', issue });
        const code = committed(res, r => `added issue ${r.id}`);
        if (res.ok && (cfg.jev.autoAssess || opt.assess) && !opt['no-assess']) await autoAssess(res.id);
        return code;
      }
      case 'triage': {
        const queue = triageQueue(store.data(), cfg.categories);
        if (opt.json) println(JSON.stringify(queue, null, 2));
        else if (!queue.length) println('Triage queue empty.');
        else for (const item of queue) println(formatTriageLine(item));
        return 0;
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
      case 'assess': {
        const sel = { ids: args, all: Boolean(opt.all), refresh: Boolean(opt.refresh) };
        const selected = selectIssues(store.data(), { ...sel, categories: cfg.categories });
        if (opt['dry-run']) { println(JSON.stringify(dryRunRequests(store, selected), null, 2)); return 0; }
        if (!selected.length) {
          println(opt.json ? JSON.stringify(assessJson(emptyAssessResult(), store.data(), cfg.categories), null, 2) : 'nothing to assess');
          return 0;
        }
        const apiKey = (io.env ?? process.env).TYPESAFE_API_KEY;
        if (!apiKey) return fail('TYPESAFE_API_KEY is not set; export it (or use --dry-run to see what would be sent)');
        const result = await assessAndCommit({ store, ...sel, apiKey, fetch: io.fetch, sleep: io.sleep });
        if (opt.json) println(JSON.stringify(assessJson(result, store.data(), cfg.categories), null, 2));
        else for (const line of formatAssessReport(result, store.data(), cfg.categories)) println(line);
        return Object.keys(result.failed).length ? 1 : 0;
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
