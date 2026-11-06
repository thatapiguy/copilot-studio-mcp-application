// MCP host: manages client connections to any number of MCP servers (stdio or Streamable HTTP),
// records protocol traffic so the UI can show what actually goes over the wire, and surfaces
// server-initiated requests (elicitation) to the user.
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const MAX_LOG = 300;
const LONG_TIMEOUT_MS = 37 * 60 * 1000; // matches the Copilot Studio bridge's installed host timeout

function bundledCopilotStudioEntry() {
  const pkg = require.resolve('@microsoft/copilot-studio-mcp/package.json');
  return path.join(path.dirname(pkg), 'server', 'mcp.mjs');
}

/** Launch presets for well-known servers. */
export function presetLaunch(preset, opts = {}) {
  switch (preset) {
    case 'copilot-studio': {
      const launch = opts.launch || config.copilotStudioLaunch;
      return launch === 'npx'
        ? { type: 'stdio', command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['-y', '@microsoft/copilot-studio-mcp@latest'] }
        : { type: 'stdio', command: process.execPath, args: [bundledCopilotStudioEntry()] };
    }
    case 'dataverse-proxy': {
      if (!opts.orgUrl) throw new Error('orgUrl is required');
      const args = ['-y', '@microsoft/dataverse', 'mcp', new URL(opts.orgUrl).origin];
      if (opts.preview) args.push('--preview');
      return { type: 'stdio', command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args };
    }
    case 'dataverse-remote': {
      if (!opts.orgUrl) throw new Error('orgUrl is required');
      return { type: 'http', url: `${new URL(opts.orgUrl).origin}/api/${opts.preview ? 'mcp_preview' : 'mcp'}`, tokenScopes: [`${new URL(opts.orgUrl).origin}/.default`] };
    }
    default:
      throw new Error(`Unknown preset ${preset}`);
  }
}

class Connection {
  constructor({ id, label, preset, launch, getToken }) {
    Object.assign(this, { id, label, preset, launch, getToken });
    this.status = 'disconnected';
    this.error = null;
    this.log = [];
    this.stderr = [];
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.elicitations = new Map();
    this.toolsVersion = 0;
    this.client = null;
  }

  record(direction, method, payload) {
    this.log.push({ t: new Date().toISOString(), direction, method, payload: truncate(payload) });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  async connect() {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.status = 'connecting';
    this.error = null;
    const client = new Client(
      { name: 'copilot-studio-mcp-explorer', version: '1.0.0' },
      { capabilities: { elicitation: { form: {}, url: {} } } }
    );

    client.setNotificationHandler(ToolListChangedNotificationSchema, async (n) => {
      this.record('in', n.method, n.params);
      await this.refreshTools().catch((e) => this.record('error', 'tools/list', e.message));
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async (n) => {
      this.record('in', n.method, n.params);
      await this.refreshResources().catch(() => {});
    });
    client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => this.record('in', n.method, n.params));
    client.setRequestHandler(ElicitRequestSchema, (req) => {
      this.record('in', req.method, req.params);
      const id = randomUUID();
      return new Promise((resolve) => {
        this.elicitations.set(id, { id, params: req.params, createdAt: Date.now(), resolve });
      });
    });
    client.fallbackNotificationHandler = async (n) => this.record('in', n.method, n.params);

    let transport;
    if (this.launch.type === 'stdio') {
      transport = new StdioClientTransport({
        command: this.launch.command,
        args: this.launch.args,
        env: { ...getDefaultEnvironment(), ...process.env, ...(this.launch.env || {}) },
        stderr: 'pipe'
      });
      transport.stderr?.on('data', (d) => {
        this.stderr.push(...String(d).split(/\r?\n/).filter(Boolean));
        if (this.stderr.length > 200) this.stderr.splice(0, this.stderr.length - 200);
      });
    } else {
      const getToken = this.getToken;
      const scopes = this.launch.tokenScopes;
      const staticToken = this.launch.bearerToken;
      transport = new StreamableHTTPClientTransport(new URL(this.launch.url), {
        fetch: async (url, init = {}) => {
          const headers = new Headers(init.headers);
          const token = staticToken || (scopes?.length ? await getToken(scopes) : null);
          if (token) headers.set('Authorization', `Bearer ${token}`);
          return fetch(url, { ...init, headers });
        }
      });
    }
    transport.onclose = () => {
      if (this.client === client) {
        this.status = 'disconnected';
        this.record('info', 'transport closed', null);
      }
    };

    try {
      this.record('out', 'initialize', { clientInfo: { name: 'copilot-studio-mcp-explorer' } });
      await client.connect(transport);
      this.client = client;
      this.status = 'connected';
      this.record('in', 'initialize/result', {
        serverInfo: client.getServerVersion(),
        capabilities: client.getServerCapabilities()
      });
      await this.refreshAll();
    } catch (err) {
      this.status = 'error';
      this.error = err.code === 'SIGN_IN_REQUIRED' ? 'Sign in first (Accounts panel), then connect again.' : err.message;
      this.record('error', 'connect', err.message);
      try { await client.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  async refreshAll() {
    await this.refreshTools();
    await this.refreshResources().catch(() => {});
    await this.refreshPrompts().catch(() => {});
  }

  async refreshTools() {
    if (!this.client?.getServerCapabilities()?.tools) { this.tools = []; return; }
    const out = [];
    let cursor;
    do {
      const r = await this.client.listTools(cursor ? { cursor } : {});
      out.push(...r.tools);
      cursor = r.nextCursor;
    } while (cursor);
    this.tools = out;
    this.toolsVersion++;
    this.record('in', 'tools/list/result', { count: out.length, names: out.map((t) => t.name) });
  }

  async refreshResources() {
    if (!this.client?.getServerCapabilities()?.resources) { this.resources = []; return; }
    const r = await this.client.listResources();
    this.resources = r.resources || [];
  }

  async refreshPrompts() {
    if (!this.client?.getServerCapabilities()?.prompts) { this.prompts = []; return; }
    const r = await this.client.listPrompts();
    this.prompts = r.prompts || [];
  }

  requireClient() {
    if (!this.client || this.status !== 'connected') throw new Error(`${this.label} is not connected`);
    return this.client;
  }

  async callTool(name, args) {
    const client = this.requireClient();
    this.record('out', 'tools/call', { name, arguments: args });
    const started = Date.now();
    try {
      const result = await client.callTool({ name, arguments: args ?? {} }, undefined, {
        timeout: LONG_TIMEOUT_MS,
        resetTimeoutOnProgress: true
      });
      this.record('in', 'tools/call/result', { name, ms: Date.now() - started, isError: !!result.isError });
      return { ...result, durationMs: Date.now() - started };
    } catch (err) {
      this.record('error', 'tools/call', { name, message: err.message });
      throw err;
    }
  }

  async readResource(uri) {
    const client = this.requireClient();
    this.record('out', 'resources/read', { uri });
    return client.readResource({ uri });
  }

  async getPrompt(name, args) {
    const client = this.requireClient();
    this.record('out', 'prompts/get', { name, arguments: args });
    return client.getPrompt({ name, arguments: args ?? {} });
  }

  /** Raw JSON-RPC request, for methods the SDK has no helper for (for example skills/list). */
  async rawRequest(method, params) {
    const client = this.requireClient();
    this.record('out', method, params);
    const result = await client.request({ method, params: params ?? {} }, z.any());
    this.record('in', `${method}/result`, null);
    return result;
  }

  answerElicitation(id, response) {
    const e = this.elicitations.get(id);
    if (!e) throw new Error('Unknown or already answered elicitation');
    this.elicitations.delete(id);
    this.record('out', 'elicitation/result', { action: response.action });
    e.resolve(response);
  }

  async disconnect() {
    for (const e of this.elicitations.values()) e.resolve({ action: 'cancel' });
    this.elicitations.clear();
    const c = this.client;
    this.client = null;
    this.status = 'disconnected';
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    if (c) await c.close().catch(() => {});
  }

  summary() {
    const c = this.client;
    return {
      id: this.id,
      label: this.label,
      preset: this.preset,
      launch: { ...this.launch, bearerToken: this.launch.bearerToken ? '***' : undefined },
      status: this.status,
      error: this.error,
      serverInfo: c?.getServerVersion() ?? null,
      capabilities: c?.getServerCapabilities() ?? null,
      instructions: c?.getInstructions() ?? null,
      tools: this.tools,
      toolsVersion: this.toolsVersion,
      resources: this.resources,
      prompts: this.prompts,
      elicitations: [...this.elicitations.values()].map(({ id, params, createdAt }) => ({ id, params, createdAt }))
    };
  }
}

function truncate(v) {
  if (v == null) return v;
  const s = JSON.stringify(v);
  return s.length > 4000 ? `${s.slice(0, 4000)}... (${s.length} chars)` : v;
}

export class McpHub {
  #connections = new Map();
  #getToken;

  constructor(getToken) {
    this.#getToken = getToken;
  }

  list() {
    return [...this.#connections.values()].map((c) => c.summary());
  }

  get(id) {
    const c = this.#connections.get(id);
    if (!c) throw Object.assign(new Error(`No MCP connection "${id}"`), { status: 404 });
    return c;
  }

  async add({ id, label, preset, launch }) {
    id = id || preset || randomUUID().slice(0, 8);
    const existing = this.#connections.get(id);
    if (existing) await existing.disconnect();
    const conn = new Connection({ id, label: label || id, preset: preset || 'custom', launch, getToken: this.#getToken });
    this.#connections.set(id, conn);
    await conn.connect();
    return conn.summary();
  }

  async remove(id) {
    const c = this.get(id);
    await c.disconnect();
    this.#connections.delete(id);
  }

  async closeAll() {
    await Promise.all([...this.#connections.values()].map((c) => c.disconnect()));
  }
}
