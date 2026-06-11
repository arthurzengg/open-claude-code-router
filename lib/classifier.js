'use strict';

const { MODEL_MAP } = require('./router');
const { ANTHROPIC_API } = require('./paths');

const SYSTEM_PROMPT = `You are a task complexity classifier. Given a conversation,
respond with exactly one word: "simple", "default", or "complex".

simple  = file read, grep, rename, format, trivial edit (1-2 lines)
default = multi-file edit, bug fix, test writing, explanation
complex = architecture design, planning, deep reasoning, multi-step agent task`;

const CLASSIFY_TIMEOUT_MS = 3000;
const LABELS = ['simple', 'default', 'complex'];

// Returns a label without an API call when the request is obviously
// simple or complex; null means "ambiguous, ask the model".
function heuristicLabel(content) {
  const lower = content.toLowerCase().trim();
  if (lower.length < 60 && /\b(ls|cat|read|show|list|grep|find)\b/.test(lower)) {
    return 'simple';
  }
  if (/\b(architect|design|plan|strategy|how should|what approach)\b/.test(lower)) {
    return 'complex';
  }
  return null;
}

// Tolerates casing, whitespace, and punctuation ("Complex.\n" -> complex).
function normalizeLabel(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return LABELS.includes(cleaned) ? cleaned : null;
}

async function classifyComplexity(text, authHeaders) {
  try {
    if (!text || !text.trim()) return 'default';

    const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        // Forwarding the caller's auth headers verbatim keeps both API-key
        // and OAuth setups working (OAuth needs its anthropic-beta value).
        ...authHeaders,
      },
      body: JSON.stringify({
        model: MODEL_MAP.simple,
        max_tokens: 5,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 500) }],
      }),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });

    const data = await res.json();
    return normalizeLabel(data?.content?.[0]?.text) ?? 'default';
  } catch (_) {
    return 'default'; // never let classification break the proxied request
  }
}

module.exports = { classifyComplexity, heuristicLabel, normalizeLabel, SYSTEM_PROMPT };
