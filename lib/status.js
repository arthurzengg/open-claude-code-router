'use strict';

const { MODEL_MAP } = require('./router');
const { lastLine } = require('./log');
const { isHealthy, readPortFile } = require('./proxy');

async function print() {
  const pkg = require('../package.json');

  const port = readPortFile();
  const healthy = port ? await isHealthy(port) : false;
  const proxyStatus = healthy
    ? `running on 127.0.0.1:${port}`
    : 'not running (starts automatically on next claude invocation)';

  const rules = Object.entries(MODEL_MAP)
    .map(([label, model]) => `  ${label.padEnd(8)} -> ${model}`)
    .join('\n');

  console.log(`
open-claude-code-router v${pkg.version}
----------------------------------------
Proxy:       ${proxyStatus}
Last routed: ${lastLine() || 'none yet'}

Routing rules:
${rules}

Commands:
  claude --router-status   this screen
  claude --router-log      recent routing decisions
`);
}

module.exports = { print };
