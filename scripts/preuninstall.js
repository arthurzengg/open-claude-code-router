'use strict';

// Cleans up the background proxy and restores the user's original
// claude command. Runs only for global uninstalls.

const { execSync } = require('child_process');
const fs = require('fs');
const { PID_FILE, PORT_FILE, META_FILE } = require('../lib/paths');

if (process.env.npm_config_global !== 'true') {
  process.exit(0);
}

// Stop the proxy if it is running.
try {
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (Number.isInteger(pid)) process.kill(pid, 'SIGTERM');
} catch (_) {}
for (const file of [PID_FILE, PORT_FILE]) {
  try {
    fs.unlinkSync(file);
  } catch (_) {}
}

// Restore the original claude-code install if the user had one.
let meta = { hadClaudeCode: true }; // safest default: restore
try {
  meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
} catch (_) {}

if (meta.hadClaudeCode) {
  console.log('[claude-router] restoring @anthropic-ai/claude-code...');
  try {
    execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
    console.log('[claude-router] restored');
  } catch (_) {
    console.warn('[claude-router] could not restore automatically. Run:');
    console.warn('  npm install -g @anthropic-ai/claude-code');
  }
} else {
  console.log('[claude-router] uninstalled. The claude command has been removed.');
}
