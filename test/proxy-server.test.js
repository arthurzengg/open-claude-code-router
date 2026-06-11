'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app } = require('../lib/proxy-server');

// The proxy's own upstream calls go to api.anthropic.com; intercept those
// while letting the test's requests reach the local server untouched.
const realFetch = globalThis.fetch;
let upstreamCalls = [];
let upstreamStatus = 200;

let server;
let base;

before(async () => {
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.anthropic.com')) {
      upstreamCalls.push({ url: String(url), body: JSON.parse(opts.body) });
      return new Response(
        JSON.stringify({ id: 'msg_test', content: [{ type: 'text', text: 'ok' }] }),
        { status: upstreamStatus, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(url, opts);
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

beforeEach(() => {
  upstreamCalls = [];
  upstreamStatus = 200;
});

function post(body) {
  return realFetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
    body: JSON.stringify(body),
  });
}

function sessionBody(sessionId, messages) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    metadata: { user_id: `user_x_account_y_session_${sessionId}` },
    messages,
  };
}

test('fresh request and tool_result continuation hit the same model', async () => {
  const sid = '11111111-aaaa-bbbb-cccc-000000000001';
  const res1 = await post(sessionBody(sid, [{ role: 'user', content: 'cat package.json' }]));
  assert.strictEqual(res1.status, 200);

  const res2 = await post(
    sessionBody(sid, [
      { role: 'user', content: 'cat package.json' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'data' }] },
    ]),
  );
  assert.strictEqual(res2.status, 200);

  const models = upstreamCalls.map((c) => c.body.model);
  assert.deepStrictEqual(models, ['claude-haiku-4-5', 'claude-haiku-4-5']);
});

test('upstream 400 on a rewritten request upgrades the session one tier', async () => {
  const sid = '22222222-aaaa-bbbb-cccc-000000000002';
  upstreamStatus = 400;
  const res1 = await post(sessionBody(sid, [{ role: 'user', content: 'cat README.md' }]));
  assert.strictEqual(res1.status, 400); // upstream error is relayed as-is
  assert.strictEqual(upstreamCalls[0].body.model, 'claude-haiku-4-5');

  upstreamStatus = 200;
  const res2 = await post(
    sessionBody(sid, [
      { role: 'user', content: 'cat README.md' },
      { role: 'assistant', content: 'retrying' },
      { role: 'user', content: 'try again' },
    ]),
  );
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(upstreamCalls[1].body.model, 'claude-sonnet-4-6');
});

test('haiku-targeted requests pass through with the body unchanged', async () => {
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    thinking: { type: 'enabled', budget_tokens: 1024 },
    messages: [{ role: 'user', content: 'background task' }],
  };
  const res = await post(body);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(upstreamCalls[0].body.model, 'claude-haiku-4-5');
  assert.deepStrictEqual(upstreamCalls[0].body.thinking, { type: 'enabled', budget_tokens: 1024 });
});

test('thinking is stripped when a request is downgraded to haiku', async () => {
  const sid = '33333333-aaaa-bbbb-cccc-000000000003';
  const body = sessionBody(sid, [{ role: 'user', content: 'grep TODO in src' }]);
  body.thinking = { type: 'adaptive' };
  body.output_config = { effort: 'high' };
  const res = await post(body);
  assert.strictEqual(res.status, 200);
  const sent = upstreamCalls[0].body;
  assert.strictEqual(sent.model, 'claude-haiku-4-5');
  assert.strictEqual(sent.thinking, undefined);
  assert.strictEqual(sent.output_config, undefined);
});
