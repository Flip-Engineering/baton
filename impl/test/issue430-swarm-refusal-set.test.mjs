// Issue #430 — the swarm family's ONE closed refusal set. The runtime's `refuse()` (impl/src/
// swarm-runtime.mjs) spells codes like `swarm_participant_not_found` / `swarm_participant_exists` /
// `swarm_closed` that the web layer's #336 fold table does not know, so every runtime-level
// refusal crossed as 503 `temporarily_unavailable` "command dispatch failed" — the operator
// retried as told and could not tell a request fault from a dead resident.
//
// The fix: one owner table (SWARM_REFUSAL_CODES in impl/src/swarm-refusals.mjs) lists every code
// the fold OR the runtime can raise with its HTTP class and a one-line rule; `refuse()` and
// `integrity()` draw their codes from it (an unknown code is a construction-time error), the web
// layer's SWARM_FOLD_REFUSAL_HTTP_STATUS is DERIVED from it, and the 503 fallthrough narrates the
// unmapped code (and the command) on the resident's stderr once per code.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { SWARM_FOLD_REFUSAL_HTTP_STATUS } from '../src/web-northbound.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
// The owner table may not exist at the red-before HEAD; the rows below show their own red then.
let SWARM_REFUSAL_CODES = null;
let SWARM_REFUSAL_SAME_RULE_PAIRS = null;
try {
  ({ SWARM_REFUSAL_CODES, SWARM_REFUSAL_SAME_RULE_PAIRS } = await import('../src/swarm-refusals.mjs'));
} catch { /* red-before: the single owner module does not exist yet */ }

const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue430-web';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue430-${label}-`));
  roots.push(root);
  return root;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {}, encrypted = true }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted, remoteAddress: '127.0.0.1' }, destroy() {},
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

function applicationCard() {
  // Mirrors issue288-web-refusal-envelopes.test.mjs: the facade check demands every web-admitted
  // command on the served card.
  return { schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) };
}

// A web stack whose application command throws the caller's canned error — the same way the #336
// guard drives coded refusals through the real dispatchFailure ladder.
function fixture({ command } = {}) {
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO_ID, card: applicationCard,
    async authorizeReplay() { return true; },
    async command(name, args) {
      if (command) return command(name, args);
      return { schemaVersion: 1, runId: args?.runId ?? 'run-issue430', phase: 'running' };
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
  });
  const issued = sessions.issue({
    userId: 'issue430-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue430-fixture' });
  const context = (overrides = {}) => ({
    principal: sessions.authenticate({ headers: { authorization: `Bearer ${issued.token}` } }),
    origin: ORIGIN, csrfToken: issued.csrfToken, transport: 'https', ...overrides,
  });
  return { web, context };
}

const envelope = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'issue430-cmd-1', idempotencyKey: 'issue430-key-1',
  command: 'run_status', args: { runId: 'run-issue430' }, repoId: REPO_ID, origin: ORIGIN,
  ...overrides,
});

// The REAL swarm stack behind the web seam (the issue288 swarmFixture, plus the runtime ports a
// recruit needs so the first recruit of a seat actually binds): the refusing request crosses the
// served POST /v1/commands transport, exactly the lane the audit's `baton swarm stop` took.
function swarmFixture() {
  const directory = scratch('web-swarm');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => workers },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => {},
  });
  const application = {
    repoId: REPO_ID, card: applicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
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
  });
  const issued = sessions.issue({
    userId: 'issue430-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue430-fixture' });
  const principal = { actor: 'direct:issue430-root', principalId: 'issue430-root', sessionId: 'issue430-root' };
  let key = 0;
  const call = (command, args) => swarmRuntime.command(command,
    { swarmId: 's-issue430', idempotencyKey: `issue430-setup-${++key}`, ...args }, principal);
  return { coordination, web, swarmRuntime, issued, principal, call };
}

// ── the source scanner (requirement 5a): the literal codes `refuse(`/`integrity(` raise ──────

/** The second argument of every `refuse(`/`integrity(` call in one module source: the argument
 * list is split at paren-depth-0 commas with string and template literals skipped whole, and the
 * code must be a plain quoted literal (a non-literal is reported, never silently skipped). */
export function raisedRefusalCodes(rawSource) {
  const raised = new Map();
  const nonLiteral = [];
  // Comments are prose, not call sites: a `//` line or a `/* … */` block that mentions
  // `integrity(...)` (swarm-state.mjs documents its own audit rule that way, #395) is blanked
  // to spaces so offsets stay stable and the scan reads code only.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => ' '.repeat(match.length))
    .replace(/^[ \t]*\/\/.*$/gmu, (match) => ' '.repeat(match.length));
  for (const open of source.matchAll(/\b(?:refuse|integrity)\(/gu)) {
    // A helper DEFINITION (`function refuse(message, code) {`) is not a call site: its second
    // argument would read as the parameter name, so definitions are skipped, not reported.
    if (/function $/.test(source.slice(Math.max(0, open.index - 9), open.index))) continue;
    let cursor = open.index + open[0].length - 1; // on the opening paren
    const args = [];
    for (;;) {
      const start = cursor + 1;
      let depth = 0;
      let end = -1;
      for (let at = start; at < source.length; at += 1) {
        const character = source[at];
        if (character === "'" || character === '"' || character === '`') {
          const quote = character;
          at += 1;
          while (at < source.length && source[at] !== quote) {
            if (source[at] === '\\') at += 1;
            at += 1;
          }
          continue;
        }
        if (character === '(' || character === '[' || character === '{') depth += 1;
        else if (character === ')' || character === ']' || character === '}') {
          if (depth === 0) { end = at; break; }
          depth -= 1;
        } else if (character === ',' && depth === 0) { end = at; break; }
      }
      if (end === -1) break;
      args.push(source.slice(start, end).trim());
      if (source[end] === ')') break;
      cursor = end;
    }
    const literal = args[1]?.match(/^'([a-z][a-z0-9_]*)'$/);
    if (literal) raised.set(literal[1], (raised.get(literal[1]) ?? 0) + 1);
    else nonLiteral.push(source.slice(open.index, open.index + 72));
  }
  return { raised, nonLiteral };
}

const runtimeScan = raisedRefusalCodes(readFileSync(new URL('../src/swarm-runtime.mjs', import.meta.url), 'utf8'));
const stateScan = raisedRefusalCodes(readFileSync(new URL('../src/swarm-state.mjs', import.meta.url), 'utf8'));

// ── (a) the owner table covers every code the fold OR the runtime raises ─────────────────────

test('#430 (a): the owner table holds every refusal code swarm-runtime and swarm-state raise', () => {
  assert.notEqual(SWARM_REFUSAL_CODES, null,
    'impl/src/swarm-refusals.mjs must export SWARM_REFUSAL_CODES — the ONE closed set for the swarm family');
  // #598: the landing refusal is a TYPED FORWARD of the git authority's own integrate_ code
  // (swarm-runtime.mjs _refuseLanding), so the runtime's raise sites are no longer a literal
  // call-site census; a new diagnostic reports without one. The integrate_ rows in the owner
  // table are raised through that forward; every other row must still name a literal raiser.
  const forwarded = (code) => code.startsWith('integrate_');
  assert.ok(runtimeScan.raised.has('swarm_participant_not_found'), 'the scan reads the runtime the issue names');
  assert.ok(stateScan.raised.has('participant_not_found'), 'the scan reads the fold the issue names');

  const missing = [...new Set([...runtimeScan.raised.keys(), ...stateScan.raised.keys()])]
    .filter((code) => !forwarded(code) && !Object.hasOwn(SWARM_REFUSAL_CODES, code));
  assert.deepEqual(missing, [],
    'every raised code needs one owner row (an unmapped code crosses the web as temporarily_unavailable)');

  // The table is honest in BOTH directions for the codes that still spell their raiser: a row
  // claiming a raiser the module does not have is a stale invention, the same way #336 refuses
  // stale fold rows.
  const stale = Object.entries(SWARM_REFUSAL_CODES)
    .filter(([code, row]) => !forwarded(code) && !(
      (row.raisedBy.includes('fold') === stateScan.raised.has(code))
      && (row.raisedBy.includes('runtime') === runtimeScan.raised.has(code))))
    .map(([code, row]) => `${code} (raisedBy ${JSON.stringify(row.raisedBy)})`);
  assert.deepEqual(stale, [], 'every raisedBy claim must match where the code is actually raised');
});
test('#430 (b): every owner code crosses POST /v1/commands with its own code and status — never temporarily_unavailable', async () => {
  assert.notEqual(SWARM_REFUSAL_CODES, null, 'the owner table must exist first');
  for (const [code, row] of Object.entries(SWARM_REFUSAL_CODES)) {
    const { web, context } = fixture({ command: async () => {
      throw Object.assign(new Error(`issue430 refused: ${code}`), { code, detail: { field: 'workId' } });
    } });
    const response = await web.execute(context(), envelope({
      commandId: `issue430-${code}`, idempotencyKey: `issue430-${code}`,
    }));
    assert.equal(response.status, row.status, `${code}: crosses with its declared ${row.status} class`);
    assert.equal(response.body.error.code, code, `${code}: the code crosses as itself`);
    assert.notEqual(response.body.error.code, 'temporarily_unavailable', `${code}: never the transient row`);
    assert.equal(response.body.error.retryable, false, `${code}: a typed refusal is never retryable`);
  }
});

test('#430 (b): the web fold table is DERIVED from the owner — no hand-kept second table', () => {
  assert.notEqual(SWARM_REFUSAL_CODES, null, 'the owner table must exist first');
  const derived = Object.fromEntries(Object.entries(SWARM_REFUSAL_CODES)
    .filter(([, row]) => row.raisedBy.includes('fold'))
    .map(([code, row]) => [code, row.status]));
  assert.deepEqual(SWARM_FOLD_REFUSAL_HTTP_STATUS, derived,
    'SWARM_FOLD_REFUSAL_HTTP_STATUS must equal the owner table projected to the fold-raised codes');
});

test('#430 (b): the same-rule note names real rows, and each pair agrees on its HTTP class', () => {
  assert.notEqual(SWARM_REFUSAL_SAME_RULE_PAIRS, null,
    'the owner must name which spelling pairs are the same rule (the later collapse lane)');
  for (const [left, right] of SWARM_REFUSAL_SAME_RULE_PAIRS) {
    assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, left), `pair half ${left} is in the table`);
    assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, right), `pair half ${right} is in the table`);
    assert.equal(SWARM_REFUSAL_CODES[left].status, SWARM_REFUSAL_CODES[right].status,
      `pair ${left} / ${right} agrees on its HTTP class`);
  }
});

// ── (c) the three observed refusals cross the REAL served transport ──────────────────────────

test('#430 (c): swarm stop with an unknown participant crosses swarm_participant_not_found as 404', async () => {
  const { web, call, issued } = swarmFixture();
  await call('swarm.create', { purpose: 'issue430 live stop' });
  const response = await send(web, {
    path: '/v1/commands',
    body: envelope({
      commandId: 'issue430-stop-ghost', idempotencyKey: 'issue430-stop-ghost',
      command: 'swarm.stop',
      args: { swarmId: 's-issue430', participantId: 'ghost', reason: 'the audit stop', idempotencyKey: 'issue430-stop-ghost-args' },
    }),
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(response.status, 404, 'a stop naming no seat the swarm holds is a request fault, not a dead resident');
  assert.equal(response.body.error.code, 'swarm_participant_not_found', 'the runtime code crosses as itself');
  assert.equal(response.body.error.retryable, false, 'retrying an unknown participant can never succeed');
});

test('#430 (c): a second recruit of the same seat crosses swarm_participant_exists as 409', async () => {
  const { web, call, issued } = swarmFixture();
  await call('swarm.create', { purpose: 'issue430 live recruit' });
  await call('swarm.recruit', { participantId: 'seat-1', objective: 'work as seat-1' });
  const response = await send(web, {
    path: '/v1/commands',
    body: envelope({
      commandId: 'issue430-re-recruit', idempotencyKey: 'issue430-re-recruit',
      command: 'swarm.recruit',
      args: { swarmId: 's-issue430', participantId: 'seat-1', objective: 'work as seat-1 again', idempotencyKey: 'issue430-re-recruit-args' },
    }),
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(response.status, 409, 'the seat already exists — a state conflict, not a transient fault');
  assert.equal(response.body.error.code, 'swarm_participant_exists', 'the runtime code crosses as itself');
  assert.equal(response.body.error.retryable, false, 'retrying the same recruit refuses the same way');
});

test('#430 (c): the closed-swarm refusal crosses swarm_closed as 409', async () => {
  // The runtime's closed-swarm raise is the recruit guard (a plain swarm.update mutation does not
  // refuse on a closed swarm at this HEAD); the fold's spelling of the same rule, a second close,
  // is asserted beside it — both must cross typed.
  const { web, call, issued } = swarmFixture();
  await call('swarm.create', { purpose: 'issue430 live closed' });
  await call('swarm.update', { event: 'swarm.closed', payload: { swarmId: 's-issue430' } });
  const recruitResponse = await send(web, {
    path: '/v1/commands',
    body: envelope({
      commandId: 'issue430-closed-recruit', idempotencyKey: 'issue430-closed-recruit',
      command: 'swarm.recruit',
      args: { swarmId: 's-issue430', participantId: 'late-seat', objective: 'arrive after the close', idempotencyKey: 'issue430-closed-recruit-args' },
    }),
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(recruitResponse.status, 409, 'recruiting into a closed swarm is a state conflict');
  assert.equal(recruitResponse.body.error.code, 'swarm_closed', 'the runtime code crosses as itself');
  const reCloseResponse = await send(web, {
    path: '/v1/commands',
    body: envelope({
      commandId: 'issue430-re-close', idempotencyKey: 'issue430-re-close',
      command: 'swarm.update',
      args: { swarmId: 's-issue430', event: 'swarm.closed', payload: { swarmId: 's-issue430' }, idempotencyKey: 'issue430-re-close-args' },
    }),
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(reCloseResponse.status, 409, 'the fold spelling of the closed rule is a state conflict too');
  assert.equal(reCloseResponse.body.error.code, 'swarm_already_closed', 'the fold code crosses as itself');
});

// ── (d) the 503 fallthrough narrates the unmapped code and the command, once per code ─────────

test('#430 (d): an unmapped coded refusal is narrated on stderr once per code, naming the code and the command', async () => {
  let calls = 0;
  const { web, context } = fixture({ command: async () => {
    calls += 1;
    throw Object.assign(new Error('issue430 unmapped probe'), { code: 'issue430_unmapped_probe_code' });
  } });
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  let first;
  let second;
  try {
    first = await web.execute(context(), envelope({
      commandId: 'issue430-narrate-1', idempotencyKey: 'issue430-narrate-1',
    }));
    second = await web.execute(context(), envelope({
      commandId: 'issue430-narrate-2', idempotencyKey: 'issue430-narrate-2',
    }));
  } finally {
    process.stderr.write = original;
  }
  assert.equal(calls, 2, 'both dispatches reached the application');
  assert.equal(first.status, 503);
  assert.equal(first.body.error.code, 'temporarily_unavailable', 'the fallthrough row itself is unchanged');
  assert.equal(second.status, 503);
  const narrations = written.filter((line) => line.includes('issue430_unmapped_probe_code'));
  assert.equal(narrations.length, 1, `the unmapped code is narrated ONCE, got ${narrations.length}`);
  assert.match(narrations[0], /run_status/, 'the narration names the command that raised it');
});
