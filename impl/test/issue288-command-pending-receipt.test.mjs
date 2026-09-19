// Issue #288 (R-5, U-F3 × MCP): a command that outlives the transport's request bound while the
// resident is alive returns the admitted receipt as `cli_command_pending` — the operation key and
// the row that will carry the verdict — never `cli_transport_failed`; `baton swarm check --follow`
// watches the swarm's own feed until that verdict row appears and prints it. On the MCP wire, the
// unclassified fallthrough is the TRANSIENT row (retryable, with a next action) and a permanent
// deployment condition keeps its own typed code with retryable:false and its remedy.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import {
  BatonWebClient, followSwarmCheck, followSwarmRecruit, parseBatonCli,
} from '../src/application-cli.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue288-pending';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue288-${label}-`));
  roots.push(root);
  return root;
}

// -------------------------------------------------------------------------------------------
// R-5 × the client: an aborted command POST is a receipt when the deployment still answers.
// -------------------------------------------------------------------------------------------

function client({ answers = true, onRequest = null } = {}) {
  return new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: ORIGIN, repoId: REPO_ID, token: 'private-bearer',
    commandTimeoutMs: 60, pollMs: 10, clock: Date.now, sleep: async () => {},
    fetchImpl: async (url, options) => {
      if (onRequest) onRequest(url, options);
      if (url.endsWith('/healthz')) {
        if (!answers) throw new Error('ECONNREFUSED');
        return { ok: true, headers: { get: () => null }, async text() { return JSON.stringify({ ok: true }); } };
      }
      // The command POST outlives the caller's own bound: the abort fires and the fetch rejects.
      await new Promise((resolve) => { options.signal.addEventListener('abort', resolve, { once: true }); });
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    },
  });
}

test('R-5: a command that outlives the request bound returns the pending receipt, never a network fault', async () => {
  const requested = [];
  const web = client({ onRequest: (url) => requested.push(String(url)) });
  const error = await web.command('swarm.check', {
    swarmId: 'swarm-288', participantId: 'reviewer', contributionId: 'contribution-288', checkId: 'check-288',
  }, 'operation-key-288').then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending', 'the peer is alive: this is a receipt, not a transport fault');
  assert.equal(error.detail.idempotencyKey, 'operation-key-288', 'the operation key crosses');
  assert.equal(typeof error.detail.commandId, 'string');
  assert.equal(error.detail.command, 'swarm.check');
  // Which watch/view row carries the verdict, and how to read it.
  assert.match(error.detail.observe.command, /baton swarm check swarm-288 reviewer contribution-288 check-288 --follow/u);
  assert.match(error.detail.observe.row, /reviews\["contribution-288"\]/u);
  assert.match(error.detail.observe.row, /Check check-288/u);
  // #522 migration: a check's receipt is now minted only when the check's own progress cannot be
  // observed either, so the leg reads the verify lease (the swarm view) before it surrenders. That
  // read is the third request and it is NOT a liveness probe: the deployment is probed once, and
  // only after the bound elapsed. Here it cannot be read either — this fixture answers no command
  // but the aborted one — so the receipt is the answer.
  assert.deepEqual(requested, [
    'https://resident.baton.test/v1/commands',
    'https://resident.baton.test/healthz',
    'https://resident.baton.test/v1/commands',
  ], 'liveness is probed once, and only after the bound elapsed');
});

test('R-5: a deployment that does not answer keeps the honest transport refusal', async () => {
  const web = client({ answers: false });
  const error = await web.command('run.status', { runId: 'run-288' }, 'operation-key-dead')
    .then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_transport_failed', 'no answer means no receipt');
  // #313: the refusal composes from the cause table now — the cause, not a fixed string, carries
  // the remedy (check that the resident is running), and a dead connection stays retryable.
  assert.equal(error?.cause, 'web_transport_failed');
  assert.equal(error?.retryable, true);
  assert.match(error.message, /check that the resident is running/u);
});

test('R-5: a command that never touched the bound keeps the transport refusal (no receipt is minted)', async () => {
  const seen = [];
  const web = new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: ORIGIN, repoId: REPO_ID, token: 'private-bearer',
    commandTimeoutMs: 60, pollMs: 10, clock: Date.now, sleep: async () => {},
    fetchImpl: async (url) => {
      seen.push(String(url));
      throw new Error('ECONNREFUSED');
    },
  });
  const error = await web.command('run.status', { runId: 'run-288' }, 'operation-key-refused')
    .then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_transport_failed');
  assert.deepEqual(seen, ['https://resident.baton.test/v1/commands'], 'a refused connection is never re-probed as liveness');
});

// -------------------------------------------------------------------------------------------
// R-5 × the CLI: `baton swarm check … --follow` observes the durable verdict row.
// -------------------------------------------------------------------------------------------

const checkArgs = ['swarm', 'check', 'swarm-288', 'reviewer', 'contribution-288', 'check-288'];
const verdictRow = {
  reviewerId: 'reviewer', decision: 'comment',
  reason: 'Check check-288: passed for 0123456789abcdef; cleanup released.',
  actor: 'web:reviewer:session', seq: 42, ts: '2026-09-14T12:00:01.000Z',
};
function swarmView(extra = {}) {
  return {
    swarmId: 'swarm-288', status: 'open', cursor: 41,
    participants: [{ participantId: 'reviewer', status: 'active', runtime: { state: 'working', turn: 'running' } }],
    contributions: { 'contribution-288': { contributionId: 'contribution-288' } },
    reviews: {}, ...extra,
  };
}

test('R-5: the CLI parses --follow on check into the observation stream', () => {
  const parsed = parseBatonCli([...checkArgs, '--follow']);
  assert.equal(parsed.kind, 'swarm_check_follow');
  assert.equal(parsed.swarmId, 'swarm-288');
  assert.equal(parsed.contributionId, 'contribution-288');
  assert.equal(parsed.checkId, 'check-288');
  assert.equal(typeof parsed.idempotencyKey, 'string');
  // Without --follow the verb is the ordinary check command (unchanged).
  assert.deepEqual(parseBatonCli([...checkArgs]).kind, 'command');
});

test('R-5: check --follow admits the check, watches the feed, and returns the verdict row', async () => {
  const calls = [];
  const pages = [];
  const views = [
    swarmView(),
    swarmView({ cursor: 42, watch: { reason: 'event' }, reviews: { 'contribution-288': [verdictRow] } }),
  ];
  const client = {
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'swarm.check') return { passed: true, sha: '0123456789abcdef', attempt: { cleanup: { state: 'released' } } };
      if (name === 'swarm.view') return views.shift();
      return views.shift();
    },
  };
  const result = await followSwarmCheck(parseBatonCli([...checkArgs, '--follow']), client, {
    onFollowPage: async (page) => pages.push(page),
  });
  assert.deepEqual(calls.map((call) => call.name), ['swarm.check', 'swarm.view', 'swarm.watch']);
  assert.equal(calls[2].args.afterSeq, 41, 'the watch resumes from the view cursor, never from scratch');
  assert.equal(result.verdict.seq, 42);
  assert.equal(result.verdict.reason, verdictRow.reason, 'the durable row is printed verbatim');
  assert.equal(result.check.passed, true, 'the check receipt rides beside it');
  assert.equal(pages.length, 1, 'the matched wake event is emitted as a page');
});

test('R-5: a verdict already durable is read back without waiting', async () => {
  const calls = [];
  const client = {
    async command(name) {
      calls.push(name);
      if (name === 'swarm.check') return { passed: false, sha: 'f'.repeat(40) };
      return swarmView({ reviews: { 'contribution-288': [verdictRow] } });
    },
  };
  const result = await followSwarmCheck(parseBatonCli([...checkArgs, '--follow']), client, {});
  assert.deepEqual(calls, ['swarm.check', 'swarm.view']);
  assert.equal(result.verdict.seq, 42);
});

test('R-5: a closed swarm ends the watch with an honest null verdict', async () => {
  const client = {
    async command(name) {
      if (name === 'swarm.check') return { passed: false, sha: 'f'.repeat(40) };
      return swarmView({ status: 'closed', participants: [], reviews: {} });
    },
  };
  const result = await followSwarmCheck(parseBatonCli([...checkArgs, '--follow']), client, {});
  assert.equal(result.verdict, null, 'no further event can write it: the receipt says so instead of hanging');
  assert.equal(result.check.sha, 'f'.repeat(40));
});

// -------------------------------------------------------------------------------------------
// U-F3 × MCP: the fallthrough is transient; a permanent cause is typed and not retryable.
// -------------------------------------------------------------------------------------------

function mcpFixture(command) {
  const directory = scratch('mcp');
  const server = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application: {
      repoId: REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async authorizeReplay() { return true; },
      command,
    },
    surface: 'combined',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-288', sessionId: 'stdio-288', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return server;
}

async function toolError(server, name, args) {
  await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'issue288', version: '1' } },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const response = await server.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args },
  });
  assert.equal(response.result.isError, true, `${name}: the call is refused`);
  return JSON.parse(response.result.content[0].text).error;
}

test('U-F3 × MCP: an unclassified throw is the TRANSIENT row — retryable, with a next action', async () => {
  const server = mcpFixture(async () => { throw new Error('internal provider exploded at /etc/baton/secret'); });
  const error = await toolError(server, 'baton_run_start', {
    repoId: REPO_ID, idempotencyKey: 'ik-288-transient',
    intent: { runId: 'run-288', objective: 'Probe the transient fallthrough', profile: 'standard' },
  });
  assert.equal(error.code, 'command_outcome_unknown');
  assert.equal(error.retryable, true, 'the fallthrough states its transience');
  assert.ok(error.action.length > 0, 'and names the next action');
  assert.equal(Object.hasOwn(error, 'message'), false, 'the internal text still never crosses');
  assert.equal(JSON.stringify(error).includes('secret'), false);
});

test('U-F3 × MCP: a permanent deployment condition keeps its typed code and is not retryable', async () => {
  const cases = [
    ['application_unavailable', /no retry can succeed/u],
    ['application_run_view_oversize', /narrow the read/u],
    ['application_run_lookup_oversize', /bounded page/u],
  ];
  for (const [code, remedy] of cases) {
    const server = mcpFixture(async () => { throw Object.assign(new Error('deployment detail'), { code }); });
    const error = await toolError(server, 'baton_run_start', {
      repoId: REPO_ID, idempotencyKey: `ik-288-${code}`,
      intent: { runId: 'run-288', objective: `Probe ${code}`, profile: 'standard' },
    });
    assert.equal(error.code, code, `${code}: the cause is typed, never re-spelled as temporarily_unavailable`);
    assert.equal(error.retryable, false, `${code}: a permanent condition is not retryable`);
    assert.match(error.action, remedy, `${code}: the remedy is stated`);
  }
});

// -------------------------------------------------------------------------------------------
// Issue #331: `baton swarm recruit … --follow` admits the recruit and then observes the
// swarm's own feed until THIS seat's admitted / queued / refused row appears and prints it.
// Without --follow the cli_command_pending receipt names the seat and the exact observation
// (`baton swarm view <swarm> --participant-id <seat>`), never doctor --check; the durable
// web command record stays reachable from the CLI through the pending refusal's commandId.
// Depends on work-332 (the completed row #332 defines): the finder below reads the rows that
// exist today and treats a completed-state seat as settled when one appears.
// -------------------------------------------------------------------------------------------

const recruitArgs = ['swarm', 'recruit', 'swarm-331', 'seat-331', 'Carry the lane'];
const recruitAnswer = {
  participantId: 'seat-331', runId: 'run-331', swarmId: 'swarm-331', scopeOverlap: [],
  admission: { state: 'admitted', authority: 'host' }, baseBehind: null,
};
function recruitSeatView(extra = {}) {
  return {
    swarmId: 'swarm-331', status: 'open', cursor: 7,
    participants: [{
      participantId: 'seat-331', status: 'active',
      workspace: { physicalOwnerId: 'task-331', shared: false, holderCount: 1 },
      runtime: { workerId: 'w-331', state: 'working', turn: 'running', live: true },
      base: { observedHead: 'a'.repeat(40), target: 'origin/master', behind: 0 },
    }],
    admission: [{
      participantId: 'seat-331', state: 'admitted', authority: 'host', leaseKind: 'worker',
      position: null, ahead: null, shortfall: null,
    }],
    ...extra,
  };
}

test('#331: the CLI parses --follow on recruit into the observation leg', () => {
  const parsed = parseBatonCli([...recruitArgs, '--follow']);
  assert.equal(parsed.kind, 'swarm_recruit_follow');
  assert.equal(parsed.swarmId, 'swarm-331');
  assert.equal(parsed.participantId, 'seat-331');
  assert.equal(parsed.objective, 'Carry the lane');
  assert.equal(typeof parsed.idempotencyKey, 'string');
  // Without --follow the verb is the ordinary recruit command (unchanged).
  assert.deepEqual(parseBatonCli([...recruitArgs]).kind, 'command');
});

test('#331: the CLI carries the recruit selection through the follow leg', () => {
  const parsed = parseBatonCli([...recruitArgs,
    '--options', '{"exact":{"harness":"h","model":"m","effort":"e"}}',
    '--permissions', '["contribute"]', '--resume-from', 'seat-330', '--follow']);
  assert.equal(parsed.kind, 'swarm_recruit_follow');
  assert.deepEqual(parsed.options, { exact: { harness: 'h', model: 'm', effort: 'e' } });
  assert.deepEqual(parsed.permissions, ['contribute']);
  assert.equal(parsed.resumeFrom, 'seat-330');
});

test('#331: recruit --follow admits the recruit and prints the admitted seat row', async () => {
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'swarm.recruit') return recruitAnswer;
      return recruitSeatView();
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.deepEqual(calls.map((call) => call.name), ['swarm.recruit', 'swarm.view']);
  assert.equal(calls[0].args.participantId, 'seat-331');
  assert.equal(result.outcome, 'admitted');
  assert.equal(result.seat.participantId, 'seat-331');
  assert.equal(result.seat.runtime.state, 'working');
  assert.deepEqual(result.seat.workspace, { physicalOwnerId: 'task-331', shared: false, holderCount: 1 });
  assert.equal(result.seat.admission.state, 'admitted');
  assert.deepEqual(result.seat.baseBehind, null);
  assert.equal(result.recruit.runId, 'run-331', 'the recruit receipt rides beside the row');
});

test('#331: recruit --follow prints the queued row while the seat still waits', async () => {
  const calls = [];
  const pending = Object.assign(new Error('Baton Web command remains admitted'), { code: 'cli_command_pending' });
  const client = {
    async command(name) {
      calls.push(name);
      if (name === 'swarm.recruit') throw pending;
      return recruitSeatView({
        participants: [],
        admission: [{
          participantId: 'seat-331', state: 'queued', authority: 'host', leaseKind: 'worker',
          position: 1, ahead: 0, shortfall: null,
        }],
      });
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.deepEqual(calls, ['swarm.recruit', 'swarm.view'], 'a queued row is terminal: no watch is armed');
  assert.equal(result.outcome, 'queued');
  assert.equal(result.seat.participantId, 'seat-331');
  assert.equal(result.seat.admission.state, 'queued');
  assert.equal(result.seat.admission.position, 1);
  assert.equal(result.recruit, null, 'no recruit receipt crossed yet');
});

test('#331: recruit --follow prints the refusal with its code when admission refuses', async () => {
  const refusal = Object.assign(new Error('route refused this recruitment'), { code: 'application_route_not_allowed' });
  const client = {
    async command(name) {
      if (name === 'swarm.recruit') throw refusal;
      return recruitSeatView({
        participants: [{
          participantId: 'seat-331', status: 'left', leftReason: 'recruit_refused',
          leftCode: 'application_route_not_allowed', workspace: null,
          runtime: { workerId: null, state: 'dead', turn: 'settled', live: false }, base: null,
        }],
      });
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.equal(result.outcome, 'refused');
  assert.equal(result.refusal.code, 'application_route_not_allowed', 'the refusal keeps its typed code');
  assert.equal(result.seat.leftReason, 'recruit_refused');
  assert.equal(result.seat.leftCode, 'application_route_not_allowed');
});

test('#331: recruit --follow reads a completed seat as settled (work-332 forward tolerance)', async () => {
  const client = {
    async command(name) {
      if (name === 'swarm.recruit') return recruitAnswer;
      return recruitSeatView({
        participants: [{
          participantId: 'seat-331', status: 'completed', workspace: null,
          runtime: { workerId: null, state: 'idle', turn: 'settled', live: false }, base: null,
        }],
      });
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.equal(result.outcome, 'completed', 'the completed row #332 defines settles the follow');
  assert.equal(result.seat.participantId, 'seat-331');
});

test('#331: without --follow the pending receipt names the seat observation, never doctor --check', async () => {
  const requested = [];
  const web = client({
    onRequest: (url) => requested.push(String(url)),
  });
  const error = await web.command('swarm.recruit', {
    swarmId: 'swarm-331', participantId: 'seat-331', objective: 'Carry the lane',
  }, 'operation-key-331').then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending', 'the peer is alive: this is a receipt, not a transport fault');
  assert.equal(error.detail.command, 'swarm.recruit');
  assert.equal(error.detail.observe.command, 'baton swarm view swarm-331 --participant-id seat-331');
  assert.match(error.detail.observe.row, /seat-331/u);
  assert.equal(error.detail.observe.command.includes('doctor'), false, 'a seat is observed on its swarm, never via doctor --check');
  assert.deepEqual(requested, [
    'https://resident.baton.test/v1/commands',
    'https://resident.baton.test/healthz',
  ], 'liveness is probed once, and only after the bound elapsed');
});

test('#331: the reconcile timeout keeps the durable command record reachable', async () => {
  let now = 0;
  const seen = [];
  const web = new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: ORIGIN, repoId: REPO_ID, token: 'private-bearer',
    commandTimeoutMs: 60, pollMs: 10, clock: () => now, sleep: async () => { now += 30; },
    fetchImpl: async (url, options) => {
      seen.push(`${options.method ?? 'GET'} ${String(url)}`);
      const body = (options.method ?? 'GET') === 'POST'
        ? { status: 'admitted' }
        : { command: { status: 'admitted' } };
      return { ok: true, headers: { get: () => null }, async text() { return JSON.stringify(body); } };
    },
  });
  const error = await web.command('swarm.recruit', {
    swarmId: 'swarm-331', participantId: 'seat-331', objective: 'Carry the lane',
  }, 'operation-key-331-reconcile').then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending', 'a record that never settles is a pending receipt');
  assert.equal(typeof error?.detail?.commandId, 'string', 'the durable web command record stays addressable');
  assert.equal(error?.detail?.observe?.command, 'baton swarm view swarm-331 --participant-id seat-331');
  assert.ok(seen.some((line) => line.startsWith('GET https://resident.baton.test/v1/commands/')),
    'the CLI polled the durable record before timing out');
});
