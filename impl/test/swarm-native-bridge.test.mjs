// Cluster — swarm-native-bridge.mjs. Covers the scoped native-participant access contract:
// token-table identity minting (principal/context never chosen by a request), contract-arg
// admission before any runtime effect (closed key sets refuse forged identity fields), derived
// authority (the bridge owns no permission model — swarm.update contributions, organizer changes,
// and every runtime refusal are the runtime's call), concurrent multi-participant traffic over one
// server, wire.frame transport bounds, revocation/closure truth (including the close-during-issue
// and revoke-during-body-read races, with no revoked-token history retained), and a token that
// never reaches inspect(), receipts, server entries, or diagnostics. The dispatch double mirrors
// the root SwarmRuntime participant path (context.runId membership resolution, per-event update
// grants, author rules) because the live SwarmRuntime is root-owned and absent from this worktree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createUnrelatedServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSwarmNativeBridge, swarmBridgeCommand, swarmBridgeMain, validateSwarmCommandArgs,
  SWARM_COMMANDS, SWARM_BRIDGE_ENV_KEYS } from '../src/swarm-native-bridge.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const execFileAsync = promisify(execFile);
const BRIDGE_MODULE = fileURLToPath(new URL('../src/swarm-native-bridge.mjs', import.meta.url));

const refuse = (message, code, detail = {}) => Object.assign(new Error(message), { code, detail });
// The double's grant tables mirror the root runtime — the bridge itself keeps neither.
const COMMAND_PERMISSIONS = Object.freeze({
  'swarm.inspect': 'read', 'swarm.watch': 'read', 'swarm.recruit': 'recruit',
  'swarm.guide': 'communicate', 'swarm.capture': 'contribute',
  'swarm.check': 'review', 'swarm.stop': 'stop',
});
const UPDATE_PERMISSIONS = Object.freeze({
  'swarm.group_updated': 'organize', 'swarm.work_updated': 'organize',
  'swarm.assignment_updated': 'organize', 'swarm.context_updated': 'communicate',
  'swarm.contribution_recorded': 'contribute', 'swarm.contribution_reviewed': 'review',
  'swarm.participant_left': 'organize', 'swarm.closed': 'organize',
});

function createFakeSwarmRuntime() {
  const members = new Map(); // runId -> membership row
  const calls = [];
  const applied = []; // durable swarm.update effects, for author/permission truth
  const dispatch = async ({ command, args, principal, context }) => {
    if (dispatch.huge) return { blob: 'x'.repeat(4096) }; // response-bound probe
    calls.push({ command, args: structuredClone(args), principal: { ...principal }, context: { ...context } });
    if (command === 'swarm.create') {
      // Root runtime: a caller carrying runId context organizes within its granted swarm only.
      if (context?.runId) throw refuse('Recruit and organize within your granted swarm', 'swarm_membership_required');
    }
    const member = members.get(context?.runId);
    if (!member || member.status !== 'active') {
      throw refuse('This agent has no active membership in the swarm', 'swarm_membership_required');
    }
    const granted = (permission) => {
      if (!member.permissions.includes(permission)) {
        throw refuse(`This swarm has not granted ${permission} authority to this participant`, 'swarm_permission_required',
          { permission, participantId: member.participantId });
      }
    };
    if (command === 'swarm.list') {
      granted('read'); // the runtime filters swarms by the caller's own membership
      return [{ swarmId: member.swarmId, purpose: 'ship the swarm access seam', status: 'open' }];
    }
    if (command === 'swarm.update') {
      const permission = UPDATE_PERMISSIONS[args.event];
      if (!permission) throw refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
      granted(permission);
      if (args.event === 'swarm.contribution_recorded' && args.payload?.participantId !== member.participantId) {
        throw refuse('Contributions must name their actual author', 'swarm_author_mismatch');
      }
      const payload = args.event === 'swarm.contribution_reviewed'
        ? { ...args.payload, reviewerId: member.participantId } : args.payload;
      applied.push({ event: args.event, swarmId: args.swarmId, author: principal.principalId, payload: structuredClone(payload) });
      return { event: args.event, applied: true, participantId: member.participantId,
        ...(payload?.reviewerId ? { reviewerId: payload.reviewerId } : {}) };
    }
    const permission = COMMAND_PERMISSIONS[command];
    if (!permission) throw refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
    granted(permission);
    if (command === 'swarm.inspect') {
      return {
        swarmId: args.swarmId,
        caller: { participantId: member.participantId },
        availableActions: Object.entries(COMMAND_PERMISSIONS)
          .filter(([, permissionName]) => member.permissions.includes(permissionName)).map(([name]) => name),
        updates: Object.entries(UPDATE_PERMISSIONS)
          .filter(([, permissionName]) => member.permissions.includes(permissionName)).map(([event]) => event),
      };
    }
    return { command, swarmId: args.swarmId, participantId: member.participantId };
  };
  return {
    calls, applied, dispatch,
    join({ swarmId, participantId, runId, permissions = ['read', 'communicate', 'contribute'], status = 'active' }) {
      members.set(runId, { swarmId, participantId, runId, permissions, status });
    },
    setStatus(runId, status) { members.get(runId).status = status; },
  };
}

async function withBridge(options, fn) {
  const runtime = createFakeSwarmRuntime();
  const bridge = createSwarmNativeBridge({ dispatch: runtime.dispatch, ...options });
  try {
    await bridge.ready();
    return await fn({ bridge, runtime });
  } finally {
    await bridge.close();
  }
}

const post = (endpoint, token, payload, headers = {}) => new Promise((resolve, reject) => {
  const target = new URL(endpoint);
  const body = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  const req = httpRequest({
    protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname,
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(Number.isSafeInteger(headers.contentLengthOverride)
        ? { 'content-length': headers.contentLengthOverride }
        : { 'content-length': body.length }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  }, resolve);
  req.on('error', reject);
  req.end(headers.contentLengthOverride === undefined ? body : Buffer.alloc(0));
});

const readResponse = (response) => new Promise((resolve, reject) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  response.on('error', reject);
});

const call = (issued, command, args = {}) => swarmBridgeCommand({
  command, args, endpoint: issued.env[SWARM_BRIDGE_ENV_KEYS.url], token: issued.token,
});

// ============================================================
// issue() — token, env injection shape, non-secret receipt, inspect()
// ============================================================

test('issue() binds one scope, returns env config and a receipt that never carries the token', async () => {
  await withBridge({}, async ({ bridge }) => {
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/u); // 256-bit base64url
    assert.equal(issued.env[SWARM_BRIDGE_ENV_KEYS.token], issued.token);
    assert.match(issued.env[SWARM_BRIDGE_ENV_KEYS.url], /^http:\/\/127\.0\.0\.1:\d+\/$/u);
    assert.equal(issued.env[SWARM_BRIDGE_ENV_KEYS.swarmId], 'swarm-1');
    assert.equal(issued.env[SWARM_BRIDGE_ENV_KEYS.participantId], 'alpha');
    assert.equal(issued.env[SWARM_BRIDGE_ENV_KEYS.runId], 'run-alpha');
    // Non-secret receipt: correlation identity only.
    assert.equal(issued.receipt.swarmId, 'swarm-1');
    assert.equal(issued.receipt.principalId, 'swarm-native:alpha');
    assert.equal(issued.receipt.tokenDigest, createHash('sha256').update(issued.token, 'utf8').digest('hex'));
    assert.equal(JSON.stringify(issued.receipt).includes(issued.token), false);
    // Deployment-facing inspect: digests only — no token, no env, and the command surface is
    // visible to agents rather than hidden.
    const status = bridge.inspect();
    assert.equal(status.capabilities.length, 1);
    assert.equal(status.capabilities[0].state, 'active');
    assert.equal(JSON.stringify(status).includes(issued.token), false);
    assert.equal(JSON.stringify(status).includes(SWARM_BRIDGE_ENV_KEYS.token), false);
    assert.ok(status.commands.includes('swarm.inspect'));
    assert.ok(status.commands.includes('swarm.update'));
    assert.deepEqual(SWARM_COMMANDS.includes('swarm.update'), true);
  });
});

test('issue() refuses malformed scopes without touching the listener', async () => {
  await withBridge({}, async ({ bridge }) => {
    await assert.rejects(bridge.issue({ swarmId: 'swarm-1' }), (error) => error.code === 'swarm_bridge_scope_invalid');
    await assert.rejects(bridge.issue({ swarmId: '', participantId: 'a', runId: 'r' }), (error) => error.code === 'swarm_bridge_scope_invalid');
    await assert.rejects(bridge.issue({ swarmId: 'bad id!', participantId: 'a', runId: 'r' }), (error) => error.code === 'swarm_bridge_scope_invalid');
  });
});

test('the transport is loopback-only by construction', () => {
  assert.throws(() => createSwarmNativeBridge({ dispatch: () => {}, host: '0.0.0.0' }), /loopback-only/u);
});

// ============================================================
// Dispatch — bridge-minted principal/context, contract admission, participation
// ============================================================

test('an authorized command reaches dispatch with the bridge-minted principal and token-table context', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    // Membership exists with a runId and no worker binding yet — the prebinding path the root
    // runtime resolves through context.runId (SwarmRuntime._caller's runId arm).
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const result = await call(issued, 'swarm.inspect', { swarmId: 'swarm-1' });
    assert.equal(result.caller.participantId, 'alpha');
    assert.ok(result.availableActions.includes('swarm.guide'));
    assert.ok(result.availableActions.includes('swarm.capture'));
    assert.ok(result.updates.includes('swarm.contribution_recorded'));
    assert.equal(result.updates.includes('swarm.group_updated'), false);
    assert.equal(result.availableActions.includes('swarm.stop'), false);
    const recorded = runtime.calls[0];
    assert.deepEqual(recorded.principal, {
      actor: 'swarm-native:swarm-1:alpha',
      principalId: 'swarm-native:alpha',
      sessionId: `swarm-bridge:${issued.receipt.tokenDigest.slice(0, 16)}`,
    });
    assert.deepEqual(recorded.context, { runId: 'run-alpha' });
  });
});

test('an implementer records a contribution through swarm.update; a reviewer records the review', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' }); // implementer
    runtime.join({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta',
      permissions: ['read', 'communicate', 'contribute', 'review'] });
    const alpha = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const beta = await bridge.issue({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta' });
    const contribution = await call(alpha, 'swarm.update', {
      swarmId: 'swarm-1', event: 'swarm.contribution_recorded', idempotencyKey: 'op-c-1',
      payload: { participantId: 'alpha', contributionId: 'c-1', body: 'the router prefers the explicit route' },
    });
    assert.equal(contribution.applied, true);
    assert.equal(contribution.participantId, 'alpha');
    const review = await call(beta, 'swarm.update', {
      swarmId: 'swarm-1', event: 'swarm.contribution_reviewed', idempotencyKey: 'op-c-1:review',
      payload: { contributionId: 'c-1', decision: 'comment', reason: 'matches the explicit-route pin' },
    });
    assert.equal(review.reviewerId, 'beta'); // the runtime attributes the review to its actual author
    assert.deepEqual(runtime.applied, [
      {
        event: 'swarm.contribution_recorded', swarmId: 'swarm-1', author: 'swarm-native:alpha',
        payload: { participantId: 'alpha', contributionId: 'c-1', body: 'the router prefers the explicit route' },
      },
      {
        event: 'swarm.contribution_reviewed', swarmId: 'swarm-1', author: 'swarm-native:beta',
        payload: { contributionId: 'c-1', decision: 'comment', reason: 'matches the explicit-route pin', reviewerId: 'beta' },
      },
    ]);
  });
});

test('an implementer cannot make organizer changes; a delegated organizer can', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' }); // no organize grant
    runtime.join({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta',
      permissions: ['read', 'communicate', 'contribute', 'organize'] }); // delegated organizer
    const alpha = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const beta = await bridge.issue({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta' });
    await assert.rejects(call(alpha, 'swarm.update', {
      swarmId: 'swarm-1', event: 'swarm.group_updated', idempotencyKey: 'op-g-1',
      payload: { purpose: 'mutiny' },
    }), (error) => error.code === 'swarm_permission_required' && error.status === 422
      && error.detail.permission === 'organize');
    assert.equal(runtime.applied.length, 0);
    const regroup = await call(beta, 'swarm.update', {
      swarmId: 'swarm-1', event: 'swarm.group_updated', idempotencyKey: 'op-g-2',
      payload: { purpose: 'split into builder and reviewer pairs' },
    });
    assert.equal(regroup.applied, true);
    assert.equal(runtime.applied[0].author, 'swarm-native:beta');
  });
});

test('the runtime owns membership-scoped surface verbs: swarm.list flows, swarm.create refuses', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const listed = await call(issued, 'swarm.list');
    assert.deepEqual(listed.map((row) => row.swarmId), ['swarm-1']);
    await assert.rejects(call(issued, 'swarm.create', { purpose: 'shadow swarm', idempotencyKey: 'op-create' }),
      (error) => error.code === 'swarm_membership_required' && error.status === 422);
  });
});

test('a request body can never choose the principal or the context (forged fields are ignored)', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const response = await post(issued.env[SWARM_BRIDGE_ENV_KEYS.url], issued.token, {
      command: 'swarm.inspect',
      args: { swarmId: 'swarm-1' },
      principal: { actor: 'orchestrator', principalId: 'worker:forged', sessionId: 'forged-session' },
      context: { runId: 'run-someone-else' },
    });
    const payload = await readResponse(response);
    assert.equal(payload.ok, true);
    assert.equal(runtime.calls[0].principal.principalId, 'swarm-native:alpha');
    assert.deepEqual(runtime.calls[0].context, { runId: 'run-alpha' });
  });
});

test('contract admission refuses forged identity fields and malformed args before any effect', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    // No contract command declares runId/principal/sessionId — identity is token-table-only.
    for (const forged of [
      { swarmId: 'swarm-1', runId: 'run-someone-else' },
      { swarmId: 'swarm-1', principal: { principalId: 'worker:forged' } },
      { swarmId: 'swarm-1', sessionId: 'forged-session' },
      { swarmId: 'swarm-1', context: { runId: 'run-someone-else' } },
    ]) {
      await assert.rejects(call(issued, 'swarm.inspect', forged), (error) => error.code === 'swarm_command_invalid');
    }
    // Closed schema on a real mutation verb: missing required field, unknown event kind.
    await assert.rejects(call(issued, 'swarm.update', { swarmId: 'swarm-1', event: 'swarm.contribution_recorded' }),
      (error) => error.code === 'swarm_command_invalid' && error.detail.field === 'idempotencyKey');
    await assert.rejects(call(issued, 'swarm.update', {
      swarmId: 'swarm-1', event: 'board.item_closed', idempotencyKey: 'op-x',
    }), (error) => error.code === 'swarm_command_invalid' && error.detail.field === 'event');
    // Non-contract commands are unavailable — the bridge keeps no command list of its own.
    for (const command of ['run.inspect', 'system.shutdown', 'swarm.promote']) {
      await assert.rejects(call(issued, command, {}), (error) => error.code === 'swarm_command_unavailable');
    }
    assert.equal(runtime.calls.length, 0);
    // The mirror agrees with the exported surface.
    assert.equal(validateSwarmCommandArgs('swarm.inspect', { swarmId: 'swarm-1' }), true);
  });
});

// ============================================================
// Refusals — tokens, scope, runtime passthrough
// ============================================================

test('unknown and revoked tokens mean the same invalid authority and never reach dispatch', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    await assert.rejects(swarmBridgeCommand({
      command: 'swarm.inspect', args: { swarmId: 'swarm-1' },
      endpoint: issued.env[SWARM_BRIDGE_ENV_KEYS.url], token: 'not-a-real-token',
    }), (error) => error.code === 'swarm_bridge_token_invalid' && error.status === 401);
    assert.deepEqual(bridge.revoke(issued.token), { revoked: 1, activeRemaining: 0 });
    await assert.rejects(call(issued, 'swarm.inspect', { swarmId: 'swarm-1' }),
      (error) => error.code === 'swarm_bridge_token_invalid' && error.status === 401);
    const raw = await post(issued.env[SWARM_BRIDGE_ENV_KEYS.url], issued.token, {}).then(readResponse);
    assert.equal(raw.error.code, 'swarm_bridge_token_invalid');
    assert.equal(runtime.calls.length, 0);
  });
});

test('revoke() accepts a partial scope object and only drops matching capabilities', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    runtime.join({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta' });
    const alpha = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const beta = await bridge.issue({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta' });
    assert.deepEqual(bridge.revoke({ participantId: 'alpha' }), { revoked: 1, activeRemaining: 1 });
    assert.equal(bridge.inspect().capabilities.length, 1);
    assert.equal(bridge.inspect().capabilities[0].principalId, 'swarm-native:beta');
    await assert.rejects(call(alpha, 'swarm.inspect', { swarmId: 'swarm-1' }),
      (error) => error.code === 'swarm_bridge_token_invalid');
    const stillActive = await call(beta, 'swarm.inspect', { swarmId: 'swarm-1' });
    assert.equal(stillActive.caller.participantId, 'beta');
  });
});

test('cross-swarm args are refused at the bridge and dispatch never sees them', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    await assert.rejects(call(issued, 'swarm.inspect', { swarmId: 'swarm-2' }),
      (error) => error.code === 'swarm_bridge_swarm_mismatch' && error.status === 403
        && error.detail.authorized === 'swarm-1' && error.detail.requested === 'swarm-2');
    assert.equal(runtime.calls.length, 0);
  });
});

test('runtime-owned refusals pass through verbatim (message, code, detail)', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha', permissions: ['read'] });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    await assert.rejects(call(issued, 'swarm.capture', { swarmId: 'swarm-1', participantId: 'alpha', contributionId: 'c1' }),
      (error) => error.code === 'swarm_permission_required' && error.status === 422
        && error.detail.permission === 'contribute' && error.detail.participantId === 'alpha');
    // A stale membership is a runtime decision, not a bridge one — the token itself stays valid.
    runtime.setStatus('run-alpha', 'inactive');
    await assert.rejects(call(issued, 'swarm.inspect', { swarmId: 'swarm-1' }),
      (error) => error.code === 'swarm_membership_required' && error.status === 422);
  });
});

// ============================================================
// Concurrency — one server, many participants, one identity per token
// ============================================================

test('one server carries concurrent participants and concurrent calls with isolated scopes', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    runtime.join({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta',
      permissions: ['read', 'communicate', 'contribute', 'review', 'organize', 'recruit', 'stop'] });
    const alpha = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const beta = await bridge.issue({ swarmId: 'swarm-1', participantId: 'beta', runId: 'run-beta' });
    const results = await Promise.all([
      call(alpha, 'swarm.inspect', { swarmId: 'swarm-1' }),
      call(alpha, 'swarm.guide', { swarmId: 'swarm-1', participantId: 'beta', message: 'hand off the fence work', idempotencyKey: 'op-i-1' }),
      call(alpha, 'swarm.capture', { swarmId: 'swarm-1', participantId: 'alpha', contributionId: 'c-alpha-1' }),
      call(beta, 'swarm.inspect', { swarmId: 'swarm-1' }),
      call(beta, 'swarm.capture', { swarmId: 'swarm-1', participantId: 'alpha', contributionId: 'c-alpha-2' }), // beta holds review
      call(beta, 'swarm.recruit', { swarmId: 'swarm-1', participantId: 'gamma', objective: 'scout the router', idempotencyKey: 'op-r-1' }),
    ]);
    assert.equal(results[0].caller.participantId, 'alpha');
    assert.equal(results[3].caller.participantId, 'beta');
    assert.equal(results[1].participantId, 'alpha'); // guide resolves the alpha membership
    assert.equal(results[4].participantId, 'beta'); // review capture is performed BY beta on alpha's work
    assert.equal(results[5].command, 'swarm.recruit');
    assert.equal(runtime.calls.length, 6);
    for (const [index, who] of [alpha, alpha, alpha, beta, beta, beta].entries()) {
      assert.equal(runtime.calls[index].context.runId, who.receipt.runId);
      assert.equal(runtime.calls[index].principal.principalId, who.receipt.principalId);
    }
    assert.equal(bridge.inspect().capabilities.length, 2);
  });
});

test('the same token reused concurrently mints one identity — native children are never fabricated', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const sessions = await Promise.all(Array.from({ length: 5 }, () => call(issued, 'swarm.inspect', { swarmId: 'swarm-1' })));
    assert.equal(sessions.length, 5);
    const principals = new Set(runtime.calls.map((entry) => `${entry.principal.principalId}:${entry.principal.sessionId}`));
    assert.equal(principals.size, 1); // one participant identity, no per-call child identities
    assert.equal(bridge.inspect().capabilities.length, 1);
  });
});

// ============================================================
// Races — close during issue, revocation during body read
// ============================================================

test('close() landing during issue() is observed: the issue rechecks closed after the listener wait', async () => {
  const runtime = createFakeSwarmRuntime();
  const bridge = createSwarmNativeBridge({ dispatch: runtime.dispatch });
  const pendingIssue = bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
  await bridge.close(); // lands while issue() is still awaiting the listener
  await assert.rejects(pendingIssue, (error) => error.code === 'swarm_bridge_closed');
});

test('a token revoked while its request body is in flight is rechecked before dispatch', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const target = new URL(issued.env[SWARM_BRIDGE_ENV_KEYS.url]);
    let requestRef;
    const responsePromise = new Promise((resolve) => {
      requestRef = httpRequest({
        hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': 64,
          authorization: `Bearer ${issued.token}` },
      }, resolve);
      requestRef.write(Buffer.alloc(10)); // partial body — the server is now mid-read
    });
    await new Promise((resolve) => setTimeout(resolve, 25)); // let the read actually start
    assert.equal(bridge.revoke(issued.token).revoked, 1);
    requestRef.end(Buffer.alloc(54)); // complete the declared 64-byte frame after revocation
    const payload = await readResponse(await responsePromise);
    assert.equal(payload.error.code, 'swarm_bridge_token_invalid');
    assert.equal(runtime.calls.length, 0);
  });
});

// ============================================================
// Transport bounds — the wire.frame substrate row
// ============================================================

test('request frames are bounded by the wire.frame row with a registry-composed refusal', async () => {
  await withBridge({ maxFrameBytes: 1024 }, async ({ bridge, runtime }) => {
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    // Schema-valid args whose bytes exceed the explicit server ceiling.
    const error = await call(issued, 'swarm.guide', {
      swarmId: 'swarm-1', participantId: 'beta', message: 'y'.repeat(2000), idempotencyKey: 'op-big',
    }).then(() => null, (thrown) => thrown);
    assert.equal(error.code, 'swarm_bridge_frame_exceeded');
    assert.equal(error.status, 413);
    assert.match(error.message, /wire\.frame is \d+ bytes \(cap 1024\)/u);
    assert.equal(error.detail.lane, 'wire.frame');
    assert.equal(error.detail.direction, 'request');
    assert.equal(typeof error.detail.resourceReason, 'string');
    // A lying declared content-length is refused without reading the body either.
    const response = await post(issued.env[SWARM_BRIDGE_ENV_KEYS.url], issued.token,
      { command: 'swarm.inspect', args: { swarmId: 'swarm-1' } }, { contentLengthOverride: 99_999_999 });
    const payload = await readResponse(response);
    assert.equal(payload.error.code, 'swarm_bridge_frame_exceeded');
    assert.equal(runtime.calls.length, 0);
    assert.equal(bridge.inspect().frameBytes, 1024);
  });
});

test('response frames are bounded by the same row before anything is written', async () => {
  await withBridge({ maxFrameBytes: 1024 }, async ({ bridge, runtime }) => {
    runtime.dispatch.huge = true;
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const response = await post(issued.env[SWARM_BRIDGE_ENV_KEYS.url], issued.token, {
      command: 'swarm.inspect', args: { swarmId: 'swarm-1' },
    });
    const payload = await readResponse(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'swarm_bridge_frame_exceeded');
    assert.equal(payload.error.detail.direction, 'response');
  });
});

test('the default ceiling is the declared wire.frame value, never an invented number', async () => {
  await withBridge({}, async ({ bridge }) => {
    assert.equal(bridge.inspect().frameBytes, FRAME_LIMITS['wire.frame'].value);
  });
});

// ============================================================
// Closure — revoke, shutdown truth, unrelated processes untouched
// ============================================================

test('close() revokes capabilities, awaits server shutdown, and leaves unrelated processes alone', async () => {
  const runtime = createFakeSwarmRuntime();
  runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
  const unrelated = createUnrelatedServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ alive: true }));
  });
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const unrelatedUrl = `http://127.0.0.1:${unrelated.address().port}/`;
  try {
    const bridge = createSwarmNativeBridge({ dispatch: runtime.dispatch });
    await bridge.ready();
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const closed = await bridge.close();
    assert.deepEqual(closed, { closed: true, revokedTotal: 1, activeRemaining: 0 });
    // Post-closure truth: capabilities gone, endpoint gone, issue refuses.
    assert.equal(bridge.inspect().capabilities.length, 0);
    assert.equal(bridge.inspect().closed, true);
    assert.equal(bridge.inspect().endpoint, null);
    await assert.rejects(bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' }),
      (error) => error.code === 'swarm_bridge_closed');
    await assert.rejects(swarmBridgeCommand({
      command: 'swarm.inspect', args: { swarmId: 'swarm-1' },
      endpoint: issued.env[SWARM_BRIDGE_ENV_KEYS.url], token: issued.token,
    }), (error) => error.code === 'swarm_bridge_unreachable');
    // close() is idempotent.
    assert.deepEqual(await bridge.close(), { closed: true, revokedTotal: 0, activeRemaining: 0 });
    // An unrelated loopback process on a neighboring port is untouched.
    const stillAlive = await new Promise((resolve, reject) => {
      const target = new URL(unrelatedUrl);
      httpRequest({ hostname: target.hostname, port: target.port, path: '/', method: 'GET' }, (response) => {
        readResponse(response).then(resolve, reject);
      }).on('error', reject).end();
    });
    assert.deepEqual(stillAlive, { alive: true });
  } finally {
    await new Promise((resolve) => unrelated.close(() => resolve()));
    unrelated.closeAllConnections?.();
  }
});

test('runtime refusals carry no token material in message, code, or detail', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    runtime.setStatus('run-alpha', 'inactive'); // force a runtime refusal path
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    let refused = null;
    try {
      await call(issued, 'swarm.inspect', { swarmId: 'swarm-1' });
    } catch (error) { refused = error; }
    assert.equal(refused.code, 'swarm_membership_required');
    assert.equal(JSON.stringify({ m: refused.message, c: refused.code, d: refused.detail }).includes(issued.token), false);
  });
});

// ============================================================
// CLI entry — the native agent's direct invocation surface
// ============================================================

test('the module executable answers swarm.inspect from env alone and fails with typed JSON errors', async () => {
  await withBridge({}, async ({ bridge, runtime }) => {
    runtime.join({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const issued = await bridge.issue({ swarmId: 'swarm-1', participantId: 'alpha', runId: 'run-alpha' });
    const env = {
      ...process.env,
      [SWARM_BRIDGE_ENV_KEYS.url]: issued.env[SWARM_BRIDGE_ENV_KEYS.url],
      [SWARM_BRIDGE_ENV_KEYS.token]: issued.token,
    };
    const ok = await execFileAsync(process.execPath, [BRIDGE_MODULE, 'swarm.inspect', JSON.stringify({ swarmId: 'swarm-1' })], { env });
    const parsed = JSON.parse(ok.stdout);
    assert.ok(parsed.availableActions.includes('swarm.guide'));
    assert.equal(ok.stderr, '');
    const refused = await execFileAsync(process.execPath, [BRIDGE_MODULE, 'swarm.stop', JSON.stringify({ swarmId: 'swarm-1', participantId: 'beta', reason: 'probe the refusal envelope', idempotencyKey: 'op-stop' })], { env })
      .catch((error) => error);
    assert.equal(refused.code, 1);
    const refusedPayload = JSON.parse(refused.stderr);
    assert.equal(refusedPayload.ok, false);
    assert.equal(refusedPayload.error.code, 'swarm_permission_required');
    assert.equal(JSON.stringify(refusedPayload).includes(issued.token), false);
    const badArgs = await execFileAsync(process.execPath, [BRIDGE_MODULE, 'swarm.inspect', 'not-json'], { env }).catch((error) => error);
    assert.equal(badArgs.code, 1);
    assert.equal(JSON.parse(badArgs.stderr).error.code, 'swarm_bridge_request_invalid');
    const missingEnv = await execFileAsync(process.execPath, [BRIDGE_MODULE, 'swarm.inspect']).catch((error) => error);
    assert.equal(missingEnv.code, 1);
    assert.match(JSON.parse(missingEnv.stderr).error.message, /BATON_SWARM_BRIDGE_URL/u);
  });
});

test('swarmBridgeMain() returns exit codes and writes envelopes without spawning a process', async () => {
  const lines = [];
  const sink = () => ({ write: (text) => { lines.push(text); return true; } });
  const code = await swarmBridgeMain([], {}, { out: sink(), err: sink() });
  assert.equal(code, 1);
  assert.match(JSON.parse(lines.at(-1)).error.message, /Usage:/u);
});
