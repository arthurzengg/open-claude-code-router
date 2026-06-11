'use strict';

const MODEL_MAP = {
  simple: 'claude-haiku-4-5',
  default: 'claude-sonnet-4-6',
  complex: 'claude-opus-4-8',
};

// Rank ladder for monotonic routing: a session may move up mid-conversation
// (long-context guard, error upgrade) but never down — Anthropic prompt
// caches are model-scoped, so a downgrade flip costs more than it saves.
const LABELS = ['simple', 'default', 'complex'];
const RANK = { simple: 0, default: 1, complex: 2 };

// Output ceilings keyed by route label (not model string) so user-supplied
// model overrides keep a valid max_tokens clamp.
const MODEL_LIMITS = {
  simple: { maxOutput: 64000 },
  default: { maxOutput: 64000 },
  complex: { maxOutput: 128000 },
};

function selectModel(complexity) {
  return MODEL_MAP[complexity] ?? MODEL_MAP.default;
}

function labelForRank(rank) {
  const clamped = Math.min(Math.max(rank, 0), LABELS.length - 1);
  return LABELS[clamped];
}

module.exports = { selectModel, MODEL_MAP, LABELS, RANK, MODEL_LIMITS, labelForRank };
