// Issue #474 — `baton swarm recruit … --options '{"exact":{…},"scope":[]}'` answered
// `application_client_invalid: application precondition failed` (HTTP 400) twice, while the same
// recruit with one scope path was admitted. The caller learned no field, no rule and no remedy:
// the empty `scope` was indistinguishable from a bad `resultIntent`.
//
// The cause: the recruit hands its Run selection to the deployment's `prepareRun`, whose own
// preflight refuses with a bare coded `application_*` error (no `detail`), and the web layer's
// generic `application_*` branch (impl/src/web-northbound.mjs) crosses exactly that shape as the
// fixed text "application precondition failed".
//
// What this suite pins, on the REAL stack — a real CoordinationStore behind a real WebNorthbound,
// a real SwarmRuntime wired to the deployment's OWN preflight (`prepareRunStart`, the pure Run
// intent the client sends on run.start), the real CLI parser and the real CLI web client:
//
//   474-a  a contributing seat's empty scope refuses typed: field `options.scope`, rule
//          `non_empty`, the admitted form, the read-only alternative — never the generic text;
//   474-b  a `read_only` seat's empty scope is ADMITTED (it claims nothing) and is carried as NO
//          scope at all — no scope on the join, no scope claim, no scope on the run's options;
//   474-c  every other recruit precondition this verb owns refuses typed through the same
//          transport (table-driven), each with field, rule and the admitted/expected form;
//   474-d  the negative pin: no recruit refusal crosses as the web layer's generic text — the
//          preflight's own refusals are the only ones left, and even those cross with a teaching
//          record (a drifted bare `application_*` refusal, and the deployment's profile-scope
//          refusal) while a refusal that already teaches (the #335 route table) crosses verbatim;
//   474-e  the recruit's OWN option legs (`prefer` #444, `routeProbe` #456) never reach the
//          deployment's closed option set — a leaked `prefer` used to make the deployment's own
//          preflight refuse the very recruit the axis was meant to order;
//   474-f  the preflight's judgement IS the deployment's Run-start grammar: for a table of
//          selections, "the recruit admits it" and "`prepareRunStart` admits it" never disagree;
//   474-g  the SDK's own recruit preconditions (`swarm-client.mjs`) teach the same way;
//   474-h  the CLI's own `--options` refusal is typed like #431's argv refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { scopeClaimId } from '../src/swarm-state.mjs';
import { prepareRunStart } from '../src/application-client.mjs';
import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { createSwarms } from '../src/swarm-client.mjs';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue474';
const SWARM_ID = 's-474';
const OBJECTIVE = 'Do the lane work';
const ROUTE = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low' });
const OWNER = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });

/** The deployment's own Run-start preflight, wired exactly where production wires it
 * (application.mjs `prepareRun`): the pure Run intent the client sends on run.start. This is the
 * mint site of the refusal #474 is about — red-before rows show it crossing untaught. */
const deploymentPreflight = async ({ runId, objective, options }) =>
  prepareRunStart(objective, { ...options, runId });

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue474-${label}-`));
  roots.push(root);
  return root;
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

/** The REAL stack: a real coordination store, a real swarm runtime whose `prepareRun` is the
 * deployment's own preflight, the real web bus, and the real CLI client over it. Every response the
 * transport produced is recorded beside the client, so a row can read the WIRE status and the typed
 * refusal the CLI threw for the same exchange. */
function fixture(t, { prepareRun = deploymentPreflight } = {}) {
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const workers = [];
  const prepared = [];
  const started = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => true,
    prepareRun: async (request, principal) => {
      prepared.push(request);
      return prepareRun(request, principal);
    },
    startRun: async (request) => {
      started.push(request);
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({
        id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working',
      });
    },
    stopRun: async () => ({ state: 'closed' }),
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: [] }),
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({
      schemaVersion: 1, repoId: REPO_ID,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
      // The CLI pre-checks a recruit's exact route against the served table (#335 (d)); the
      // deployment's own card carries it.
      readiness: { schemaVersion: 1, ready: true, routes: [{ ...ROUTE, state: 'ready' }] },
    }),
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
  });
  const issued = sessions.issue({
    userId: 'issue474-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID],
    ttlMs: 600_000,
  }, { actor: 'issue474-fixture' });
  const wire = [];
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      const response = await send(web, {
        method: init.method ?? 'GET', path: `${parsed.pathname}${parsed.search}`,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        headers: init.headers ?? {},
      });
      wire.push({ status: response.status, body: response.body });
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        text: async () => response.rawBody ?? '',
      };
    },
    clock: () => NOW, sleep: async () => {},
  });
  const create = () => swarmRuntime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue474', idempotencyKey: 'issue474:create',
  }, OWNER);
  return { coordination, swarmRuntime, web, client, wire, prepared, started, workers, create, issued };
}

const recruitArgv = (seat, extra = []) => ['swarm', 'recruit', SWARM_ID, seat, OBJECTIVE, ...extra];
const optionsFlag = (selection) => ['--options', JSON.stringify(selection)];

/** Run one recruit through the real CLI: the parser, the CLI client and the served POST
 * /v1/commands transport — the lane the issue's two refusals took. */
async function recruit(f, seat, extra = []) {
  const parsed = parseBatonCli(recruitArgv(seat, extra));
  return runBatonCli(parsed, f.client);
}

async function refusalOf(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

const refusalRows = (coordination) => coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.operation_refused');

const seatRow = (coordination, seat) => coordination.swarm(SWARM_ID).participants[seat] ?? null;
const joinOf = (coordination, seat) => coordination.eventsView()
  .find((event) => event.kind === 'swarm.participant_joined'
    && event.payload?.participantId === seat) ?? null;

/** The teaching record the wire carried, read the way the CLI reads it: the wire error object rides
 * `error.detail` (#231), and the refusal's own record is nested inside it. */
const wireOf = (error) => error?.detail ?? null;
const teachingOf = (error) => wireOf(error)?.detail ?? null;
const crossedText = (error) => `${error?.message ?? ''} ${wireOf(error)?.message ?? ''}`;

const GENERIC_TEXTS = ['application precondition failed', 'application state conflict',
  'application command forbidden', 'goal/plan precondition failed'];

// ── 474-a: a contributing seat's empty scope refuses typed ──────────────────────────────────────

test('474-a: a contributing seat with an empty scope refuses typed — field, rule, admitted form', async (t) => {
  const f = fixture(t);
  await f.create();

  const error = await refusalOf(recruit(f, 'lane-empty', optionsFlag({ exact: ROUTE, scope: [] })));
  assert.equal(error.code, 'swarm_command_invalid', 'the refusal is a swarm command-shape refusal');
  assert.equal(error.field, 'options.scope', 'the wire names the field the caller must change');
  assert.equal(teachingOf(error)?.field, 'options.scope');
  assert.equal(teachingOf(error)?.rule, 'non_empty', 'the rule that refused is named');
  assert.equal(teachingOf(error)?.admitted, 'one or more repository paths',
    'the admitted form is named');
  assert.match(error.message, /options\.scope/u, 'the message names the offending option');
  assert.match(error.message, /read_only/u, 'the read-only alternative is offered in the message');
  assert.match(error.message, /HTTP 400/u, 'the request-shape class crosses as 400');
  for (const generic of GENERIC_TEXTS) {
    assert.equal(crossedText(error).includes(generic), false, `never the fixed text "${generic}"`);
  }
  // The wire's own answer carries the same record (the CLI lifted it).
  assert.deepEqual(wireOf(error)?.detail, teachingOf(error));
  assert.equal(f.wire.at(-1).status, 400);

  assert.equal(seatRow(f.coordination, 'lane-empty'), null, 'no seat joined on a refused recruit');
  assert.equal(f.started.length, 0, 'no run started on a refused recruit');
  const rows = refusalRows(f.coordination);
  assert.equal(rows.length, 1, 'the refusal landed on the durable refusal lane');
  assert.equal(rows[0].payload.code, 'swarm_command_invalid');
  assert.equal(rows[0].payload.field, 'options.scope');
  assert.equal(rows[0].payload.rule, 'non_empty',
    'a watcher learns the field AND the rule, not merely that something was refused');
});

// ── 474-b: a read_only seat's empty scope is admitted ───────────────────────────────────────────

test('474-b: a read_only seat claims nothing — an empty scope is admitted and carried as no scope', async (t) => {
  const f = fixture(t);
  await f.create();

  const result = await recruit(f, 'lane-readonly',
    [...optionsFlag({ exact: ROUTE, scope: [] }), '--mode', 'read_only']);

  assert.equal(result?.runId, seatRow(f.coordination, 'lane-readonly')?.runId,
    'the recruit was admitted and its receipt names the seat run');
  const view = await f.swarmRuntime.command('swarm.view', { swarmId: SWARM_ID }, OWNER);
  assert.equal(view.participants.find((row) => row.participantId === 'lane-readonly')?.mode, 'read_only',
    'the view projects the seat\'s mode (#373)');
  const join = joinOf(f.coordination, 'lane-readonly');
  assert.equal('scope' in join.payload, false, 'a claims-nothing seat joins with NO scope field');
  assert.equal(join.payload.mode, 'read_only');
  assert.equal(Object.hasOwn(f.coordination.swarm(SWARM_ID).claims, scopeClaimId('lane-readonly')), false,
    'no scope claim is written for a seat that claims nothing');
  assert.deepEqual(result.scopeOverlap, [], 'nothing overlaps a scope nobody claimed');
  // The run the seat was started under: the read-only intent, and no empty scope leaked into it.
  const started = f.started.at(-1);
  assert.equal(started.options.resultIntent, 'read_only_evidence');
  assert.equal('scope' in started.options, false, 'the empty scope is never handed to the deployment');
  assert.equal('scope' in f.prepared.at(-1).options, false);
});

test('474-b2: the same empty scope on a contributing seat is still refused — the decision is the mode', async (t) => {
  const f = fixture(t);
  await f.create();
  const refused = await refusalOf(recruit(f, 'lane-change', optionsFlag({ exact: ROUTE, scope: [] })));
  assert.equal(teachingOf(refused)?.rule, 'non_empty');
  assert.equal(seatRow(f.coordination, 'lane-change'), null);
});

// ── 474-c: every other recruit precondition, table-driven through the transport ─────────────────

const PRECONDITIONS = Object.freeze([
  {
    id: 'unknown option key',
    selection: { exact: ROUTE, bogus: 1 },
    field: 'options.bogus', rule: 'unknown-field',
  },
  {
    id: 'blank profile',
    selection: { exact: ROUTE, profile: '   ' },
    field: 'options.profile', rule: 'non_empty',
  },
  {
    id: 'unknown result intent',
    selection: { exact: ROUTE, resultIntent: 'read_only' },
    field: 'options.resultIntent', rule: 'closed-set',
  },
  {
    id: 'exact route naming an axis that is not a route axis',
    selection: { exact: { harness: 'omp', model: 'deepseek/deepseek-flash', vendor: 'x' } },
    field: 'options.exact', rule: 'closed-set',
  },
  {
    id: 'exact route that is not an object',
    selection: { exact: 'omp/deepseek/deepseek-flash@low' },
    field: 'options.exact', rule: 'closed-set',
  },
  {
    id: 'exact route combined with selectors',
    selection: { exact: ROUTE, model: 'deepseek/deepseek-flash' },
    field: 'options.exact', rule: 'exclusive-with',
  },
  {
    id: 'model without effort',
    selection: { model: 'deepseek/deepseek-flash' },
    field: 'options.effort', rule: 'required-with',
  },
  {
    id: 'harness without model or effort',
    selection: { harness: 'omp' },
    field: 'options.model', rule: 'required-with',
  },
  {
    id: 'scope that is not an array',
    selection: { exact: ROUTE, scope: 'docs/39-swarm-runtime.md' },
    field: 'options.scope', rule: 'field-predicate',
  },
  {
    id: 'scope with a duplicate path',
    selection: { exact: ROUTE, scope: ['docs/a.md', 'docs/a.md'] },
    field: 'options.scope', rule: 'field-predicate',
  },
  {
    id: 'scope past its ceiling',
    selection: { exact: ROUTE, scope: Array.from({ length: 65 }, (_, index) => `docs/${index}.md`) },
    field: 'options.scope', rule: 'field-predicate',
  },
  {
    id: 'scope entry the intent cannot carry',
    selection: { exact: ROUTE, scope: [`docs/${'a'.repeat(4097)}.md`] },
    field: 'options.scope', rule: 'field-predicate',
  },
  {
    id: 'empty wave roster',
    selection: { exact: ROUTE, waveStart: { roster: [], idempotencyKey: 'wave-1' } },
    field: 'options.waveStart', rule: 'closed-set',
  },
  {
    id: 'wave start with an unknown field',
    selection: { exact: ROUTE, waveStart: { roster: ['a'], idempotencyKey: 'wave-1', bogus: true } },
    field: 'options.waveStart', rule: 'closed-set',
  },
  {
    // The #444 axis already refused typed; it is pinned here so the recruit's option vocabulary
    // gains no second, untaught spelling.
    id: 'unknown route preference axis',
    selection: { harness: 'omp', prefer: 'cheap' },
    field: 'options.prefer', rule: 'closed-set',
  },
]);

test('474-c: every other recruit precondition crosses typed with field, rule and the admitted form', async (t) => {
  const f = fixture(t);
  await f.create();
  const crossed = [];
  for (const [index, row] of PRECONDITIONS.entries()) {
    const seat = `lane-${index}`;
    const error = await refusalOf(recruit(f, seat, optionsFlag(row.selection)));
    const wire = wireOf(error);
    const teaching = teachingOf(error);
    assert.equal(error.code, 'swarm_command_invalid', `${row.id}: the typed command refusal`);
    assert.equal(error.field, row.field, `${row.id}: the wire names the field`);
    assert.equal(teaching?.field, row.field, `${row.id}: the teaching names the field`);
    assert.equal(teaching?.rule, row.rule, `${row.id}: the teaching names the rule`);
    assert.ok(teaching?.admitted !== undefined || teaching?.expectation !== undefined,
      `${row.id}: the teaching names the admitted form or the predicate it failed`);
    assert.ok(typeof error.message === 'string' && error.message.includes(row.field),
      `${row.id}: the message names the field`);
    for (const generic of GENERIC_TEXTS) {
      assert.equal(crossedText(error).includes(generic), false,
        `${row.id}: never the fixed text "${generic}"`);
    }
    assert.equal(seatRow(f.coordination, seat), null, `${row.id}: no seat joined`);
    assert.equal(f.wire.at(-1).status, 400, `${row.id}: a request-shape refusal crosses as 400`);
    crossed.push({ id: row.id, code: error.code, field: error.field, rule: teaching.rule });
  }
  assert.equal(crossed.length, PRECONDITIONS.length);
});

// ── 474-d: the negative pin and the deployment's own preflight refusals ─────────────────────────

test('474-d1: no recruit precondition crosses as the web layer\'s generic application text', async (t) => {
  const f = fixture(t);
  await f.create();
  const selections = [{ exact: ROUTE, scope: [] }, ...PRECONDITIONS.map((row) => row.selection)];
  for (const selection of selections) {
    const error = await refusalOf(recruit(f, 'lane-pin-' + String(selections.indexOf(selection)),
      optionsFlag(selection)));
    const wire = wireOf(error);
    assert.ok(wire !== null, 'every refusal crossed as a typed wire error');
    assert.ok(Object.keys(teachingOf(error) ?? {}).length > 0,
      'every crossed recruit refusal carries its own teaching record');
    assert.ok(typeof wire.field === 'string' && wire.field.length > 0, 'and names its field');
    assert.equal(f.wire.at(-1).body.error.message === 'application precondition failed', false,
      'the generic branch is unreachable from the recruit path');
  }
});

test('474-d2: a deployment preflight refusal that teaches nothing still crosses with a teaching record', async (t) => {
  // A drifted deployment preflight — a bare coded application refusal, the exact shape #474 is
  // about: the runtime attaches the teaching the mint site owed, and the mint's own code and
  // message cross verbatim.
  const f = fixture(t, {
    prepareRun: async () => {
      throw Object.assign(new Error('Run scope is invalid'), { code: 'application_client_invalid' });
    },
  });
  await f.create();
  const error = await refusalOf(recruit(f, 'lane-drift', optionsFlag({ exact: ROUTE })));
  assert.equal(error.code, 'application_client_invalid', 'the deployment\'s own code is preserved');
  assert.match(error.message, /Run scope is invalid/u, 'and its own message, verbatim');
  assert.equal(error.field, 'options');
  assert.equal(teachingOf(error)?.rule, 'run-selection');
  assert.equal(teachingOf(error)?.cause?.code, 'application_client_invalid');
  for (const generic of GENERIC_TEXTS) {
    assert.equal(crossedText(error).includes(generic), false, `never the fixed text "${generic}"`);
  }
});

test('474-d3: the deployment\'s profile-scope refusal crosses with the field and rule it owed', async (t) => {
  const f = fixture(t, {
    prepareRun: async () => {
      throw Object.assign(new Error('Requested scope is outside the deployment profile'),
        { code: 'application_scope_not_allowed' });
    },
  });
  await f.create();
  const error = await refusalOf(recruit(f, 'lane-profile',
    optionsFlag({ exact: ROUTE, scope: ['src/outside-profile.mjs'] })));
  assert.equal(error.code, 'application_scope_not_allowed', 'the code the deployment minted');
  assert.equal(error.field, 'options.scope');
  assert.equal(teachingOf(error)?.rule, 'within-deployment-profile');
  assert.match(teachingOf(error)?.correction ?? '', /options\.scope/u);
});

test('474-d4: a refusal that already teaches crosses byte-identically — the teaching is never re-spelled', async (t) => {
  const detail = Object.freeze({
    field: 'options.exact', requested: { harness: 'nope', model: 'nope', effort: 'low' },
    grammar: 'HARNESS/MODEL@EFFORT',
    served: [{ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low', state: 'ready' }],
  });
  const f = fixture(t, {
    prepareRun: async () => {
      throw Object.assign(new Error('requested route is outside the deployment profile'),
        { code: 'application_route_not_allowed', detail });
    },
  });
  await f.create();
  const error = await refusalOf(recruit(f, 'lane-taught', optionsFlag({ exact: ROUTE })));
  assert.equal(error.code, 'application_route_not_allowed');
  assert.equal(error.field, 'options.exact');
  assert.deepEqual(teachingOf(error), detail, 'the mint site\'s own record rides the wire unchanged');
});

// ── 474-e: the recruit's own option legs never reach the deployment ─────────────────────────────

test('474-e: `prefer` and `routeProbe` are the recruit\'s own legs — the deployment never sees them', async (t) => {
  const f = fixture(t);
  await f.create();
  await recruit(f, 'lane-legs', optionsFlag({ exact: ROUTE, prefer: 'quality', routeProbe: true }));
  const preparedOptions = f.prepared.at(-1)?.options ?? {};
  assert.equal('prefer' in preparedOptions, false,
    'a leaked `prefer` made the deployment\'s closed option set refuse the recruit');
  assert.equal('routeProbe' in preparedOptions, false);
  assert.deepEqual(preparedOptions.exact, ROUTE, 'the selection itself is untouched');
  assert.equal('prefer' in (f.started.at(-1)?.options ?? {}), false);
  assert.equal(seatRow(f.coordination, 'lane-legs')?.status, 'active');
});

// ── 474-f: the preflight IS the deployment's Run-start grammar ──────────────────────────────────

test('474-f: the recruit\'s judgement and the deployment\'s Run-start grammar never disagree', async (t) => {
  const f = fixture(t, { prepareRun: (request) => request });
  await f.create();
  const selections = [
    {}, { scope: ['docs/a.md'] }, { scope: [] }, { scope: ['a.md', 'a.md'] }, { scope: 'docs/a.md' },
    { scope: [1] }, { scope: ['a'.repeat(4097)] },
    { exact: { ...ROUTE } }, { exact: { ...ROUTE, model: 'x' } },
    { exact: { ...ROUTE }, model: ROUTE.model }, { exact: { harness: 'omp', vendor: 'x' } },
    { model: ROUTE.model }, { harness: 'omp' }, { harness: 'omp', effort: 'low' },
    { model: ROUTE.model, effort: ROUTE.effort }, { harness: 'omp', model: ROUTE.model, effort: ROUTE.effort },
    { resultIntent: 'change' }, { resultIntent: 'read_only_evidence' }, { resultIntent: 'nope' },
    { profile: '' }, { profile: 'impl' }, { driverKind: 'inline' }, { bogus: 1 },
    { waveStart: { roster: ['a'], idempotencyKey: 'wave-1' } }, { waveStart: { roster: [] } },
    { waveStart: { roster: ['a'], idempotencyKey: 'wave-1', extra: 1 } },
  ];
  for (const [index, selection] of selections.entries()) {
    let deployment = null;
    try { prepareRunStart(OBJECTIVE, { ...selection, runId: 'run-474-f' }); } catch (error) { deployment = error; }
    // The runtime is the judgement under test — the CLI's own route pre-check (#335 (d)) would
    // answer for a served-route mistake before the grammar is ever reached.
    let recruitError = null;
    try {
      await f.swarmRuntime.command('swarm.recruit', {
        swarmId: SWARM_ID, participantId: `lane-mirror-${index}`, objective: OBJECTIVE,
        options: selection, idempotencyKey: `issue474-mirror-${index}`,
      }, OWNER);
    } catch (error) { recruitError = error; }
    if (deployment === null) {
      assert.equal(recruitError, null,
        `selection ${JSON.stringify(selection)} is admitted by the Run-start grammar and must be admitted here`);
    } else {
      assert.ok(recruitError !== null,
        `selection ${JSON.stringify(selection)} is refused by the Run-start grammar and must refuse here`);
      assert.equal(recruitError.code, 'swarm_command_invalid',
        `selection ${JSON.stringify(selection)} refuses in the swarm family's own vocabulary`);
      assert.ok(Object.keys(recruitError.detail ?? {}).length > 0);
    }
  }
});

test('474-f2: the ONE documented divergence — an INCOMPLETE exact route is a prefix, never a refusal here', async (t) => {
  // `{exact: {harness}}` names a family: the comparison reads it as a prefix (and, on a host with a
  // served route table, resolves it — see #341), so the recruit admits it and the deployment
  // resolves the missing axes on a host that has none. That divergence is deliberate and pinned
  // here, so it can never be mistaken for a lost teaching: the deployment's refusal still crosses
  // typed through the boundary teaching (`withRecruitPreflightTeaching`), never bare.
  const f = fixture(t, { prepareRun: (request) => request });
  await f.create();
  const incomplete = { exact: { harness: 'omp' } };
  assert.throws(() => prepareRunStart(OBJECTIVE, { ...incomplete, runId: 'run-474-f2' }),
    'the deployment\'s own Run-start grammar refuses an incomplete exact route');
  await f.swarmRuntime.command('swarm.recruit', {
    swarmId: SWARM_ID, participantId: 'lane-family', objective: OBJECTIVE,
    options: incomplete, idempotencyKey: 'issue474-family',
  }, OWNER);
  assert.equal(seatRow(f.coordination, 'lane-family')?.route, null,
    'an incomplete selector is never padded into a recorded route');
});

// ── 474-g: the SDK's own recruit preconditions ──────────────────────────────────────────────────

test('474-g: the SDK\'s recruit preconditions teach field, rule and admitted values', async () => {
  const swarm = createSwarms({ command: async () => ({ swarmId: SWARM_ID }) }).open(SWARM_ID);

  const mixed = syncRefusalOf(() => swarm.recruit('lane-a', OBJECTIVE,
    { options: { exact: ROUTE }, scope: ['docs/a.md'] }));
  assert.equal(mixed.code, 'application_client_invalid');
  assert.equal(mixed.detail?.field, 'options');
  assert.equal(mixed.detail?.rule, 'exclusive');
  assert.deepEqual(mixed.detail?.admitted,
    ['one nested options object', 'the direct selection fields (exact, harness, model, effort, scope, profile, resultIntent)'],
    'the two admitted spellings are named');

  const unknown = syncRefusalOf(() => swarm.recruit('lane-b', OBJECTIVE, { bogus: 1 }));
  assert.equal(unknown.detail?.field, 'bogus');
  assert.equal(unknown.detail?.rule, 'unknown-field');
  assert.ok(unknown.detail?.admitted.includes('scope'), 'the admitted option keys are named');

  // The same helper teaches every verb's options object, not only the recruit's.
  const create = await refusalOf(createSwarms({ command: async () => ({}) }).create('purpose', { bogus: 1 }));
  assert.equal(create.detail?.field, 'bogus');
  assert.equal(create.detail?.rule, 'unknown-field');
});

function syncRefusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

// ── 474-h: the CLI's own `--options` refusal is typed like #431's argv refusals ─────────────────

test('474-h: `--options` that is not JSON refuses at the parse with field, rule and admitted form', () => {
  const error = syncRefusalOf(() => parseBatonCli(recruitArgv('lane-json', ['--options', 'nope'])));
  assert.match(error.message, /--options must be JSON/u, 'the pinned message survives');
  assert.equal(error.detail?.field, '--options');
  assert.equal(error.detail?.rule, 'json');
  assert.equal(error.detail?.admitted, 'one JSON object');
  assert.equal(error.code, 'cli_invalid', 'a parse-time refusal keeps its usage-error class');

  const list = syncRefusalOf(() => parseBatonCli(recruitArgv('lane-json', ['--options', '[1,2]'])));
  assert.equal(list.detail?.rule, 'json-shape');
  assert.equal(list.detail?.admitted, 'one JSON object');
});
