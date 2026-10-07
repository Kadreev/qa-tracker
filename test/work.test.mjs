// The agent work loop: issue order, the next issue, and dated notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listIssues, nextIssue, formatIssueLine, appendNote } from '../src/work.mjs';

const issue = (id, severity, complexity, extra = {}) =>
  ({ id, title: `t ${id}`, severity, complexity, type: 'functionality', feature: 'a', status: 'open', ...extra });

const ISSUES = [
  issue('QA-1', 'low', 1),
  issue('QA-2', 'high', 5),
  issue('QA-3', 'high', 2),
  issue('QA-4', undefined, undefined),
  issue('QA-5', 'critical', 8, { status: 'fixed' }),
  issue('QA-6', 'medium', undefined, { feature: 'b', category: 'data' }),
  issue('QA-7', 'medium', 3, { feature: 'b' }),
];
const ids = list => list.map(i => i.id);

test('open issues come in the dashboard order: severity, then complexity, unset last', () => {
  assert.deepEqual(ids(listIssues(ISSUES)), ['QA-3', 'QA-2', 'QA-7', 'QA-6', 'QA-1', 'QA-4']);
});

test('status, severity, feature and category filter the list', () => {
  assert.deepEqual(ids(listIssues(ISSUES, { status: 'fixed' })), ['QA-5']);
  assert.deepEqual(ids(listIssues(ISSUES, { status: 'closed' })), ['QA-5']);
  assert.equal(listIssues(ISSUES, { status: 'all' }).length, ISSUES.length);
  assert.deepEqual(ids(listIssues(ISSUES, { severity: 'medium' })), ['QA-7', 'QA-6']);
  assert.deepEqual(ids(listIssues(ISSUES, { feature: 'b' })), ['QA-7', 'QA-6']);
  assert.deepEqual(ids(listIssues(ISSUES, { category: 'data' })), ['QA-6']);
  assert.throws(() => listIssues(ISSUES, { status: 'done' }), /status must be one of/);
  assert.throws(() => listIssues(ISSUES, { severity: 'urgent' }), /severity must be one of/);
});

test('next is the top open issue, honours filters, and is null when nothing is open', () => {
  assert.equal(nextIssue(ISSUES).id, 'QA-3');
  assert.equal(nextIssue(ISSUES, { feature: 'b' }).id, 'QA-7');
  assert.equal(nextIssue(ISSUES, { status: 'fixed' }).id, 'QA-3'); // next always means open
  assert.equal(nextIssue(ISSUES.filter(i => i.status !== 'open')), null);
});

test('an issue line shows id, severity, complexity, feature and title', () => {
  assert.equal(formatIssueLine(ISSUES[1], 5), 'QA-2   high     cx5  a  t QA-2');
  assert.equal(formatIssueLine(ISSUES[3]), 'QA-4  unrated  cx-  a  t QA-4');
  assert.match(formatIssueLine(ISSUES[4]), /\[fixed\]/);
});

test('a note becomes one dated paragraph at the end of the details', () => {
  assert.equal(appendNote('', 'first', '2026-01-02'), '2026-01-02: first');
  assert.equal(appendNote('Seen on Safari.', 'fixed in abc123', '2026-01-02'), 'Seen on Safari.\n\n2026-01-02: fixed in abc123');
  assert.equal(appendNote(undefined, 'line one\n  line two\n', '2026-01-02'), '2026-01-02: line one line two');
  assert.throws(() => appendNote('x', '  ', '2026-01-02'), /note text is empty/);
  assert.throws(() => appendNote('x', 'y', 'today'), /date must be YYYY-MM-DD/);
});
