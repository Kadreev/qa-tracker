// The Jev client: one POST to TypeSafe's systemone endpoint, with retries.
//
// The only module that talks to the network, and only through the injected
// `fetch`. Retries 429, 529, network errors and timeouts with the given
// backoff; 401 is fatal (the caller stops the run); every other failure is a
// plain JevError. The API key is sent only in the Authorization header — it is
// never put in an error message or property, and any text taken from the
// response or from a thrown fetch error is scrubbed of it before use.

/** The TypeSafe endpoint. */
export const API_URL = 'https://api.typesafe.ai/v1/systemone';

const DEFAULT_DELAYS = [1000, 2000, 4000];
const SIZE_HINT = ' — if `details` is long, shorten it';
const SIZE_COMPLAINT = /size|length|token|too large/i;

/** An error from the Jev API. `status` is null for network errors and timeouts; `fatal` only for 401. */
export class JevError extends Error {
  constructor(message, { status = null, fatal = false } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.fatal = fatal;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

/** Read a response body as { json, text }; json is null unless the text parses. Throws only on a read failure. */
async function readBody(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

/** The API's own message from an error body, read defensively. */
function apiMessage({ json, text }) {
  const m = json?.error?.message ?? json?.message ?? json?.detail ?? (json && !Object.keys(json).length ? '' : text);
  if (typeof m === 'string') return m.trim();
  return m == null || m === '' ? '' : JSON.stringify(m);
}

/**
 * askJev(body, { apiKey, fetch, sleep, timeoutMs, delays }) → { model, answers, usage }.
 * POSTs `body` as JSON. Retries 429, 529, network errors and timeouts once per
 * entry in `delays` (waiting via `sleep`), then throws the last error. A 2xx body
 * whose `answers` is not an object keyed by question id is malformed. Throws a
 * JevError for everything else; `err.fatal` is true only for a rejected key (401).
 */
export async function askJev(body, {
  apiKey,
  fetch = globalThis.fetch,
  sleep = defaultSleep,
  timeoutMs = 30000,
  delays = DEFAULT_DELAYS,
} = {}) {
  const scrub = (s) => (apiKey ? String(s).split(apiKey).join('[redacted]') : String(s));
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    let res;
    let parsed;
    let failure = null; // set when this attempt is retryable
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      parsed = await readBody(res);
    } catch (err) {
      failure = isTimeout(err)
        ? new JevError(`request timed out after ${timeoutMs} ms`)
        : new JevError(`network error: ${scrub(err?.message ?? err)}`);
    }

    if (!failure) {
      const { status } = res;
      if (res.ok) {
        const answers = parsed.json?.answers;
        if (answers == null || typeof answers !== 'object' || Array.isArray(answers)) throw new JevError('malformed response');
        return parsed.json;
      }
      if (status === 401) throw new JevError('TypeSafe rejected the API key (401)', { status, fatal: true });
      const detail = scrub(apiMessage(parsed));
      if (status === 422) throw new JevError(`request rejected (422)${detail ? ': ' + detail : ''}${SIZE_COMPLAINT.test(detail) ? SIZE_HINT : ''}`, { status });
      const error = new JevError(`TypeSafe returned ${status}${detail ? ': ' + detail : ''}`, { status });
      if (status !== 429 && status !== 529) throw error;
      failure = error;
    }

    if (attempt >= delays.length) throw failure;
    await sleep(delays[attempt]);
  }
}
