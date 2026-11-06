// Integration test: starts the explorer API and the real bundled Copilot Studio MCP bridge (no sign-in needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';

let server, base, hub;
before(async () => {
  const created = createApp();
  hub = created.hub;
  await new Promise((r) => { server = created.app.listen(0, '127.0.0.1', r); });
  base = `http://localhost:${server.address().port}`;
});
after(async () => { await hub.closeAll(); server.close(); });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('rejects non-local hosts and non-JSON writes', async () => {
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/catalog', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST', body: 'x' })).status, 415);
});

test('Dataverse endpoints ask for sign-in first', async () => {
  const r = await fetch(`${base}/api/dataverse/instances`);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'SIGN_IN_REQUIRED');
});

test('chat validates input', async () => {
  assert.equal((await post('/api/chat/start', {})).status, 400);
});

test('connects to the Copilot Studio MCP bridge and lists its bootstrap tools', { timeout: 60000 }, async () => {
  const r = await post('/api/mcp', { preset: 'copilot-studio' });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'connected');
  assert.equal(body.serverInfo.name, 'copilot-studio-mcp-bridge');
  const names = body.tools.map((t) => t.name);
  for (const n of ['copilot_studio_status', 'copilot_studio_connect', 'copilot_studio_list_environments', 'copilot_studio_select_environment', 'copilot_studio_prepare_connection']) {
    assert.ok(names.includes(n), n);
  }
  const status = await (await post('/api/mcp/copilot-studio/tools/copilot_studio_status', { arguments: {} })).json();
  const parsed = JSON.parse(status.content[0].text);
  assert.equal(parsed.signedIn, false);
  assert.equal(parsed.ring, 'prod');

  const skills = await (await fetch(`${base}/api/mcp/copilot-studio/skills`)).json();
  assert.equal(skills.source, null); // not available until an environment is selected

  const log = await (await fetch(`${base}/api/mcp/copilot-studio/log`)).json();
  assert.ok(log.log.some((e) => e.method === 'tools/call'));
});
