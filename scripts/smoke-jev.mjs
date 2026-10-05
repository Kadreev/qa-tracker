// Live smoke test for the Jev integration (not part of `npm test`, not shipped in the package).
//
// Assesses demo issue QA-4 against the real TypeSafe API and prints the model and
// the mapped judgments as JSON. It writes nothing: no store.commit, no files.
// Needs TYPESAFE_API_KEY in the environment; without it the script says so and exits 0.
// The key is only handed to askJev and is never printed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/config.mjs';
import { createStore } from '../src/store.mjs';
import { buildRequest } from '../src/jev-rubric.mjs';
import { askJev } from '../src/jev-client.mjs';
import { mapAnswers } from '../src/triage-policy.mjs';

const ISSUE_ID = 'QA-4';
const apiKey = process.env.TYPESAFE_API_KEY;

if (!apiKey) {
  console.log('smoke:jev skipped — set TYPESAFE_API_KEY to run it');
  process.exit(0);
}

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo');
const cfg = resolveConfig({ dir: demo });
const data = createStore(cfg).data();
const issue = data.issues.find(i => i.id === ISSUE_ID);
if (!issue) {
  console.error(`smoke:jev: demo issue ${ISSUE_ID} not found`);
  process.exit(1);
}

try {
  const body = buildRequest(issue, data, { title: cfg.title, categories: cfg.categories });
  const res = await askJev(body, { apiKey });
  const judgments = mapAnswers(res.answers, cfg.categories);
  console.log(JSON.stringify({ issue: ISSUE_ID, model: res.model, judgments, usage: res.usage ?? null }, null, 2));
} catch (err) {
  console.error(`smoke:jev failed: ${err.message}`);
  process.exit(1);
}
