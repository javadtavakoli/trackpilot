import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';

// A stub fetch that records the last call and returns a canned JSON body.
function stubFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = null } = responder(String(url), init) || {};
    return new Response(body == null ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  fn.calls = calls;
  return fn;
}

test('createApi uses the injected fetch (not global) and sends bearer auth', async () => {
  const fetch = stubFetch(() => ({ body: { login: 'me', name: 'Me' } }));
  const api = createApi({ baseUrl: 'https://x.youtrack.cloud', token: 'perm:abc', fetch });
  await api.me();
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /^https:\/\/x\.youtrack\.cloud\/api\/users\/me/);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer perm:abc');
});

test('me() returns { name, login } from /users/me', async () => {
  const fetch = stubFetch(() => ({ body: { login: 'jt', name: 'Javad Tavakoli' } }));
  const api = createApi({ baseUrl: 'https://x.youtrack.cloud', token: 't', fetch });
  const me = await api.me();
  assert.deepEqual(me, { name: 'Javad Tavakoli', login: 'jt' });
});

test('logWorkItem posts a duration workItem to the issue', async () => {
  const fetch = stubFetch(() => ({ body: { id: 'wi-1' } }));
  const api = createApi({ baseUrl: 'https://x.youtrack.cloud', token: 't', fetch });
  await api.logWorkItem('ABC-123', { minutes: 42, text: 'work', date: 1700000000000 });
  const call = fetch.calls.at(-1);
  assert.match(call.url, /\/api\/issues\/ABC-123\/timeTracking\/workItems$/);
  assert.equal(call.init.method, 'POST');
  const sent = JSON.parse(call.init.body);
  assert.deepEqual(sent, {
    date: 1700000000000,
    duration: { minutes: 42 },
    text: 'work',
    usesMarkdown: false,
  });
});
