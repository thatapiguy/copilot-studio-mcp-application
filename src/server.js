import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { auth, scopes, SignInRequiredError } from './auth.js';
import { McpHub, presetLaunch } from './mcpHub.js';
import { getCatalog } from './catalog.js';
import * as dv from './dataverse.js';
import * as chat from './agentChat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(hub = new McpHub((s) => auth.getToken(s))) {
  const app = express();
  app.disable('x-powered-by');

  // Local-only tool: reject DNS-rebinding style hosts and non-JSON writes (forces a CORS preflight cross-origin).
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.status(403).json({ error: 'Local access only' });
    if (req.method !== 'GET' && req.path.startsWith('/api/') && !req.is('application/json')) {
      return res.status(415).json({ error: 'Use application/json' });
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const h = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof SignInRequiredError) {
        return res.status(401).json({ error: err.message, code: err.code, scopes: err.scopes });
      }
      res.status(err.status || 500).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
  };

  // ---------- Catalog ----------
  app.get('/api/catalog', h(() => getCatalog()));

  // ---------- Explorer sign-in (Dataverse + agent chat) ----------
  app.get('/api/auth', h(() => auth.state()));
  app.post('/api/auth/config', h((req) => { auth.configure(req.body || {}); return auth.state(); }));
  app.post('/api/auth/device-code', h((req) => {
    const s = req.body?.scopes;
    const requested = Array.isArray(s) && s.length ? s : scopes.globalDiscovery;
    return auth.startDeviceCode(requested);
  }));
  app.post('/api/auth/cancel', h(() => { auth.cancel(); return auth.state(); }));
  app.post('/api/auth/sign-out', h(async () => { await auth.signOut(); return auth.state(); }));

  // ---------- MCP connections ----------
  app.get('/api/mcp', h(() => hub.list()));
  app.post('/api/mcp', h((req) => {
    const { preset, id, label, orgUrl, preview, launch: launchMode, url, bearerToken, tokenScopes, command, args } = req.body || {};
    let launch;
    if (preset === 'custom-http') {
      if (!url) throw new Error('url is required');
      const u = new URL(url);
      if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('Use an https URL');
      launch = { type: 'http', url: u.href, bearerToken: bearerToken || undefined, tokenScopes: tokenScopes?.length ? tokenScopes : undefined };
    } else if (preset === 'custom-stdio') {
      if (!command) throw new Error('command is required');
      launch = { type: 'stdio', command, args: Array.isArray(args) ? args : [] };
    } else {
      launch = presetLaunch(preset, { orgUrl: orgUrl && dv.normalizeOrgUrl(orgUrl), preview, launch: launchMode });
    }
    const defaults = {
      'copilot-studio': 'Copilot Studio MCP',
      'dataverse-remote': `Dataverse MCP (${orgUrl ? new URL(dv.normalizeOrgUrl(orgUrl)).hostname : ''})`,
      'dataverse-proxy': `Dataverse MCP proxy (${orgUrl ? new URL(dv.normalizeOrgUrl(orgUrl)).hostname : ''})`
    };
    return hub.add({ id: id || preset, label: label || defaults[preset] || id || preset, preset, launch });
  }));
  app.get('/api/mcp/:id', h((req) => hub.get(req.params.id).summary()));
  app.delete('/api/mcp/:id', h(async (req) => { await hub.remove(req.params.id); return { ok: true }; }));
  app.post('/api/mcp/:id/reconnect', h(async (req) => {
    const c = hub.get(req.params.id);
    await c.disconnect();
    await c.connect();
    return c.summary();
  }));
  app.post('/api/mcp/:id/refresh', h(async (req) => { const c = hub.get(req.params.id); await c.refreshAll(); return c.summary(); }));
  app.get('/api/mcp/:id/log', h((req) => ({ log: hub.get(req.params.id).log, stderr: hub.get(req.params.id).stderr })));
  app.post('/api/mcp/:id/tools/:tool', h((req) => hub.get(req.params.id).callTool(req.params.tool, req.body?.arguments ?? {})));
  app.post('/api/mcp/:id/resources/read', h((req) => hub.get(req.params.id).readResource(req.body?.uri)));
  app.post('/api/mcp/:id/prompts/:name', h((req) => hub.get(req.params.id).getPrompt(req.params.name, req.body?.arguments)));
  app.post('/api/mcp/:id/elicitations/:eid', h((req) => {
    hub.get(req.params.id).answerElicitation(req.params.eid, req.body);
    return { ok: true };
  }));

  // Skills: prefer native skills/list (MCP skills extension), fall back to the advertised reader tool.
  app.get('/api/mcp/:id/skills', h(async (req) => {
    const c = hub.get(req.params.id);
    try {
      const r = await c.rawRequest('skills/list', {});
      return { source: 'skills/list', skills: r.skills || [] };
    } catch (nativeErr) {
      const reader = c.tools.find((t) => t.name === 'get_copilot_studio_skills' || t.name === 'get_agentic_builder_skills');
      if (!reader) {
        return { source: null, skills: [], note: 'No skill reader is available yet. Sign in and select an environment first.', nativeError: nativeErr.message };
      }
      const r = await c.callTool(reader.name, {});
      return { source: reader.name, result: r };
    }
  }));
  app.get('/api/mcp/:id/skills/:name', h(async (req) => {
    const c = hub.get(req.params.id);
    const reader = c.tools.find((t) => t.name === 'get_copilot_studio_skills' || t.name === 'get_agentic_builder_skills');
    const args = { name: req.params.name, ...(req.query.path ? { path: String(req.query.path) } : {}) };
    if (reader) return { source: reader.name, result: await c.callTool(reader.name, args) };
    const uri = `copilotflow://skills/${encodeURIComponent(req.params.name)}/${req.query.path ? String(req.query.path) : 'SKILL.md'}`;
    return { source: 'resources/read', result: await c.readResource(uri) };
  }));

  // ---------- Dataverse ----------
  app.get('/api/dataverse/instances', h(() => dv.listInstances()));
  app.get('/api/dataverse/whoami', h((req) => dv.whoAmI(String(req.query.org || ''))));
  app.get('/api/dataverse/agents', h((req) => dv.listAgents(String(req.query.org || ''))));
  app.get('/api/dataverse/agents/:botId/components', h((req) => dv.listAgentComponents(String(req.query.org || ''), req.params.botId)));
  app.get('/api/dataverse/connection-references', h((req) => dv.listConnectionReferences(String(req.query.org || ''))));
  app.post('/api/dataverse/odata', h((req) => dv.odataGet(String(req.body?.org || ''), req.body?.query)));
  app.get('/api/dataverse/scopes', h((req) => {
    const org = dv.normalizeOrgUrl(String(req.query.org || ''));
    return { webApi: scopes.dataverse(org), mcp: scopes.dataverseDefault(org), globalDiscovery: scopes.globalDiscovery, powerPlatformApi: scopes.powerPlatformApi };
  }));

  // ---------- Agent chat (agents-copilotstudio-client) ----------
  app.post('/api/chat/start', h((req) => chat.startChat(req.body || {})));
  app.post('/api/chat/:sid/send', h((req) => chat.sendChat(req.params.sid, String(req.body?.text || ''))));
  app.delete('/api/chat/:sid', h((req) => { chat.endChat(req.params.sid); return { ok: true }; }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return { app, hub };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { app, hub } = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`Copilot Studio MCP Explorer running at http://localhost:${config.port}`);
  });
  const shutdown = async () => {
    await hub.closeAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
