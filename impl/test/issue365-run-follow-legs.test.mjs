// Issue #365: `run status --follow` and `run progress|events|output --follow` always refused at
// entry (cli_config_invalid): the follow legs admitted only `onFollowPage` while the entry
// (impl/scripts/baton.mjs streaming branch) passes `{signal, onFollowPage}`, and neither leg
// forwarded `signal` to its transport waits, so SIGINT could not stop an in-flight run.follow.
//
// The rows below drive the REAL CLI parse over a REAL resident deployment (parser →
// authenticated Web host on an owner-only Unix socket → the application's own validator and
// dispatch), the way the #338 deployment row does — only the repository and the provider
// adapter are fixtures; every layer of the path is production code.
//
//   (a) `run status RUN_ID --follow` with `{signal, onFollowPage}` does NOT refuse and delivers
//       at least one page;
//   (b) `run progress|events|output RUN_ID --follow` likewise — one row per form, table-driven
//       from the CLI's OWN advertised forms (the `baton help run` usage lines), never a
//       hand-kept list;
//   (c) an unknown option key refuses cli_config_invalid naming the offending key and the
//       admitted set, through the ONE option helper the wake watch shares;
//   (d) aborting the signal mid-follow ends the leg within the transport's own bound with the
//       ended row naming reason `aborted` — and no unhandled rejection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { BatonWebClient, batonCliHelp, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { WebNorthbound, createLocalAuthenticatedWebServer } from '../src/web-northbound.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';

const RESIDENT_REPO = 'repo-issue-365';
const RESIDENT_ORIGIN = 'https://baton.local';
const residentPrincipal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

async function until(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

async function refusalOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, the leg resolved instead');
}

/** A real resident deployment: the real BatonApplication over a driver + MockAdapter, behind the
 * real authenticated Web host on an owner-only socket, driven by the real CLI client. The
 * profile enables follow (the CLI derives its page wait from the deployment card, as shipped).
 * The socket root goes through the measure-then-fall-back derivation (fixture-root.mjs) because
 * the host refuses a bound path over 103 bytes. */
async function residentDeployment(t) {
  const directory = fixtureSocketRoot('baton-365-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 365 test', GIT_COMMITTER_NAME: 'Issue 365 test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue365@example.invalid', GIT_COMMITTER_EMAIL: 'issue365@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({
    harness: 'mock',
    // Long enough that a run approved at test time is still non-terminal when its follow leg
    // attaches, short enough that every row settles in seconds.
    scenario: { outcome: 'completed', delayMs: 1_500, summary: 'ready', files: {} },
  });
  const adapterCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...adapterCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-a',
    available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [],
    reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  const driver = createDriver({
    repoRoot: repo, repoId: RESIDENT_REPO, logDir: join(directory, 'log'), adapters: { mock: adapter },
    goalPlanAuthority: {
      policy: { schemaVersion: 1, repoId: RESIDENT_REPO, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
        limits: { maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 65_536,
          maxPlanBytes: 262_144, maxStatusBytes: 262_144, maxTokens: 1_000_000, maxUsd: 100,
          maxWallMin: 1_440, maxProviderTurns: 10_000 } },
      authorize: async () => true,
    },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: RESIDENT_REPO,
    profiles: { standard: { schemaVersion: 1, repoId: RESIDENT_REPO, definitionOfDone: ['verification passes'],
      constraints: [], risk: 'low',
      goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
      nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
      pathScope: ['**'],
      verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
        expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 65_536, requiredPredecessorEvidence: [] },
      routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
      capabilities: ['code'], effects: ['repository_edit'],
      resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      followPolicy: { mode: 'enabled', maxWaitMs: 30_000, maxChanges: 128,
        maxResponseBytes: 512 * 1024, maxScanEvents: 1024 } } },
    principals: { planner: residentPrincipal('planner'), dispatcher: residentPrincipal('dispatcher'),
      observer: residentPrincipal('observer') },
    authorize: async () => true,
  });
  await application.ready;
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({ userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop', 'export_result'],
    repoIds: [RESIDENT_REPO], ttlMs: 300_000 }, { actor: 'deployment:resident' });
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination,
    sessions, application, repoIds: [RESIDENT_REPO], allowedOrigins: [RESIDENT_ORIGIN] });
  const server = createLocalAuthenticatedWebServer(web);
  const socketPath = join(directory, 'resident.sock');
  const host = new BatonWebHost({
    application, server,
    shutdownPrincipal: { actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session' },
    listen: { path: socketPath }, webDrainMs: 2_000,
  });
  t.after(async () => {
    try { await host.shutdown(); } catch { /* the fixture is already down */ }
    try { await application.shutdown(residentPrincipal('cleanup')); } catch { /* already closed */ }
  });
  await host.start();
  const client = new BatonWebClient({
    baseUrl: RESIDENT_ORIGIN, origin: RESIDENT_ORIGIN, repoId: RESIDENT_REPO, token: issued.token,
    commandTimeoutMs: 15_000, pollMs: 10,
    fetchImpl: createLocalSocketFetch({ socketPath, baseUrl: RESIDENT_ORIGIN }),
    clock: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return { application, client };
}

/** Start a fixture Run and return its pending plan digest (the ceremony: run.start → the
 * advertised approve_plan action carries the digest the approval names). */
async function startRun(client, runId) {
  await client.command('run.start', {
    intent: {
      runId, objective: 'Follow-leg fixture run', profile: 'standard',
      route: { harness: 'mock', model: 'model-a', effort: 'low' },
      scope: ['**'],
    },
  });
  const advertised = await until(async () => {
    const status = await client.command('run.status', { runId });
    return (status?.nextActions ?? []).find((row) => row?.kind === 'approve_plan') ?? null;
  }, `approve_plan action for ${runId}`);
  return advertised.planDigest;
}

/** The follow forms the CLI ITSELF advertises, read off the run help topic's own usage lines —
 * the table the rows drive, never a hand-kept list. */
function advertisedFollowForms() {
  const usage = batonCliHelp('run').split('\n').map((line) => line.trim());
  const status = usage.some((line) => /^baton run status RUN_ID\b/.test(line) && line.includes('--follow'));
  const channels = usage
    .filter((line) => /^baton run (progress|events|output) RUN_ID\b/.test(line) && line.includes('[--follow'))
    .map((line) => /^baton run (\w+) RUN_ID\b/.exec(line)[1]);
  return { status, channels };
}

// ── (a) `run status RUN_ID --follow` ───────────────────────────────────────────────────────────

test('#365(a): run status RUN_ID --follow admits {signal, onFollowPage} and delivers pages', async (t) => {
  assert.ok(advertisedFollowForms().status, 'the CLI help advertises run status --follow');
  const { client } = await residentDeployment(t);
  const runId = 'run-365-status';
  const planDigest = await startRun(client, runId);
  const controller = new AbortController();
  const pages = [];
  const leg = runBatonCli(
    parseBatonCli(['run', 'status', runId, '--follow', '--idempotency-key', 'issue-365-a']),
    client,
    { signal: controller.signal, onFollowPage: async (page) => { pages.push(page); } },
  );
  // At HEAD the entry refusal fires before any command is sent, so a resolved leg that delivered
  // pages is exactly the property the issue asks for.
  await client.command('run.approve', { runId, planDigest });
  const result = await leg;
  assert.ok(pages.length >= 1, `the follow delivered at least one page (got ${pages.length})`);
  assert.equal(result?.runId, runId);
});

// ── (b) `run progress|events|output RUN_ID --follow`, one row per advertised form ──────────────

for (const channel of advertisedFollowForms().channels) {
  test(`#365(b): run ${channel} RUN_ID --follow admits {signal, onFollowPage} and delivers its pages`, async (t) => {
    const { client } = await residentDeployment(t);
    const runId = `run-365-${channel}`;
    const planDigest = await startRun(client, runId);
    const controller = new AbortController();
    const pages = [];
    const leg = runBatonCli(
      parseBatonCli(['run', channel, runId, '--follow', '--idempotency-key', `issue-365-${channel}`]),
      client,
      { signal: controller.signal, onFollowPage: async (page) => { pages.push(page); } },
    );
    await client.command('run.approve', { runId, planDigest });
    const result = await leg;
    // A page delivered is the follow working; a terminal result with no page is the transport's
    // honest answer when the channel carried nothing this fixture run produced (the mock adapter
    // emits no provider messages, so the output channel can be legitimately empty).
    assert.ok(pages.length >= 1 || result?.terminal === true,
      `the ${channel} follow delivered its pages or honestly ended terminal `
      + `(pages: ${pages.length}, terminal: ${result?.terminal})`);
  });
}

// ── (c) the closed option set, shared with the wake watch ──────────────────────────────────────

test('#365(c): an unknown option key refuses naming the key and the admitted set', async () => {
  const unusedClient = {
    command: async () => { throw new Error('no command may cross an invalid option set'); },
  };
  const bogus = { onFollowPage: async () => {}, signal: new AbortController().signal, bogus: true };
  for (const argv of [
    ['run', 'status', 'run-365-c', '--follow'],
    ['run', 'progress', 'run-365-c', '--follow'],
  ]) {
    const refusal = await refusalOf(() => runBatonCli(parseBatonCli(argv), unusedClient, bogus));
    assert.equal(refusal.code, 'cli_config_invalid', argv.join(' '));
    assert.match(refusal.message, /bogus/, `${argv.join(' ')}: the offending key is named`);
    assert.match(refusal.message, /onFollowPage, signal/, `${argv.join(' ')}: the admitted keys are named`);
    assert.deepEqual(refusal.detail?.admitted, ['onFollowPage', 'signal']);
  }
  // The wake watch leg shares the SAME helper — one key list, no third copy.
  const watch = await refusalOf(() => runBatonCli(parseBatonCli(['deployment', 'watch', '--follow']), unusedClient, { nope: 1 }));
  assert.match(watch.message, /nope/);
  assert.match(watch.message, /onFollowPage, signal/);
});

// ── (d) aborting mid-follow ends the leg ───────────────────────────────────────────────────────

test('#365(d): aborting the signal mid-follow ends the follow leg with the ended row', async (t) => {
  const { client } = await residentDeployment(t);
  const runId = 'run-365-abort';
  // Never approved: nothing changes, so the first run.follow wait holds for the profile's whole
  // bound — the abort must end the leg long before that bound expires.
  await startRun(client, runId);
  const controller = new AbortController();
  const startedAt = Date.now();
  const leg = runBatonCli(
    parseBatonCli(['run', 'status', runId, '--follow', '--idempotency-key', 'issue-365-d']),
    client,
    { signal: controller.signal, onFollowPage: async () => {} },
  );
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const result = await leg;
    const elapsed = Date.now() - startedAt;
    assert.equal(result?.kind, 'baton.run_follow_ended');
    assert.equal(result?.reason, 'aborted');
    assert.equal(result?.runId, runId);
    assert.ok(elapsed < 8_000, `the abort ended the leg promptly (${elapsed}ms, bound is 30s)`);
  } finally {
    clearTimeout(timer);
  }
});

test('#365(d): aborting the signal mid-follow ends the stream leg the same way', async (t) => {
  const { client } = await residentDeployment(t);
  const runId = 'run-365-abort-stream';
  await startRun(client, runId);
  const controller = new AbortController();
  const pages = [];
  const startedAt = Date.now();
  const leg = runBatonCli(
    parseBatonCli(['run', 'progress', runId, '--follow', '--idempotency-key', 'issue-365-d-stream']),
    client,
    { signal: controller.signal, onFollowPage: async (page) => { pages.push(page); } },
  );
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const result = await leg;
    const elapsed = Date.now() - startedAt;
    assert.equal(result?.kind, 'baton.run_stream_ended');
    assert.equal(result?.reason, 'aborted');
    assert.equal(result?.channel, 'progress');
    assert.equal(result?.runId, runId);
    assert.ok(elapsed < 8_000, `the abort ended the leg promptly (${elapsed}ms, bound is 30s)`);
  } finally {
    clearTimeout(timer);
  }
});
