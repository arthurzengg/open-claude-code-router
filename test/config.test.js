'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfigStore, mergeConfig, defaults } = require('../lib/config');
const { sanitizeBody } = require('../lib/route-request');

function tmpConfig(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crcfg-')), 'config.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  return file;
}

test('missing config file yields defaults', () => {
  const store = createConfigStore(tmpConfig(undefined));
  const cfg = store.get();
  assert.deepStrictEqual(cfg.models, defaults().models);
  assert.strictEqual(cfg.haikuMaxTokens, 60000);
  assert.strictEqual(cfg.classifier, 'auto');
  assert.strictEqual(cfg.limits.complex.maxOutput, 128000);
});

test('invalid JSON yields defaults without throwing', () => {
  const store = createConfigStore(tmpConfig('{ not json'));
  const cfg = store.get();
  assert.deepStrictEqual(cfg.models, defaults().models);
});

test('partial overrides merge field-by-field', () => {
  const cfg = mergeConfig({
    models: { default: 'claude-sonnet-4-5' },
    haikuMaxTokens: 30000,
    classifier: 'heuristics-only',
  });
  assert.strictEqual(cfg.models.default, 'claude-sonnet-4-5');
  assert.strictEqual(cfg.models.simple, defaults().models.simple); // untouched
  assert.strictEqual(cfg.haikuMaxTokens, 30000);
  assert.strictEqual(cfg.classifier, 'heuristics-only');
});

test('overridden model without explicit maxOutput gets the conservative clamp', () => {
  const cfg = mergeConfig({ models: { complex: 'claude-opus-4-5' } });
  assert.strictEqual(cfg.limits.complex.maxOutput, 64000);

  const explicit = mergeConfig({
    models: { complex: 'claude-opus-4-5' },
    maxOutput: { complex: 128000 },
  });
  assert.strictEqual(explicit.limits.complex.maxOutput, 128000);
});

test('invalid field values are ignored individually', () => {
  const cfg = mergeConfig({
    models: { simple: '' },
    haikuMaxTokens: -5,
    classifier: 'nonsense',
  });
  assert.strictEqual(cfg.models.simple, defaults().models.simple);
  assert.strictEqual(cfg.haikuMaxTokens, 60000);
  assert.strictEqual(cfg.classifier, 'auto');
});

test('config edits are picked up via mtime without restart', () => {
  const file = tmpConfig(JSON.stringify({ haikuMaxTokens: 30000 }));
  const store = createConfigStore(file);
  assert.strictEqual(store.get().haikuMaxTokens, 30000);

  fs.writeFileSync(file, JSON.stringify({ haikuMaxTokens: 40000 }));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later); // force a distinct mtime
  assert.strictEqual(store.get().haikuMaxTokens, 40000);
});

test('sanitizeBody follows the resolved model, not the tier label', () => {
  // simple tier overridden to a sonnet model: thinking survives
  const body = { thinking: { type: 'adaptive' }, max_tokens: 32000 };
  sanitizeBody(body, 'simple', { simple: { maxOutput: 64000 } }, 'claude-sonnet-4-6');
  assert.deepStrictEqual(body.thinking, { type: 'adaptive' });

  // haiku target still strips
  const body2 = { thinking: { type: 'adaptive' }, max_tokens: 32000 };
  sanitizeBody(body2, 'simple', { simple: { maxOutput: 64000 } }, 'claude-haiku-4-5');
  assert.strictEqual(body2.thinking, undefined);
});
