// Issue #443 hand-backs (landed 11c6dfba) plus the #455 web-port hand-back — the four rows the
// landing lane could not reach from its own files:
//
//   443h-a  `baton swarm create <purpose> --policy '{"rerouteOnProviderFault":"auto"}'` OPENS a
//           swarm with its re-route policy declared: the create records the `swarm.policy_updated`
//           row through the SAME fold an update takes, the canonical operation names `policy`, the
//           CLI spells it, and `swarm.view` shows the policy from the first row (resolved defaults
//           included). A policy the fold would refuse refuses BEFORE the swarm exists — no
//           `swarm.created` row for a create that never happened.
//   443h-b  the canonical `swarm.create` operation carries the `policy` field and
//           `validateApplicationCommandArgs` admits it (the web bus validates swarm commands
//           through exactly this call), while a non-object policy refuses naming the field.
//   443h-c  `reroute_proposal_mismatch` is PINNED as a replay invariant in the surface gate's
//           closed fold-admission table — the row proves the pin through the gate's own semantics
//           (a pin the scanned fold no longer raises is refused as stale).
//   443h-d  the web `package.admit` port forwards the store receipt's reuse half and the CLI's
//           recruit receipt carries it: a second `--issue` recruit reads
//           `contextPackage: {digest, reused: true}` (the #455 store half answers `result: 'reused'`).
//
// The stack is REAL: a temp dir, a CoordinationStore behind a WebNorthbound over the deployment's
// own Context CAS writer, a SwarmRuntime, and the CLI's own parser and client — the issue455
// fixture's shape, driven through the CLI where the row is about a spelling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { StatelessContextBench } from '../src/context-program.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { canonicalOperationFields, canonicalOperationForCommand } from '../src/application-semantics.mjs';
import { validateApplicationCommandArgs } from '../src/application.mjs';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue443h';
const SWARM_ID = 's-443h';
const ISSUE = 443;
const CITED_DOC = 'docs/47-the-reading-half.md';
const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue443h-${label}-`));
  roots.push(root);
  return root;
}

const ISSUE_TITLE = 'A seat its provider killed re-routes';
const ISSUE_BODY = [
  'The swarm carries the work to another route: the policy is declared when the swarm is opened.',
  `See ${CITED_DOC} §6 and the #443 decision rows.`,
].join('\n');

/** The root credential's contract, stubbed (the #441/#455 fixture shape): the issue and the doc
 *  it cites, answered without a network. */
function issueReader() {
  return async ({ issue }) => {
    if (issue !== ISSUE) throw Object.assign(new Error(`no issue ${issue}`), { code: 'issue_not_found' });
    return {
      number: ISSUE, title: ISSUE_TITLE, body: ISSUE_BODY, labels: ['bug'],
      url: `https://github.com/owner/repo/issues/${ISSUE}`,
    };
  };
}

function writeDocs(repoRoot) {
  mkdirSync(join(repoRoot, 'docs'), { recursive: true });
  writeFileSync(join(repoRoot, CITED_DOC), '# The reading half\n\nA seat reads its issue.\n');
  return repoRoot;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {} }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}

function storeOptions(directory, bench) {
  return {
    repoId: REPO_ID, deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: bench.environmentDigest,
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('context source attestation is not used here'); },
    clock: () => new Date(NOW).toISOString(),
  };
}

/** The REAL stack: the deployment's context CAS writer behind a real WebNorthbound, a real
 *  SwarmRuntime, and the CLI's own parser and client. */
function fixture(t) {
  const repoRoot = writeDocs(scratch('repo'));
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const bench = new StatelessContextBench({
    artifactRoot: join(directory, 'context'), sources: {},
    environmentDigest: '2'.repeat(64), policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const coordination = new CoordinationStore(join(directory, 'coordination'), storeOptions(directory, bench));
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: {
      list: () => workers,
      providerFaultDeathFor: () => null,
    },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => {},
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, sessionPrincipal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
        principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
      }, context);
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
    contextSourceAdmit: (value) => bench.admitSource(value),
  });
  const issued = sessions.issue({
    userId: 'issue443h-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'issue443h-fixture' });
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      const response = await send(web, {
        method: init.method ?? 'GET', path: `${parsed.pathname}${parsed.search}`,
        body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers ?? {},
      });
      return {
        ok: response.status >= 200 && response.status < 300, status: response.status,
        text: async () => response.rawBody ?? '',
      };
    },
    clock: () => NOW, sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  });
  return { directory, bench, coordination, web, swarmRuntime, client, repoRoot, workers };
}

const swarmRows = (coordination, kind) => coordination.eventsView()
  .filter((event) => event.kind === kind);
const seatRow = (coordination, seat) => coordination.swarm(SWARM_ID).participants[seat] ?? null;

// ── 443h-a: the swarm is OPENED with its policy ────────────────────────────────────────────────

test('443h-a: `swarm create --policy` records the policy row, and the view shows it from the first row', async (t) => {
  const f = fixture(t);
  const parsed = parseBatonCli([
    'swarm', 'create', 'Route around a provider fault',
    '--swarm-id', SWARM_ID, '--idempotency-key', 'issue443h:create',
    '--policy', '{"rerouteOnProviderFault":"auto"}',
  ]);
  assert.equal(parsed.kind, 'command', 'the create parses as a command');
  assert.equal(parsed.name, 'swarm.create');
  assert.deepEqual(parsed.args.policy, { rerouteOnProviderFault: 'auto' },
    'the --policy JSON rides the create as its own argument');

  const receipt = await runBatonCli(parsed, f.client);
  assert.equal(receipt.receipt?.event?.kind, 'swarm.created', 'the receipt names the created row');

  // The policy row is the SAME kind `swarm.update {event: 'swarm.policy_updated'}` writes, and it
  // names the swarm the create just made — one fold, one derivation.
  const policyRows = swarmRows(f.coordination, 'swarm.policy_updated');
  assert.equal(policyRows.length, 1, 'the create recorded exactly ONE policy row');
  assert.deepEqual(policyRows[0].payload, { swarmId: SWARM_ID, rerouteOnProviderFault: 'auto' },
    'the row carries the declared fields verbatim');

  const view = await f.client.command('swarm.view', { swarmId: SWARM_ID }, 'issue443h:view');
  assert.deepEqual(view.policy,
    { rerouteOnProviderFault: 'auto', reroutePreferApi: false, resumeContinuation: 'manual' },
    'the view renders the RESOLVED policy (undeclared fields default) from the first row');

  // A create with no policy records no policy row at all: the pre-#443 answer is untouched.
  const bare = parseBatonCli(['swarm', 'create', 'No policy declared', '--swarm-id', 's-443h-bare',
    '--idempotency-key', 'issue443h:create-bare']);
  assert.equal(Object.hasOwn(bare.args, 'policy'), false);
  await runBatonCli(bare, f.client);
  assert.equal(swarmRows(f.coordination, 'swarm.policy_updated').length, 1, 'still only the declared one');
});

test('443h-a2: a policy the fold refuses refuses BEFORE the swarm exists', async (t) => {
  const f = fixture(t);
  const parsed = parseBatonCli([
    'swarm', 'create', 'Bad policy', '--swarm-id', 's-443h-bad', '--idempotency-key', 'issue443h:create-bad',
    '--policy', '{"rerouteOnProviderFault":"sometimes"}',
  ]);
  await assert.rejects(runBatonCli(parsed, f.client), (error) => {
    assert.match(String(error?.message ?? error), /rerouteOnProviderFault/u, 'the refusal names the field');
    return true;
  });
  assert.equal(swarmRows(f.coordination, 'swarm.created').length, 0,
    'a refused policy never leaves a swarm behind');
  assert.equal(swarmRows(f.coordination, 'swarm.policy_updated').length, 0);
});

// ── 443h-b: the canonical operation, and the validator the web bus runs ────────────────────────

test('443h-b: the canonical swarm.create operation names policy, and validateApplicationCommandArgs admits it', () => {
  const operation = canonicalOperationForCommand('swarm.create');
  assert.ok(operation, 'swarm.create resolves to a canonical operation');
  assert.ok(canonicalOperationFields(operation).includes('policy'),
    'the canonical field union carries policy');
  assert.equal(
    validateApplicationCommandArgs('swarm.create', {
      purpose: 'Ship it', idempotencyKey: 'k-443h', policy: { rerouteOnProviderFault: 'auto' },
    }),
    true,
    'the create request with a policy is admissible');
  assert.throws(
    () => validateApplicationCommandArgs('swarm.create', {
      purpose: 'Ship it', idempotencyKey: 'k-443h', policy: 'auto',
    }),
    (error) => {
      assert.equal(error.code, 'swarm_command_invalid');
      assert.equal(error.detail?.field, 'policy', 'the refusal names the field');
      return true;
    },
    'a policy that is not an object refuses typed');
});

// ── 443h-d: the #455 web-port hand-back — the recruit receipt says whether the package was reused ─

test('443h-d: a second --issue recruit reuses the admitted package, and the CLI receipt says so', async (t) => {
  const f = fixture(t);
  await f.swarmRuntime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue443h', idempotencyKey: 'issue443h:swarm',
  }, OWNER);

  const recruit = (seat) => runBatonCli(
    parseBatonCli(['swarm', 'recruit', SWARM_ID, seat, 'Land the item this issue names.',
      '--issue', String(ISSUE)]),
    f.client, { issueReader: issueReader(), contextRepoRoot: f.repoRoot },
  );

  const first = await recruit('lane-a');
  assert.ok(first.contextPackage, 'the recruit receipt carries the context package');
  assert.match(first.contextPackage.digest ?? '', /^[a-f0-9]{64}$/u, 'the receipt names the digest');
  assert.equal(first.contextPackage.reused, false, 'the first recruit ADMITS the package');

  const second = await recruit('lane-b');
  assert.equal(second.contextPackage.reused, true,
    'the second recruit REUSES the admission the store already holds (#455)');
  assert.equal(second.contextPackage.digest, first.contextPackage.digest,
    'both receipts name the same content-addressed package');
  assert.equal(swarmRows(f.coordination, 'package.admitted').length, 1,
    'a reuse admits nothing a second time');
  assert.ok(seatRow(f.coordination, 'lane-b'), 'the second seat really joined on the same issue');
});
