'use strict';

const fs = require('fs');
const { getConfig } = require('./config');
const { CONFIG_FILE } = require('./paths');
const { lastLine } = require('./log');
const { isHealthy, readPortFile } = require('./proxy');

async function print() {
  const pkg = require('../package.json');

  const port = readPortFile();
  const healthy = port ? await isHealthy(port) : false;
  const proxyStatus = healthy
    ? `running on 127.0.0.1:${port}`
    : 'not running (starts automatically on next claude invocation)';

  const cfg = getConfig();
  const configSource = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : 'defaults (no config.json)';
  const rules = Object.entries(cfg.models)
    .map(([label, model]) => `  ${label.padEnd(8)} -> ${model}`)
    .join('\n');

  console.log(`
open-claude-code-router v${pkg.version}
----------------------------------------
Proxy:       ${proxyStatus}
Last routed: ${lastLine() || 'none yet'}

Routing rules (${configSource}):
${rules}
  long-context floor: > ${cfg.haikuMaxTokens} est. tokens
  classifier: ${cfg.classifier}

Commands:
  claude --router-status   this screen
  claude --router-log      recent routing decisions
`);
}

module.exports = { print };
