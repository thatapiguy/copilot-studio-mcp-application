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
  const activities = await collect(client.startConversationStreaming({ emitStartConversationEvent: true, locale }));
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
