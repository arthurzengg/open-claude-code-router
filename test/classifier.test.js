'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyComplexity, heuristicLabel, normalizeLabel } = require('../lib/classifier');

test('heuristicLabel marks short read-style commands as simple', () => {
  assert.strictEqual(heuristicLabel('cat package.json'), 'simple');
  assert.strictEqual(heuristicLabel('grep TODO in src'), 'simple');
  assert.strictEqual(heuristicLabel('list the files in lib'), 'simple');
});

test('heuristicLabel marks planning language as complex', () => {
  assert.strictEqual(
    heuristicLabel('how should we architect the caching layer for this service'),
    'complex',
  );
  assert.strictEqual(heuristicLabel('design a migration plan for the database'), 'complex');
});

test('heuristicLabel returns null for ambiguous requests', () => {
  assert.strictEqual(
    heuristicLabel('fix the failing assertion in the payments unit suite'),
    null,
  );
});

test('normalizeLabel tolerates casing, whitespace, and punctuation', () => {
  assert.strictEqual(normalizeLabel('Complex.'), 'complex');
  assert.strictEqual(normalizeLabel(' SIMPLE\n'), 'simple');
  assert.strictEqual(normalizeLabel('"default"'), 'default');
  assert.strictEqual(normalizeLabel('something else'), null);
  assert.strictEqual(normalizeLabel(undefined), null);
});

test('classifyComplexity returns default for empty text', async () => {
  assert.strictEqual(await classifyComplexity('', {}), 'default');
  assert.strictEqual(await classifyComplexity('   ', {}), 'default');
  assert.strictEqual(await classifyComplexity(undefined, {}), 'default');
});

test('classifyComplexity uses the normalized model label', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    json: async () => ({ content: [{ type: 'text', text: 'Complex.\n' }] }),
  }));
  const label = await classifyComplexity(
    'fix the failing assertion in the payments unit suite',
    { 'x-api-key': 'test' },
  );
  assert.strictEqual(label, 'complex');
});

test('classifyComplexity falls back to default on fetch failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down');
  });
  const label = await classifyComplexity(
    'fix the failing assertion in the payments unit suite',
    { 'x-api-key': 'test' },
  );
  assert.strictEqual(label, 'default');
});

test('classifyComplexity falls back to default on malformed responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    json: async () => ({ error: { type: 'invalid_request_error' } }),
  }));
  const label = await classifyComplexity(
    'fix the failing assertion in the payments unit suite',
    { 'x-api-key': 'test' },
  );
  assert.strictEqual(label, 'default');
});
