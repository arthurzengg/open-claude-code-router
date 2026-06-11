'use strict';

const express = require('express');
const fs = require('fs');
const { Readable } = require('stream');
const { classifyComplexity } = require('./classifier');
const { selectModel } = require('./router');
const { appendLog } = require('./log');
const {
  META_DIR,
  PID_FILE,
  PORT_FILE,
  DEFAULT_PORT,
  MAX_PORT,
  ANTHROPIC_API,
} = require('./paths');

const app = express();

// Headers the upstream needs; everything hop-by-hop or recomputed by fetch
// (host, content-length, accept-encoding, connection) is dropped.
function pickForwardHeaders(headers) {
  const out = {};
  for (const name of ['x-api-key', 'authorization', 'anthropic-version', 'anthropic-beta']) {
    if (headers[name]) out[name] = headers[name];
  }
  return out;
}

function pickAuthHeaders(headers) {
  const out = {};
  if (headers['x-api-key']) out['x-api-key'] = headers['x-api-key'];
  if (headers.authorization) out.authorization = headers.authorization;
  if (headers['anthropic-beta']) out['anthropic-beta'] = headers['anthropic-beta'];
  return out;
}

async function pipeUpstream(upstream, res) {
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    // fetch already decompressed the body and the length may change
    if (['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) {
      return;
    }
    res.setHeader(key, value);
  });
  if (!upstream.body) {
    res.end();
    return;
  }
  await new Promise((resolve) => {
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => res.end());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    stream.on('end', resolve);
    res.on('close', resolve);
  });
}

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'claude-router', pid: process.pid });
});

app.post('/v1/messages', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const requestedModel = String(body.model || '');

    // Claude Code issues internal background calls (topic detection, etc.)
    // that already target Haiku; rerouting those would only add cost.
    if (requestedModel.includes('haiku')) {
      appendLog({ time: new Date().toISOString(), complexity: 'passthrough', model: requestedModel });
    } else {
      const complexity = await classifyComplexity(body.messages, pickAuthHeaders(req.headers));
      body.model = selectModel(complexity);
      appendLog({ time: new Date().toISOString(), complexity, model: body.model });
    }

    const upstream = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        ...pickForwardHeaders(req.headers),
      },
      body: JSON.stringify(body),
    });

    await pipeUpstream(upstream, res);
  } catch (err) {
    console.error('[claude-router]', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        type: 'error',
        error: { type: 'api_error', message: `claude-router proxy error: ${err.message}` },
      });
    } else {
      res.end();
    }
  }
});

// Everything else (token counting, models, batches, ...) passes through
// byte-for-byte with the original method and body.
app.all('*', express.raw({ type: () => true, limit: '100mb' }), async (req, res) => {
  try {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    delete headers['accept-encoding'];

    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const upstream = await fetch(`${ANTHROPIC_API}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: hasBody && req.body && req.body.length ? req.body : undefined,
    });

    await pipeUpstream(upstream, res);
  } catch (err) {
    console.error('[claude-router]', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        type: 'error',
        error: { type: 'api_error', message: `claude-router proxy error: ${err.message}` },
      });
    } else {
      res.end();
    }
  }
});

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function writeRuntimeFiles(port) {
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  fs.writeFileSync(PORT_FILE, String(port));
}

function removeRuntimeFiles() {
  for (const file of [PID_FILE, PORT_FILE]) {
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

async function start() {
  for (let port = DEFAULT_PORT; port <= MAX_PORT; port++) {
    try {
      const server = await listenOn(port);
      writeRuntimeFiles(port);
      console.log(`[claude-router] proxy running on 127.0.0.1:${port} (pid ${process.pid})`);

      const shutdown = () => {
        removeRuntimeFiles();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1000).unref();
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
      return;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`no free port between ${DEFAULT_PORT} and ${MAX_PORT}`);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[claude-router] fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { app, start };
