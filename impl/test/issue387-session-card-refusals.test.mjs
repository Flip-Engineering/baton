// issue387-session-card-refusals.test.mjs — Issue #387 (audit C8): the cards a SESSION route is
// read from published no provider-refusal table at all.
//
// The degradation this pins: the omp card, the CLI-adapter family and the legacy tiers all publish
// `providerRefusalsForHarness` (adapter.mjs, #341 part 2), and the deployment's readiness derivation
// matches a crash/turn-failure text against exactly THAT table (`refusalEvidenceOf` →
// `matchProviderRefusal`, application-deployment.mjs). The session tiers — claude-session.mjs,
// codex-appserver.mjs (and the ACP tiers kimi-acp.mjs/grok-acp.mjs) — published no such key, so
// `matchProviderRefusal` returned null for every text they ever wrote. A #348-style provider death
// (a claude seat dying on "401 OAuth access token has expired", a quota refusal) therefore left the
// session route reading READY, and every successor admitted onto it died the same way.
//
// RED at HEAD (before the card fix):
//   (A) the session cards carry no `providerRefusals` key;
//   (B) the #348 capture is therefore recognised by nothing;
//   (D) the deployment's own doctor row reads the session route READY after that crash.
// GREEN only when every session-tier card publishes the ONE derivation for its own harness
// (`providerRefusalsForHarness(card.harness)` — never a copy) and the card contract refuses a card
// that publishes none.
//
// Hermetic: temp dirs under os.tmpdir() only; every session adapter is constructed against this
// test's own fake binaries and never spawns (no vendor CLI, no network, no quota).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROVIDER_REFUSAL_CODES, PROVIDER_REFUSALS_CARD_AXIS, assertCardProviderRefusals,
  matchProviderRefusal, providerRefusalsForHarness,
} from '../src/adapter.mjs';
import { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from '../src/claude-session.mjs';
import { ClaudeCli, CodexCli, MuseCli } from '../src/cli-adapters.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { Log } from '../src/log.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));

const AUTH_CODE = PROVIDER_REFUSAL_CODES.authentication;
const QUOTA_CODE = PROVIDER_REFUSAL_CODES.quota;

// The provider texts themselves: the #348 capture that opened the finding, codex's observed quota
// refusal, and prose that is about the worker rather than the provider.
const CLAUDE_AUTH_TEXT = 'Failed to authenticate. API Error: 401 OAuth access token has expired.';
const CODEX_QUOTA_TEXT = "You've hit your usage limit for the day. Please try again at Sep 19th, 2026 10:28 PM.";
const WORKER_PROSE = 'the provider connection was reset before the turn settled';

// The version is a real observed token: the deployment's card projection reads a route's harness as
// available only off an x.y.z version, and this fixture seats a real session card.
const claudeSession = (opts = {}) => new ClaudeSessionCli({
  cmd: process.execPath, args: [FAKE_CLAUDE], version: '2.1.206', model: 'claude-opus-4-6', ...opts,
});

/** The session tiers this lane owns a card for, plus the CLI family the same table must reach.
 * Each builder constructs its tier without spawning anything. */
const SESSION_TIERS = Object.freeze([
  ['ClaudeSessionCli', () => claudeSession()],
  ['GlmSessionCli', () => new GlmSessionCli({
    cmd: process.execPath, args: [FAKE_CLAUDE], version: 'issue387-test', model: 'glm-5.2',
  })],
  ['KimiSessionCli', () => new KimiSessionCli({
    cmd: process.execPath, args: [FAKE_CLAUDE], version: 'issue387-test',
  })],
  ['CodexAppServerCli', () => new CodexAppServerCli({
    cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2_000,
    model: 'gpt-5.6-sol', versionProbe: () => 'issue387-test',
  })],
]);

const CLI_TIERS = Object.freeze([
  ['CodexCli', () => new CodexCli()],
  ['ClaudeCli', () => new ClaudeCli()],
  ['MuseCli', () => new MuseCli({ version: 'issue387-test' })],
]);

const EVERY_CARD_TIER = Object.freeze([...SESSION_TIERS, ...CLI_TIERS]);
const cardOf = (name) => EVERY_CARD_TIER.find(([tier]) => tier === name)[1]().card();

// ── (A) the cards carry the table, and it IS the harness's own derivation ───────────────────────

test('387-A: every session-tier card publishes its harness’s own refusal table — one derivation, never a copy', () => {
  for (const [name, make] of EVERY_CARD_TIER) {
    const card = make().card();
    assert.ok(Array.isArray(card.providerRefusals),
      `${name}: the card publishes no providerRefusals table — a session route can never read blocked (#387)`);
    assert.equal(card.providerRefusals, providerRefusalsForHarness(card.harness),
      `${name}: the table must BE providerRefusalsForHarness('${card.harness}') — one derivation, never a copy`);
    assert.doesNotThrow(() => assertCardProviderRefusals(card),
      `${name}: the card contract admits every tier this build can seat`);
  }
  assert.deepEqual(cardOf('ClaudeSessionCli').providerRefusals.map((row) => row.code), [AUTH_CODE],
    'the claude session tier answers with the credential refusal #348 recorded');
  assert.deepEqual(cardOf('CodexAppServerCli').providerRefusals.map((row) => row.code), [QUOTA_CODE],
    'the codex app-server tier answers with its own provider-quota refusal');
  // Harness keys: the session spelling and the deployment spelling of one provider reach the SAME
  // table object, and the inheriting subclasses (Glm/Kimi/Deepseek) publish the table for the
  // harness their own card names.
  for (const [harness, provider] of [['glm-via-claude-session', 'glm-via-claude'], ['glm', 'glm-via-claude']]) {
    assert.equal(providerRefusalsForHarness(harness), providerRefusalsForHarness(provider),
      `${harness} is the same provider as ${provider}: one table object, never a second copy`);
  }
  assert.equal(cardOf('GlmSessionCli').providerRefusals, providerRefusalsForHarness('glm-via-claude'),
    'the GLM session card carries the z.ai vocabulary its one-shot sibling already carries');
  assert.ok(providerRefusalsForHarness('deepseek').length > 0,
    'DeepSeek reaches its own Anthropic-compatible endpoint on a session route: its limit vocabulary belongs to that harness');
  assert.doesNotThrow(() => assertCardProviderRefusals({
    harness: 'deepseek', providerRefusals: providerRefusalsForHarness('deepseek'),
  }));
  // Honest absence stays honest: a harness whose provider text this build never captured publishes
  // the empty table, and a card that publishes exactly that is admitted.
  assert.doesNotThrow(() => assertCardProviderRefusals({
    harness: 'pi', providerRefusals: providerRefusalsForHarness('pi'),
  }), 'a tier this build has no captured vocabulary for publishes an EMPTY table, never a guess');
});

// ── (B) the #348 capture is recognised through the session card ────────────────────────────────

test('387-B: the captured 401 is recognised through the claude session card, and worker prose never blocks', () => {
  const claude = cardOf('ClaudeSessionCli');
  assert.equal(matchProviderRefusal(claude, CLAUDE_AUTH_TEXT)?.code, AUTH_CODE,
    'the live capture that opened #348 must be recognised by the card the session route is read from');
  assert.equal(matchProviderRefusal(cardOf('CodexAppServerCli'), CODEX_QUOTA_TEXT)?.code, QUOTA_CODE);
  assert.equal(matchProviderRefusal(cardOf('MuseCli'), 'missing meta credentials: run `muse login`')?.code, AUTH_CODE);
  for (const prose of [WORKER_PROSE, 'stopped by the operator', 'worktree could not be created']) {
    for (const [name, make] of EVERY_CARD_TIER) {
      assert.equal(matchProviderRefusal(make().card(), prose), null,
        `${name}: a pattern nobody captured never blocks a route (#341): ${prose}`);
    }
  }
  // The HEAD shape — the very same card with no table — recognises nothing at all. This is the bug.
  assert.equal(matchProviderRefusal({ ...claude, providerRefusals: undefined }, CLAUDE_AUTH_TEXT), null);
});

// ── (C) the card contract refuses a card that carries no table ─────────────────────────────────

test('387-C: the card contract refuses a card publishing no table, or one that is not its harness’s derivation', () => {
  const card = cardOf('ClaudeSessionCli');
  const refusedFor = (providerRefusals) => assert.throws(
    () => assertCardProviderRefusals({ ...card, providerRefusals }),
    (error) => error?.code === 'adapter_card_incomplete' && error?.detail?.axis === 'providerRefusals'
      && error?.detail?.missing?.includes('providerRefusals'),
    `a card whose providerRefusals is ${JSON.stringify(providerRefusals)} must be refused, naming the axis`,
  );
  refusedFor(undefined);
  refusedFor(null);
  refusedFor([]);
  // A structurally identical copy is still refused: the table is DERIVED from the harness, so a
  // second spelling of it is exactly the drift this contract exists to prevent.
  refusedFor([{ ...card.providerRefusals[0] }]);
  refusedFor([{ code: AUTH_CODE, pattern: /401/u.source, resetAt: null }]);
  assert.equal(assertCardProviderRefusals(card), card, 'the derivation itself is admitted');
  // The axis is declared in the shape ADAPTER_CARD_AXES entries have, so the card contract
  // (adapter-contract.mjs) admits it by reference instead of re-deriving the rule it names.
  assert.deepEqual(Object.keys(PROVIDER_REFUSALS_CARD_AXIS).sort(), ['axis', 'consumes', 'validate']);
  assert.equal(PROVIDER_REFUSALS_CARD_AXIS.axis, 'providerRefusals');
  assert.equal(typeof PROVIDER_REFUSALS_CARD_AXIS.consumes, 'string');
  assert.equal(typeof PROVIDER_REFUSALS_CARD_AXIS.validate, 'function');
  assert.doesNotThrow(() => PROVIDER_REFUSALS_CARD_AXIS.validate(card.providerRefusals, card.harness));
  assert.throws(() => PROVIDER_REFUSALS_CARD_AXIS.validate(undefined, card.harness), TypeError);
});

// ── (D) the deployment's own readiness: the session route reads blocked ────────────────────────

const CLAUDE_ROUTE = Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high' });

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-refusal-387-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'session-card-refusals@example.invalid', GIT_COMMITTER_EMAIL: 'session-card-refusals@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Session card refusals', GIT_COMMITTER_NAME: 'Session card refusals' });
  writeFileSync(join(root, 'README.md'), '# session card refusals fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/**
 * The route adapter the readiness derivation reads: a double carrying a REAL session card, with
 * only the atoms the deployment's own admission reads overridden (an exact route advertisement and
 * credential ownership — the #341 fixture recipe). The refusal table is left exactly as the session
 * tier published it, which is the fact under test; `providerRefusals: undefined` rebuilds the HEAD
 * shape of the same card.
 */
function sessionRouteAdapter(card, overrides = {}) {
  const adapter = new MockAdapter({
    harness: card.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  adapter.card = () => ({
    ...card,
    ...overrides,
    concurrencyCeiling: null,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: CLAUDE_ROUTE.model, available: [CLAUDE_ROUTE.model],
      family: 'claude', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [CLAUDE_ROUTE.effort],
      serviceTier: null, provenance: 'issue387-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, name, adapter) {
  const repo = repository(t, name);
  const ownerRoot = mkdtempSync(join(tmpdir(), `baton-refusal-387-${name}-owner-`));
  t.after(() => rmSync(ownerRoot, { force: true, recursive: true }));
  mkdirSync(ownerRoot, { recursive: true });
  let driverOptions = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: join(ownerRoot, 'deployment'),
      adapters: { 'claude-code': adapter },
      routes: [CLAUDE_ROUTE],
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => {
    driverOptions = options;
    return createDriver(options);
  });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return { deployment, driverOptions };
}

/** A crash cert as the adapters publish it: the provider's own words in `error`. */
function appendCrash(log, worker, text) {
  return log.append({
    worker, harness: CLAUDE_ROUTE.harness, turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: CLAUDE_ROUTE.harness, modelResolved: CLAUDE_ROUTE.model,
    effortResolved: CLAUDE_ROUTE.effort, payload: { error: text, usageSeal: null },
  });
}

const routeRow = (doctor) => doctor.routes.find((row) => row.harness === CLAUDE_ROUTE.harness
  && row.model === CLAUDE_ROUTE.model && row.effort === CLAUDE_ROUTE.effort);

test('387-D: a captured 401 on a session route reads blocked with the #341 row; the same card without it reads ready', async (t) => {
  const card = claudeSession().card();

  const refused = await openDeployment(t, 'refused', sessionRouteAdapter(card));
  appendCrash(new Log(refused.driverOptions.logDir), 'fixture-387-refused', CLAUDE_AUTH_TEXT);
  const blocked = routeRow(await refused.deployment.doctor());
  assert.equal(blocked.state, 'blocked', 'a session route whose provider refused does not read ready');
  assert.equal(blocked.code, AUTH_CODE, 'the row names the #341 class the provider’s own words fall in');
  assert.equal(blocked.resetAt, null, 'the provider named no instant, and none is invented');
  assert.equal(blocked.lastProviderRefusal.code, AUTH_CODE);
  assert.match(blocked.lastProviderRefusal.text, /OAuth access token has expired/u,
    'the provider’s own text rides the row');

  // The exact HEAD shape: the same session card, one key absent, on the same crash.
  const headShape = await openDeployment(t, 'head-shape', sessionRouteAdapter(card, { providerRefusals: undefined }));
  appendCrash(new Log(headShape.driverOptions.logDir), 'fixture-387-head-shape', CLAUDE_AUTH_TEXT);
  const ready = routeRow(await headShape.deployment.doctor());
  assert.equal(ready.lastProviderRefusal, null, 'a card with no table recognises nothing (#341)');
  assert.equal(ready.state, 'ready', 'and the route reads ready — the degradation #387 records');
});
