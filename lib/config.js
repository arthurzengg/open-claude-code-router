'use strict';

const fs = require('fs');
const { CONFIG_FILE } = require('./paths');
const { MODEL_MAP, MODEL_LIMITS, LABELS } = require('./router');
const { DEFAULT_HAIKU_MAX_TOKENS } = require('./route-request');

// The 128K ceiling is only known-safe for the default complex model
// (Opus); a user-overridden model gets this conservative clamp unless
// they set maxOutput explicitly.
const FALLBACK_MAX_OUTPUT = 64000;

function defaults() {
  const maxOutput = {};
  for (const label of LABELS) maxOutput[label] = MODEL_LIMITS[label].maxOutput;
  return {
    models: { ...MODEL_MAP },
    maxOutput,
    haikuMaxTokens: DEFAULT_HAIKU_MAX_TOKENS,
    classifier: 'auto',
  };
}

function isPositiveInt(value) {
  return Number.isFinite(value) && value > 0;
}

// Field-by-field merge: an invalid value loses only that field, never
// the whole file.
function mergeConfig(raw) {
  const cfg = defaults();
  if (!raw || typeof raw !== 'object') raw = {};

  for (const label of LABELS) {
    const model = raw.models && raw.models[label];
    const modelOverridden = typeof model === 'string' && model.trim() !== '';
    if (modelOverridden && model !== cfg.models[label]) {
      cfg.models[label] = model.trim();
      cfg.maxOutput[label] = FALLBACK_MAX_OUTPUT;
    }
    const maxOutput = raw.maxOutput && raw.maxOutput[label];
    if (isPositiveInt(maxOutput)) {
      cfg.maxOutput[label] = Math.floor(maxOutput);
    }
  }

  if (isPositiveInt(raw.haikuMaxTokens)) {
    cfg.haikuMaxTokens = Math.floor(raw.haikuMaxTokens);
  }
  if (raw.classifier === 'heuristics-only' || raw.classifier === 'auto') {
    cfg.classifier = raw.classifier;
  }

  // Derived: MODEL_LIMITS-shaped clamp table for sanitizeBody.
  cfg.limits = {};
  for (const label of LABELS) cfg.limits[label] = { maxOutput: cfg.maxOutput[label] };
  return cfg;
}

// Reload on mtime change so config edits apply without restarting the
// long-lived proxy daemon; one stat per request is negligible.
function createConfigStore(filePath = CONFIG_FILE) {
  let cached = null;
  let cachedMtime = null;

  function get() {
    let mtime = 0;
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch (_) {
      mtime = 0; // no config file
    }
    if (cached && mtime === cachedMtime) return cached;

    let raw = {};
    if (mtime !== 0) {
      try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.error('[claude-router] ignoring invalid config.json:', err.message);
        raw = {};
      }
    }
    cached = mergeConfig(raw);
    cachedMtime = mtime;
    return cached;
  }

  return { get };
}

const defaultStore = createConfigStore();

module.exports = {
  createConfigStore,
  getConfig: () => defaultStore.get(),
  defaults,
  mergeConfig,
};
