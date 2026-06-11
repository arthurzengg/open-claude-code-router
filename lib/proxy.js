'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { PORT_FILE } = require('./paths');

const STARTUP_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 500;

function readPortFile() {
  try {
    const port = parseInt(fs.readFileSync(PORT_FILE, 'utf8'), 10);
    return Number.isInteger(port) ? port : null;
  } catch (_) {
    return null;
  }
}

// A free port plus an unrelated server both fail this check: the marker
// guarantees we only reuse our own proxy.
async function isHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const data = await res.json();
    return data && data.ok === true && data.service === 'claude-router';
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForProxy(timeout = STARTUP_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const port = readPortFile();
    if (port && (await isHealthy(port))) return port;
    await sleep(100);
  }
  throw new Error(`proxy failed to start within ${timeout}ms`);
}

async function ensureProxyRunning() {
  const existing = readPortFile();
  if (existing && (await isHealthy(existing))) return existing;

  const child = fork(path.join(__dirname, 'proxy-server.js'), [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return waitForProxy();
}

module.exports = { ensureProxyRunning, isHealthy, readPortFile };
