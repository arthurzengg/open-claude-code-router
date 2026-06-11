'use strict';

const MODEL_MAP = {
  simple: 'claude-haiku-4-5',
  default: 'claude-sonnet-4-6',
  complex: 'claude-opus-4-8',
};

function selectModel(complexity) {
  return MODEL_MAP[complexity] ?? MODEL_MAP.default;
}

module.exports = { selectModel, MODEL_MAP };
