// docs/36 §9 M3 — member unification + read consolidation + the episode fold. run.member.* land
// as canonical dispatch-layer aliases with structured {role, generation?} addressing; run.view
// absorbs the Episode chapters (`--section episode.CHAPTER`, with --role/--generation axes) and
// run.wait (`--until settled|terminal`); run.watch is the event-channel read. The transport tables
// (card().commands, WEB_APPLICATION_ENTRIES) stay byte-stable — the flips land in the dispatch
// layer, the CLI parser, the surfaced continuation, and the browser desk. These contracts
// (M3-1..M3-8) are the M3 acceptance gate; the phase92 Episode contracts are the highest-risk gate
// (docs/36 §11) and are enforced in phase92-episode-{attribution,workstream}-red.test.mjs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY as REGISTRY,
  BatonApplication,
  operatorAsset,
  parseBatonCli,
} from '../src/index.mjs';
import { applicationOperationAliasMap } from '../src/application-semantics.mjs';
import { createWave } from '../src/wave.mjs';
import {
  CANONICAL_OPERATIONS,
  checkLedgerMonotone,
  validateLedger,
} from '../scripts/surface-conformance.mjs';

const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));

// The pre-M3 legacy transport inventory — the M3 consolidation must not add or rename a single
// transport name (UA5 byte-stability; the flips are dispatch-layer only until M4).
const COMMANDS_BEFORE_M3 = Object.freeze([
  'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
  'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act',
  'run.status', 'run.follow', 'run.approve', 'run.wait', 'run.answer', 'run.feedback',
  'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification',
  'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'run.recover',
  'waves.attach', 'application.shutdown',
]);

const PRINCIPAL = Object.freeze({
  actor: 'direct:grammar-user', principalId: 'grammar-user', sessionId: 'grammar-session',
});

// A dispatch spy over the real command bus: canonical resolution, argument validation, and the
// Episode fold all run against the shipped BatonApplication.command; only the leaf projections are
// stubbed so the routing decision itself is what is asserted.
function dispatchApp() {
  const app = Object.create(BatonApplication.prototype);
  app.calls = [];
  app.episode = async (args) => { app.calls.push(['episode', args]); return { via: 'episode' }; };
  app.inspect = async (args) => { app.calls.push(['inspect', args]); return { via: 'inspect' }; };
  app.workstreams = async (args) => { app.calls.push(['workstreams', args]); return { via: 'workstreams' }; };
  app.notifyWorkstream = async (args) => { app.calls.push(['notify', args]); return { via: 'notify' }; };
  return app;
}

// A minimal control-target host for the run-level recipient resolver (the two-clocks / work
// sentinel authority) — no live provider, only the eligible-seat arithmetic.
function controlApp(workers) {
  const app = Object.create(BatonApplication.prototype);
  app._isWorkflowRun = () => false;
  app.driver = {
    coordinator: { list: () => workers },
    coordination: {
      snapshot: () => ({ goalPlan: { dispatches: [] } }),
      task: (taskId) => ({ id: taskId, runId: 'run-m3' }),
    },
  };
  return app;
}
const liveSeat = (id) => ({
  id, runId: 'run-m3', fence: 1, status: 'working', taskId: `task-${id}`,
  sessionPreservationCapable: true,
});
const CURRENT = { goal: { runId: 'run-m3' } };

// A wait host with a scripted phase progression and no real clock delay, to prove the --until
// predicate selection over the registry lifecycle predicates.
function waitApp(phases) {
  const app = Object.create(BatonApplication.prototype);
  let index = 0;
  app._assertOpen = () => {};
  app.status = async () => ({ phase: phases[Math.min(index++, phases.length - 1)] });
  app.driver = { coordinator: { wait: async () => {} } };
  return app;
}

test('M3-1: the exact phase92 attribution call is byte-equal and expressible through run.view', async () => {
  // The Episode fold: `run view --section episode.result --role reviewer --generation 2 --evidence`
  // compiles byte-identically to the legacy `run episode result --workstream reviewer …`.
  const viaView = parseBatonCli([
    'run', 'view', 'run-m3', '--section', 'episode.result',
    '--role', 'reviewer', '--generation', '2', '--evidence',
  ]);
  const viaEpisode = parseBatonCli([
    'run', 'episode', 'run-m3', 'result', '--workstream', 'reviewer', '--generation', '2', '--evidence',
  ]);
  assert.equal(viaView.name, 'run.episode');
  assert.deepEqual(viaView.args, {
    runId: 'run-m3', topic: 'result', role: 'reviewer', generation: 2, detail: 'evidence',
  });
  assert.deepEqual(viaView.args, viaEpisode.args);

  // The folded read reaches the Episode projection engine (topic present), not the ordinary
  // inspect projection, when dispatched through the shared command bus.
  const app = dispatchApp();
  await app.command('run.view', {
    runId: 'run-m3', topic: 'result', role: 'reviewer', generation: 2, detail: 'evidence',
  }, PRINCIPAL, null);
  assert.deepEqual(app.calls, [['episode', {
    runId: 'run-m3', topic: 'result', role: 'reviewer', generation: 2, detail: 'evidence',
  }]]);

  // A run.view without a chapter topic stays the ordinary inspect projection.
  const plain = dispatchApp();
  await plain.command('run.view', { runId: 'run-m3', depth: 'outline' }, PRINCIPAL, null);
  assert.deepEqual(plain.calls, [['inspect', { runId: 'run-m3', depth: 'outline' }]]);
});

test('M3-2: --role none selects the run-level aggregate — a distinct projection from any role', () => {
  // The explicit aggregate selector omits the role axis (never a literal role "none"), exactly as
  // omitting --role does; it is a distinct projection from an addressed role.
  const aggregate = parseBatonCli(['run', 'view', 'run-m3', '--section', 'episode.result', '--role', 'none']);
  const implicit = parseBatonCli(['run', 'view', 'run-m3', '--section', 'episode.result']);
  const addressed = parseBatonCli(['run', 'view', 'run-m3', '--section', 'episode.result', '--role', 'reviewer']);
  assert.deepEqual(aggregate.args, { runId: 'run-m3', topic: 'result', detail: 'item' });
  assert.deepEqual(implicit.args, aggregate.args);
  assert.equal(Object.hasOwn(aggregate.args, 'role'), false);
  assert.deepEqual(addressed.args, { runId: 'run-m3', topic: 'result', role: 'reviewer', detail: 'item' });
  assert.notDeepEqual(aggregate.args, addressed.args);
});

test('M3-3: the four cross-argument admission rules refuse exactly as before through run.view', async () => {
  // application.mjs:1377-1402 — pageCursor only for output×content; content only for output|help;
  // generation ⇒ role; waitMs ⇒ cursor. They port verbatim: the same refusal fires whether the
  // request arrives as run.episode or through the folded run.view.
  const violations = [
    { runId: 'run-m3', topic: 'result', detail: 'item', pageCursor: 'page_2' },
    { runId: 'run-m3', topic: 'sources', detail: 'content' },
    { runId: 'run-m3', topic: 'result', generation: 2 },
    { runId: 'run-m3', topic: 'result', waitMs: 5 },
  ];
  for (const bad of violations) {
    await assert.rejects(dispatchApp().command('run.view', bad, PRINCIPAL, null),
      { code: 'application_episode_invalid' }, `run.view ${JSON.stringify(bad)}`);
    await assert.rejects(dispatchApp().command('run.episode', bad, PRINCIPAL, null),
      { code: 'application_episode_invalid' }, `run.episode ${JSON.stringify(bad)}`);
  }
  // The exact phase92 attribution shape remains admitted through both entries.
  const good = { runId: 'run-m3', topic: 'output', detail: 'content', role: 'reviewer', generation: 2, pageCursor: 'page_2', cursor: 7, waitMs: 5 };
  const app = dispatchApp();
  await app.command('run.view', good, PRINCIPAL, null);
  assert.equal(app.calls[0][0], 'episode');
});

test('M3-4: the continuation and the browser desk flip to run.view / run.member.* atomically', async () => {
  // The surfaced Episode continuation is the canonical read verb run.view (the arguments stay the
  // chapter shape); it replays through the fold back onto the Episode projection.
  const app = Object.create(BatonApplication.prototype);
  const continuation = app._logicalEpisodeContinuation(
    { topic: 'result', detail: 'item' }, null, 'run-m3', 7,
  );
  assert.deepEqual(continuation, {
    operation: 'run.view', arguments: { runId: 'run-m3', topic: 'result', detail: 'item', cursor: 7 },
  });
  const replay = dispatchApp();
  await replay.command(continuation.operation, continuation.arguments, PRINCIPAL, null);
  assert.deepEqual(replay.calls, [['episode', continuation.arguments]]);

  // The browser desk moves with the fold: canonical bus operations and element ids, no residual
  // legacy Episode/workstream spellings.
  const html = operatorAsset('/control').body;
  const script = operatorAsset('/control/app.js').body;
  for (const operation of ['run_view', 'run_member_view', 'run_member_send', 'run_member_stop']) {
    assert.equal(script.includes(`command('${operation}'`), true, operation);
  }
  for (const legacy of ['run_episode', 'run_workstreams', 'run_workstream_notify', 'run_workstream_stop']) {
    assert.equal(script.includes(`command('${legacy}'`), false, legacy);
  }
  for (const id of ['view-member', 'view-section', 'view-detail', 'load-view', 'continue-view',
    'load-members', 'member-send', 'member-stop']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'), id);
  }
});

test('M3-5: member send addresses {role, generation?} under the two-clocks rule and the ambiguity refusal', async () => {
  // The member ops are structured {role, generation?}: the workflow-scoped clock (member.send)
  // carries a generation; the run-level clock (send/interrupt) has no generation axis.
  const memberSend = parseBatonCli(['run', 'member', 'send', 'run-m3', 'reviewer', 'Continue.', '--generation', '2']);
  assert.equal(memberSend.name, 'run.workstream.notify');
  assert.deepEqual(memberSend.args, { runId: 'run-m3', role: 'reviewer', message: 'Continue.', delivery: 'nudge', generation: 2 });
  // Byte-equal to the legacy `run notify` spelling.
  assert.deepEqual(memberSend.args, parseBatonCli(['run', 'notify', 'run-m3', 'reviewer', 'Continue.', '--generation', '2']).args);

  const memberInterrupt = parseBatonCli(['run', 'member', 'interrupt', 'run-m3', 'reviewer', '--generation', '2']);
  assert.equal(memberInterrupt.actionKind, 'interrupt');
  assert.deepEqual(memberInterrupt.inputs, { recipient: 'reviewer', generation: 2 });
  const runInterrupt = parseBatonCli(['run', 'interrupt', 'run-m3', '--to', 'reviewer']);
  assert.deepEqual(runInterrupt.inputs, { recipient: 'reviewer' });
  const runSend = parseBatonCli(['run', 'send', 'run-m3', 'Continue.']);
  assert.equal(Object.hasOwn(runSend.inputs, 'generation'), false);

  // A bare-role recipient with more than one live seat and no advertised role is ambiguous — the
  // existing application_control_recipient_ambiguous refusal requires an explicit address.
  assert.throws(
    () => controlApp([liveSeat('a'), liveSeat('b')])._resolveSemanticControlTarget(CURRENT, 'work', 'send'),
    { code: 'application_control_recipient_ambiguous' },
  );
});

test('M3-6: the work sentinel is accepted by run.send only, and refused for member ops and wave roles', async () => {
  // Run-level send resolves the sole live seat through the `work` sentinel.
  assert.doesNotThrow(
    () => controlApp([liveSeat('only')])._resolveSemanticControlTarget(CURRENT, 'work', 'send'),
  );
  assert.equal(parseBatonCli(['run', 'send', 'run-m3', 'Continue.', '--to', 'work']).inputs.recipient, 'work');

  // Member ops refuse the reserved sentinel as a role.
  await assert.rejects(
    dispatchApp().command('run.member.send', { runId: 'run-m3', role: 'work', message: 'Continue.' }, PRINCIPAL, null),
    { code: 'application_workstream_notify_invalid' },
  );
  await assert.rejects(
    dispatchApp().command('run.member.stop', { runId: 'run-m3', role: 'work' }, PRINCIPAL, null),
    { code: 'application_workstream_stop_invalid' },
  );

  // A workflow role literally named `work` is a wave-admission (registry) lint error.
  await assert.rejects(
    createWave({ runs: { start() {} } }, { members: [{ role: 'work', objective: 'x', scope: ['a.mjs'] }] }),
    /reserved/u,
  );
});

test('M3-7: run.view --until settles on the registry lifecycle predicates', async () => {
  // The CLI folds the deployment-bounded condition wait onto run.wait with an explicit condition.
  const settled = parseBatonCli(['run', 'view', 'run-m3', '--until', 'settled']);
  assert.equal(settled.name, 'run.wait');
  assert.equal(settled.args.until, 'settled');
  const terminal = parseBatonCli(['run', 'view', 'run-m3', '--until', 'terminal', '--wait', '5ms']);
  assert.deepEqual(terminal.args, { runId: 'run-m3', until: 'terminal', timeoutMs: 5 });
  assert.throws(() => parseBatonCli(['run', 'view', 'run-m3', '--until', 'anything']), /settled or terminal/u);

  // `settled` blocks until the provider settles (work_completed settles, is not terminal);
  // `terminal` blocks past provider settle until the application Run itself is terminal.
  assert.equal((await waitApp(['work_completed', 'completed'])
    .wait('run-m3', PRINCIPAL, { timeoutMs: 60_000, until: 'settled' }, null)).phase, 'work_completed');
  assert.equal((await waitApp(['work_completed', 'completed'])
    .wait('run-m3', PRINCIPAL, { timeoutMs: 60_000, until: 'terminal' }, null)).phase, 'completed');
});

test('M3-8: the ledger stays monotone and valid and every transport name is byte-stable (UA5)', () => {
  // The consolidation retires no transport-name row (those flip at M4); the ledger is unchanged, so
  // monotonicity (append-forbidden vs itself) and validity both hold.
  assert.deepEqual(validateLedger(ledger), []);
  assert.deepEqual(checkLedgerMonotone(ledger, ledger), []);
  assert.deepEqual(ledger.entries.filter((entry) => entry.retiresIn === 'M3'), []);

  // No transport name changed: the legacy command table is byte-identical and the new canonical
  // names resolve only in the dispatch-layer alias map, never as command definitions.
  assert.deepEqual(Object.keys(APPLICATION_COMMAND_DEFINITIONS), COMMANDS_BEFORE_M3);
  for (const canonical of ['run.view', 'run.watch', 'run.member.view', 'run.member.send',
    'run.member.interrupt', 'run.member.stop']) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, canonical), false, canonical);
  }
  // run.member.interrupt lands as a canonical dispatch-layer alias and a known canonical operation.
  assert.equal(REGISTRY.aliases.operations['run.member.interrupt'], 'run.interrupt');
  assert.equal(applicationOperationAliasMap()['run.member.interrupt'], 'run.interrupt');
  assert.ok(CANONICAL_OPERATIONS.some((operation) => operation.key === 'run.member.interrupt'));
});
