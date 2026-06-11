'use strict';

// Records prior install state so preuninstall can restore the user's
// original claude command. Runs only for global installs: a local
// `npm install` during development must stay side-effect free.

const { execSync } = require('child_process');
const fs = require('fs');
const { META_DIR, META_FILE } = require('../lib/paths');

if (process.env.npm_config_global !== 'true') {
  process.exit(0);
}

let hadClaudeCode = false;
try {
  execSync('npm list -g @anthropic-ai/claude-code --depth=0', { stdio: 'ignore' });
  hadClaudeCode = true;
} catch (_) {}

try {
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify({ hadClaudeCode }, null, 2));
} catch (err) {
  console.warn('[claude-router] could not record install state:', err.message);
}

console.log('[claude-router] installed');
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[claude-router] warning: ANTHROPIC_API_KEY is not set. The complexity\n' +
      '[claude-router] classifier needs an API key; without one, ambiguous requests\n' +
      '[claude-router] are routed to the default model. Subscription-only logins are\n' +
      '[claude-router] passed through but cannot be classified.',
  );
}
console.log('[claude-router] run `claude --router-status` to verify');
