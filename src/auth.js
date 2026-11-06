// Microsoft Entra sign-in for the explorer itself (Dataverse Web API, Dataverse MCP remote endpoint,
// and agent chat through @microsoft/agents-copilotstudio-client).
// The Copilot Studio MCP bridge does its own sign-in inside its process. This module is separate.
import { PublicClientApplication, LogLevel } from '@azure/msal-node';
import { config } from './config.js';

export class SignInRequiredError extends Error {
  constructor(scopes, cause) {
    super(`Sign-in required for ${scopes.join(' ')}${cause ? `: ${cause.message}` : ''}`);
    this.code = 'SIGN_IN_REQUIRED';
    this.scopes = scopes;
  }
}

class AuthManager {
  #pca;
  #account = null;
  #pending = null; // { userCode, verificationUri, message, expiresAt, scopes, error, done }
  #clientId;
  #tenantId;

  constructor() {
    this.configure({ clientId: config.clientId, tenantId: config.tenantId });
  }

  configure({ clientId, tenantId }) {
    this.#clientId = clientId || config.clientId;
    this.#tenantId = tenantId || config.tenantId;
    this.#account = null;
    this.#pending = null;
    this.#pca = new PublicClientApplication({
      auth: { clientId: this.#clientId, authority: `${config.authorityHost}/${this.#tenantId}` },
      system: { loggerOptions: { logLevel: LogLevel.Error, piiLoggingEnabled: false, loggerCallback: () => {} } }
    });
  }

  state() {
    const p = this.#pending;
    return {
      clientId: this.#clientId,
      tenantId: this.#tenantId,
      account: this.#account
        ? { username: this.#account.username, name: this.#account.name, tenantId: this.#account.tenantId }
        : null,
      pending: p && !p.done
        ? { userCode: p.userCode, verificationUri: p.verificationUri, message: p.message, expiresAt: p.expiresAt, scopes: p.scopes }
        : null,
      lastError: p?.error ?? null
    };
  }

  /** Start a device-code sign-in for the given scopes. Resolves once the code is available (not when sign-in finishes). */
  async startDeviceCode(scopes) {
    if (this.#pending && !this.#pending.done) return this.state();
    const pending = { scopes, done: false, error: null };
    this.#pending = pending;
    let resolveCode;
    const codeReady = new Promise((r) => { resolveCode = r; });
    const request = {
      scopes,
      deviceCodeCallback: (r) => {
        Object.assign(pending, {
          userCode: r.userCode,
          verificationUri: r.verificationUri,
          message: r.message,
          expiresAt: Date.now() + r.expiresIn * 1000
        });
        resolveCode();
      }
    };
    pending.request = request;
    this.#pca
      .acquireTokenByDeviceCode(request)
      .then((result) => {
        if (this.#pending !== pending) return; // cancelled or superseded
        pending.done = true;
        this.#account = result.account;
      })
      .catch((err) => {
        pending.done = true;
        pending.error = err.errorMessage || err.message;
        resolveCode();
      });
    await codeReady;
    return this.state();
  }

  cancel() {
    if (this.#pending) {
      this.#pending.done = true;
      if (this.#pending.request) this.#pending.request.cancel = true; // stops MSAL polling
    }
    this.#pending = null;
  }

  async signOut() {
    const cache = this.#pca.getTokenCache();
    for (const a of await cache.getAllAccounts()) await cache.removeAccount(a);
    this.#account = null;
    this.#pending = null;
  }

  /** Get an access token silently. Throws SignInRequiredError when interaction is needed. */
  async getToken(scopes) {
    if (!this.#account) throw new SignInRequiredError(scopes);
    try {
      const r = await this.#pca.acquireTokenSilent({ account: this.#account, scopes });
      return r.accessToken;
    } catch (err) {
      throw new SignInRequiredError(scopes, err);
    }
  }
}

export const auth = new AuthManager();

export const scopes = {
  globalDiscovery: ['https://globaldisco.crm.dynamics.com/user_impersonation'],
  dataverse: (orgUrl) => [`${new URL(orgUrl).origin}/user_impersonation`],
  dataverseDefault: (orgUrl) => [`${new URL(orgUrl).origin}/.default`],
  powerPlatformApi: ['https://api.powerplatform.com/.default']
};
