// Issue #537 — the swarm capture/check leg's refusal codes crossed POST /v1/commands as the
// narrated 503 `temporarily_unavailable` fallthrough. The leg mints its codes outside the
// `refuse()`/`integrity()` helpers the #430 owner-set scan reads — runtime-admission.mjs
// `captureContribution` (the capture window: workspace state, pause reservation) and
// contribution-service.mjs (`capture`/`check`: revision identity, retention, identifier shape) —
// so the #430 closure could not see them. The fix: the codes get owner rows in SWARM_REFUSAL_CODES
// (raisedBy 'coordinator' — the coordinator leg the swarm verbs surface), and this file keeps the
// leg's closed set honest in both directions: every code the leg mints has a row, and the observed
// refusals cross the served transport typed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue537-web';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue537-${label}-`));
  roots.push(root);
  return root;
}

// ── the leg scan: the literal codes the capture/check leg mints ──────────────────────────────

const slice = (url, start, end) => {
  const raw = readFileSync(new URL(url, import.meta.url), 'utf8');
  const from = raw.indexOf(start);
  assert.notEqual(from, -1, `${url} carries ${start}`);
  return raw.slice(from, end === null ? raw.length : raw.indexOf(end, from));
};
// The admission leg raises through Object.assign(new Error(...), { code: '...' }) — same line or
// wrapped; the slice bounds make the bare field match safe.
const assignedCodes = (source) => [...source.matchAll(/code: '([a-z0-9_]+)'/gu)].map((m) => m[1]);
// The service raises through its failure(message, code) helper.
const failureCodes = (source) => [...source.matchAll(/failure\('(?:[^']|\\')*',\s*'([a-z0-9_]+)'\)/gu)].map((m) => m[1]);

const captureLegSource = slice('../src/runtime-admission.mjs',
  'export function captureContribution', 'export function observedNativeSubagents')
  + slice('../src/contribution-service.mjs', 'const failure = ', null);

// The leg's closed set: every code it mints, with the HTTP class its owner row declares.
const CAPTURE_LEG_CODES = Object.freeze({
  contribution_workspace_unavailable: 409,
  contribution_capture_not_paused: 409,
  contribution_capture_conflict: 409,
  capture_failed: 409,
  contribution_retention_unavailable: 503,
  checkpoint_failed: 503,
  contribution_invalid: 400,
  contribution_unknown: 404,
  contribution_changed: 409,
});

test('#537 (a): the capture leg mints exactly the codes this issue owns, and each has an owner row', () => {
  const minted = [...new Set([...assignedCodes(captureLegSource), ...failureCodes(captureLegSource)])].sort();
  assert.deepEqual(minted, Object.keys(CAPTURE_LEG_CODES).sort(),
    'the scan reads the whole leg — a new code here needs a row here and in swarm-refusals.mjs');
  for (const [code, status] of Object.entries(CAPTURE_LEG_CODES)) {
    const row = SWARM_REFUSAL_CODES[code];
    assert.notEqual(row, undefined, `${code} has an owner row in SWARM_REFUSAL_CODES`);
    assert.equal(row.status, status, `${code} declares its ${status} class`);
    assert.ok(row.rule.length > 0, `${code}'s row states its rule`);
    assert.deepEqual(row.raisedBy, ['coordinator'],
      `${code} is raised by the coordinator leg, never the fold or the runtime's refuse()`);
  }
});

// ── (b) the observed refusals cross the served POST /v1/commands transport ───────────────────

function fixture(code) {
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO_ID, card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command() {
      throw Object.assign(new Error(`issue537 refused: ${code}`), { code, detail: { participantId: 'author' } });
    },
    async actionAuthority() {
      return { schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64) };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue537-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue537-fixture' });
  return {
    web,
    context: () => ({
      principal: sessions.authenticate({ headers: { authorization: `Bearer ${issued.token}` } }),
      origin: ORIGIN, csrfToken: issued.csrfToken, transport: 'https',
    }),
    envelope: (overrides = {}) => ({
      schemaVersion: 1, commandId: 'issue537-cmd-1', idempotencyKey: 'issue537-key-1',
      command: 'swarm_capture', args: { swarmId: 's-537', participantId: 'author', contributionId: 'c-1' },
      repoId: REPO_ID, origin: ORIGIN, ...overrides,
    }),
  };
}
for (const [code, status] of [['contribution_workspace_unavailable', 409], ['capture_failed', 409]]) {
  test(`#537 (b): ${code} crosses POST /v1/commands as ${status} with its own code — never temporarily_unavailable`, async () => {
    const { web, context, envelope } = fixture(code);
    const response = await web.execute(context(), envelope());
    assert.equal(response.status, status, `${code}: crosses with its declared ${status} class`);
    assert.equal(response.body.error.code, code, `${code}: the code crosses as itself`);
    assert.notEqual(response.body.error.code, 'temporarily_unavailable', `${code}: never the transient row`);
    assert.equal(response.body.error.retryable, false, `${code}: a typed refusal is never retryable`);
  });
}
