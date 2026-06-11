'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  decideRoute,
  sanitizeBody,
  sessionKeyFor,
  estimateTokens,
  extractFirstUserText,
  isContinuation,
} = require('../lib/route-request');
const { createSessionCache } = require('../lib/session-cache');

const SESSION_A = 'user_abc_account_111_session_aaaa1111-2222-3333-4444-555566667777';

function freshBody(text, overrides = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    metadata: { user_id: SESSION_A },
    messages: [{ role: 'user', content: text }],
    ...overrides,
  };
}

function continuationBody(firstText, overrides = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    metadata: { user_id: SESSION_A },
    messages: [
      { role: 'user', content: firstText },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file body' },
          { type: 'tool_result', tool_use_id: 't1', content: 'more' },
        ],
      },
    ],
    ...overrides,
  };
}

const failingClassify = async () => {
  throw new Error('classifier must not be called');
};

test('haiku-targeted requests pass through without cache writes', async () => {
  const cache = createSessionCache();
  const body = freshBody('anything', { model: 'claude-haiku-4-5' });
  const d = await decideRoute(body, cache, { classify: failingClassify });
  assert.strictEqual(d.reason, 'passthrough');
  assert.strictEqual(d.model, 'claude-haiku-4-5');
  assert.strictEqual(cache.size, 0);
});

test('fresh simple request routes to haiku via heuristics', async () => {
  const cache = createSessionCache();
  const d = await decideRoute(freshBody('cat package.json'), cache, {
    classify: failingClassify,
  });
  assert.strictEqual(d.model, 'claude-haiku-4-5');
  assert.strictEqual(d.reason, 'heuristic');
});

test('fresh ambiguous request uses the injected classifier', async () => {
  const cache = createSessionCache();
  const d = await decideRoute(
    freshBody('fix the failing assertion in the payments unit suite'),
    cache,
    { classify: async () => 'complex' },
  );
  assert.strictEqual(d.model, 'claude-opus-4-8');
  assert.strictEqual(d.reason, 'classifier');
});

test('continuations reuse the cached decision without classifying', async () => {
  const cache = createSessionCache();
  const first = await decideRoute(freshBody('cat package.json'), cache, {
    classify: failingClassify,
  });
  assert.strictEqual(first.model, 'claude-haiku-4-5');

  const second = await decideRoute(continuationBody('cat package.json'), cache, {
    classify: failingClassify,
  });
  assert.strictEqual(second.model, 'claude-haiku-4-5');
  assert.strictEqual(second.reason, 'sticky');
});

test('tool_result-only continuations never reach the classifier', async () => {
  const cache = createSessionCache(); // empty: no sticky entry to fall back on
  const body = continuationBody('cat package.json');
  body.messages[0] = body.messages[2]; // degenerate: first user turn is tool_results
  const d = await decideRoute(body, cache, { classify: failingClassify });
  assert.strictEqual(d.reason, 'no-signal'); // extracts to empty -> default, no API call
  assert.strictEqual(d.model, 'claude-sonnet-4-6');
});

test('long-context guard floors a cached haiku session at sonnet', async () => {
  const cache = createSessionCache();
  await decideRoute(freshBody('cat package.json'), cache, { classify: failingClassify });

  const big = continuationBody('cat package.json');
  big.messages[2].content[0].content = 'x'.repeat(300000); // ~75K estimated tokens
  const d = await decideRoute(big, cache, { classify: failingClassify });
  assert.strictEqual(d.model, 'claude-sonnet-4-6');
  assert.strictEqual(d.reason, 'guard');

  // and the upgrade sticks: a small follow-up stays at sonnet
  const after = await decideRoute(continuationBody('cat package.json'), cache, {
    classify: failingClassify,
  });
  assert.strictEqual(after.model, 'claude-sonnet-4-6');
  assert.strictEqual(after.reason, 'sticky');
});

test('guard applies before classification on fresh oversized requests', async () => {
  const cache = createSessionCache();
  const body = freshBody('cat package.json' + ' filler'.repeat(50000)); // huge first turn
  const d = await decideRoute(body, cache, { classify: failingClassify });
  assert.strictEqual(d.model, 'claude-sonnet-4-6');
  assert.strictEqual(d.reason, 'guard');
});

test('cached opus session is not lowered by the guard', async () => {
  const cache = createSessionCache();
  await decideRoute(freshBody('design a migration plan for the database'), cache, {
    classify: failingClassify,
  });
  const d = await decideRoute(
    continuationBody('design a migration plan for the database'),
    cache,
    { classify: failingClassify },
  );
  assert.strictEqual(d.model, 'claude-opus-4-8');
});

test('context_management floors at sonnet', async () => {
  const cache = createSessionCache();
  const body = freshBody('cat package.json', {
    context_management: { edits: [{ type: 'compact_20260112' }] },
  });
  const d = await decideRoute(body, cache, { classify: failingClassify });
  assert.strictEqual(d.model, 'claude-sonnet-4-6');
  assert.strictEqual(d.reason, 'guard');
});

test('subagent threads get their own cache entry', async () => {
  const cache = createSessionCache();
  await decideRoute(freshBody('design a migration plan for the database'), cache, {
    classify: failingClassify,
  }); // main thread -> opus

  // Same session id, different first message, fresh shape (Task tool kickoff)
  const sub = await decideRoute(freshBody('cat package.json'), cache, {
    classify: failingClassify,
  });
  assert.strictEqual(sub.model, 'claude-haiku-4-5');

  // and the main thread is unaffected
  const main = await decideRoute(
    continuationBody('design a migration plan for the database'),
    cache,
    { classify: failingClassify },
  );
  assert.strictEqual(main.model, 'claude-opus-4-8');
});

test('compaction-shaped requests inherit the session floor', async () => {
  const cache = createSessionCache();
  await decideRoute(freshBody('design a migration plan for the database'), cache, {
    classify: failingClassify,
  }); // session floor -> complex

  // Compaction rewrote history: new first user message, continuation shape
  const compacted = continuationBody('Summary of the conversation so far: ...');
  const d = await decideRoute(compacted, cache, { classify: failingClassify });
  assert.strictEqual(d.model, 'claude-opus-4-8');
  assert.strictEqual(d.reason, 'session-floor');
});

test('session key derivation: user_id session segment and hash fallback', () => {
  const withId = sessionKeyFor(freshBody('hello'));
  assert.match(withId.key, /^aaaa1111-2222-3333-4444-555566667777:/);
  assert.strictEqual(withId.floorKey, 'floor:aaaa1111-2222-3333-4444-555566667777');

  const noId = sessionKeyFor({
    system: [{ type: 'text', text: 'sys' }],
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.strictEqual(noId.floorKey, null);
  assert.match(noId.key, /^[0-9a-f]{16}$/);

  const stringSystem = sessionKeyFor({
    system: 'sys',
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.strictEqual(stringSystem.key, noId.key); // string and block system hash alike
});

test('extractFirstUserText filters non-text blocks and system reminders', () => {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>plan mode is active</system-reminder>' },
        { type: 'text', text: 'cat package.json' },
        { type: 'tool_result', tool_use_id: 'x', content: 'ignored' },
      ],
    },
  ];
  assert.strictEqual(extractFirstUserText(messages), 'cat package.json');
});

test('estimateTokens skips large base64 payloads', () => {
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'x'.repeat(4000) },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(1000000) },
          },
        ],
      },
    ],
  };
  assert.ok(estimateTokens(body) < 2000);
});

test('isContinuation detects assistant turns, multi-user turns, and tool_results', () => {
  assert.strictEqual(isContinuation([{ role: 'user', content: 'hi' }]), false);
  assert.strictEqual(
    isContinuation([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]),
    true,
  );
  assert.strictEqual(
    isContinuation([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }] },
    ]),
    true,
  );
});

test('sanitizeBody strips thinking/effort for haiku but keeps format', () => {
  const body = {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'xhigh', format: { type: 'json_schema', schema: {} } },
    max_tokens: 128000,
  };
  sanitizeBody(body, 'simple');
  assert.strictEqual(body.thinking, undefined);
  assert.strictEqual(body.output_config.effort, undefined);
  assert.ok(body.output_config.format);
  assert.strictEqual(body.max_tokens, 64000);
});

test('sanitizeBody deletes output_config when emptied', () => {
  const body = { output_config: { effort: 'high' }, max_tokens: 1000 };
  sanitizeBody(body, 'simple');
  assert.strictEqual(body.output_config, undefined);
  assert.strictEqual(body.max_tokens, 1000);
});

test('sanitizeBody clamps xhigh effort and max_tokens for the sonnet tier', () => {
  const body = { output_config: { effort: 'xhigh' }, max_tokens: 128000 };
  sanitizeBody(body, 'default');
  assert.strictEqual(body.output_config.effort, 'max');
  assert.strictEqual(body.max_tokens, 64000);
});

test('sanitizeBody leaves opus-tier requests intact up to the ceiling', () => {
  const body = {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'xhigh' },
    max_tokens: 128000,
  };
  sanitizeBody(body, 'complex');
  assert.deepStrictEqual(body.thinking, { type: 'adaptive' });
  assert.strictEqual(body.output_config.effort, 'xhigh');
  assert.strictEqual(body.max_tokens, 128000);
});

test('session cache is monotonic and evicts at capacity', () => {
  const cache = createSessionCache({ maxEntries: 2 });
  cache.setMax('a', 2);
  assert.strictEqual(cache.setMax('a', 0), 2); // never lowered
  cache.setMax('b', 1);
  cache.setMax('c', 1); // evicts oldest ('a')
  assert.strictEqual(cache.get('a'), undefined);
  assert.strictEqual(cache.size, 2);
});
