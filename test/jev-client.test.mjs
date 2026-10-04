// The Jev client: request shape, retries and error handling, with a fake fetch
// and a fake sleep — nothing here touches the network or waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askJev, JevError, API_URL } from '../src/jev-client.mjs';

const KEY = 'sk-secret-123';
const OK_BODY = { model: 'jev-latest', answers: ['a', 'b', 'c'], usage: { input_tokens: 5, output_tokens: 2 } };

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake fetch that serves `steps` in order; a function step is called, an Error step is thrown. */
function fakeFetch(steps) {
  const calls = [];
  async function fetch(url, init) {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  }
  fetch.calls = calls;
  return fetch;
}

function fakeSleep() {
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  sleep.delays = delays;
  return sleep;
}

test('sends the documented request', async () => {
  const fetch = fakeFetch([reply(200, OK_BODY)]);
  const body = { state: { id: 'ISS-001' }, questions: ['q'] };
  const out = await askJev(body, { apiKey: 'k', fetch, sleep: fakeSleep() });
  assert.deepEqual(out, OK_BODY);
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, API_URL);
  assert.equal(API_URL, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization ?? init.headers.Authorization, 'Bearer k');
  assert.equal(init.headers['content-type'] ?? init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), body);
  assert.ok(init.signal instanceof AbortSignal);
});

test('401 is fatal and not retried', async () => {
  const fetch = fakeFetch([reply(401, { error: { message: 'bad key' } })]);
  const sleep = fakeSleep();
  await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep }), (err) => {
    assert.ok(err instanceof JevError);
    assert.equal(err.name, 'JevError');
    assert.equal(err.status, 401);
    assert.equal(err.fatal, true);
    assert.equal(err.message, 'TypeSafe rejected the API key (401)');
    return true;
  });
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(sleep.delays, []);
});

test('429 then 200 succeeds after one backoff', async () => {
  const fetch = fakeFetch([reply(429, {}), reply(200, OK_BODY)]);
  const sleep = fakeSleep();
  const out = await askJev({}, { apiKey: KEY, fetch, sleep });
  assert.deepEqual(out, OK_BODY);
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(sleep.delays, [1000]);
});

test('persistent 529 gives up after three retries', async () => {
  const fetch = fakeFetch([reply(529, {})]);
  const sleep = fakeSleep();
  await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep }), (err) => {
    assert.ok(err instanceof JevError);
    assert.equal(err.status, 529);
    assert.equal(err.fatal, false);
    return true;
  });
  assert.equal(fetch.calls.length, 4);
  assert.deepEqual(sleep.delays, [1000, 2000, 4000]);
});

test('custom delays set the number of retries', async () => {
  const fetch = fakeFetch([reply(529, {})]);
  const sleep = fakeSleep();
  await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep, delays: [5] }), /529/);
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(sleep.delays, [5]);
});

test('422 surfaces the API message and the size hint', async () => {
  const fetch = fakeFetch([reply(422, { error: { message: 'state is too large' } })]);
  const sleep = fakeSleep();
  await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep }), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.fatal, false);
    assert.match(err.message, /state is too large/);
    assert.match(err.message, /shorten it/);
    return true;
  });
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(sleep.delays, []);
});

test('422 reads the message defensively', async () => {
  for (const [body, want] of [
    [{ message: 'top-level message' }, /top-level message/],
    [{ detail: 'a detail string' }, /a detail string/],
    [{}, /shorten it/],
  ]) {
    const fetch = fakeFetch([reply(422, body)]);
    await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep: fakeSleep() }), want);
  }
  const text = { ok: false, status: 422, json: async () => { throw new SyntaxError('no json'); }, text: async () => 'plain text reason' };
  await assert.rejects(askJev({}, { apiKey: KEY, fetch: fakeFetch([text]), sleep: fakeSleep() }), /plain text reason/);
});

test('other 4xx and 5xx statuses are not retried', async () => {
  for (const status of [400, 403, 404, 500, 503]) {
    const fetch = fakeFetch([reply(status, { message: 'nope' })]);
    const sleep = fakeSleep();
    await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep }), (err) => {
      assert.equal(err.status, status);
      assert.equal(err.fatal, false);
      return true;
    });
    assert.equal(fetch.calls.length, 1);
    assert.deepEqual(sleep.delays, []);
  }
});

test('a network error is retried, a malformed body is not', async () => {
  const flaky = fakeFetch([new TypeError('fetch failed'), reply(200, OK_BODY)]);
  const sleep = fakeSleep();
  assert.deepEqual(await askJev({}, { apiKey: KEY, fetch: flaky, sleep }), OK_BODY);
  assert.equal(flaky.calls.length, 2);
  assert.deepEqual(sleep.delays, [1000]);

  const bad = fakeFetch([reply(200, {})]);
  await assert.rejects(askJev({}, { apiKey: KEY, fetch: bad, sleep: fakeSleep() }), /malformed/);
  assert.equal(bad.calls.length, 1);

  const notJson = fakeFetch([{ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } }]);
  await assert.rejects(askJev({}, { apiKey: KEY, fetch: notJson, sleep: fakeSleep() }), /malformed/);
});

test('persistent network errors end as a JevError with no status', async () => {
  const fetch = fakeFetch([new TypeError('fetch failed')]);
  const sleep = fakeSleep();
  await assert.rejects(askJev({}, { apiKey: KEY, fetch, sleep }), (err) => {
    assert.ok(err instanceof JevError);
    assert.equal(err.status, null);
    assert.equal(err.fatal, false);
    assert.match(err.message, /network error: fetch failed/);
    return true;
  });
  assert.equal(fetch.calls.length, 4);
  assert.deepEqual(sleep.delays, [1000, 2000, 4000]);
});

test('a timeout is retried and then reported with the limit', async () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const fetch = fakeFetch([timeout, reply(200, OK_BODY)]);
  const sleep = fakeSleep();
  assert.deepEqual(await askJev({}, { apiKey: KEY, fetch, sleep }), OK_BODY);
  assert.deepEqual(sleep.delays, [1000]);

  const always = fakeFetch([timeout]);
  await assert.rejects(askJev({}, { apiKey: KEY, fetch: always, sleep: fakeSleep(), timeoutMs: 250 }), (err) => {
    assert.equal(err.status, null);
    assert.match(err.message, /request timed out after 250 ms/);
    return true;
  });
  assert.equal(always.calls.length, 4);
});

test('the key never appears in errors', async () => {
  const leaky = new TypeError(`fetch failed (Authorization: Bearer ${KEY})`);
  const cases = [
    reply(401, { error: { message: `invalid key ${KEY}` } }),
    reply(422, { error: { message: `rejected ${KEY}` } }),
    reply(529, { message: KEY }),
    reply(500, { message: KEY }),
    leaky,
  ];
  for (const step of cases) {
    const err = await askJev({}, { apiKey: KEY, fetch: fakeFetch([step]), sleep: fakeSleep() }).then(
      () => assert.fail('should have rejected'),
      (e) => e,
    );
    assert.ok(err instanceof JevError);
    const dump = String(err) + JSON.stringify(err) + (err.stack ?? '') + String(err.cause ?? '');
    assert.ok(!dump.includes(KEY), `key leaked in: ${dump}`);
    assert.equal(err.cause, undefined);
  }
});
