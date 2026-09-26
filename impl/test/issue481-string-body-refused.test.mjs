// Issue #481 — `swarm.contribution_recorded` admitted a body that is a JSON STRING.
//
// Observed at fed18071: a seat serialized its report one time more than the contract expects
// (`payload.body` was the report's JSON text, not the report), the runtime admitted it, the
// projection carried the string (a reader that folds it yields one key per character), and the
// root's landing loop — which reads `body.items` and `body.commit.sha` — had nothing to land.
//
// The repair has three halves, each pinned here over the REAL transport the incident crossed
// (the #430 web parity fixture) rather than a hand-built runtime call:
//   a  a body that is its own JSON document refuses typed at the contract — `swarm_command_invalid`
//      {field: payload.body, rule: object, admitted: the contribution report object, correction:
//      the report was JSON-encoded twice; pass the object} — and records NOTHING (no contribution,
//      no note); the same holds for the whole-payload spelling;
//   b  the report OBJECT is admitted and recorded, so the rule refuses the defect and not the verb;
//   c  a string body that already reached the ledger (the incident's own rows) projects as the
//      typed defect `{invalid: 'string_body', bytes}` on the view's contribution rows and on the
//      ONE exported derivation `run.contributions.read` answers — never as character-indexed keys;
//   d  `baton swarm update … --payload` refuses the same body at the parse, with the same remedy,
//      while the object payload and the plain-text note spelling parse unchanged;
//   e  the SDK carries the same refusal before the wire (it validates with the shared contract).
//
// Every await here is the served transport's own answer (#430's `send`): the fixture spawns no
// resident, no worker turn and no git, so no await rides the deployment settle chain docs/42 §8
// bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  CoordinationStore,
  WebNorthbound,
  WebSessionStore,
} from '../src/index.mjs';
import { SwarmRuntime, contributionLedgerRows } from '../src/swarm-runtime.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { createSwarms } from '../src/swarm-client.mjs';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue481-web';
const SWARM_ID = 's-issue481';
const SHA = 'a'.repeat(40);
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue481-${label}-`));
  roots.push(root);
  return root;
}

/** The report the contract admits — the #310 example shape, commit null so no git is spawned. */
const report = () => ({
  subject: 'Issue #481: the report body is the report',
  base: { observedHead: SHA, rebasedOnto: SHA },
  commit: null,
  items: [{
    id: 'report-body', status: 'delivered', change: 'Refuse a body that is its own JSON document',
    files: ['impl/src/swarm-contract.mjs'], test: 'node --test test/issue481-string-body-refused.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});
/** The incident's body: the report serialized once more than the contract expects. */
const encodedReport = () => JSON.stringify(report());

/** The refusal text both the contract and the CLI render — the admitted form and the remedy. */
const ADMITTED = 'the contribution report object (subject, commit, items, verification, needsFromOthers)';
const REMEDY = /the report was JSON-encoded twice; pass the object/u;

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
  return { schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) };
}

/** The REAL swarm stack behind the served web seam (the #430 `swarmFixture`), so the body rule is
 * exercised on the lane the seat's publish really crossed, not on a direct runtime call. */
function fixture() {
  const directory = scratch('web-swarm');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => ({}),
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
    userId: 'issue481-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue481-fixture' });
  const principal = { actor: 'direct:issue481-root', principalId: 'issue481-root', sessionId: 'issue481-root' };
  let key = 0;
  const call = (command, args) => swarmRuntime.command(command,
    { swarmId: SWARM_ID,
      ...(['swarm.view', 'swarm.watch', 'swarm.list'].includes(command) ? {} : { idempotencyKey: `issue481-setup-${++key}` }),
      ...args }, principal);
  return { coordination, web, swarmRuntime, issued, principal, call };
}

const envelope = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'issue481-cmd-1', idempotencyKey: 'issue481-key-1',
  command: 'swarm.update', args: {}, repoId: REPO_ID, origin: ORIGIN,
  ...overrides,
});

/** The served transport's answer to one `swarm.update`, with the seat's publish attributed to the
 * recruited builder (the runtime refuses a contribution that names another author). */
async function publish(f, payload, { event = 'swarm.contribution_recorded', suffix = 'publish' } = {}) {
  return send(f.web, {
    path: '/v1/commands',
    body: envelope({
      commandId: `issue481-${suffix}`, idempotencyKey: `issue481-${suffix}`,
      args: { swarmId: SWARM_ID, event, payload, idempotencyKey: `issue481-${suffix}-args` },
    }),
    headers: { authorization: `Bearer ${f.issued.token}` },
  });
}

/** The fixture's seat, recruited so the fold holds its participant row. */
async function recruited(f) {
  await f.call('swarm.create', { purpose: 'Issue #481: the report body is the report' });
  await f.call('swarm.recruit', { participantId: 'builder', objective: 'publish the lane report' });
  return f;
}

const rowsOf = (view) => view.contributions ?? [];

// ── (a) a body that is its own JSON document refuses typed, and records nothing ────────────────

test('#481 (a): a JSON-string body refuses typed with the remedy, on the lane the seat publishes through', async () => {
  const f = await recruited(fixture());
  const payload = { contributionId: 'c-encoded', participantId: 'builder', body: encodedReport() };
  // The seat's own lane (the SDK/direct port, and the native bridge over it): the refusal IS the
  // contract's, field, rule, admitted form and remedy included.
  const direct = await f.call('swarm.update', { event: 'swarm.contribution_recorded', payload })
    .then(() => null, (error) => error);
  assert.equal(direct?.code, 'swarm_command_invalid', 'the contract refuses the encoded body by code');
  assert.deepEqual(direct?.detail, {
    field: 'payload.body', rule: 'object', admitted: ADMITTED,
    correction: 'the report was JSON-encoded twice; pass the object',
  }, 'the refusal names the field, the rule, the admitted form and the one-line remedy');
  assert.match(direct?.message ?? '', REMEDY, 'and the remedy rides the refusal message');
  // The served web transport (the lane the incident's rows crossed) crosses the same code and the
  // same message. Issue #485 closed the gap this row used to record: the pre-dispatch argument arm
  // carried the cause's own `field` and `detail` instead of re-deriving the field from the request
  // shape, so the contract's teaching crosses the wire intact.
  const response = await publish(f, payload);
  assert.equal(response.status, 400, 'a body that is not the report is a request fault, not a dead resident');
  assert.equal(response.body.error.code, 'swarm_command_invalid', 'the contract code crosses as itself');
  assert.equal(response.body.error.field, 'payload.body',
    'and the field the contract\'s check named, never the first declared argument the caller omitted');
  assert.deepEqual(response.body.error.detail, direct?.detail,
    'the contract\'s own teaching crosses with it — the rule, the admitted form and the remedy');
  assert.match(response.body.error.message, REMEDY, 'with the remedy on the message a web caller reads');
  assert.match(response.body.error.message, /the contribution report object/u, 'and the admitted form');
  // Nothing landed: the defect is refused BEFORE the note translation and before any fold row.
  assert.deepEqual(Object.keys(f.coordination.swarm(SWARM_ID).contributions), [],
    'no contribution row lands for a refused body');
  assert.deepEqual(
    f.coordination.eventsView().filter((event) => event.payload?.kind === 'swarm.note_recorded'),
    [], 'and the note translation never records the encoded body as a note');
});

test('#481 (a): the whole payload as the report JSON string refuses the same way', async () => {
  const f = await recruited(fixture());
  const direct = await f.call('swarm.update', { event: 'swarm.contribution_recorded', payload: encodedReport() })
    .then(() => null, (error) => error);
  assert.equal(direct?.code, 'swarm_command_invalid');
  assert.equal(direct?.detail?.field, 'payload', 'the string payload itself is the field that failed');
  assert.equal(direct?.detail?.admitted, ADMITTED);
  assert.match(direct?.message ?? '', REMEDY);
  const response = await publish(f, encodedReport());
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'swarm_command_invalid');
  assert.match(response.body.error.message, REMEDY);
  assert.deepEqual(Object.keys(f.coordination.swarm(SWARM_ID).contributions), []);
});

// ── (b) the report object is admitted, so the rule refuses the defect and not the verb ──────────

test('#481 (b): the report object is recorded and projects its contract', async () => {
  const f = await recruited(fixture());
  const body = report();
  const response = await publish(f, { contributionId: 'c-report', participantId: 'builder', body }, { suffix: 'object' });
  assert.equal(response.status, 200, 'the object body is the admitted form');
  assert.equal(response.body.result?.receipt?.event?.kind, 'swarm.contribution_recorded',
    'the receipt names the recorded contribution');
  const view = await f.call('swarm.view', {});
  const row = rowsOf(view).find((entry) => entry.contributionId === 'c-report');
  assert.ok(row, 'the contribution row is projected');
  assert.equal(row.contract?.subject, body.subject, 'and it carries the contract the root lands');
  assert.deepEqual(row.body, body, 'the stored body is the report itself, byte for byte');
});

// ── (c) a string body that already reached the ledger projects as the typed defect ─────────────

test('#481 (c): a ledger string body projects {invalid: string_body, bytes}, never character-indexed keys', async () => {
  const f = await recruited(fixture());
  const encoded = encodedReport();
  // The incident's own row: recorded before the rule existed, so it is written straight to the
  // ledger — exactly how the three rows at seq 186528/186538/186548 came to exist.
  f.coordination.recordSwarm('swarm.contribution_recorded', {
    swarmId: SWARM_ID, contributionId: 'c-legacy', participantId: 'builder', body: encoded,
  }, { actor: 'worker:w-1', key: 'issue481-legacy-row' });
  const view = await f.call('swarm.view', { projection: 'contributions' });
  const row = rowsOf(view).find((entry) => entry.contributionId === 'c-legacy');
  assert.ok(row, 'the legacy row is projected — a view never refuses recorded history');
  assert.deepEqual(row.body, { invalid: 'string_body', bytes: Buffer.byteLength(encoded) },
    'the string body projects as the typed defect with its size');
  assert.equal(Object.hasOwn(row.body, '0'), false, 'never a character-indexed object');
  // The SAME derivation `run.contributions.read` answers says so too: a reviewer reads the defect
  // and its size, and the summary is absent rather than 670 characters of JSON.
  const [ledgerRow] = contributionLedgerRows(f.coordination.swarm(SWARM_ID));
  assert.equal(ledgerRow.contributionId, 'c-legacy');
  assert.deepEqual(ledgerRow.body, { invalid: 'string_body', bytes: Buffer.byteLength(encoded) });
  assert.equal(ledgerRow.summary, null, 'a defect body has no readable summary');
});

test('#481 (c): a note the old spelling swallowed projects the defect, and plain text stays readable', async () => {
  const f = await recruited(fixture());
  const encoded = encodedReport();
  // The incident's OTHER shape: the same publish without a contribution identity, which the note
  // translation recorded as `swarm.note_recorded` — a note row inside the same contributions
  // collection, written straight to the ledger here the way the pre-rule rows were.
  f.coordination.recordDriver('swarm.note_recorded',
    { swarmId: SWARM_ID, participantId: 'builder', body: encoded },
    { actor: 'worker:w-1', key: 'issue481-note-defect' });
  f.coordination.recordDriver('swarm.note_recorded',
    { swarmId: SWARM_ID, participantId: 'builder', body: 'just a passing note' },
    { actor: 'worker:w-1', key: 'issue481-note-prose' });
  f.coordination.recordSwarm('swarm.contribution_recorded', {
    swarmId: SWARM_ID, contributionId: 'c-prose', participantId: 'builder', body: 'First slice.',
  }, { actor: 'worker:w-1', key: 'issue481-prose-row' });
  const view = await f.call('swarm.view', { projection: 'contributions' });
  const notes = rowsOf(view).filter((entry) => entry.kind === 'note');
  assert.equal(notes.length, 2, 'both note rows are projected');
  assert.deepEqual(notes.find((entry) => typeof entry.body === 'object')?.body,
    { invalid: 'string_body', bytes: Buffer.byteLength(encoded) },
    'the swallowed report reads as the typed defect');
  assert.equal(notes.find((entry) => typeof entry.body === 'string')?.body, 'just a passing note',
    'and the note text a peer really wrote reads as itself');
  const row = rowsOf(view).find((entry) => entry.contributionId === 'c-prose');
  assert.equal(row.body, 'First slice.', 'the long-standing text finding is not a defect');
  const [ledgerRow] = contributionLedgerRows(f.coordination.swarm(SWARM_ID));
  assert.equal(ledgerRow.summary, 'First slice.', 'and it stays the row summary');
});

// ── (d) the CLI refuses the same body at the parse, with the same text ─────────────────────────

const refused = (fn) => {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
};

test('#481 (d): swarm update --payload refuses the encoded body at the parse with the same remedy', () => {
  const error = refused(() => parseBatonCli(['swarm', 'update', SWARM_ID, 'swarm.contribution_recorded',
    '--payload', JSON.stringify({ body: encodedReport() })]));
  assert.match(error.message, REMEDY, 'the parse prints the contract\'s own remedy');
  assert.equal(error.detail?.field, '--payload', 'the refusal names the flag the caller typed');
  assert.equal(error.detail?.rule, 'object');
  assert.equal(error.detail?.admitted, ADMITTED, 'and the same admitted form the contract names');
});

test('#481 (d): the honest payloads parse unchanged — the report object, and the note spelling', () => {
  const parsed = parseBatonCli(['swarm', 'update', SWARM_ID, 'swarm.contribution_recorded',
    '--payload', JSON.stringify({ contributionId: 'c-report', participantId: 'builder', body: report() })]);
  assert.equal(parsed.name, 'swarm.update');
  assert.deepEqual(parsed.args.payload.body, report(), 'the report object crosses whole');
  const note = parseBatonCli(['swarm', 'update', SWARM_ID, 'swarm.contribution_recorded',
    '--payload', JSON.stringify({ body: 'just a passing note' })]);
  assert.equal(note.args.payload.body, 'just a passing note', 'a plain-text note is not the defect');
  const context = parseBatonCli(['swarm', 'update', SWARM_ID, 'swarm.context_updated',
    '--payload', JSON.stringify({ key: 'notes', body: '{"any":"JSON"}' })]);
  assert.equal(context.args.payload.body, '{"any":"JSON"}',
    'the whiteboard entry stays arbitrary JSON — its schema declares it so (#427)');
});
