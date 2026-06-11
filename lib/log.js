'use strict';

const fs = require('fs');
const { META_DIR, LOG_FILE } = require('./paths');

function appendLog(entry) {
  try {
    fs.mkdirSync(META_DIR, { recursive: true });
    const parts = [];
    if (entry.reason) parts.push(`reason=${entry.reason}`);
    parts.push(`complexity=${entry.complexity}`, `-> ${entry.model}`);
    if (entry.estTokens != null) parts.push(`est=${entry.estTokens}`);
    if (entry.key) parts.push(`key=${String(entry.key).slice(0, 12)}`);
    fs.appendFileSync(LOG_FILE, `[${entry.time}] ${parts.join(' ')}\n`);
  } catch (_) {
    // logging must never break request handling
  }
}

function tail(n = 20) {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No routing decisions logged yet.');
    return;
  }
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  lines.slice(-n).forEach((l) => console.log(l));
}

function lastLine() {
  if (!fs.existsSync(LOG_FILE)) return null;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  return lines[lines.length - 1] || null;
}

module.exports = { appendLog, tail, lastLine };
