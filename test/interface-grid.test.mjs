import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInterfaceGrid } from '../src/interface-grid.mjs';

const sample = () => ({
  surfaces: [{
    file: 'pages.yaml', area: 'Pages <workspace>', roots: [{
      id: 'pages', feature: 'pages', kind: 'view', name: 'Pages & workspace', route: '/pages?x="<y>',
      verdict: 'pass', issues: ['BWE-1'],
      children: [
        { id: 'pages.table', kind: 'table', name: 'Page table', verdict: 'broken', issues: ['BWE-1'] },
        { id: 'pages.filters', kind: 'control', name: 'Filters', verdict: 'unchecked', children: [
          { id: 'pages.filters.url', kind: 'control', name: 'URL filter', verdict: 'blocked', feature: 'other' },
        ] },
      ],
    }],
  }],
  issues: [
    { id: 'BWE-1', status: 'open', severity: 'high', feature: 'elsewhere' },
    { id: 'BWE-2', status: 'open', severity: 'medium', feature: 'pages' },
    { id: 'BWE-3', status: 'open', severity: 'unrated', feature: 'pages' },
    { id: 'BWE-4', status: 'fixed', severity: 'critical', feature: 'pages' },
  ],
});

test('renders escaped nested details and each subtree counts its parent and children once', () => {
  const html = renderInterfaceGrid(sample());
  assert.match(html, /<details class="interface-grid__area" open data-area="Pages &lt;workspace&gt;">/);
  assert.match(html, /Pages &amp; workspace/);
  assert.match(html, /route/);
  assert.match(html, /\/pages\?x=&quot;&lt;y&gt;/);
  assert.match(html, /<details class="interface-grid__children"><summary>2 child surfaces<\/summary>/);
  assert.match(html, /1\/4 passed \(25%\)/);
  assert.match(html, /0\/1 passed \(0%\)/);
  assert.match(html, /0\/2 passed \(0%\)/);
  assert.match(html, /Unchecked 1 · Broken 1 · Blocked 1/);
});

test('counts unique open issues by direct surface link or exact inherited feature, with explicit unknown severity', () => {
  const html = renderInterfaceGrid(sample());
  assert.match(html, /3 open issues · Critical 0 · High 1 · Medium 1 · Low 0 · Unknown 1/);
  assert.match(html, /feature-scoped counts may overlap across subtrees/);
  assert.doesNotMatch(html, /BWE-4/);
});

test('returns a useful empty state for missing or empty surface data', () => {
  for (const data of [undefined, {}, { surfaces: [] }, { surfaces: [{ area: 'Empty', roots: [] }] }]) {
    const html = renderInterfaceGrid(data);
    assert.match(html, /interface-grid--empty/);
    assert.match(html, /No interface surfaces are available yet/);
  }
});

test('escapes area and interface text before including it in markup', () => {
  const html = renderInterfaceGrid({
    surfaces: [{ file: 'safe.yaml', area: 'A" onmouseover="x', roots: [{
      id: 'safe.root', feature: 'safe', kind: 'view', name: '<script>alert(1)</script>', route: '/<img>', verdict: 'unchecked',
    }] }],
  });
  assert.match(html, /data-area="A&quot; onmouseover=&quot;x"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
