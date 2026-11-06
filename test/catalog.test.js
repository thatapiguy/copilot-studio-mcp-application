import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../src/catalog.js';
import { normalizeOrgUrl } from '../src/dataverse.js';

test('every scenario step references a catalogued tool and skill', () => {
  const { scenarios, copilotStudioTools, copilotStudioSkills } = getCatalog();
  const skills = new Set(copilotStudioSkills.map((s) => s.name));
  for (const s of scenarios) {
    if (s.skill) assert.ok(skills.has(s.skill), `${s.id} skill ${s.skill}`);
    for (const st of s.steps) assert.ok(copilotStudioTools[st.tool], `${s.id} → ${st.tool}`);
  }
  for (const [name, t] of Object.entries(copilotStudioTools)) {
    if (t.skill) assert.ok(skills.has(t.skill), `${name} skill ${t.skill}`);
  }
});

test('skills reference known tools', () => {
  const { copilotStudioSkills, copilotStudioTools } = getCatalog();
  for (const s of copilotStudioSkills) for (const t of s.usedBy) assert.ok(copilotStudioTools[t], `${s.name} → ${t}`);
});

test('normalizeOrgUrl accepts Dataverse hosts and rejects others', () => {
  assert.equal(normalizeOrgUrl('contoso.crm.dynamics.com'), 'https://contoso.crm.dynamics.com');
  assert.equal(normalizeOrgUrl('https://org1.crm4.dynamics.com/main.aspx'), 'https://org1.crm4.dynamics.com');
  assert.throws(() => normalizeOrgUrl('https://evil.example.com'));
  assert.throws(() => normalizeOrgUrl('http://contoso.crm.dynamics.com'));
});
