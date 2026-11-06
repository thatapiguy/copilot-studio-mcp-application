import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainFailure } from '../src/agentChat.js';

const fakeToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

test('403 without the Invoke scope points at the app registration', () => {
  const err = explainFailure(new Error('[-140032] - Copilot Studio request failed with status 403 Forbidden'),
    fakeToken({ aud: 'https://api.powerplatform.com', scp: 'user_impersonation', appid: 'abc' }), { environmentId: 'e', agentIdentifier: 's' });
  assert.equal(err.status, 403);
  assert.match(err.details.hints[0], /CopilotStudio\.Copilots\.Invoke/);
  assert.equal(err.details.claims.appid, 'abc');
});

test('403 with the scope skips the app-registration hint', () => {
  const err = explainFailure(new Error('request failed with status 403 Forbidden'),
    fakeToken({ scp: 'CopilotStudio.Copilots.Invoke' }), {});
  assert.doesNotMatch(err.details.hints[0], /no CopilotStudio/);
});

test('other errors pass through unchanged', () => {
  const e = new Error('boom');
  assert.equal(explainFailure(e, fakeToken({}), {}), e);
});
