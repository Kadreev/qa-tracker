import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readReport, renderReports } from '../src/reports.mjs';
test('reports expose existing evidence safely without reading outside reports', () => {
 const dir=mkdtempSync(path.join(tmpdir(),'qa-reports-'));
 try {
  mkdirSync(path.join(dir,'reports'));
  writeFileSync(path.join(dir,'reports','result.md'),'317 passed, 26 failed <script>');
  writeFileSync(path.join(dir,'secret.json'),'secret');
  assert.match(readReport(dir,'result.md'), /317 passed/);
  assert.equal(readReport(dir,'../secret.json'),null);
  assert.equal(readReport(dir,'missing.md'),null);
  assert.match(renderReports(dir), /result.md/);
  assert.doesNotMatch(renderReports(dir), /secret/);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
