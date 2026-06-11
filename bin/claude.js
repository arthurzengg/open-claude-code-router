#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

// claude-code's bin has shipped both as a JS script and as a native
// executable; resolving through its package.json survives either layout.
function resolveClaudeBin() {
  const pkgPath = require.resolve('@anthropic-ai/claude-code/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.claude;
  if (!rel) throw new Error('cannot locate the claude binary inside @anthropic-ai/claude-code');
  return path.join(path.dirname(pkgPath), rel);
}

function runClaude(claudeBin, env) {
  const isScript = /\.(js|cjs|mjs)$/.test(claudeBin);
  const child = isScript
    ? spawn(process.execPath, [claudeBin, ...args], { stdio: 'inherit', env })
    : spawn(claudeBin, args, { stdio: 'inherit', env });

  child.on('error', (err) => {
    console.error('[claude-router] failed to launch claude-code:', err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  // Let the child decide how to handle interactive signals.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {});
  }
}

async function main() {
  if (args[0] === '--router-status') {
    await require('../lib/status').print();
    return;
  }
  if (args[0] === '--router-log') {
    require('../lib/log').tail();
    return;
  }

  const claudeBin = resolveClaudeBin();
  const env = { ...process.env };

  try {
    const port = await require('../lib/proxy').ensureProxyRunning();
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  } catch (err) {
    // A broken proxy must never lock the user out of claude itself.
    console.error(`[claude-router] proxy unavailable (${err.message}); running without routing`);
  }

  runClaude(claudeBin, env);
}

main().catch((err) => {
  console.error('[claude-router] fatal:', err.message);
  process.exit(1);
});
