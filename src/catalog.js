// Curated knowledge about the packages and MCP servers this app explores.
// Live data (tool schemas, skill content, environments) always comes from the servers themselves;
// this catalog only adds explanations, safety notes and links so the UI can teach as you explore.

const LEARN = 'https://learn.microsoft.com';
const DV_SKILLS = 'https://github.com/microsoft/Dataverse-skills/blob/main/.github/plugins/dataverse/skills';

export const docs = {
  copilotStudioMcp: `${LEARN}/microsoft-copilot-studio/agents-experience/copilot-studio-mcp`,
  copilotStudioMcpConfigure: `${LEARN}/microsoft-copilot-studio/agents-experience/copilot-studio-mcp-configure`,
  copilotStudioMcpVsCode: `${LEARN}/microsoft-copilot-studio/agents-experience/copilot-studio-mcp-vscode-copilot-cli`,
  copilotStudioMcpRepo: 'https://github.com/microsoft/copilot-studio-mcp',
  copilotStudioMcpNpm: 'https://www.npmjs.com/package/@microsoft/copilot-studio-mcp',
  clientNpm: 'https://www.npmjs.com/package/@microsoft/agents-copilotstudio-client',
  clientRepo: 'https://github.com/microsoft/Agents-for-js',
  agentMcpChannel: `${LEARN}/microsoft-copilot-studio/agents-experience/publication-channels-mcp-agent-to-agent`,
  agentAddMcpTool: `${LEARN}/microsoft-copilot-studio/agents-experience/tools-add-mcp-server`,
  dataverseMcp: `${LEARN}/power-apps/maker/data-platform/data-platform-mcp`,
  dataverseMcpOtherClients: `${LEARN}/power-apps/maker/data-platform/data-platform-mcp-other-clients`,
  dataverseMcpConfigure: `${LEARN}/power-apps/maker/data-platform/data-platform-mcp-disable`,
  dataverseMcpPreview: `${LEARN}/power-apps/maker/data-platform/data-platform-mcp-preview-tools`,
  dataverseWebApi: `${LEARN}/power-apps/developer/data-platform/webapi/overview`,
  globalDiscovery: `${LEARN}/power-apps/developer/data-platform/discovery-service`,
  connectionReferences: `${LEARN}/power-apps/maker/data-platform/create-connection-reference`,
  ppApiAuth: `${LEARN}/power-platform/admin/programmability-authentication-v2`,
  dataverseSkills: 'https://github.com/microsoft/Dataverse-skills',
  mcpSpec: 'https://modelcontextprotocol.io/specification'
};

export const packages = [
  {
    id: 'copilot-studio-mcp',
    name: '@microsoft/copilot-studio-mcp',
    kind: 'MCP server (stdio bridge)',
    summary:
      'A local stdio MCP server that signs you in with your Microsoft work account, lets you pick a Power Platform environment, and then proxies the cloud-hosted Copilot Studio MCP service: agent and workflow management, connector discovery, credit consumption, and the authoring Skills.',
    howItRuns: 'npx -y @microsoft/copilot-studio-mcp@latest  (Node.js 22.18+)',
    explorerTab: 'copilot-studio',
    links: [
      { label: 'npm', url: docs.copilotStudioMcpNpm },
      { label: 'Microsoft Learn overview', url: docs.copilotStudioMcp },
      { label: 'Configure access', url: docs.copilotStudioMcpConfigure },
      { label: 'VS Code & Copilot CLI setup', url: docs.copilotStudioMcpVsCode },
      { label: 'Public docs repo', url: docs.copilotStudioMcpRepo }
    ],
    facts: [
      'Before sign-in only the local setup tools are listed. The cloud tools appear after an environment is selected, announced through notifications/tools/list_changed.',
      'Tokens live only in the bridge process memory. Restarting the bridge means signing in again.',
      'Sign-in opens a browser on the machine running the bridge (loopback redirect), so run this explorer locally.',
      'The public package is fixed to the Prod service ring. copilot_studio_select_ring exists only in the internal build.',
      'Every forwarded cloud call has a 36-minute deadline. Never automatically retry an uncertain write.'
    ]
  },
  {
    id: 'agents-copilotstudio-client',
    name: '@microsoft/agents-copilotstudio-client',
    kind: 'Client SDK (not an MCP server)',
    summary:
      'The Microsoft 365 Agents SDK client for talking to a published Copilot Studio agent over the Direct Engine protocol. Use it to start conversations, send messages, stream activities and subscribe to conversations from your own Node.js or browser app.',
    howItRuns: 'npm install @microsoft/agents-copilotstudio-client',
    explorerTab: 'chat',
    links: [
      { label: 'npm', url: docs.clientNpm },
      { label: 'Source (Agents-for-js)', url: docs.clientRepo },
      { label: 'Power Platform API auth', url: docs.ppApiAuth }
    ],
    facts: [
      'It needs a JWT for the Power Platform API audience (https://api.powerplatform.com/.default) with the CopilotStudio.Copilots.Invoke permission.',
      'You identify the agent by environment ID plus agent schema name (Settings > Advanced > Metadata), or by a direct connect URL.',
      'For published agents it discovers conversation endpoints through GET /copilotstudio/agents/{schemaName}/conversation-endpoints.',
      'The streaming APIs (startConversationStreaming, sendActivityStreaming, executeStreaming, subscribeAsync) replace the deprecated *Async helpers.',
      'It is not an MCP server. To reach an agent over MCP, publish it to the MCP channel and connect to it as a custom MCP server in this explorer.'
    ],
    api: [
      { name: 'new CopilotStudioClient(settings, token)', desc: 'Create a client from ConnectionSettings and a bearer token.' },
      { name: 'CopilotStudioClient.scopeFromSettings(settings)', desc: 'Return the token scope to request for this agent and cloud.' },
      { name: 'startConversationStreaming(request | emitStart)', desc: 'Start a conversation and stream the greeting activities.' },
      { name: 'sendActivityStreaming(activity, conversationId)', desc: 'Send a message or event activity and stream the replies.' },
      { name: 'executeStreaming(activity, conversationId)', desc: 'Run one turn in an explicit conversation.' },
      { name: 'subscribeAsync({ conversationId, lastReceivedEventId })', desc: 'Resume receiving events (requires a subscribe endpoint).' },
      { name: 'startConversationWithResponse / executeWithResponse', desc: 'Variants that also return HTTP response metadata.' },
      { name: 'CopilotStudioWebChat.createConnection(client, opts)', desc: 'Adapter for embedding the agent in Bot Framework Web Chat.' },
      { name: 'loadCopilotStudioConnectionSettingsFromEnv()', desc: 'Build settings from environmentId, agentIdentifier, cloud, etc. in .env.' }
    ]
  },
  {
    id: 'dataverse-mcp',
    name: 'Dataverse MCP server',
    kind: 'MCP server (remote HTTP, or the @microsoft/dataverse local proxy)',
    summary:
      'Every Dataverse environment can act as an MCP server at https://<org>.crm.dynamics.com/api/mcp. It lets agents, including Copilot Studio agents, list tables, describe schemas, and read and write records. Copilot Studio uses the same endpoint when you add the Dataverse MCP Server connector to an agent.',
    howItRuns: 'Remote: https://<org>/api/mcp   |   Local proxy: npx -y @microsoft/dataverse mcp https://<org>',
    explorerTab: 'dataverse',
    links: [
      { label: 'Dataverse MCP overview', url: docs.dataverseMcp },
      { label: 'Non-Microsoft clients', url: docs.dataverseMcpOtherClients },
      { label: 'Enable / allow clients', url: docs.dataverseMcpConfigure },
      { label: 'Preview tools (/api/mcp_preview)', url: docs.dataverseMcpPreview }
    ],
    facts: [
      'An admin must turn on "Allow MCP clients to interact with Dataverse MCP server" and enable your client ID under Advanced Settings in the Power Platform admin center.',
      'The remote endpoint needs an Entra app with the Dynamics CRM mcp.tools delegated permission.',
      'The @microsoft/dataverse local proxy uses the Dataverse CLI app (0c412cc3-0dd6-449b-987f-05b053db9457), which needs tenant admin consent once.'
    ]
  }
];

// Explanations of every tool the Copilot Studio MCP bridge can expose.
export const copilotStudioTools = {
  copilot_studio_status: {
    group: 'Session',
    title: 'Connection status',
    explain:
      'Read-only. Reports the bridge version, service ring, sign-in state, account, selected environment, in-flight work, recent agent previews and, once connected, the serverInstructions supplied by the cloud service. Always call this first.',
    sideEffects: 'none',
    order: 1
  },
  copilot_studio_connect: {
    group: 'Session',
    title: 'Sign in',
    explain:
      'Opens Microsoft work-account sign-in in a browser on the machine running the bridge. It signs in only and does not pick an environment. Calling it again replaces the current session and clears the environment and pending connection plans.',
    sideEffects: 'opens browser; replaces session',
    order: 2
  },
  copilot_studio_list_environments: {
    group: 'Session',
    title: 'List environments',
    explain:
      'Lists the Power Platform environments your account can use. Pass a name in query to narrow a large inventory, or a full environment ID (GUID or Default-<GUID>) for a direct, access-checked lookup. Name filtering happens before the 1,000-result limit.',
    sideEffects: 'none',
    order: 3,
    example: { query: 'dev' }
  },
  copilot_studio_select_environment: {
    group: 'Session',
    title: 'Connect to an environment',
    explain:
      'Connects the bridge to the cloud Copilot Studio MCP service for the chosen environment. Afterwards the cloud tools (manage_agents, manage_workflows, discover_resources, get_consumption, get_copilot_studio_skills) appear. It clears earlier connector-setup plans. If the switch fails, no environment stays active.',
    sideEffects: 'changes active environment',
    order: 4,
    example: { environment: '<environment id or unique display name>' }
  },
  copilot_studio_disconnect: {
    group: 'Session',
    title: 'Sign out',
    explain:
      'Closes the cloud connection, signs out locally, and clears the environment and connection plans. It does not delete connector connections or any online artifact.',
    sideEffects: 'local sign-out only',
    order: 5
  },
  copilot_studio_clear_read_cache: {
    group: 'Session',
    title: 'Clear read cache',
    explain:
      "Discards the bridge's short-lived private cache of read results (skills, models, artifacts, discovery). Use it after editing something in the Copilot Studio UI, then repeat only the read you need. It does not clear server-side caches.",
    sideEffects: 'none',
    order: 6
  },
  copilot_studio_select_ring: {
    group: 'Session',
    title: 'Select service ring (internal build only)',
    explain:
      'Switches between the test, preprod and prod service deployments. This tool exists only in the internal build. The public npm package is fixed to Prod.',
    sideEffects: 'signs out and clears state',
    order: 7
  },
  copilot_studio_prepare_connection: {
    group: 'Connector connections',
    title: 'Prepare connector connection',
    explain:
      'Step 1 of connector setup. Given a connector API name returned by discovery (for example shared_office365, shared_commondataserviceforapps or shared_agentnode), it builds a plan. The plan either reuses an existing Connected connection, repairs one, or creates a new one. It writes nothing. Show the plan (action, ring, account, environment) and get approval.',
    sideEffects: 'none (plan only)',
    order: 10,
    example: { connector: 'shared_office365' }
  },
  copilot_studio_setup_connection: {
    group: 'Connector connections',
    title: 'Apply approved connection plan',
    explain:
      'Step 2. Runs a prepared plan with { planId, confirm: true }. It creates or repairs real Power Platform connections and their Dataverse connection references. OAuth tries server-side single sign-on first, then browser consent. Connectors that need typed credentials are handed off to the Copilot Studio UI. Never retry an uncertain write.',
    sideEffects: 'WRITES connections + Dataverse connection references',
    destructive: true,
    order: 11,
    example: { planId: '<uuid from prepare>', confirm: true }
  },
  copilot_studio_connection_setup_status: {
    group: 'Connector connections',
    title: 'Check connection setup status',
    explain:
      'Step 3, read-only. Follow nextAction: complete_browser_consent (wait for the user), resume_reference_setup (re-run setup with the same planId), check_status (bounded re-check), inspect_connection (stop), or use_platform_setup (finish in the Copilot Studio UI). The plan is done only at ready/continue_request with both binding names verified.',
    sideEffects: 'none',
    order: 12,
    example: { planId: '<uuid>' }
  },
  get_copilot_studio_skills: {
    group: 'Cloud: guidance',
    title: 'Copilot Studio authoring Skills',
    explain:
      'Start here before authoring. With no arguments it lists the skills. With { name } it returns that skill, and with { name, path } it returns one of its files, for example schema.json or models.json for agent-authoring. Skills are served live by the cloud service. Nothing is installed locally.',
    sideEffects: 'none',
    order: 20,
    example: { name: 'agent-authoring' },
    skill: 'agent-authoring'
  },
  discover_resources: {
    group: 'Cloud: discovery',
    title: 'Discover resources',
    explain:
      'Discovers connector operations and their schemas, your existing connections, dependent parameter values, and attachable resources such as knowledge sources and tools. Use action=describe_actions to read the exact contract and side effects of any action on any tool before calling it.',
    sideEffects: 'read-only discovery',
    order: 21,
    example: { action: 'describe_actions', parameters: {} }
  },
  manage_agents: {
    group: 'Cloud: agents',
    title: 'Manage agents',
    explain:
      'Covers the agent lifecycle: inventory (list and inspect), full draft authoring (create or update definitions you author locally from the agent-authoring skill and schema.json), lifecycle (publish and similar), sharing of published agents, saved-draft previews (test conversations against the draft), and evaluation suites and runs. Saving a draft is not publishing.',
    sideEffects: 'varies by action; writes drafts, publishes, shares',
    order: 22,
    example: { action: '<see schema>', parameters: {} },
    skill: 'agent-authoring'
  },
  manage_workflows: {
    group: 'Cloud: workflows',
    title: 'Manage workflows',
    explain:
      'Covers the workflow (agent flow) lifecycle: inventory, draft authoring, lifecycle, real tests, and run diagnostics. Workflow tests run published, enabled workflows and can have real effects.',
    sideEffects: 'varies; tests have REAL effects',
    order: 23,
    example: { action: '<see schema>', parameters: {} },
    skill: 'workflow-authoring'
  },
  get_consumption: {
    group: 'Cloud: credits',
    title: 'Credit consumption',
    explain:
      "Reads historical Copilot Credit consumption for an agent or workflow, or the environment's current credit capacity. Usage is measured in Copilot Credits, not currency.",
    sideEffects: 'none',
    order: 24,
    example: { action: '<see schema>', parameters: {} },
    skill: 'testing-and-credits'
  }
};

// Authoring skills served by the Copilot Studio MCP cloud service (documented on Microsoft Learn).
export const copilotStudioSkills = [
  {
    name: 'agent-authoring',
    title: 'Agent authoring',
    explain:
      'Core guidance for building and updating Copilot Studio agents: instructions, topics, knowledge, tools/actions, model selection (models.json) and the full agent definition schema (schema.json). Read it before calling manage_agents to create or update a draft.',
    usedBy: ['manage_agents', 'discover_resources'],
    files: ['SKILL.md', 'schema.json', 'models.json']
  },
  {
    name: 'workflow-authoring',
    title: 'Workflow authoring',
    explain:
      'Guidance for authoring Copilot Studio workflows (agent flows): triggers, actions, connector operations and their connection references, and the workflow definition schema. Read it before calling manage_workflows to create or update a draft.',
    usedBy: ['manage_workflows', 'discover_resources', 'copilot_studio_prepare_connection'],
    files: ['SKILL.md', 'schema.json']
  },
  {
    name: 'workflow-troubleshooting',
    title: 'Workflow troubleshooting',
    explain:
      'How to investigate failed or unexpected workflow runs with the run-diagnostics actions of manage_workflows, interpret errors, and repair connections safely.',
    usedBy: ['manage_workflows', 'copilot_studio_connection_setup_status'],
    files: ['SKILL.md']
  },
  {
    name: 'testing-and-credits',
    title: 'Testing and credits',
    explain:
      'How to preview saved agent drafts, run evaluation suites, test workflows (with real effects), and read Copilot Credit consumption and capacity with get_consumption.',
    usedBy: ['manage_agents', 'manage_workflows', 'get_consumption'],
    files: ['SKILL.md']
  }
];

// Companion Dataverse skills (Microsoft Dataverse plugin for coding agents).
export const dataverseSkills = [
  { name: 'dv-overview', explain: 'Orientation: scope, the skill map, tool capabilities, safety rules and the safe change lifecycle.' },
  { name: 'dv-connect', explain: 'Install tools, authenticate, register the Dataverse MCP server and verify the environment.' },
  { name: 'dv-query', explain: 'Bulk reads, paging, filtering, aggregation and analytics over Dataverse data.' },
  { name: 'dv-data', explain: 'Record create/update/delete/upsert, bulk and CSV imports, sample data.' },
  { name: 'dv-metadata', explain: 'Tables, columns, relationships, forms and views: authoring and inspection.' },
  { name: 'dv-solution', explain: 'Solution lifecycle: create, export, import, promote and validate (agents ship in solutions).' },
  { name: 'dv-security', explain: 'Security roles, users, application users and business units.' },
  { name: 'dv-admin', explain: 'Environment admin: bulk delete, retention, audit and org settings.' }
].map((s) => ({ ...s, url: `${DV_SKILLS}/${s.name}/SKILL.md` }));

// Guided scenarios: each is a sequence of real tool calls the UI can run step by step.
export const scenarios = [
  {
    id: 'onboard',
    title: 'Sign in and connect to an environment',
    server: 'copilot-studio',
    skill: null,
    steps: [
      { tool: 'copilot_studio_status', args: {}, note: 'Check whether you are already signed in.' },
      { tool: 'copilot_studio_connect', args: {}, note: 'Opens a browser for work-account sign-in (skip if signedIn is true).' },
      { tool: 'copilot_studio_list_environments', args: {}, note: 'Pick an environment from the list. Prefer a dev environment.' },
      { tool: 'copilot_studio_select_environment', args: { environment: '' }, note: 'Paste the environment ID. The cloud tools then appear.' }
    ]
  },
  {
    id: 'inspect-agents',
    title: 'Inspect existing agents (read-only)',
    server: 'copilot-studio',
    skill: 'agent-authoring',
    steps: [
      { tool: 'get_copilot_studio_skills', args: {}, note: 'List the available authoring skills.' },
      { tool: 'discover_resources', args: { action: 'describe_actions', parameters: {} }, note: 'See every action manage_agents supports and its side effects.' },
      { tool: 'manage_agents', args: { action: '', parameters: {} }, note: 'Choose a list/inventory action from the described actions.' }
    ]
  },
  {
    id: 'author-agent',
    title: 'Author an agent draft',
    server: 'copilot-studio',
    skill: 'agent-authoring',
    steps: [
      { tool: 'get_copilot_studio_skills', args: { name: 'agent-authoring' }, note: 'Read the core skill first.' },
      { tool: 'get_copilot_studio_skills', args: { name: 'agent-authoring', path: 'schema.json' }, note: 'Read the definition schema.' },
      { tool: 'get_copilot_studio_skills', args: { name: 'agent-authoring', path: 'models.json' }, note: 'See which models you can pick.' },
      { tool: 'manage_agents', args: { action: '', parameters: {} }, note: 'Save the definition you authored as a DRAFT. This does not publish it.' }
    ]
  },
  {
    id: 'connector',
    title: 'Set up a connector connection for an agent or workflow',
    server: 'copilot-studio',
    skill: 'workflow-authoring',
    steps: [
      { tool: 'discover_resources', args: { action: '', parameters: {} }, note: 'Find the connector API name and existing connections.' },
      { tool: 'copilot_studio_prepare_connection', args: { connector: 'shared_office365' }, note: 'Build a plan. No writes yet.' },
      { tool: 'copilot_studio_setup_connection', args: { planId: '', confirm: true }, note: 'After you approve the plan: create or repair the connection and its Dataverse reference.' },
      { tool: 'copilot_studio_connection_setup_status', args: { planId: '' }, note: 'Follow nextAction until ready.' }
    ]
  },
  {
    id: 'credits',
    title: 'Check Copilot Credit consumption',
    server: 'copilot-studio',
    skill: 'testing-and-credits',
    steps: [
      { tool: 'get_copilot_studio_skills', args: { name: 'testing-and-credits' }, note: 'Read the testing and credits guidance.' },
      { tool: 'get_consumption', args: { action: '', parameters: {} }, note: 'Read capacity or history for an agent or workflow.' }
    ]
  }
];

export function getCatalog() {
  return { docs, packages, copilotStudioTools, copilotStudioSkills, dataverseSkills, scenarios };
}
