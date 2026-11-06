# Copilot Studio MCP Explorer

A local web app that helps you explore every capability of:

| Package / server | What it is | Where to explore it |
| --- | --- | --- |
| [`@microsoft/copilot-studio-mcp`](https://www.npmjs.com/package/@microsoft/copilot-studio-mcp) | A **stdio MCP server** (bridge). It handles sign-in, environment selection and connector setup, and proxies the cloud Copilot Studio MCP service: `manage_agents`, `manage_workflows`, `discover_resources`, `get_consumption`, `get_copilot_studio_skills`. | **Copilot Studio MCP** and **Skills** tabs |
| [`@microsoft/agents-copilotstudio-client`](https://www.npmjs.com/package/@microsoft/agents-copilotstudio-client) | The Agents SDK **client library** for chatting with a *published* Copilot Studio agent (Direct Engine protocol). It is **not** an MCP server. | **Agent Chat** tab |
| Dataverse MCP server (`https://<org>/api/mcp`) | Every Dataverse environment's MCP endpoint. It is also what Copilot Studio agents use through the Dataverse MCP Server connector. | **Dataverse** and **MCP Console** tabs |

The app is itself an **MCP host**. It spawns MCP servers, performs the protocol handshake, reloads `tools/list` when a server sends `notifications/tools/list_changed`, answers elicitations, and logs every JSON-RPC message. You see exactly what an AI assistant would see.

## Features

- **Copilot Studio MCP**
  - Start the bridge, either the bundled pinned copy or `npx @latest`.
  - A guided onboarding: sign in (`copilot_studio_connect`), list environments, then select one. After selection the cloud tools appear.
  - A live tool explorer. Each tool has a plain-language explanation, its MCP annotations (read-only, writes, destructive), a parameter table, the full JSON schema, a JSON argument editor with an `action` picker, and a result viewer.
  - Destructive or writing tools always ask for confirmation first. A **Describe actions** button calls `discover_resources` with `action=describe_actions` for any tool.
  - Guided scenarios that link each tool to the skill to read first: onboarding, inspecting agents, authoring a draft, connector setup, credits.
- **Skills**
  - Explanations of the four Copilot Studio authoring skills: `agent-authoring`, `workflow-authoring`, `workflow-troubleshooting` and `testing-and-credits`.
  - Their live content (`SKILL.md`, `schema.json`, `models.json`), loaded through native `skills/list` when the server supports it, or through the `get_copilot_studio_skills` tool otherwise.
  - Links to the companion [Dataverse skills](https://github.com/microsoft/Dataverse-skills).
- **Dataverse**
  - Device-code sign-in.
  - Environment discovery through the Global Discovery Service.
  - WhoAmI.
  - The **Copilot Studio agents** stored in the environment (the `bot` table) and their components (`botcomponent`).
  - **Connection references**, showing which are bound and which are not, with a one-click "Prepare via MCP" that pre-fills `copilot_studio_prepare_connection`.
  - A read-only OData console.
  - One click to connect the environment's **Dataverse MCP server**, either the remote endpoint with your token or the `npx @microsoft/dataverse` proxy, optionally against `/api/mcp_preview`.
- **MCP Console**
  - A generic view of any connected server: capabilities, instructions, tools, resources, prompts, pending elicitations, stderr, and the raw protocol log.
  - You can add any Streamable HTTP or stdio MCP server, for example a Copilot Studio agent [published to the MCP channel](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/publication-channels-mcp-agent-to-agent).
- **Agent Chat**
  - Start a conversation with a published agent using `startConversationStreaming` / `sendActivityStreaming`.
  - Every activity is shown, including events and suggested actions.
  - Prefilled from the Dataverse agent list, with the equivalent SDK code.

## Quick start

Requirements: **Node.js 22.18+** (the Copilot Studio MCP bridge requires it). You need a work account with access to a Power Platform environment.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm start
```

Then open <http://localhost:4545>.

> Run the explorer **on your own machine**. The Copilot Studio MCP bridge signs in by opening a browser on the machine where it runs, using a loopback redirect. The server only accepts requests addressed to `localhost`.

## Authentication: two separate sign-ins

1. **Copilot Studio MCP bridge.** The bridge signs in inside its own process with Microsoft's client. Tokens stay in the bridge's memory and are never persisted. Use the **Sign in** step on the Copilot Studio MCP tab.
2. **Explorer sign-in (top right).** This is used for the Dataverse Web API, the Dataverse MCP remote endpoint and agent chat. It uses MSAL device-code flow with the app registration in `.env` (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`). You can also change it at runtime on the Dataverse tab.

For your own app registration, enable **Allow public client flows** and add these delegated permissions:

| Feature | API | Permission |
| --- | --- | --- |
| Dataverse Web API, Global Discovery | Dynamics CRM | `user_impersonation` |
| Dataverse MCP remote endpoint | Dynamics CRM | `mcp.tools` (and add the client ID to the environment's allowed MCP clients) |
| Agent chat | Power Platform API | `CopilotStudio.Copilots.Invoke` |

Dataverse MCP prerequisites: in the [Power Platform admin center](https://admin.powerplatform.microsoft.com/), go to **Environment > Settings > Product > Features**. Turn on **Allow MCP clients to interact with Dataverse MCP server**, then enable your client under **Advanced Settings**. See [Connect to Dataverse with MCP in non-Microsoft clients](https://learn.microsoft.com/power-apps/maker/data-platform/data-platform-mcp-other-clients).

## Architecture

```
public/            Single-page UI (vanilla JS, no build step)
src/server.js      Express API (localhost only)
src/mcpHub.js      MCP host: stdio + Streamable HTTP clients, notifications, elicitation, protocol log
src/auth.js        MSAL device-code sign-in and silent token acquisition per resource
src/dataverse.js   Global Discovery, WhoAmI, bots, botcomponents, connection references, OData GET
src/agentChat.js   @microsoft/agents-copilotstudio-client conversations
src/catalog.js     Explanations, skills, scenarios and documentation links shown in the UI
```

Main API routes:

| Route | Purpose |
| --- | --- |
| `POST /api/mcp` | Connect a server (`preset`: `copilot-studio`, `dataverse-remote`, `dataverse-proxy`, `custom-http`, `custom-stdio`) |
| `POST /api/mcp/:id/tools/:tool` | `tools/call` |
| `GET /api/mcp/:id/skills[/:name?path=]` | Skills via `skills/list`, `get_copilot_studio_skills` or `resources/read` |
| `GET /api/mcp/:id/log` | Protocol log and stderr |
| `GET /api/dataverse/{instances,whoami,agents,connection-references}` | Dataverse exploration |
| `POST /api/chat/start`, `POST /api/chat/:sid/send` | Agent chat |

## Safety notes

- Copilot Studio MCP **writes are real**. They include saving drafts, publishing, sharing, workflow tests and connector setup (`copilot_studio_setup_connection` creates or repairs connections and Dataverse connection references). Use a development environment.
- The explorer confirms every tool that is annotated as destructive or writing.
- Never retry a write whose outcome is uncertain. Inspect the state first, as the bridge's instructions require.
- The Dataverse OData console is GET-only. Writes go through MCP tools so they stay visible and confirmable.
- Saving a draft, publishing, and running are separate outcomes. Report them separately.

## Tests

```bash
npm test
```

The tests check catalog consistency, the API's local-only guards, the sign-in-required behaviour, and an integration run against the real bundled Copilot Studio MCP bridge. That run needs no sign-in.

## References

- [Connect to Microsoft Copilot Studio with MCP](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/copilot-studio-mcp)
- [Configure access to Copilot Studio MCP](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/copilot-studio-mcp-configure)
- [Copilot Studio MCP docs repo](https://github.com/microsoft/copilot-studio-mcp)
- [Agents SDK for JavaScript](https://github.com/microsoft/Agents-for-js)
- [Dataverse MCP server](https://learn.microsoft.com/power-apps/maker/data-platform/data-platform-mcp)
- [Dataverse skills](https://github.com/microsoft/Dataverse-skills)
