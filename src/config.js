import 'dotenv/config';

export const config = Object.freeze({
  port: Number(process.env.PORT || 4545),
  host: process.env.HOST || '127.0.0.1',
  copilotStudioLaunch: (process.env.COPILOT_STUDIO_MCP_LAUNCH || 'bundled').toLowerCase(),
  clientId: process.env.AZURE_CLIENT_ID || '51f81489-12ee-4a9e-aaae-a2591f45987d',
  tenantId: process.env.AZURE_TENANT_ID || 'organizations',
  authorityHost: (process.env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/$/, '')
});
