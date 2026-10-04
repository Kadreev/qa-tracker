// Issue categories: the default list, the per-project override, and the config wiring.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCategories, categoryByName } from '../src/categories.mjs';
import { resolveConfig } from '../src/config.mjs';

const scratch = [];
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function configDir(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-tracker-cat-'));
  scratch.push(dir);
  if (config !== undefined) writeFileSync(path.join(dir, 'qa-tracker.config.json'), JSON.stringify(config));
  return dir;
}

test('default list has 11 categories plus other last', () => {
  const c = resolveCategories();
  assert.equal(c.length, 12);
  assert.equal(c.at(-1).name, 'other');
  assert.equal(categoryByName(c, 'accessibility').type, 'usability');
  assert.equal(categoryByName(c, 'security').type, 'code');
  assert.equal(categoryByName(c, 'nope'), undefined);
});

test('a config list replaces the defaults and keeps its order', () => {
  const c = resolveCategories({
    visual: { type: 'usability', description: 'x' },
    checkout: { type: 'functionality', description: 'y' },
  });
  assert.deepEqual(c.map(e => e.name), ['visual', 'checkout', 'other']);
});

test('bad config entries throw', () => {
  const ok = { type: 'code', description: 'd' };
  assert.throws(() => resolveCategories({ 'Bad Name': ok }), /Bad Name/);
  assert.throws(() => resolveCategories({ a: { type: 'ux', description: 'd' } }), /"a"/);
  assert.throws(() => resolveCategories({ a: { type: 'code', description: ' ' } }), /"a"/);
  assert.throws(() => resolveCategories({ other: ok }), /other/);
  const many = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`c${i}`, ok]));
  assert.throws(() => resolveCategories(many), /254/);
});

test('resolveConfig reads categories and jev.auto_assess', () => {
  const cfg = resolveConfig({ dir: configDir({
    categories: { visual: { type: 'usability', description: 'x' } },
    jev: { auto_assess: true },
  }) });
  assert.equal(cfg.categories[0].name, 'visual');
  assert.equal(cfg.jev.autoAssess, true);

  const plain = resolveConfig({ dir: configDir({}) });
  assert.equal(plain.categories.length, 12);
  assert.equal(plain.jev.autoAssess, false);

  assert.throws(() => resolveConfig({ dir: configDir({ jev: { auto_assess: 'yes' } }) }), /auto_assess/);
  assert.throws(() => resolveConfig({ dir: configDir({ jev: { auto_assess: true, extra: 1 } }) }), /extra/);
  assert.throws(() => resolveConfig({ dir: configDir({ categories: { other: { type: 'code', description: 'd' } } }) }), /qa-tracker\.config\.json.*other/);
});
