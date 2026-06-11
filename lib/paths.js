'use strict';

const path = require('path');
const os = require('os');

const META_DIR = path.join(os.homedir(), '.claude-router');

module.exports = {
  META_DIR,
  PID_FILE: path.join(META_DIR, 'proxy.pid'),
  PORT_FILE: path.join(META_DIR, 'port'),
  LOG_FILE: path.join(META_DIR, 'router.log'),
  META_FILE: path.join(META_DIR, 'meta.json'),
  DEFAULT_PORT: 3456,
  MAX_PORT: 3466,
  ANTHROPIC_API: 'https://api.anthropic.com',
};
