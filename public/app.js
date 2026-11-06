// Copilot Studio MCP Explorer: front end (no build step, no framework).
// All server data is rendered through DOM APIs (textContent) to avoid HTML injection.

const state = {
  catalog: null,
  auth: null,
  connections: [],
  selectedTool: {},       // connId -> tool name
  results: {},            // `${connId}:${tool}` -> last result
  envChoices: [],
  csStatus: null,
  dv: {
    org: load('dv.org') || '',
    instances: [],
    agents: [],
    connRefs: [],
    who: null,
    components: {},
    selectedBot: null
  },
  chat: { sessionId: null, transcript: [], settings: load('chat.settings') || {} },
  consoleConn: null,
  skillView: null,
  presetArgs: {}          // `${connId}:${tool}` -> arguments to prefill once
};

/** Select a tool in the explorer with prefilled arguments and navigate to it. */
function openTool(connId, tool, args) {
  state.selectedTool[connId] = tool;
  if (args) state.presetArgs[`${connId}:${tool}`] = args;
  const target = connId === 'copilot-studio' ? '#copilot-studio' : '#console';
  if (connId !== 'copilot-studio') state.consoleConn = connId;
  if (location.hash === target) render().then(() => document.getElementById('tool-detail')?.scrollIntoView({ behavior: 'smooth' }));
  else { location.hash = target; setTimeout(() => document.getElementById('tool-detail')?.scrollIntoView({ behavior: 'smooth' }), 300); }
}

// ---------- helpers ----------
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
const link = (url, label) => el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label || url);
const badge = (text, kind = '') => el('span', { class: `badge ${kind}` }, text);
const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'SIGN_IN_REQUIRED') {
    await signIn(data.scopes);
    throw Object.assign(new Error('Finish signing in, then try again.'), { handled: true });
  }
  if (!res.ok) {
    if (data.details?.hints) {
      modal('Request was refused', el('div', { class: 'stack' },
        el('div', { class: 'callout danger' }, data.error),
        el('b', {}, 'Likely causes'),
        el('ol', {}, data.details.hints.map((x) => el('li', {}, x))),
        el('details', {}, el('summary', {}, 'Token claims (decoded, not verified)'), el('pre', {}, JSON.stringify(data.details.claims, null, 2)))));
      throw Object.assign(new Error(data.error), { handled: true });
    }
    throw new Error(data.error || res.statusText);
  }
  return data;
}

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { if (!e.handled) toast(e.message, 6000); else toast(e.message); }
  finally { if (btn) btn.disabled = false; }
}

function modal(title, body, actions = [{ label: 'Close' }]) {
  const m = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  const b = document.getElementById('modal-body');
  b.replaceChildren(body);
  const a = document.getElementById('modal-actions');
  return new Promise((resolve) => {
    a.replaceChildren(...actions.map((x) => el('button', {
      class: x.kind || '',
      onclick: () => { m.hidden = true; resolve(x.value ?? x.label); }
    }, x.label)));
    m.hidden = false;
  });
}
function closeModal() { document.getElementById('modal').hidden = true; }

/** Parse an MCP tool result's text content as JSON when possible. */
function toolPayload(result) {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const texts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (texts.length === 1) { try { return JSON.parse(texts[0]); } catch { return texts[0]; } }
  return texts.join('\n\n');
}

function renderResult(result) {
  if (!result) return el('div');
  const items = [];
  items.push(el('div', { class: 'row' },
    result.isError ? badge('isError', 'danger') : badge('ok', 'ok'),
    result.durationMs != null ? el('span', { class: 'muted small' }, `${result.durationMs} ms`) : null));
  for (const c of result.content || []) {
    if (c.type === 'text') {
      let txt = c.text;
      try { txt = JSON.stringify(JSON.parse(c.text), null, 2); } catch { /* plain text */ }
      items.push(el('pre', {}, txt));
    } else if (c.type === 'resource') {
      items.push(el('div', { class: 'small muted' }, `resource: ${c.resource?.uri}`), el('pre', {}, c.resource?.text ?? '[binary]'));
    } else if (c.type === 'resource_link') {
      items.push(el('div', { class: 'small' }, 'resource link: ', el('code', {}, c.uri), c.description ? ` ${c.description}` : ''));
    } else if (c.type === 'image') {
      items.push(el('img', { src: `data:${c.mimeType};base64,${c.data}`, style: 'max-width:100%' }));
    } else {
      items.push(el('pre', {}, pretty(c)));
    }
  }
  if (result.structuredContent) items.push(el('details', {}, el('summary', {}, 'structuredContent'), el('pre', {}, pretty(result.structuredContent))));
  return el('div', { class: 'stack' }, items);
}

// ---------- data loading ----------
async function refreshAuth() {
  state.auth = await api('/api/auth');
  renderAccount();
}
async function refreshConnections() {
  state.connections = await api('/api/mcp');
}
const conn = (id) => state.connections.find((c) => c.id === id);

async function signIn(scopes) {
  const s = await api('/api/auth/device-code', { method: 'POST', body: { scopes } });
  if (!s.pending) {
    if (s.lastError) toast(`Sign-in failed: ${s.lastError}`, 8000);
    return;
  }
  const { userCode, verificationUri } = s.pending;
  const body = el('div', { class: 'stack' },
    el('p', {}, 'Open ', link(verificationUri), ' and enter this code:'),
    el('div', { class: 'code-big' }, userCode),
    el('p', { class: 'muted small' }, 'Requested scopes: ', s.pending.scopes.join(' ')),
    el('p', { class: 'muted small' }, 'This window closes when sign-in completes. Signing in here is for Dataverse and agent chat. The Copilot Studio MCP bridge signs in separately, in its own browser window.'));
  const poll = setInterval(async () => {
    const a = await fetch('/api/auth').then((r) => r.json());
    if (!a.pending) {
      clearInterval(poll);
      closeModal();
      state.auth = a;
      renderAccount();
      if (a.lastError) toast(`Sign-in failed: ${a.lastError}`, 8000);
      else if (a.account) { toast(`Signed in as ${a.account.username}`); render(); }
    }
  }, 2000);
  const r = await modal('Sign in with your work account', body, [
    { label: 'Copy code', value: 'copy' },
    { label: 'Cancel', value: 'cancel', kind: 'danger' }
  ]);
  if (r === 'copy') { navigator.clipboard?.writeText(userCode); toast('Code copied. The sign-in keeps waiting.'); }
  if (r === 'cancel') { clearInterval(poll); await api('/api/auth/cancel', { method: 'POST', body: {} }); }
}

function renderAccount() {
  const a = state.auth;
  const box = document.getElementById('account');
  if (!a) return box.replaceChildren();
  if (a.account) {
    box.replaceChildren(
      el('span', { class: 'dot ok' }),
      el('span', { title: `Tenant ${a.account.tenantId}` }, a.account.username),
      el('button', { onclick: () => guard(async () => { await api('/api/auth/sign-out', { method: 'POST', body: {} }); await refreshAuth(); render(); }) }, 'Sign out'));
  } else {
    box.replaceChildren(
      el('span', { class: 'dot' }),
      el('span', { class: 'muted' }, 'Not signed in (Dataverse / chat)'),
      el('button', { class: 'primary', onclick: () => guard(() => signIn()) }, 'Sign in'));
  }
}

// ---------- routing ----------
const views = { overview, 'copilot-studio': copilotStudio, skills, dataverse, console: mcpConsole, chat: agentChat };
function currentTab() { const t = location.hash.replace('#', '').split('/')[0]; return views[t] ? t : 'overview'; }
async function render() {
  const tab = currentTab();
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const view = document.getElementById('view');
  try {
    view.replaceChildren(await views[tab]());
  } catch (e) {
    view.replaceChildren(el('div', { class: 'callout danger' }, e.message));
  }
}
window.addEventListener('hashchange', render);

// ======================================================================
// Overview
// ======================================================================
async function overview() {
  const { packages, docs } = state.catalog;
  return el('div', {},
    el('h1', {}, 'Explore Copilot Studio through MCP'),
    el('p', { class: 'muted' },
      'This local app is an MCP host. It launches the Copilot Studio MCP server, connects to your Dataverse environment and its MCP endpoint, and talks to published agents with the agents-copilotstudio-client SDK. You can see every tool, skill and protocol message.'),
    el('div', { class: 'card', style: 'margin:14px 0' },
      el('h3', {}, 'How the pieces fit'),
      el('div', { class: 'arch' },
        el('div', { class: 'node' }, el('b', {}, 'This explorer'), 'MCP client + SDK host'),
        el('div', { class: 'arrow' }, '→'),
        el('div', { class: 'node' }, el('b', {}, '@microsoft/copilot-studio-mcp'), 'stdio bridge: sign-in, environment, connector setup'),
        el('div', { class: 'arrow' }, '→'),
        el('div', { class: 'node' }, el('b', {}, 'Copilot Studio cloud MCP'), 'manage_agents · manage_workflows · discover_resources · get_consumption · Skills')),
      el('div', { class: 'arch', style: 'margin-top:10px' },
        el('div', { class: 'node' }, el('b', {}, 'This explorer'), 'device-code sign-in'),
        el('div', { class: 'arrow' }, '→'),
        el('div', { class: 'node' }, el('b', {}, 'Dataverse'), 'Web API (bots, connection references) and MCP at /api/mcp'),
        el('div', { class: 'arrow' }, '→'),
        el('div', { class: 'node' }, el('b', {}, 'Published agent'), 'chat via @microsoft/agents-copilotstudio-client'))),
    el('h2', {}, 'Packages and servers'),
    el('div', { class: 'grid' }, packages.map((p) => el('div', { class: 'card stack' },
      el('div', { class: 'row between' }, el('h3', {}, p.name), badge(p.kind, 'accent')),
      el('p', {}, p.summary),
      el('pre', {}, p.howItRuns),
      el('ul', { class: 'small' }, p.facts.map((f) => el('li', {}, f))),
      p.api ? el('details', {}, el('summary', {}, 'SDK surface'), el('table', {}, el('tbody', {}, p.api.map((x) => el('tr', {}, el('td', {}, el('code', {}, x.name)), el('td', {}, x.desc)))))) : null,
      el('div', { class: 'row' }, p.links.map((l) => link(l.url, l.label))),
      el('div', {}, el('a', { class: 'btn primary', href: `#${p.explorerTab}` }, 'Explore →'))))),
    el('h2', {}, 'Quick start'),
    el('ol', { class: 'steps' },
      el('li', {}, el('b', {}, 'Copilot Studio MCP: '), 'open the ', el('a', { href: '#copilot-studio' }, 'Copilot Studio MCP'), ' tab, start the server, sign in (a browser opens), and pick an environment. The cloud tools and Skills appear.'),
      el('li', {}, el('b', {}, 'Skills: '), 'read the authoring guidance the service provides on the ', el('a', { href: '#skills' }, 'Skills'), ' tab before you create or change anything.'),
      el('li', {}, el('b', {}, 'Dataverse: '), 'sign in (top right), pick an environment on the ', el('a', { href: '#dataverse' }, 'Dataverse'), ' tab, and browse its agents, topics and connection references. You can also connect its MCP server.'),
      el('li', {}, el('b', {}, 'Chat: '), 'choose a published agent and talk to it on the ', el('a', { href: '#chat' }, 'Agent Chat'), ' tab.'),
      el('li', {}, el('b', {}, 'Inspect: '), 'watch the raw JSON-RPC traffic, resources, prompts and elicitations on the ', el('a', { href: '#console' }, 'MCP Console'), ' tab.')),
    el('div', { class: 'callout warn' },
      el('b', {}, 'Safety. '),
      'Tools marked ', badge('destructive', 'danger'), ' or ', badge('writes', 'warn'),
      ' change real Power Platform resources. Use a development environment. The explorer always asks before running them. Never automatically retry a write whose outcome is uncertain: inspect it first. ',
      link(docs.copilotStudioMcp, 'Microsoft guidance')));
}

// ======================================================================
// Copilot Studio MCP
// ======================================================================
async function copilotStudio() {
  await refreshConnections();
  const c = conn('copilot-studio');
  const { docs } = state.catalog;
  const wrap = el('div', {});
  wrap.append(
    el('div', { class: 'row between' },
      el('div', {}, el('h1', {}, '@microsoft/copilot-studio-mcp'),
        el('p', { class: 'muted' }, 'The Copilot Studio MCP bridge runs over stdio. Below are the live tool catalog, explanations, input schemas and a runner for each tool.')),
      el('div', { class: 'row' }, link(docs.copilotStudioMcp, 'Docs'), link(docs.copilotStudioMcpNpm, 'npm'))));

  if (!c || c.status !== 'connected') {
    const launchSel = el('select', {}, el('option', { value: 'bundled' }, 'Bundled copy (node_modules, pinned)'), el('option', { value: 'npx' }, 'npx -y @microsoft/copilot-studio-mcp@latest'));
    wrap.append(el('div', { class: 'card stack' },
      el('h3', {}, 'Start the MCP server'),
      el('p', {}, 'This spawns the bridge as a child process and performs the MCP initialize handshake. Nothing is sent to the cloud until you sign in.'),
      c?.error ? el('div', { class: 'callout danger' }, c.error) : null,
      el('div', { class: 'row' }, el('label', { class: 'field' }, 'Launch', launchSel),
        el('button', { class: 'primary', onclick: (e) => guard(async () => {
          await api('/api/mcp', { method: 'POST', body: { preset: 'copilot-studio', launch: launchSel.value } });
          await refreshStatus();
          render();
        }, e.target) }, 'Start & connect'))));
    wrap.append(el('h2', {}, 'What you will be able to do'), toolCatalogStatic());
    return wrap;
  }

  if (!state.csStatus) await refreshStatus();
  wrap.append(statusCard(c), onboardingCard(c));
  wrap.append(el('h2', {}, 'Guided scenarios'), scenariosView(c));
  wrap.append(el('h2', {}, `Tools (${c.tools.length} live)`), toolExplorer(c));
  return wrap;
}

async function refreshStatus() {
  try {
    const r = await api('/api/mcp/copilot-studio/tools/copilot_studio_status', { method: 'POST', body: { arguments: {} } });
    state.csStatus = toolPayload(r);
  } catch { state.csStatus = null; }
  await refreshConnections();
}

function statusCard(c) {
  const s = typeof state.csStatus === 'object' ? state.csStatus : null;
  const env = s?.environment;
  return el('div', { class: 'card stack' },
    el('div', { class: 'row between' },
      el('div', { class: 'row' }, el('span', { class: `dot ${s?.signedIn ? (env ? 'ok' : 'warn') : ''}` }),
        el('b', {}, s?.signedIn ? (env ? 'Connected' : 'Signed in, no environment') : 'Not signed in'),
        c.serverInfo ? badge(`${c.serverInfo.name} ${c.serverInfo.version}`) : null,
        s?.ring ? badge(`ring: ${s.ring}`, 'accent') : null),
      el('div', { class: 'row' },
        el('button', { onclick: (e) => guard(async () => { await refreshStatus(); render(); }, e.target) }, 'Refresh status'),
        el('button', { onclick: (e) => guard(async () => { await api('/api/mcp/copilot-studio/reconnect', { method: 'POST', body: {} }); state.csStatus = null; render(); }, e.target) }, 'Restart server'),
        el('button', { class: 'danger', onclick: (e) => guard(async () => { await api('/api/mcp/copilot-studio', { method: 'DELETE' }); state.csStatus = null; render(); }, e.target) }, 'Stop'))),
    s ? el('table', {}, el('tbody', {},
      el('tr', {}, el('th', {}, 'Account'), el('td', {}, s.account ? `${s.account.username} (tenant ${s.account.tenantId})` : '—')),
      el('tr', {}, el('th', {}, 'Environment'), el('td', {}, env ? pretty(env) : '—')),
      el('tr', {}, el('th', {}, 'Skills'), el('td', {}, s.skillReaderTool ? `reader tool: ${s.skillReaderTool}` : (s.nativeSkills ? `native skills ${s.nativeSkills.available ? 'available' : 'unavailable'}` : 'not loaded yet'))),
      el('tr', {}, el('th', {}, 'Credentials persisted'), el('td', {}, String(s.credentialsPersisted))))) : null,
    s?.serverInstructions ? el('details', {}, el('summary', {}, 'serverInstructions from the cloud service'), el('pre', {}, pretty(s.serverInstructions))) : null,
    c.instructions ? el('details', {}, el('summary', {}, 'Bridge initialize instructions'), el('pre', {}, c.instructions)) : null,
    el('details', {}, el('summary', {}, 'Raw status'), el('pre', {}, pretty(state.csStatus))));
}

function onboardingCard(c) {
  const s = typeof state.csStatus === 'object' ? state.csStatus : {};
  const signedIn = !!s?.signedIn;
  const hasEnv = !!s?.environment;
  const call = async (tool, args, btn) => guard(async () => {
    const r = await api(`/api/mcp/copilot-studio/tools/${tool}`, { method: 'POST', body: { arguments: args } });
    if (r.isError) toast(pretty(toolPayload(r)).slice(0, 400), 8000);
    return r;
  }, btn);

  const query = el('input', { placeholder: 'filter by name, or full environment ID', style: 'flex:1' });
  const envList = el('div', {});
  const drawEnvs = () => envList.replaceChildren(state.envChoices.length
    ? el('ul', { class: 'list' }, state.envChoices.map((e) => el('li', { class: 'row between' },
      el('div', {}, el('b', {}, e.name), ' ', el('span', { class: 'muted small' }, [e.type, e.location, e.id].filter(Boolean).join(' · '))),
      el('button', { class: 'primary', onclick: (ev) => call('copilot_studio_select_environment', { environment: e.id || e.name }, ev.target).then(async (r) => {
        if (r && !r.isError) { toast(`Connected to ${e.name}. Loading cloud tools…`); await refreshStatus(); render(); }
      }) }, 'Connect'))))
    : el('div', { class: 'muted small' }, 'No environments listed yet.'));
  drawEnvs();

  return el('div', { class: 'card stack' },
    el('h3', {}, 'Onboarding'),
    el('ol', { class: 'steps' },
      el('li', { class: signedIn ? 'done' : '' },
        el('div', { class: 'row between' }, el('span', {}, el('b', {}, 'Sign in '), el('code', {}, 'copilot_studio_connect')),
          el('button', { class: signedIn ? '' : 'primary', onclick: async (ev) => {
            if (signedIn) {
              const ok = await modal('Replace the current session?', el('p', {}, 'Signing in again clears the current account, environment and connection plans.'), [{ label: 'Cancel', value: false }, { label: 'Sign in again', value: true, kind: 'danger' }]);
              if (!ok) return;
            }
            toast('A sign-in window is opening in your browser…', 6000);
            const r = await call('copilot_studio_connect', {}, ev.target);
            if (r) { await refreshStatus(); render(); }
          } }, signedIn ? 'Switch account' : 'Sign in')),
        el('div', { class: 'muted small' }, 'The bridge opens a Microsoft sign-in page in the browser on this machine. The browser prompt is your confirmation.')),
      el('li', { class: hasEnv ? 'done' : '' },
        el('div', {}, el('b', {}, 'Choose an environment '), el('code', {}, 'copilot_studio_list_environments'), ' → ', el('code', {}, 'copilot_studio_select_environment')),
        el('div', { class: 'row', style: 'margin:6px 0' }, query,
          el('button', { disabled: !signedIn, onclick: (ev) => call('copilot_studio_list_environments', query.value.trim() ? { query: query.value.trim() } : {}, ev.target).then((r) => {
            if (!r) return;
            state.envChoices = extractEnvironments(toolPayload(r));
            if (!state.envChoices.length) modal('Environments', el('pre', {}, pretty(toolPayload(r))));
            drawEnvs();
          }) }, 'List environments')),
        envList,
        el('div', { class: 'muted small' }, 'Prefer a development or sandbox environment. Never select production implicitly.')),
      el('li', { class: hasEnv && c.tools.length > 9 ? 'done' : '' },
        el('div', {}, el('b', {}, 'Use the cloud tools and Skills. '), 'After selection the server sends ', el('code', {}, 'notifications/tools/list_changed'), ' and the explorer reloads ', el('code', {}, 'tools/list'), '.'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: '#skills' }, 'Open Skills'), el('button', { onclick: (ev) => guard(async () => { await api('/api/mcp/copilot-studio/refresh', { method: 'POST', body: {} }); render(); }, ev.target) }, 'Refresh tools/list')))));
}

/** Best-effort extraction of environment choices from the list_environments payload. */
function extractEnvironments(payload) {
  const out = [];
  const seen = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === 'object') {
      const id = v.id || v.environmentId || v.name;
      const name = v.displayName || v.friendlyName || v.name || v.id;
      if (id && name && (v.displayName || v.environmentId || v.type || v.location) && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name, type: v.type || v.environmentType || v.sku, location: v.location || v.region });
      }
      Object.values(v).forEach(visit);
    }
  };
  visit(payload);
  return out;
}

function annotationBadges(tool, meta) {
  const a = tool?.annotations || {};
  const out = [];
  if (a.readOnlyHint) out.push(badge('read-only', 'ok'));
  if (a.destructiveHint || meta?.destructive) out.push(badge('destructive', 'danger'));
  else if (a.readOnlyHint === false) out.push(badge('writes', 'warn'));
  if (a.idempotentHint) out.push(badge('idempotent'));
  if (a.openWorldHint === false) out.push(badge('local only'));
  return out;
}

function skillLink(name) {
  if (!name) return null;
  return el('a', { href: `#skills/${name}`, class: 'badge accent', title: 'Read this skill first' }, `skill: ${name}`);
}

function toolCatalogStatic() {
  const meta = state.catalog.copilotStudioTools;
  const groups = {};
  for (const [name, m] of Object.entries(meta)) (groups[m.group] ||= []).push([name, m]);
  return el('div', {}, Object.entries(groups).map(([g, items]) => el('div', {},
    el('div', { class: 'tool-group' }, g),
    el('div', { class: 'grid' }, items.sort((a, b) => a[1].order - b[1].order).map(([name, m]) => el('div', { class: 'card stack' },
      el('div', { class: 'row between' }, el('code', {}, name), m.destructive ? badge('destructive', 'danger') : null),
      el('b', {}, m.title), el('p', { class: 'small' }, m.explain),
      el('div', { class: 'row' }, badge(`side effects: ${m.sideEffects}`), skillLink(m.skill))))))));
}

function toolExplorer(c) {
  const meta = state.catalog.copilotStudioTools;
  const groups = {};
  for (const t of c.tools) {
    const g = meta[t.name]?.group || 'Other (live only)';
    (groups[g] ||= []).push(t);
  }
  const byOrder = [...c.tools].sort((x, y) => (meta[x.name]?.order ?? 99) - (meta[y.name]?.order ?? 99));
  const selected = c.tools.some((t) => t.name === state.selectedTool[c.id]) ? state.selectedTool[c.id] : byOrder[0]?.name;
  const detail = el('div', { id: 'tool-detail' });
  const list = el('div', { class: 'card flat' }, Object.entries(groups).map(([g, tools]) => el('div', {},
    el('div', { class: 'tool-group' }, g),
    el('ul', { class: 'list' }, tools.sort((a, b) => (meta[a.name]?.order ?? 99) - (meta[b.name]?.order ?? 99)).map((t) => el('li', {
      class: `clickable ${t.name === selected ? 'selected' : ''}`,
      onclick: () => { state.selectedTool[c.id] = t.name; render(); }
    }, el('div', {}, el('code', {}, t.name)), el('div', { class: 'muted small' }, t.title || meta[t.name]?.title || ''))))))
  );
  const tool = c.tools.find((t) => t.name === selected);
  if (tool) detail.append(toolCard(c, tool));
  const notYet = Object.keys(meta).filter((n) => !c.tools.some((t) => t.name === n) && n !== 'copilot_studio_select_ring');
  return el('div', {},
    el('div', { class: 'split' }, list, detail),
    notYet.length ? el('div', { class: 'callout', style: 'margin-top:12px' },
      el('b', {}, 'Not loaded yet: '), notYet.map((n) => el('code', { style: 'margin-right:6px' }, n)),
      el('div', { class: 'small muted' }, 'Cloud tools appear after sign-in and environment selection. Availability also depends on rollout, permissions and policy.')) : null);
}

function skeletonFromSchema(schema) {
  if (!schema || schema.type !== 'object') return {};
  const out = {};
  for (const [k, p] of Object.entries(schema.properties || {})) {
    if (!(schema.required || []).includes(k)) continue;
    if (p.const !== undefined) out[k] = p.const;
    else if (p.enum) out[k] = p.enum[0];
    else if (p.type === 'boolean') out[k] = false;
    else if (p.type === 'number' || p.type === 'integer') out[k] = 0;
    else if (p.type === 'object') out[k] = {};
    else if (p.type === 'array') out[k] = [];
    else out[k] = '';
  }
  return out;
}

function toolCard(c, tool, presetArgs) {
  const m = c.preset === 'copilot-studio' ? state.catalog.copilotStudioTools[tool.name] : null;
  const key = `${c.id}:${tool.name}`;
  const preset = presetArgs ?? state.presetArgs[key];
  delete state.presetArgs[key];
  const initial = preset ?? m?.example ?? skeletonFromSchema(tool.inputSchema);
  const ta = el('textarea', { class: 'json', spellcheck: 'false' }, JSON.stringify(initial, null, 2));
  const out = el('div', {}, renderResult(state.results[key]));
  const props = tool.inputSchema?.properties || {};
  const actionProp = props.action;
  const actionPicker = actionProp?.enum ? el('label', { class: 'field' }, 'action',
    el('select', { onchange: (e) => {
      let v = {}; try { v = JSON.parse(ta.value || '{}'); } catch { /* keep */ }
      v.action = e.target.value; if (v.parameters === undefined && props.parameters) v.parameters = {};
      ta.value = JSON.stringify(v, null, 2);
    } }, el('option', { value: '' }, '— choose —'), actionProp.enum.map((x) => el('option', { value: x }, x)))) : null;

  const run = async (btn) => {
    let args;
    try { args = ta.value.trim() ? JSON.parse(ta.value) : {}; } catch (e) { return toast(`Invalid JSON: ${e.message}`); }
    const a = tool.annotations || {};
    const risky = a.destructiveHint || m?.destructive || (a.readOnlyHint === false && !['copilot_studio_connect', 'copilot_studio_select_environment', 'copilot_studio_disconnect', 'copilot_studio_clear_read_cache'].includes(tool.name));
    if (risky) {
      const ok = await modal(`Run ${tool.name}?`, el('div', { class: 'stack' },
        el('div', { class: 'callout danger' }, 'This tool can change real resources in the selected environment. Check the target environment, account and arguments.'),
        m ? el('p', { class: 'small' }, m.explain) : null,
        el('pre', {}, pretty(args))), [{ label: 'Cancel', value: false }, { label: 'Run it', value: true, kind: 'danger' }]);
      if (!ok) return;
    }
    await guard(async () => {
      out.replaceChildren(el('div', { class: 'muted' }, 'Running… long operations can take minutes.'));
      const r = await api(`/api/mcp/${encodeURIComponent(c.id)}/tools/${encodeURIComponent(tool.name)}`, { method: 'POST', body: { arguments: args } });
      state.results[key] = r;
      out.replaceChildren(renderResult(r));
      if (c.preset === 'copilot-studio' && tool.name.startsWith('copilot_studio_')) await refreshStatus();
    }, btn).catch(() => {});
  };

  return el('div', { class: 'card stack' },
    el('div', { class: 'row between' }, el('h3', {}, tool.title || m?.title || tool.name), el('div', { class: 'row' }, annotationBadges(tool, m), skillLink(m?.skill))),
    el('code', {}, tool.name),
    m ? el('div', { class: 'callout' }, m.explain, el('div', { class: 'small muted' }, `Side effects: ${m.sideEffects}`)) : null,
    tool.description ? el('details', { open: !m }, el('summary', {}, 'Server description (sent to the model)'), el('p', { class: 'small' }, tool.description)) : null,
    Object.keys(props).length ? el('details', { open: true }, el('summary', {}, 'Input parameters'),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'name'), el('th', {}, 'type'), el('th', {}, 'details'))),
        el('tbody', {}, Object.entries(props).map(([k, p]) => el('tr', {},
          el('td', {}, el('code', {}, k), (tool.inputSchema.required || []).includes(k) ? ' *' : ''),
          el('td', {}, p.type || (p.enum ? 'enum' : p.anyOf ? 'anyOf' : '')),
          el('td', { class: 'small' }, p.description || '', p.enum ? el('div', { class: 'muted' }, `one of: ${p.enum.join(', ')}`) : null, p.const !== undefined ? el('div', { class: 'muted' }, `must be ${JSON.stringify(p.const)}`) : null)))))) : el('div', { class: 'muted small' }, 'No input parameters.'),
    el('details', {}, el('summary', {}, 'Full inputSchema / outputSchema'), el('pre', {}, pretty({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations }))),
    actionPicker,
    el('label', { class: 'field' }, 'arguments (JSON)', ta),
    el('div', { class: 'row' }, el('button', { class: 'primary', onclick: (e) => run(e.target) }, 'Call tool'),
      tool.name !== 'discover_resources' && c.tools.some((t) => t.name === 'discover_resources') && actionProp
        ? el('button', { onclick: (e) => guard(async () => {
          const r = await api(`/api/mcp/${c.id}/tools/discover_resources`, { method: 'POST', body: { arguments: { action: 'describe_actions', parameters: { tool: tool.name } } } });
          modal(`describe_actions: ${tool.name}`, renderResult(r));
        }, e.target) }, 'Describe actions') : null),
    out);
}

function scenariosView(c) {
  return el('div', { class: 'grid two' }, state.catalog.scenarios.filter((s) => s.server === 'copilot-studio').map((s) => el('div', { class: 'card stack' },
    el('div', { class: 'row between' }, el('h3', {}, s.title), skillLink(s.skill)),
    el('ol', { class: 'steps' }, s.steps.map((st) => {
      const live = c.tools.find((t) => t.name === st.tool);
      return el('li', {},
        el('div', { class: 'row between' }, el('code', {}, st.tool),
          el('button', { disabled: !live, title: live ? '' : 'Not loaded yet', onclick: () => openTool(c.id, st.tool, st.args) }, live ? 'Open' : 'Not loaded')),
        el('div', { class: 'small muted' }, st.note));
    })))));
}

// ======================================================================
// Skills
// ======================================================================
async function skills() {
  await refreshConnections();
  const c = conn('copilot-studio');
  const live = c?.status === 'connected';
  const { copilotStudioSkills, dataverseSkills, docs } = state.catalog;
  const focus = location.hash.split('/')[1];
  const viewer = el('div', {});
  const liveList = el('div', {});

  const openSkill = async (name, path) => {
    viewer.replaceChildren(el('div', { class: 'card muted' }, `Loading ${name}${path ? `/${path}` : ''}…`));
    try {
      const r = await api(`/api/mcp/copilot-studio/skills/${encodeURIComponent(name)}${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      const body = r.result?.contents
        ? el('div', {}, r.result.contents.map((x) => el('pre', { class: 'md' }, x.text ?? '[binary]')))
        : renderResult(r.result);
      viewer.replaceChildren(el('div', { class: 'card stack' },
        el('div', { class: 'row between' }, el('h3', {}, `${name}${path ? ` / ${path}` : ' / SKILL.md'}`), badge(`via ${r.source}`)), body));
      viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      viewer.replaceChildren(el('div', { class: 'callout danger' }, e.message));
    }
  };

  if (live) {
    api('/api/mcp/copilot-studio/skills').then((r) => {
      liveList.replaceChildren(el('div', { class: 'card stack' },
        el('div', { class: 'row between' }, el('b', {}, 'Live skill catalog from the service'), badge(r.source ? `via ${r.source}` : 'unavailable', r.source ? 'ok' : 'warn')),
        r.note ? el('p', { class: 'muted small' }, r.note) : null,
        r.skills?.length ? el('pre', {}, pretty(r.skills)) : r.result ? renderResult(r.result) : null));
    }).catch((e) => liveList.replaceChildren(el('div', { class: 'callout warn' }, e.message)));
  }

  const view = el('div', {},
    el('h1', {}, 'Skills'),
    el('p', { class: 'muted' }, 'Skills are packaged instructions an AI assistant reads before acting. The Copilot Studio MCP service serves its authoring Skills live. Nothing is installed locally. Read the matching core skill before authoring, then read schema.json.'),
    el('div', { class: 'callout' }, 'Hosts that support the MCP skills extension use ', el('code', {}, 'skills/list'), ' / ', el('code', {}, 'skills/get'),
      '. Other hosts, including this explorer when native skills are unavailable, use the ', el('code', {}, 'get_copilot_studio_skills'), ' tool. ', link(docs.copilotStudioMcp, 'Microsoft Learn')),
    !live ? el('div', { class: 'callout warn' }, 'Start the Copilot Studio MCP server, sign in and select an environment to load skill content. ', el('a', { href: '#copilot-studio' }, 'Go there →')) : null,
    el('h2', {}, 'Copilot Studio authoring skills'),
    el('div', { class: 'grid two' }, copilotStudioSkills.map((s) => el('div', { class: 'card stack', id: `skill-${s.name}`, style: focus === s.name ? 'outline:2px solid var(--accent)' : '' },
      el('div', { class: 'row between' }, el('h3', {}, s.title), el('code', {}, s.name)),
      el('p', {}, s.explain),
      el('div', { class: 'small' }, 'Used with: ', s.usedBy.map((t) => el('code', { style: 'margin-right:4px' }, t))),
      el('div', { class: 'row' }, s.files.map((f) => el('button', { disabled: !live, onclick: () => openSkill(s.name, f === 'SKILL.md' ? null : f) }, `Read ${f}`)))))),
    viewer,
    live ? liveList : null,
    el('h2', {}, 'Companion Dataverse skills'),
    el('p', { class: 'muted' }, 'Copilot Studio agents, topics and connection references are stored in Dataverse. The Microsoft Dataverse skills plugin teaches coding agents to work with the Dataverse MCP server and Web API safely. ', link(docs.dataverseSkills, 'microsoft/Dataverse-skills')),
    el('div', { class: 'grid' }, dataverseSkills.map((s) => el('div', { class: 'card stack' },
      el('div', { class: 'row between' }, el('code', {}, s.name), link(s.url, 'SKILL.md ↗')),
      el('p', { class: 'small' }, s.explain)))));

  if (focus && live && copilotStudioSkills.some((s) => s.name === focus) && state.skillView !== focus) {
    state.skillView = focus;
    setTimeout(() => openSkill(focus), 0);
  }
  return view;
}

// ======================================================================
// Dataverse
// ======================================================================
async function dataverse() {
  await refreshConnections();
  const { docs } = state.catalog;
  const d = state.dv;
  const signedIn = !!state.auth?.account;
  const orgInput = el('input', { value: d.org, placeholder: 'https://contoso.crm.dynamics.com', style: 'flex:1;min-width:260px' });
  const setOrg = (url) => { d.org = url; save('dv.org', url); d.who = null; d.agents = []; d.connRefs = []; d.components = {}; render(); };

  const view = el('div', {},
    el('div', { class: 'row between' }, el('div', {}, el('h1', {}, 'Dataverse environment'),
      el('p', { class: 'muted' }, 'Copilot Studio stores agents (the bot table), their topics and knowledge (botcomponent), and connector bindings (connectionreference) in Dataverse. Connect to explore them, or use the Dataverse MCP server.')),
    el('div', { class: 'row' }, link(docs.dataverseMcp, 'Dataverse MCP docs'), link(docs.dataverseWebApi, 'Web API docs'))));

  if (!signedIn) {
    view.append(el('div', { class: 'card stack' },
      el('h3', {}, 'Sign in'),
      el('p', {}, 'The explorer uses device-code sign-in with a public client app. You can change the app registration below.'),
      authConfigForm(),
      el('button', { class: 'primary', onclick: (e) => guard(() => signIn(), e.target) }, 'Sign in with device code')));
    return view;
  }

  // Environment picker
  view.append(el('div', { class: 'card stack' },
    el('h3', {}, '1. Choose an environment'),
    el('div', { class: 'row' }, orgInput, el('button', { class: 'primary', onclick: () => setOrg(orgInput.value.trim()) }, 'Use this org'),
      el('button', { onclick: (e) => guard(async () => { d.instances = await api('/api/dataverse/instances'); render(); }, e.target) }, 'Discover my environments')),
    d.instances.length ? el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Name', 'URL', 'Environment ID', 'Region', ''].map((x) => el('th', {}, x)))),
      el('tbody', {}, d.instances.map((i) => el('tr', {},
        el('td', {}, i.friendlyName), el('td', {}, el('code', {}, i.url)), el('td', { class: 'small' }, i.environmentId || ''), el('td', {}, i.region || ''),
        el('td', {}, el('button', { onclick: () => { d.envId = i.environmentId; save('dv.envId', i.environmentId); setOrg(i.url); } }, 'Select'))))))) : null));

  if (!d.org) return view;

  // Who am I + loaders
  const whoBox = el('div', {});
  if (d.who) whoBox.append(el('table', {}, el('tbody', {},
    el('tr', {}, el('th', {}, 'Organization'), el('td', {}, d.who.organization?.name || d.who.OrganizationId)),
    el('tr', {}, el('th', {}, 'User ID'), el('td', {}, d.who.UserId)),
    el('tr', {}, el('th', {}, 'Business unit'), el('td', {}, d.who.BusinessUnitId)))));
  view.append(el('div', { class: 'card stack' },
    el('div', { class: 'row between' }, el('h3', {}, `2. Explore ${new URL(d.org).hostname}`), el('span', { class: 'muted small' }, load('dv.envId') ? `Environment ID ${load('dv.envId')}` : '')),
    el('div', { class: 'row' },
      el('button', { onclick: (e) => guard(async () => { d.who = await api(`/api/dataverse/whoami?org=${encodeURIComponent(d.org)}`); render(); }, e.target) }, 'WhoAmI'),
      el('button', { class: 'primary', onclick: (e) => guard(async () => { d.agents = await api(`/api/dataverse/agents?org=${encodeURIComponent(d.org)}`); render(); }, e.target) }, 'Load Copilot Studio agents'),
      el('button', { onclick: (e) => guard(async () => { d.connRefs = await api(`/api/dataverse/connection-references?org=${encodeURIComponent(d.org)}`); render(); }, e.target) }, 'Load connection references')),
    whoBox));

  if (d.agents.length) {
    view.append(el('h2', {}, `Agents (${d.agents.length})`), el('div', { class: 'card table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Name', 'Schema name', 'State', 'Published', 'Modified', ''].map((x) => el('th', {}, x)))),
      el('tbody', {}, d.agents.map((b) => [el('tr', {},
        el('td', {}, el('b', {}, b.name)), el('td', {}, el('code', {}, b.schemaName)), el('td', {}, b.state), el('td', { class: 'small' }, b.publishedOn ? new Date(b.publishedOn).toLocaleString() : badge('not published', 'warn')),
        el('td', { class: 'small' }, new Date(b.modifiedOn).toLocaleString()),
        el('td', { class: 'row' },
          el('button', { onclick: (e) => guard(async () => { d.components[b.botId] = await api(`/api/dataverse/agents/${b.botId}/components?org=${encodeURIComponent(d.org)}`); d.selectedBot = b.botId; render(); }, e.target) }, 'Components'),
          el('button', { class: 'primary', disabled: !b.publishedOn, title: b.publishedOn ? '' : 'Publish the agent first', onclick: () => {
            state.chat.settings = { ...state.chat.settings, environmentId: load('dv.envId') || state.chat.settings.environmentId || '', schemaName: b.schemaName, agentName: b.name };
            save('chat.settings', state.chat.settings);
            location.hash = '#chat';
          } }, 'Chat'))),
      d.selectedBot === b.botId && d.components[b.botId] ? el('tr', {}, el('td', { colspan: 6 },
        el('table', {}, el('thead', {}, el('tr', {}, ['Component', 'Type', 'Schema name'].map((x) => el('th', {}, x)))),
          el('tbody', {}, d.components[b.botId].map((x) => el('tr', {}, el('td', {}, x.name), el('td', {}, String(x.type)), el('td', { class: 'small' }, el('code', {}, x.schemaName)))))))) : null])))));
  }

  if (d.connRefs.length) {
    view.append(el('h2', {}, `Connection references (${d.connRefs.length})`),
      el('p', { class: 'muted small' }, 'A connection reference is the Dataverse record that binds an agent or workflow to an actual connector connection. ', el('code', {}, 'copilot_studio_setup_connection'), ' creates or repairs these. Unbound references are why tools fail at runtime. ', link(docs.connectionReferences, 'Learn more')),
      el('div', { class: 'card table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Display name', 'Connector', 'Bound', 'State', ''].map((x) => el('th', {}, x)))),
        el('tbody', {}, d.connRefs.map((r) => el('tr', {},
          el('td', {}, r.displayName || r.logicalName, el('div', { class: 'muted small' }, r.logicalName)),
          el('td', {}, el('code', {}, r.connector)),
          el('td', {}, r.bound ? badge('connected', 'ok') : badge('unbound', 'warn')),
          el('td', {}, String(r.state)),
          el('td', {}, el('button', { disabled: conn('copilot-studio')?.status !== 'connected', title: 'Prepare a plan with the Copilot Studio MCP bridge', onclick: () => {
            const c = conn('copilot-studio');
            if (!c.tools.some((t) => t.name === 'copilot_studio_prepare_connection')) return toast('Connect the Copilot Studio MCP server to an environment first');
            openTool('copilot-studio', 'copilot_studio_prepare_connection', { connector: r.connector, ...(r.connectionId ? { connectionName: r.connectionId } : {}) });
          } }, 'Prepare via MCP'))))))));
  }

  // OData console
  const q = el('input', { value: 'bots?$select=name,schemaname&$top=5', style: 'flex:1' });
  const qOut = el('div', {});
  view.append(el('h2', {}, 'Read-only OData console'), el('div', { class: 'card stack' },
    el('div', { class: 'row' }, el('code', {}, '/api/data/v9.2/'), q, el('button', { onclick: (e) => guard(async () => { qOut.replaceChildren(el('pre', {}, pretty(await api('/api/dataverse/odata', { method: 'POST', body: { org: d.org, query: q.value } })))); }, e.target) }, 'GET')),
    el('div', { class: 'row small' }, 'Try: ', ['botcomponents?$select=name,componenttype&$top=10', 'connectionreferences?$top=5', 'environmentvariabledefinitions?$select=schemaname,displayname&$top=10', 'solutions?$select=uniquename,version&$filter=isvisible eq true'].map((x) => el('a', { href: '#dataverse', onclick: (e) => { e.preventDefault(); q.value = x; } }, el('code', {}, x)))),
    qOut));

  // Dataverse MCP
  view.append(el('h2', {}, 'Dataverse MCP server'), dataverseMcpCard());
  return view;
}

function authConfigForm() {
  const a = state.auth || {};
  const cid = el('input', { value: a.clientId || '', style: 'width:340px' });
  const tid = el('input', { value: a.tenantId || '', style: 'width:260px' });
  return el('details', {}, el('summary', {}, `App registration: ${a.clientId} @ ${a.tenantId}`),
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('label', { class: 'field' }, 'Client (application) ID', cid),
      el('label', { class: 'field' }, 'Tenant', tid),
      el('button', { onclick: (e) => guard(async () => { state.auth = await api('/api/auth/config', { method: 'POST', body: { clientId: cid.value.trim(), tenantId: tid.value.trim() } }); renderAccount(); toast('Saved for this run'); }, e.target) }, 'Apply')),
    el('p', { class: 'small muted' }, 'Needs "Allow public client flows" and delegated permissions: Dynamics CRM user_impersonation (Web API), Dynamics CRM mcp.tools (Dataverse MCP), and Power Platform API CopilotStudio.Copilots.Invoke (agent chat).'));
}

function dataverseMcpCard() {
  const d = state.dv;
  const { docs } = state.catalog;
  const preview = el('input', { type: 'checkbox' });
  const existing = state.connections.filter((c) => c.preset?.startsWith('dataverse'));
  const add = (preset) => async (e) => guard(async () => {
    const r = await api('/api/mcp', { method: 'POST', body: { preset, id: preset, orgUrl: d.org, preview: preview.checked } });
    toast(`${r.label}: ${r.tools.length} tools`);
    state.consoleConn = r.id;
    location.hash = '#console';
  }, e.target);
  return el('div', { class: 'card stack' },
    el('p', {}, 'Every environment exposes an MCP server at ', el('code', {}, `${d.org}/api/mcp`), '. Copilot Studio agents use it through the Dataverse MCP Server connector. Connect to it here to see exactly what an agent can do with your data.'),
    el('div', { class: 'callout warn small' }, 'Admin prerequisites: in the Power Platform admin center turn on "Allow MCP clients to interact with Dataverse MCP server", then under Advanced Settings enable your client. The remote endpoint needs your app ID with the mcp.tools permission. The local proxy uses the Dataverse CLI app (0c412cc3-…) and needs tenant admin consent. ', link(docs.dataverseMcpOtherClients, 'Setup guide')),
    el('label', { class: 'row small' }, preview, 'Use the preview endpoint (/api/mcp_preview)'),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: add('dataverse-remote') }, 'Connect remote endpoint (uses your sign-in)'),
      el('button', { onclick: add('dataverse-proxy') }, 'Connect via npx @microsoft/dataverse proxy')),
    existing.length ? el('div', { class: 'small' }, 'Connected: ', existing.map((c) => el('a', { href: '#console', onclick: () => { state.consoleConn = c.id; } }, `${c.label} (${c.status}, ${c.tools.length} tools) `))) : null);
}

// ======================================================================
// MCP Console (generic)
// ======================================================================
async function mcpConsole() {
  await refreshConnections();
  const cs = state.connections;
  if (!state.consoleConn || !conn(state.consoleConn)) state.consoleConn = cs[0]?.id;
  const c = conn(state.consoleConn);

  const view = el('div', {},
    el('h1', {}, 'MCP Console'),
    el('p', { class: 'muted' }, 'A generic MCP host view of any connected server: capabilities, instructions, tools, resources, prompts, server-initiated elicitations, and the raw protocol log.'),
    el('div', { class: 'row' }, cs.map((x) => el('button', { class: x.id === state.consoleConn ? 'primary' : '', onclick: () => { state.consoleConn = x.id; render(); } },
      el('span', { class: `dot ${x.status === 'connected' ? 'ok' : x.status === 'error' ? 'danger' : ''}` }), x.label))),
    addServerCard());

  if (!c) { view.append(el('div', { class: 'empty', style: 'margin-top:14px' }, 'No MCP servers connected yet.')); return view; }

  const logBox = el('div', { class: 'log' });
  const loadLog = async () => {
    const { log, stderr } = await api(`/api/mcp/${encodeURIComponent(c.id)}/log`);
    logBox.replaceChildren(...log.slice().reverse().map((e) => el('div', { class: 'entry' },
      el('span', { class: `dir-${e.direction}` }, `${e.direction === 'out' ? '→' : e.direction === 'in' ? '←' : '•'} ${e.method}`), ' ',
      el('span', { class: 'muted' }, e.t.slice(11, 19)),
      e.payload != null ? el('details', {}, el('summary', {}, 'payload'), el('pre', {}, pretty(e.payload))) : null)),
    stderr.length ? el('details', {}, el('summary', {}, `stderr (${stderr.length} lines)`), el('pre', {}, stderr.join('\n'))) : '');
  };
  loadLog().catch(() => {});

  const resOut = el('div', {});
  view.append(
    el('div', { class: 'card stack', style: 'margin-top:14px' },
      el('div', { class: 'row between' }, el('div', { class: 'row' }, el('h3', {}, c.label), badge(c.status, c.status === 'connected' ? 'ok' : 'warn'), c.serverInfo ? badge(`${c.serverInfo.name} ${c.serverInfo.version}`) : null),
        el('div', { class: 'row' },
          el('button', { onclick: (e) => guard(async () => { await api(`/api/mcp/${c.id}/refresh`, { method: 'POST', body: {} }); render(); }, e.target) }, 'Refresh lists'),
          el('button', { onclick: (e) => guard(async () => { await api(`/api/mcp/${c.id}/reconnect`, { method: 'POST', body: {} }); render(); }, e.target) }, 'Reconnect'),
          el('button', { class: 'danger', onclick: (e) => guard(async () => { await api(`/api/mcp/${c.id}`, { method: 'DELETE' }); state.consoleConn = null; render(); }, e.target) }, 'Remove'))),
      c.error ? el('div', { class: 'callout danger' }, c.error) : null,
      el('details', {}, el('summary', {}, 'Launch'), el('pre', {}, pretty(c.launch))),
      el('details', {}, el('summary', {}, 'Server capabilities'), el('pre', {}, pretty(c.capabilities))),
      c.instructions ? el('details', {}, el('summary', {}, 'Server instructions'), el('pre', {}, c.instructions)) : null),
    elicitationsView(c),
    el('h2', {}, `Tools (${c.tools.length})`),
    c.tools.length ? toolExplorer(c) : el('div', { class: 'empty' }, 'This server lists no tools (yet).'),
    el('div', { class: 'grid two', style: 'margin-top:14px' },
      el('div', { class: 'card stack' }, el('h3', {}, `Resources (${c.resources.length})`),
        c.resources.length ? el('ul', { class: 'list' }, c.resources.map((r) => el('li', { class: 'clickable', onclick: () => guard(async () => {
          const x = await api(`/api/mcp/${c.id}/resources/read`, { method: 'POST', body: { uri: r.uri } });
          resOut.replaceChildren(el('div', { class: 'small muted' }, r.uri), ...(x.contents || []).map((cc) => el('pre', {}, cc.text ?? `[${cc.mimeType} blob]`)));
        }) }, el('code', {}, r.uri), el('div', { class: 'muted small' }, r.name || '', r.description ? ` · ${r.description}` : '')))) : el('div', { class: 'muted small' }, 'None listed.'),
        resOut),
      el('div', { class: 'card stack' }, el('h3', {}, `Prompts (${c.prompts.length})`),
        c.prompts.length ? el('ul', { class: 'list' }, c.prompts.map((p) => el('li', { class: 'clickable', onclick: () => guard(async () => {
          const args = {};
          for (const a of p.arguments || []) { const v = prompt(`${p.name}: ${a.name}${a.required ? ' (required)' : ''}`); if (v) args[a.name] = v; }
          const x = await api(`/api/mcp/${c.id}/prompts/${encodeURIComponent(p.name)}`, { method: 'POST', body: { arguments: args } });
          modal(p.name, el('pre', {}, pretty(x)));
        }) }, el('code', {}, p.name), el('div', { class: 'muted small' }, p.description || '')))) : el('div', { class: 'muted small' }, 'None listed.'))),
    el('h2', {}, 'Protocol log'),
    el('div', { class: 'card' }, el('div', { class: 'row between' }, el('span', { class: 'muted small' }, 'Newest first. Payloads are truncated at 4 KB.'), el('button', { onclick: () => loadLog() }, 'Reload')), logBox));
  return view;
}

function elicitationsView(c) {
  if (!c.elicitations?.length) return el('div');
  return el('div', { class: 'card stack', style: 'margin-top:14px;border-color:var(--warn)' },
    el('h3', {}, 'The server is asking you something (elicitation)'),
    c.elicitations.map((e) => {
      const p = e.params || {};
      const ta = el('textarea', { class: 'json' }, JSON.stringify(skeletonFromSchema(p.requestedSchema), null, 2));
      const answer = (action) => guard(async () => {
        let content;
        if (action === 'accept' && p.mode !== 'url') { try { content = JSON.parse(ta.value); } catch (err) { return toast(err.message); } }
        await api(`/api/mcp/${c.id}/elicitations/${e.id}`, { method: 'POST', body: content ? { action, content } : { action } });
        render();
      });
      return el('div', { class: 'stack' },
        el('p', {}, p.message || ''),
        p.mode === 'url' ? el('p', {}, 'Open: ', link(p.url)) : el('details', { open: true }, el('summary', {}, 'Requested schema'), el('pre', {}, pretty(p.requestedSchema)), ta),
        el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => answer('accept') }, p.mode === 'url' ? 'I opened it' : 'Accept'), el('button', { onclick: () => answer('decline') }, 'Decline'), el('button', { class: 'danger', onclick: () => answer('cancel') }, 'Cancel')));
    }));
}

function addServerCard() {
  const kind = el('select', {}, el('option', { value: 'custom-http' }, 'Streamable HTTP URL'), el('option', { value: 'custom-stdio' }, 'Local command (stdio)'));
  const label = el('input', { placeholder: 'Label (for example "My agent over MCP")', style: 'width:240px' });
  const target = el('input', { placeholder: 'https://… or command', style: 'flex:1;min-width:240px' });
  const extra = el('input', { placeholder: 'OAuth scope (uses your sign-in), or args for stdio', style: 'flex:1;min-width:240px' });
  return el('details', { style: 'margin-top:10px' }, el('summary', {}, 'Add another MCP server (for example a Copilot Studio agent published to the MCP channel)'),
    el('div', { class: 'card stack', style: 'margin-top:8px' },
      el('p', { class: 'small muted' }, 'Publish a Copilot Studio agent to the MCP channel and paste its endpoint here, or connect any other MCP server. ', link(state.catalog.docs.agentMcpChannel, 'MCP channel docs')),
      el('div', { class: 'row' }, kind, label), el('div', { class: 'row' }, target, extra),
      el('button', { class: 'primary', onclick: (e) => guard(async () => {
        const body = kind.value === 'custom-http'
          ? { preset: 'custom-http', id: `http-${Date.now().toString(36)}`, label: label.value || target.value, url: target.value.trim(), tokenScopes: extra.value.trim() ? extra.value.trim().split(/\s+/) : undefined }
          : { preset: 'custom-stdio', id: `stdio-${Date.now().toString(36)}`, label: label.value || target.value, command: target.value.trim(), args: extra.value.trim() ? extra.value.trim().split(/\s+/) : [] };
        const r = await api('/api/mcp', { method: 'POST', body });
        state.consoleConn = r.id;
        render();
      }, e.target) }, 'Connect')));
}

// ======================================================================
// Agent chat (agents-copilotstudio-client)
// ======================================================================
async function agentChat() {
  const { docs } = state.catalog;
  const s = state.chat;
  const env = el('input', { value: s.settings.environmentId || load('dv.envId') || '', placeholder: 'Environment ID (GUID or Default-<GUID>)', style: 'width:330px' });
  const schema = el('input', { value: s.settings.schemaName || '', placeholder: 'Agent schema name, for example cr123_myAgent', style: 'width:280px' });
  const direct = el('input', { value: s.settings.directConnectUrl || '', placeholder: 'or a direct connect URL (optional)', style: 'flex:1;min-width:260px' });
  const cloud = el('select', {}, ['Prod', 'Gov', 'High', 'DoD', 'Mooncake', 'Preprod', 'Test', 'FirstRelease'].map((x) => el('option', { value: x, selected: (s.settings.cloud || 'Prod') === x }, x)));
  const transcript = el('div', { class: 'chat' });
  const draw = () => {
    transcript.replaceChildren(...s.transcript.map((a) => {
      if (a.type === 'message') {
        return el('div', { class: `bubble ${a.from === 'user' ? 'user' : ''}` }, a.text || '',
          a.attachments?.length ? el('details', {}, el('summary', {}, `${a.attachments.length} attachment(s)`), el('pre', {}, pretty(a.attachments))) : null,
          a.suggestedActions?.length ? el('div', { class: 'row', style: 'margin-top:6px' }, a.suggestedActions.map((x) => el('button', { onclick: () => send(String(x)) }, String(x)))) : null);
      }
      return el('div', { class: 'bubble event' }, `${a.type}${a.name ? `: ${a.name}` : ''}`, el('details', {}, el('summary', {}, 'activity'), el('pre', {}, pretty(a))));
    }));
    transcript.scrollTop = transcript.scrollHeight;
  };
  draw();

  const input = el('input', { placeholder: s.sessionId ? 'Type a message' : 'Start a conversation first', style: 'flex:1', disabled: !s.sessionId,
    onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) send(input.value.trim()); } });
  const send = (text) => guard(async () => {
    input.value = '';
    s.transcript.push({ type: 'message', from: 'user', text });
    draw();
    const r = await api(`/api/chat/${s.sessionId}/send`, { method: 'POST', body: { text } });
    s.transcript.push(...r.activities);
    draw();
  });

  return el('div', {},
    el('div', { class: 'row between' }, el('div', {}, el('h1', {}, 'Agent Chat'),
      el('p', { class: 'muted' }, 'Talk to a published Copilot Studio agent with @microsoft/agents-copilotstudio-client (startConversationStreaming, then sendActivityStreaming). Every activity is shown, including events and typing.')),
    el('div', { class: 'row' }, link(docs.clientNpm, 'npm'), link(docs.clientRepo, 'Source'))),
    el('div', { class: 'card stack' },
      el('div', { class: 'row' }, env, schema, cloud), el('div', { class: 'row' }, direct),
      el('p', { class: 'small muted' }, 'Find these in Copilot Studio under Settings > Advanced > Metadata, or click Chat next to an agent on the ', el('a', { href: '#dataverse' }, 'Dataverse tab'), '. The token is requested for ', el('code', {}, 'https://api.powerplatform.com/.default'), ' and needs the CopilotStudio.Copilots.Invoke delegated permission on your app registration.'),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: (e) => guard(async () => {
          s.settings = { ...s.settings, environmentId: env.value.trim(), schemaName: schema.value.trim(), directConnectUrl: direct.value.trim(), cloud: cloud.value };
          save('chat.settings', s.settings);
          const r = await api('/api/chat/start', { method: 'POST', body: s.settings });
          s.sessionId = r.sessionId;
          s.transcript = [{ type: 'event', name: `conversation ${r.conversationId || ''} started (scope ${r.scope})` }, ...r.activities];
          render();
        }, e.target) }, s.sessionId ? 'Restart conversation' : 'Start conversation'),
        s.sessionId ? el('button', { onclick: () => guard(async () => { await api(`/api/chat/${s.sessionId}`, { method: 'DELETE' }); s.sessionId = null; s.transcript = []; render(); }) }, 'End') : null)),
    el('div', { class: 'card stack', style: 'margin-top:14px' }, s.transcript.length ? transcript : el('div', { class: 'empty' }, 'No conversation yet.'),
      el('div', { class: 'row' }, input, el('button', { class: 'primary', disabled: !s.sessionId, onclick: () => input.value.trim() && send(input.value.trim()) }, 'Send'))),
    el('details', { style: 'margin-top:14px' }, el('summary', {}, 'Equivalent SDK code'), el('pre', {},
`import { CopilotStudioClient, ConnectionSettings } from '@microsoft/agents-copilotstudio-client'
import { Activity } from '@microsoft/agents-activity'

const settings = new ConnectionSettings({ environmentId: '${env.value || '<env id>'}', agentIdentifier: '${schema.value || '<schema name>'}' })
const token = await acquireToken([CopilotStudioClient.scopeFromSettings(settings)]) // MSAL
const client = new CopilotStudioClient(settings, token)

for await (const a of client.startConversationStreaming(true)) console.log(a.type, a.text)
const msg = Activity.fromObject({ type: 'message', text: 'Hello' })
for await (const a of client.sendActivityStreaming(msg)) console.log(a.type, a.text)`)));
}

// ---------- boot ----------
(async function boot() {
  try {
    state.catalog = await api('/api/catalog');
    await refreshAuth();
  } catch (e) {
    document.getElementById('view').replaceChildren(el('div', { class: 'callout danger' }, `Cannot reach the explorer server: ${e.message}`));
    return;
  }
  render();
  // Keep connection state fresh (tools appear asynchronously after environment selection).
  setInterval(async () => {
    const before = JSON.stringify(state.connections.map((c) => [c.id, c.status, c.toolsVersion, c.elicitations?.length]));
    try { await refreshConnections(); } catch { return; }
    const after = JSON.stringify(state.connections.map((c) => [c.id, c.status, c.toolsVersion, c.elicitations?.length]));
    const busy = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (before !== after && !busy && document.getElementById('modal').hidden && ['copilot-studio', 'console'].includes(currentTab())) render();
  }, 4000);
})();
