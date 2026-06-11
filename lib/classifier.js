'use strict';

const { MODEL_MAP } = require('./router');
const { ANTHROPIC_API } = require('./paths');

const SYSTEM_PROMPT = `You are a task complexity classifier. Given a conversation,
respond with exactly one word: "simple", "default", or "complex".

simple  = file read, grep, rename, format, trivial edit (1-2 lines)
default = multi-file edit, bug fix, test writing, explanation
complex = architecture design, planning, deep reasoning, multi-step agent task`;

const CLASSIFY_TIMEOUT_MS = 3000;

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return null;
  const lastUserMsg = [...messages].reverse().find((m) => m && m.role === 'user');
  if (!lastUserMsg) return null;
  if (typeof lastUserMsg.content === 'string') return lastUserMsg.content;
  if (Array.isArray(lastUserMsg.content)) {
    return lastUserMsg.content.map((c) => (c && c.text) || '').join(' ');
  }
  return null;
}

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

async function classifyComplexity(messages, authHeaders) {
  try {
    const content = extractLastUserText(messages);
    if (!content) return 'default';

    const fast = heuristicLabel(content);
    if (fast) return fast;

    const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...authHeaders,
      },
      body: JSON.stringify({
        model: MODEL_MAP.simple,
        max_tokens: 5,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content.slice(0, 500) }],
      }),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });

    const data = await res.json();
    const label = data?.content?.[0]?.text?.trim().toLowerCase();
    if (['simple', 'default', 'complex'].includes(label)) return label;
    return 'default';
  } catch (_) {
    return 'default'; // never let classification break the proxied request
  }
}

module.exports = { classifyComplexity, heuristicLabel, extractLastUserText, SYSTEM_PROMPT };
