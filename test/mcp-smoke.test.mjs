import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/trackpilot.mjs', import.meta.url));

// Drive the server: spawn it, send newline-delimited JSON-RPC, collect stdout
// lines, and resolve when a response with the given id arrives (or time out).
function rpcSession() {
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    env: {
      ...process.env,
      YOUTRACK_BASE_URL: 'https://stub.youtrack.cloud',
      YOUTRACK_TOKEN: 'stub-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const messages = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) messages.push(JSON.parse(line)); // throws if stdout is not pure JSON-RPC
    }
  });

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

  const waitFor = (id, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const found = messages.find((m) => m.id === id);
        if (found) return resolve(found);
        if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for id ${id}`));
        setTimeout(tick, 25);
      };
      tick();
    });

  return { child, send, waitFor };
}

test('server lists all 12 tools via the JSON-RPC handshake', async () => {
  const { child, send, waitFor } = rpcSession();
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    });
    await waitFor(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const res = await waitFor(2);

    const names = res.result.tools.map((t) => t.name).sort();
    assert.equal(names.length, 12);
    assert.ok(names.includes('search'));
    assert.ok(names.includes('create_issue'));
    assert.ok(names.includes('log_work'));
  } finally {
    child.kill();
  }
});
