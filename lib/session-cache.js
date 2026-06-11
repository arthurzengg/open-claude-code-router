'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

// Insert-order-evicting Map. A single-user local proxy holds at most a
// handful of live sessions, so 500 entries is effectively unbounded and
// no LRU dependency is warranted.
function createSessionCache({ maxEntries = 500, ttlMs = DAY_MS } = {}) {
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > ttlMs) {
      entries.delete(key);
      return undefined;
    }
    return entry.rank;
  }

  // The only write path, and it never lowers a rank — mid-session
  // downgrades are impossible by construction.
  function setMax(key, rank) {
    const current = get(key);
    const next = current === undefined ? rank : Math.max(current, rank);
    entries.delete(key);
    entries.set(key, { rank: next, at: Date.now() });
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
    return next;
  }

  return {
    get,
    setMax,
    get size() {
      return entries.size;
    },
  };
}

module.exports = { createSessionCache };
