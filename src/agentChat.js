// Chat with a published Copilot Studio agent through @microsoft/agents-copilotstudio-client.
import { randomUUID } from 'node:crypto';
import { CopilotStudioClient, ConnectionSettings } from '@microsoft/agents-copilotstudio-client';
import { Activity } from '@microsoft/agents-activity';
import { auth } from './auth.js';

const sessions = new Map(); // sessionId -> { client, conversationId, settings, transcript }

function simplify(a) {
  return {
    id: a.id,
    type: a.type,
    from: a.from?.role || a.from?.name,
    text: a.text,
    textFormat: a.textFormat,
    name: a.name,
    valueType: a.valueType,
    attachments: (a.attachments || []).map((x) => ({ contentType: x.contentType, content: x.content })),
    suggestedActions: a.suggestedActions?.actions?.map((x) => x.title || x.value) || [],
    channelData: a.channelData,
    entities: a.entities,
    value: a.value,
    timestamp: a.timestamp
  };
}

const INVOKE = 'CopilotStudio.Copilots.Invoke';

/** Decode (not verify) the JWT payload so we can explain authorization failures. */
function tokenClaims(token) {
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return { aud: c.aud, scp: c.scp, roles: c.roles, appid: c.appid || c.azp, tid: c.tid, upn: c.upn || c.preferred_username, exp: c.exp && new Date(c.exp * 1000).toISOString() };
  } catch { return null; }
}

/** Turn the SDK's -140032 "request failed" into an actionable diagnosis. */
export function explainFailure(err, token, settings) {
  const m = /status (\d{3})/.exec(err.message || '');
  const status = m ? Number(m[1]) : null;
  if (status !== 401 && status !== 403) return err;
  const claims = tokenClaims(token) || {};
  const scopes = String(claims.scp || '').split(' ').filter(Boolean);
  const hints = [];
  if (!scopes.includes(INVOKE)) {
    hints.push(`The token has no ${INVOKE} scope (scp: "${claims.scp || 'none'}"). The app registration ${claims.appid} must have the Power Platform API delegated permission ${INVOKE}, with consent granted. Set AZURE_CLIENT_ID to your own app registration (the default sample client does not have it), restart, sign out and sign in again.`);
  }
  hints.push('In Copilot Studio, the agent must be published after its last change, and its Settings > Security > Authentication must be "Authenticate with Microsoft". Agents set to "No authentication" or manual authentication reject user tokens.');
  hints.push('Your account must have access to the agent: you are its owner, or it is shared with you. Your account must also be in the same tenant as the environment.');
  hints.push(`Check that the environment ID (${settings.environmentId || 'n/a'}) and schema name (${settings.agentIdentifier || 'n/a'}) match Settings > Advanced > Metadata exactly.`);
  return Object.assign(new Error(`${err.message}`), { status, details: { claims, hints } });
}

async function collect(gen) {
  const out = [];
  for await (const a of gen) out.push(a);
  return out;
}

export async function startChat({ environmentId, schemaName, cloud, directConnectUrl, locale }) {
  if (!directConnectUrl && (!environmentId || !schemaName)) {
    throw Object.assign(new Error('Provide environmentId and the agent schema name, or a direct connect URL'), { status: 400 });
  }
  const settings = new ConnectionSettings({
    environmentId: environmentId || undefined,
    agentIdentifier: schemaName || undefined,
    cloud: cloud || 'Prod',
    directConnectUrl: directConnectUrl || undefined
  });
  const scope = CopilotStudioClient.scopeFromSettings(settings);
  const token = await auth.getToken([scope]);
  const client = new CopilotStudioClient(settings, token);
  let activities;
  try {
    activities = await collect(client.startConversationStreaming({ emitStartConversationEvent: true, locale }));
  } catch (err) {
    throw explainFailure(err, token, settings);
  }
  const conversationId = activities.find((a) => a.conversation?.id)?.conversation?.id;
  const sessionId = randomUUID();
  const transcript = activities.map(simplify);
  sessions.set(sessionId, { client, conversationId, settings, transcript, scope });
  return { sessionId, conversationId, scope, activities: transcript };
}

export async function sendChat(sessionId, text) {
  const s = sessions.get(sessionId);
  if (!s) throw Object.assign(new Error('Chat session not found; start a new conversation'), { status: 404 });
  const activity = Activity.fromObject({ type: 'message', text, textFormat: 'plain' });
  const replies = await collect(s.client.sendActivityStreaming(activity, s.conversationId));
  const simplified = replies.map(simplify);
  s.transcript.push({ type: 'message', from: 'user', text }, ...simplified);
  return { conversationId: s.conversationId, activities: simplified };
}

export function endChat(sessionId) {
  sessions.delete(sessionId);
}
