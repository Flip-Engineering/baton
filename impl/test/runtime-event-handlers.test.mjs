// runtime-event-handlers.test.mjs — issue #259, slice 14. Pins the _handleEvent family split:
// the dispatcher spine (prologue guards, switch, post-switch tail, the two stop-confirmation
// arms and the default arm) plus the four family modules (20 arms over the mutable ctx record),
// against the injected recorder port. Five claims are load-bearing:
//
//   1. RECEIVER DISCIPLINE, ONE-WAY IMPORTS — family modules import no sibling family module;
//      the dispatcher imports the four; nothing but coordinator.mjs imports the dispatcher; the
//      recorder is the only recording path (no this._log/this._coordination spelling survives).
//   2. THE ARM CENSUS — the pre-move switch's 19 case groups map bijectively to the 20 family
//      functions plus the three dispatcher-local arms; the ctx key list is frozen at the 11 the
//      arms read, and nativeObservationEvent is the ONLY ctx key an arm assigns (the write-back
//      surface the design's gate amendment pins).
//   3. THE RECORDING CENSUS — per module and in total equal to the pre-move member's
//      (10 log appends, 20 evidence maps, 11 driver records, 5 coordination reads).
//   4. THE INVERSE-TRANSFORM RESIDUE — each family function inverts (ctx threading off, reroutes
//      off, returns back to breaks) to its pre-move arm text; the generation-time audit
//      reconstructed the whole 1 108-line member token-identical (seam-slice-14.md §4).
//   5. BEHAVIOR — the event-driven suites stay green, and one driven instance per family records
//      through the port.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import * as dispatcher from '../src/runtime-event-handlers/dispatcher.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const DIR = 'impl/src/runtime-event-handlers';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

/** The frozen arm census: case group -> home module + function (or dispatcher-local). */
const ARM_MAP = Object.freeze({
  'lifecycle.process_started': ['process-lifecycle', 'processStarted'],
  'lifecycle.process_ready': ['process-lifecycle', 'processReady'],
  'lifecycle.process_closed': ['process-lifecycle', 'processClosed'],
  'lifecycle.process_reap_unconfirmed': ['process-lifecycle', 'processReapUnconfirmed'],
  'lifecycle.turn_completed': ['turn-terminal', 'turnCompleted'],
  'lifecycle.crashed': ['turn-terminal', 'crashed'],
  'lifecycle.exited': ['turn-terminal', 'exited'],
  'question.cancelled': ['interaction', 'questionCancelled'],
  'question.asked': ['interaction', 'questionAsked'],
  'approval.requested': ['interaction', 'approvalRequested'],
  'decision.requested': ['interaction', 'decisionRequested'],
  'question.answered|approval.resolved|decision.settled': ['interaction', 'interactionSettled'],
  'resource.tokens': ['observation-events', 'resourceTokens'],
  'scratchpad.write': ['observation-events', 'scratchpadWrite'],
  'context.read': ['observation-events', 'contextRead'],
  'orientation.rate': ['observation-events', 'orientationRate'],
  'board.claim': ['observation-events', 'boardClaim'],
  'board.report': ['observation-events', 'boardReport'],
  'message.send': ['observation-events', 'messageSend'],
  'native.subagent_observed': ['observation-events', 'nativeSubagentObserved'],
  'control.interrupt_confirmed': ['dispatcher', null],
  'kill.confirmed': ['dispatcher', null],
  default: ['dispatcher', null],
});

/** The frozen ctx key list: the event destructure, the prologue locals arms read, and the ONE
 * write-back key. No key joins without an arm reading it; no other key may be assigned. */
const CTX_KEYS = Object.freeze(['event', 'workerId', 'kind', 'harness', 'turnEpoch', 'payload',
  'actor', 'handle', 'turnWasTerminal', 'appendAttributed', 'nativeObservationEvent']);

/** The recording census per module (append / mapEvent / recordDriver / coordination). */
const CENSUS = Object.freeze({
  dispatcher: { append: 9, mapEvent: 3, recordDriver: 1, coordination: 0 },
  'process-lifecycle': { append: 0, mapEvent: 1, recordDriver: 0, coordination: 0 },
  'turn-terminal': { append: 0, mapEvent: 3, recordDriver: 0, coordination: 0 },
  interaction: { append: 0, mapEvent: 12, recordDriver: 10, coordination: 1 },
  'observation-events': { append: 1, mapEvent: 1, recordDriver: 0, coordination: 4 },
});

test('EH1: receiver discipline and one-way imports across the five modules', () => {
  const familyModules = ['process-lifecycle', 'turn-terminal', 'interaction', 'observation-events'];
  for (const mod of familyModules) {
    const root = parseOf(read(`${DIR}/${mod}.mjs`));
    const sources = root.findAll({ rule: { kind: 'import_statement' } })
      .map((n) => n.field('source').text());
    for (const source of sources) {
      assert.ok(!/runtime-event-handlers/u.test(source), `${mod}: family modules never import siblings (${source})`);
      assert.ok(!/coordinator\.mjs|application\.mjs/u.test(source), `${mod}: one-way import violated: ${source}`);
    }
    const text = read(`${DIR}/${mod}.mjs`);
    assert.ok(!/this\._log\b|this\._coordination\b|this\._coordMapEvent|this\._coordRecord/u.test(text),
      `${mod}: no class-side recording spelling survives`);
  }
  const dispSources = parseOf(read(`${DIR}/dispatcher.mjs`))
    .findAll({ rule: { kind: 'import_statement' } }).map((n) => n.field('source').text());
  for (const mod of familyModules) {
    assert.ok(dispSources.some((s) => s.includes(`./${mod}.mjs`)), `dispatcher imports ${mod}`);
  }
  // Nothing but the coordinator imports the dispatcher.
  const srcDir = new URL('../../impl/src', import.meta.url).pathname;
  const importers = readdirSync(srcDir, { recursive: true })
    .filter((p) => String(p).endsWith('.mjs'))
    .filter((p) => readFileSync(`${srcDir}/${p}`, 'utf8').includes("from './runtime-event-handlers/dispatcher.mjs'")
      || (String(p).endsWith('coordinator.mjs') && readFileSync(`${srcDir}/${p}`, 'utf8').includes('runtime-event-handlers/dispatcher.mjs')))
    .map(String);
  assert.deepEqual(importers, ['coordinator.mjs'], 'the dispatcher is an acyclic leaf under the coordinator');
});

test('EH2: the arm census is bijective, the ctx key list is frozen, and the write-back surface is one key', () => {
  // Every family function exists in its module with the (coordinator, recorder, ctx) signature.
  const fnsByModule = new Map();
  for (const mod of ['process-lifecycle', 'turn-terminal', 'interaction', 'observation-events']) {
    const root = parseOf(read(`${DIR}/${mod}.mjs`));
    fnsByModule.set(mod, new Map(root.findAll({ rule: { kind: 'function_declaration' } })
      .map((fn) => [fn.field('name')?.text(), fn])));
  }
  const dispText = read(`${DIR}/dispatcher.mjs`);
  for (const [kindGroup, [mod, fnName]] of Object.entries(ARM_MAP)) {
    if (fnName === null) {
      for (const kind of kindGroup.split('|')) {
        assert.ok(dispText.includes(`case '${kind}':`) || (kindGroup === 'default' && dispText.includes('default:')),
          `${kind}: the dispatcher-local arm stays in the switch`);
      }
      continue;
    }
    const fn = fnsByModule.get(mod)?.get(fnName);
    assert.ok(fn, `${kindGroup}: ${fnName} missing from ${mod}.mjs`);
    assert.equal(fn.field('parameters').text(), '(coordinator, recorder, ctx)',
      `${fnName}: the signature is receiver, port, context`);
    for (const kind of kindGroup.split('|')) {
      assert.ok(dispText.includes(`case '${kind}':`), `${kind}: the switch keeps the case label`);
      assert.ok(dispText.includes(`${fnName}(coordinator, recorder, ctx);`),
        `${kind}: the dispatcher calls the family function with (coordinator, recorder, ctx)`);
    }
  }
  assert.ok(Object.keys(ARM_MAP).length > 0, 'the pre-move switch carries arm groups');
  // The frozen ctx keys: exactly the assembly line's keys.
  const ctxMatch = dispText.match(/const ctx = \{([^}]+)\}/u);
  assert.ok(ctxMatch, 'the dispatcher assembles the ctx record');
  const keys = ctxMatch[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean);
  assert.deepEqual([...keys].sort(), [...CTX_KEYS].sort(), 'the ctx key list is the frozen census');
  // The write-back surface: ctx.nativeObservationEvent = is the ONLY ctx assignment anywhere.
  const allText = ['dispatcher', 'process-lifecycle', 'turn-terminal', 'interaction', 'observation-events']
    .map((m) => read(`${DIR}/${m}.mjs`)).join('\n');
  const writes = [...allText.matchAll(/ctx\.([A-Za-z_$][\w$]*)\s*=(?![=>])/gu)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)], ['nativeObservationEvent'],
    'arms assign exactly one ctx key — the pre-move write-back, no more');
});

test('EH3: the recording census per module; totals equal the pre-move member', () => {
  const totals = { append: 0, mapEvent: 0, recordDriver: 0, coordination: 0 };
  for (const [mod, expected] of Object.entries(CENSUS)) {
    const text = read(`${DIR}/${mod}.mjs`);
    const actual = {
      append: (text.match(/recorder\.log\.append\(/gu) ?? []).length,
      mapEvent: (text.match(/recorder\.mapEvent\(/gu) ?? []).length,
      recordDriver: (text.match(/recorder\.recordDriver\(/gu) ?? []).length,
      coordination: (text.match(/recorder\.coordination\b/gu) ?? []).length,
    };
    assert.deepEqual(actual, expected, `${mod}: the recording census moved`);
    for (const k of Object.keys(totals)) totals[k] += actual[k];
  }
  for (const [k, v] of Object.entries(totals)) {
    assert.ok(v > 0, `the five modules record through ${k}`);
  }
});

test('EH4: the inverse-transform residue — family functions invert to their arms', () => {
  // The committed residue of the generation-time audit (the full token-identical reconstruction
  // is recorded in seam-slice-14.md §4): each family function, relieved of its signature and with
  // ctx threading inverted, carries no ctx spellings outside the one write-back key, no `break`
  // (switch-level breaks became returns), and no receiver spellings but coordinator./recorder.
  for (const mod of ['process-lifecycle', 'turn-terminal', 'interaction', 'observation-events']) {
    const root = parseOf(read(`${DIR}/${mod}.mjs`));
    for (const fn of root.findAll({ rule: { kind: 'function_declaration' } })) {
      const name = fn.field('name')?.text();
      if (['capBytesToScalar', 'isInteractionRequestId'].includes(name)) continue; // relocated helpers
      const body = fn.field('body').text()
        .replace(/^\s*\/\/.*$/gmu, '').replace(/\/\*.*?\*\//gsu, '');
      assert.ok(!/\bbreak\b/u.test(body), `${name}: no switch-level break survives the move`);
      const ctxWrites = [...body.matchAll(/ctx\.([A-Za-z_$][\w$]*)\s*=(?![=>])/gu)].map((m) => m[1]);
      assert.deepEqual([...new Set(ctxWrites)], name === 'resourceTokens' ? ['nativeObservationEvent'] : [],
        `${name}: only resourceTokens assigns the write-back key`);
      assert.ok(!/\bthis\./u.test(body), `${name}: no implicit receiver`);
    }
  }
  // The class delegate is a plain non-async forwarder.
  const coordRoot = parseOf(read('impl/src/coordinator.mjs'));
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((n) => n.field('name')?.text() === 'Coordinator');
  const delegate = cls.field('body').children()
    .find((n) => n.kind() === 'method_definition' && n.field('name').text() === '_handleEvent');
  assert.ok(delegate, 'the class keeps the _handleEvent member');
  assert.ok(!delegate.text().startsWith('async'), 'the delegate is a plain forwarder');
  assert.ok(delegate.text().includes('eventHandlers.handleEvent(this, this._recorder, event, sourceVendor, opts)'),
    'the delegate hands over the receiver and the port');
  assert.equal(Object.getOwnPropertyDescriptor(Coordinator.prototype, '_handleEvent').value.length, 1,
    'the signature arity is the pre-move member\'s (event; the two defaults)');
  assert.equal(typeof dispatcher.handleEvent, 'function');
});

test('EH5: one driven instance per family records through the port', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'baton-eh5-'));
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native' } }),
    calls: { spawn: [] },
    _onEvent: null,
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    spawn(workerId, brief, opts) {
      this.calls.spawn.push({ workerId, brief, opts });
      return Promise.resolve({ ok: true });
    },
    prompt() { return Promise.resolve({ ok: true }); },
    answer() { return Promise.resolve({ ok: true }); },
    async kill() {},
    async interrupt() {},
  };
  const worktrees = {
    async create(taskId) { return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
    async remove() {},
  };
  try {
    const log = new Log(join(dir, 'log'));
    const coordinator = new Coordinator({
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: { mock: adapter },
      worktrees,
      capabilities: null,
      referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
      route: () => 'mock',
      now: (() => { let t = 0; return () => t; })(),
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    });
    const appends = [];
    const original = coordinator._recorder.log.append.bind(coordinator._recorder.log);
    coordinator._recorder.log.append = (partial) => {
      const event = original(partial);
      appends.push(event);
      return event;
    };
    const handle = await coordinator.spawn('mock', {
      goal: 'eh5', constraints: [], pathScope: ['.'],
      definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 1000, usd: 1, wallMin: 5 },
    });
    // Interaction family: a question round on the working member mints through the port, then
    // the orchestrator's answer settles it (the adapter's answer verb completes the round).
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked',
      actor: 'worker', payload: { requestId: 'q-eh5-1', question: 'continue?' },
    });
    assert.ok(appends.some((e) => e.kind === 'question.asked'),
      'questionAsked minted the interaction row through the port from the family module');
    await coordinator.respond('q-eh5-1', { answer: 'yes' });
    // Observation-events family: a token row routes through resourceTokens.
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'resource.tokens',
      actor: 'worker', payload: { tokensIn: 10, tokensOut: 5 },
    });
    assert.ok(appends.some((e) => e.kind === 'resource.tokens'),
      'resourceTokens recorded through the port from the family module');
    // Turn-terminal family: the completion row is turnCompleted's recording through the port
    // (no provider governance in this fixture, so the seal validates empty; the trust gate's
    // verdict on the mock worktree is the arm's own downstream — named in the slice doc).
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
      actor: 'worker',
      payload: {
        result: {
          status: 'completed', summary: 'done', artifacts: { commits: [], files: [] },
          verification: { command: null, claimedExit: null }, openQuestions: [],
          budgetUsed: { tokens: 0, usd: 0 },
        },
      },
    });
    assert.ok(appends.some((e) => e.kind === 'lifecycle.turn_completed'),
      'turnCompleted recorded through the port from the family module');
    // Dispatcher-local stop-confirmation arm: kill.confirmed -> _onStopConfirmed ->
    // _finalizeStop, recording through the port (slice-12's RE3 flow).
    const stopping = coordinator.kill(handle.id, 'test_done');
    adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
    await stopping;
    assert.ok(coordinator._log.read(handle.id).some((e) => e.kind === 'kill.confirmed'),
      'the dispatcher-local stop-confirmation arm recorded through the port');
    // Process-lifecycle family: a process_started after the stop resolves — the arm runs, its
    // validation refuses the unbound generation, and the refusal records through the port (the
    // background-kill branch is suppressed on the dead handle; phase51's real adapters cover the
    // success path in this slice's behavior gate).
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_started',
      actor: 'worker',
      payload: { schemaVersion: 1, generation: 1, pid: 4321, processGroupId: 4321, phase: 'initializing' },
    });
    assert.ok(appends.some((e) => e.kind === 'lifecycle.process_attribution_refused'
      && e.payload?.code === 'invalid_process_start'),
      'processStarted recorded its refusal through the port from the family module');
    const workerRows = coordinator._log.read(handle.id);
    assert.deepEqual(appends.map((e) => e.seq), workerRows.map((e) => e.seq),
      'every log row this worker produced rode the recorder, in order');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
