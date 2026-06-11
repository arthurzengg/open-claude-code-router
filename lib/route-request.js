'use strict';

const crypto = require('crypto');
const { MODEL_MAP, RANK, MODEL_LIMITS, labelForRank } = require('./router');
const { heuristicLabel } = require('./classifier');

const DEFAULT_HAIKU_MAX_TOKENS = 60000;

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join(' ');
  }
  return '';
}

// Claude Code injects <system-reminder> blocks into user turns; the
// plan-mode reminder alone contains the word "plan", which would trip
// the complex heuristic on every classification.
function stripSystemReminders(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').trim();
}

function extractFirstUserText(messages) {
  if (!Array.isArray(messages)) return '';
  const first = messages.find((m) => m && m.role === 'user');
  if (!first) return '';
  return stripSystemReminders(textOfContent(first.content));
}

function systemText(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map((s) => (s && typeof s.text === 'string' ? s.text : '')).join(' ');
  }
  return '';
}

function shortHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Claude Code's metadata.user_id embeds a per-session uuid
// (user_<hash>_account_<uuid>_session_<uuid>).
function sessionIdFrom(body) {
  const userId = body && body.metadata && body.metadata.user_id;
  if (typeof userId !== 'string') return null;
  const match = userId.match(/session[_-]([0-9a-fA-F-]{8,})/);
  return match ? match[1] : null;
}

// Composite key: session id + first-user-message hash. Subagent calls share
// the session id but start a different conversation thread, so they must
// not clobber the main thread's cached decision.
function sessionKeyFor(body) {
  const firstUser = extractFirstUserText(body.messages).slice(0, 500);
  const threadHash = shortHash(firstUser);
  const sessionId = sessionIdFrom(body);
  if (sessionId) {
    return { key: `${sessionId}:${threadHash}`, floorKey: `floor:${sessionId}` };
  }
  const fallback = shortHash(systemText(body.system).slice(0, 500) + '\n' + firstUser);
  return { key: fallback, floorKey: null };
}

// ~4 chars per token. Long base64 strings (image/document sources) are
// skipped: 1MB of base64 would read as ~250K tokens against <5K real
// image tokens and needlessly floor screenshot-heavy sessions.
function estimateTokens(body) {
  let chars = 0;
  const count = (value) => {
    if (typeof value === 'string') {
      chars += value.length;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) count(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'data' && typeof v === 'string' && v.length > 4096) continue;
        count(v);
      }
    }
  };
  count(body.system);
  count(body.messages);
  count(body.tools);
  return Math.ceil(chars / 4);
}

function isContinuation(messages) {
  if (!Array.isArray(messages)) return false;
  let userTurns = 0;
  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'assistant') return true;
    if (m.role === 'user') {
      userTurns += 1;
      if (userTurns > 1) return true;
      if (Array.isArray(m.content) && m.content.some((c) => c && c.type === 'tool_result')) {
        return true;
      }
    }
  }
  return false;
}

// Decision order (downgrades impossible by construction):
//   1. client already asked for haiku -> passthrough
//   2. cached decision for this thread -> sticky
//   3. continuation with no cache entry (compaction rotated the thread
//      key, or the proxy restarted) -> session floor
//   4. fresh conversation -> heuristics, then the injected classifier
// The long-context guard is applied on top of whichever base was chosen.
async function decideRoute(body, cache, opts = {}) {
  const {
    classify = null,
    haikuMaxTokens = DEFAULT_HAIKU_MAX_TOKENS,
    models = MODEL_MAP,
  } = opts;

  const requestedModel = String(body.model || '');
  if (requestedModel.includes('haiku')) {
    return { model: requestedModel, label: null, reason: 'passthrough', estTokens: null, key: null };
  }

  const { key, floorKey } = sessionKeyFor(body);
  const estTokens = estimateTokens(body);

  // claude-haiku-4-5 caps at 200K context and supports neither adaptive
  // thinking nor context_management; estimate-based flooring also keeps
  // big conversations off the small model well before the hard limit.
  const guardFloor =
    estTokens > haikuMaxTokens || body.context_management ? RANK.default : 0;

  const cachedRank = cache.get(key);
  const sessionFloor = floorKey ? cache.get(floorKey) ?? 0 : 0;

  let base;
  let reason;
  if (cachedRank !== undefined) {
    base = cachedRank;
    reason = 'sticky';
  } else if (sessionFloor > 0 && isContinuation(body.messages)) {
    base = sessionFloor;
    reason = 'session-floor';
  } else {
    const text = extractFirstUserText(body.messages);
    const fast = text ? heuristicLabel(text) : null;
    let label;
    if (fast) {
      label = fast;
      reason = 'heuristic';
    } else if (guardFloor > 0) {
      // The guard already rules out haiku, and the classifier mostly
      // separates simple from default — not worth a roundtrip here.
      label = labelForRank(guardFloor);
      reason = 'guard';
    } else if (text && classify) {
      label = await classify(text);
      reason = 'classifier';
    } else {
      label = 'default';
      reason = 'no-signal';
    }
    base = RANK[label] ?? RANK.default;
  }

  const finalRank = Math.max(base, guardFloor);
  if (guardFloor > base) reason = 'guard';

  cache.setMax(key, finalRank);
  if (floorKey) cache.setMax(floorKey, finalRank);

  const label = labelForRank(finalRank);
  return { model: models[label] ?? MODEL_MAP[label], label, reason, estTokens, key };
}

// Make the rewritten request valid for the target model. Capability rules
// follow the resolved model name (not the tier label) so user-overridden
// tiers keep what their model supports. Mutates body.
function sanitizeBody(body, label, limits = MODEL_LIMITS, model = MODEL_MAP[label]) {
  const target = String(model || '');
  if (target.includes('haiku')) {
    // claude-haiku-4-5 rejects adaptive thinking and output_config.effort;
    // structured outputs (output_config.format) are supported and kept.
    delete body.thinking;
    if (body.output_config) {
      delete body.output_config.effort;
      if (Object.keys(body.output_config).length === 0) delete body.output_config;
    }
  } else if (!target.includes('opus') && !target.includes('fable')) {
    // effort "xhigh" is Opus-tier only; "max" is the closest valid level.
    if (body.output_config && body.output_config.effort === 'xhigh') {
      body.output_config.effort = 'max';
    }
  }

  const maxOutput = (limits[label] && limits[label].maxOutput) || 64000;
  if (typeof body.max_tokens === 'number' && body.max_tokens > maxOutput) {
    body.max_tokens = maxOutput;
  }
  return body;
}

module.exports = {
  decideRoute,
  sanitizeBody,
  sessionKeyFor,
  estimateTokens,
  extractFirstUserText,
  isContinuation,
  DEFAULT_HAIKU_MAX_TOKENS,
};
