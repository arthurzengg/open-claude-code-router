'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { selectModel, MODEL_MAP } = require('../lib/router');

test('selectModel maps each complexity to the expected model', () => {
  assert.strictEqual(selectModel('simple'), 'claude-haiku-4-5');
  assert.strictEqual(selectModel('default'), 'claude-sonnet-4-6');
  assert.strictEqual(selectModel('complex'), 'claude-opus-4-8');
});

test('selectModel falls back to the default model on unknown labels', () => {
  assert.strictEqual(selectModel('nonsense'), MODEL_MAP.default);
  assert.strictEqual(selectModel(undefined), MODEL_MAP.default);
  assert.strictEqual(selectModel(null), MODEL_MAP.default);
});
