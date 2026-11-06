// Dataverse Web API helpers: discover environments, and inspect the Dataverse records behind
// Copilot Studio (agents = "bot" table, topics = "botcomponent", connection references).
import { auth, scopes } from './auth.js';

const API = 'api/data/v9.2';

async function dvFetch(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.Message || res.statusText;
    throw Object.assign(new Error(`Dataverse ${res.status}: ${msg}`), { status: res.status });
  }
  return body;
}

export function normalizeOrgUrl(orgUrl) {
  const u = new URL(orgUrl.includes('://') ? orgUrl : `https://${orgUrl}`);
  if (u.protocol !== 'https:') throw Object.assign(new Error('Org URL must be https'), { status: 400 });
  if (!/\.(dynamics\.com|dynamics\.cn|microsoftdynamics\.de|dynamics365\.us|crm\.appsplatform\.us|microsoftdynamics\.us)$/i.test(u.hostname)) {
    throw Object.assign(new Error('That does not look like a Dataverse org URL (for example https://contoso.crm.dynamics.com)'), { status: 400 });
  }
  return u.origin;
}

/** Lists the Dataverse environments the signed-in user can access (Global Discovery Service). */
export async function listInstances() {
  const token = await auth.getToken(scopes.globalDiscovery);
  const body = await dvFetch('https://globaldisco.crm.dynamics.com/api/discovery/v2.0/Instances', token);
  return (body.value || []).map((i) => ({
    friendlyName: i.FriendlyName,
    uniqueName: i.UniqueName,
    url: i.Url,
    environmentId: i.EnvironmentId,
    region: i.Region,
    state: i.State,
    version: i.Version,
    purpose: i.Purpose,
    tenantId: i.TenantId
  }));
}

async function orgGet(orgUrl, pathAndQuery) {
  const origin = normalizeOrgUrl(orgUrl);
  const token = await auth.getToken(scopes.dataverse(origin));
  return dvFetch(`${origin}/${API}/${pathAndQuery.replace(/^\//, '')}`, token);
}

export async function whoAmI(orgUrl) {
  const who = await orgGet(orgUrl, 'WhoAmI');
  let org = null;
  try {
    const r = await orgGet(orgUrl, `organizations(${who.OrganizationId})?$select=name,uniquename`);
    org = { name: r.name, uniqueName: r.uniquename };
  } catch { /* optional */ }
  return { ...who, organization: org };
}

/** Copilot Studio agents are stored in the Dataverse "bot" table. */
export async function listAgents(orgUrl) {
  const r = await orgGet(
    orgUrl,
    'bots?$select=botid,name,schemaname,statecode,publishedon,modifiedon,createdon&$orderby=modifiedon desc&$top=200'
  );
  return (r.value || []).map((b) => ({
    botId: b.botid,
    name: b.name,
    schemaName: b.schemaname,
    state: b['statecode@OData.Community.Display.V1.FormattedValue'] ?? b.statecode,
    publishedOn: b.publishedon,
    modifiedOn: b.modifiedon
  }));
}

/** Topics, knowledge, actions etc. of an agent are rows in "botcomponent". */
export async function listAgentComponents(orgUrl, botId) {
  if (!/^[0-9a-f-]{36}$/i.test(botId)) throw Object.assign(new Error('Invalid bot id'), { status: 400 });
  const r = await orgGet(
    orgUrl,
    `botcomponents?$select=botcomponentid,name,schemaname,componenttype,modifiedon&$filter=_parentbotid_value eq ${botId}&$orderby=componenttype,name&$top=500`
  );
  return (r.value || []).map((c) => ({
    id: c.botcomponentid,
    name: c.name,
    schemaName: c.schemaname,
    type: c['componenttype@OData.Community.Display.V1.FormattedValue'] ?? c.componenttype,
    modifiedOn: c.modifiedon
  }));
}

/** Connection references bind agents and flows to real connector connections. */
export async function listConnectionReferences(orgUrl) {
  const r = await orgGet(
    orgUrl,
    'connectionreferences?$select=connectionreferenceid,connectionreferencedisplayname,connectionreferencelogicalname,connectorid,connectionid,statecode,modifiedon&$orderby=modifiedon desc&$top=500'
  );
  return (r.value || []).map((c) => ({
    id: c.connectionreferenceid,
    displayName: c.connectionreferencedisplayname,
    logicalName: c.connectionreferencelogicalname,
    connector: (c.connectorid || '').split('/').pop(),
    connectorId: c.connectorid,
    connectionId: c.connectionid,
    bound: !!c.connectionid,
    state: c['statecode@OData.Community.Display.V1.FormattedValue'] ?? c.statecode,
    modifiedOn: c.modifiedon
  }));
}

/** Read-only OData GET console. Writes are deliberately not exposed here; use the MCP tools. */
export async function odataGet(orgUrl, query) {
  if (typeof query !== 'string' || !query.trim()) throw Object.assign(new Error('Query is required, for example accounts?$top=5'), { status: 400 });
  if (/^https?:/i.test(query) || query.includes('..')) throw Object.assign(new Error('Give a path relative to /api/data/v9.2/'), { status: 400 });
  return orgGet(orgUrl, query.trim());
}
