import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase84-context-successor-wave-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-dogfood-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const kimi = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });
const reportPath = 'reviews/dogfood/phase84-context-successor-wave-review.md';
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);
for (const name of readdirSync(evidenceDir)) {
  if (/^partition-\d{4}\.md$/u.test(name)) rmSync(join(evidenceDir, name), { force: true });
}
const callerBefore = Object.freeze({
  status: outsideEvidenceStatus(),
  indexTree: git(['write-tree']),
});

let baton = null;
let workflow = null;
let record = null;
let failure = null;
let reports = [];
let activeCallId = null;
let predecessorMemberStops = null;

try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [codex, codexDeep, kimi],
      verification: {
        command: 'node',
        arguments: [
          '--test',
          'impl/test/phase84-context-map-schema-red.test.mjs',
          'impl/test/phase84-context-map-plan-binding-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor({ depth: 'connection', check: true });
  const kimiReady = readiness.routes.some((route) => (
    route.harness === kimi.harness && route.model === kimi.model
      && route.effort === kimi.effort && route.state === 'ready'
  ));
  const team = kimiReady ? [
    { role: 'lifecycle-auditor', exact: codex },
    { role: 'ax-adversary', exact: kimi },
  ] : [
    { role: 'lifecycle-auditor', exact: codex },
    { role: 'ax-adversary', exact: codexDeep },
  ];
  const mapRoute = team.find((member) => member.role === 'ax-adversary').exact;

  workflow = await baton.workflow([
    'Audit the current effective-tree Phase 84 Context successor-Wave implementation in Baton.',
    'Concentrate on content-addressed ContextMapCall and Plan-node bindings, historical authority',
    'after Plan-head advancement, the zero-provider-before-approval boundary, exact',
    'orchestrator-selected harness/model/effort routing, terminal child aggregation, restart replay,',
    'and Run-stop v3 descendant call/process/worktree reaping. Also assess whether the Pythonic',
    'Context search/map/call surface is genuinely simpler than direct receipt choreography.',
    'Use concrete source pointers and distinguish release blockers from the later reduce/review/',
    'verify/RLM work. Stay in this harness process, do not spawn subagents, and do not run the test',
    'suite because Baton performs fresh verification. Finish promptly.',
    `Write only ${reportPath}; do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team,
  });
  await workflow.approve();

  const context = workflow.context();
  const sourceCell = await context.search(['context', 'map', 'child', 'failed'].join('_'), {
    branch: 'repository', mode: 'literal', role: 'lifecycle-auditor',
  });
  const sourceOutput = await sourceCell.output();
  if (!Array.isArray(sourceOutput?.items) || sourceOutput.items.length < 2) {
    throw new Error(`expected at least two grounded map partitions, observed ${sourceOutput?.items?.length ?? 0}`);
  }
  for (const role of ['lifecycle-auditor', 'ax-adversary']) {
    await workflow.stopMember(
      role,
      'Immutable Context is captured; release predecessor execution before its successor Wave.',
    );
  }
  const predecessorStatus = await workflow.status();
  predecessorMemberStops = ['lifecycle-auditor', 'ax-adversary'].map((role) => ({
    role,
    member: predecessorStatus.memberStops.find((row) => row.role === role) ?? null,
    attempt: predecessorStatus.attempts.find((row) => row.role === role) ?? null,
  }));
  if (predecessorMemberStops.some(({ member, attempt }) => (
    member?.status !== 'stopped' || attempt?.state !== 'cancelled'
  )) || predecessorStatus.ownership?.workers !== 0) {
    throw new Error('predecessor Workflow members did not stop and reap before Context map');
  }
  predecessorMemberStops = {
    members: predecessorMemberStops,
    ownershipAfterStop: predecessorStatus.ownership,
  };
  const call = await context.map(sourceCell, {
    role: 'ax-adversary',
    instruction: [
      'Review only this immutable source partition for a concrete Phase 84 authority, replay,',
      'settlement, or stop/reap defect. Ground every claim in the attached partition. Write a',
      `concise independent report to ${reportPath}, then finish without running tests.`,
    ].join(' '),
  });
  activeCallId = call.id;
  const proposal = await call.outline();
  if (proposal.item.state !== 'awaiting_plan_approval') {
    throw new Error(`Context map did not pause at approval: ${proposal.item.state}`);
  }
  await workflow.approve();
  await call.complete({ signal: controller.signal });
  const completedCall = await call.outline();
  if (!controller.signal.aborted && completedCall.item.state !== 'completed') {
    throw new Error(`Context map did not settle: ${completedCall.item.state}`);
  }

  const status = await workflow.status();
  const contextOutline = await context.outline();
  const manifest = await workflow.evidence();
  const output = completedCall.item.value?.output ?? null;
  for (const child of output?.items ?? []) {
    if (!child.resultSha) continue;
    reports.push({
      index: child.index,
      resultSha: child.resultSha,
      body: git(['show', `${child.resultSha}:${reportPath}`], {
        encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      }),
    });
  }
  const events = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const callAdmission = events.find((event) => (
    event.kind === 'context.call_admitted' && event.payload?.call?.callId === call.id
  ));
  const callSettlement = events.find((event) => (
    event.kind === 'context.call_settled' && event.payload?.callId === call.id
  ));
  const settlementResult = callSettlement?.payload?.result ?? null;
  const cleanupProof = settlementResult?.cleanup ?? null;
  const releaseEvents = events.filter((event) => (
    event.kind === 'task.resources_released'
      && cleanupProof?.targets?.some((target) => target.releaseEvent === event.seq)
  ));
  const waveDispatches = events.filter((event) => (
    event.kind === 'plan.node_dispatched'
      && event.payload?.binding?.planDigest === callAdmission?.payload?.expectedPlanDigest
  )).sort((left, right) => left.payload.wave.index - right.payload.wave.index);
  const waveTaskEvents = waveDispatches.map((dispatch) => events[dispatch.seq] ?? null);
  const routeAttempts = settlementResult?.children?.map((child) => ({
    child,
    attempt: status.attempts.find((candidate) => candidate.taskId === child.taskId) ?? null,
  })) ?? [];
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const expectedIndexes = sourceOutput.items.map((_, index) => index);
  const waveBatchIds = new Set(waveDispatches.map((event) => event.batch?.id));
  const waveDigests = new Set(waveDispatches.map((event) => event.payload.wave?.digest));
  const waveTimestamps = new Set(waveDispatches.map((event) => event.ts));
  const childTaskIds = (settlementResult?.children ?? []).map((child) => child.taskId).sort();
  const dispatchTaskIds = waveDispatches.map((event) => event.payload.taskId).sort();
  const releaseProofs = releaseEvents.map((event) => {
    const mapped = events[event.payload.evidence.coordinationSeq - 1] ?? null;
    const operationalRows = readFileSync(
      join(deploymentRoot, 'state', `${event.payload.workerId}.jsonl`), 'utf8',
    ).trim().split('\n').map((line) => JSON.parse(line));
    const operational = operationalRows
      .find((row) => row.seq === event.payload.evidence.workerSeq) ?? null;
    const processTerminal = operationalRows.find((row) => (
      row.seq === operational?.payload?.process?.terminalSeq
    )) ?? null;
    const processStart = operationalRows.slice(
      0, Math.max(0, (operational?.payload?.process?.terminalSeq ?? 1) - 1),
    ).findLast((row) => row.kind === 'lifecycle.process_started') ?? null;
    return { release: event, mapped, operational, operationalRows, processStart, processTerminal };
  });
  if (!callAdmission || !callSettlement
    || settlementResult.providerEffects !== sourceOutput.items.length
    || settlementResult.children?.length !== sourceOutput.items.length
    || output?.items?.length !== sourceOutput.items.length
    || cleanupProof?.targetCount !== sourceOutput.items.length
    || cleanupProof?.remainingCount !== 0
    || cleanupProof?.targets?.length !== sourceOutput.items.length
    || releaseEvents.length !== sourceOutput.items.length
    || contextOutline.providerEffects !== sourceOutput.items.length
    || reports.length !== sourceOutput.items.length
    || waveDispatches.length !== sourceOutput.items.length
    || waveBatchIds.size !== 1 || waveDigests.size !== 1 || waveTimestamps.size !== 1
    || !same(waveDispatches.map((event) => event.payload.wave.index), expectedIndexes)
    || waveDispatches.some((event) => (
      event.batch?.kind !== 'goal_plan_wave_dispatch'
        || event.batch.count !== sourceOutput.items.length * 2
        || event.batch.index !== event.payload.wave.index * 2
        || event.payload.wave.count !== sourceOutput.items.length
    ))
    || waveTaskEvents.some((event, index) => (
      event?.kind !== 'task.created'
        || event.batch?.id !== waveDispatches[index].batch.id
        || event.batch?.index !== waveDispatches[index].batch.index + 1
        || event.payload?.id !== waveDispatches[index].payload.taskId
    ))
    || !same(dispatchTaskIds, childTaskIds)
    || routeAttempts.length !== sourceOutput.items.length
    || routeAttempts.some(({ child, attempt }) => (
      !same(child.route, mapRoute) || !attempt || attempt.state !== 'accepted'
        || !same(attempt.route?.requested, mapRoute)
        || Object.values(attempt.route?.launchEnforcement ?? {})
          .some((axis) => axis.state !== 'matched')
        || Object.values(attempt.route?.providerAttestation ?? {})
          .some((axis) => axis.state === 'mismatched')
    ))
    || releaseProofs.some(({ release, mapped, operational, operationalRows, processStart, processTerminal }) => (
      release.actor !== 'policy' || release.seq >= callSettlement.seq
        || mapped?.kind !== 'evidence.mapped'
        || mapped.seq !== release.payload.evidence.coordinationSeq
        || operational?.kind !== 'resource.worker_cleanup_attested'
        || operational.actor !== 'policy'
        || operational.taskId !== release.payload.taskId
        || operational.runId !== workflow.id
        || operational.payload?.releaseDigest !== release.payload.releaseDigest
        || processStart?.kind !== 'lifecycle.process_started'
        || processStart.actor !== 'worker'
        || processStart.taskId !== release.payload.taskId
        || processStart.runId !== workflow.id
        || processTerminal?.kind !== operational.payload?.process?.terminalKind
        || processTerminal.taskId !== release.payload.taskId
        || processTerminal.runId !== workflow.id
        || ['generation', 'pid', 'processGroupId'].some((field) => (
          processStart.payload?.[field] !== operational.payload?.process?.[field]
            || processTerminal.payload?.[field] !== operational.payload?.process?.[field]
        ))
        || operationalRows.slice(operational.payload.process.terminalSeq)
          .some((row) => row.kind === 'lifecycle.process_started')
    ))
    || settlementResult.children.some((child) => {
      const target = cleanupProof.targets.find((candidate) => (
        candidate.partitionId === child.partitionId
      ));
      return !target || child.resourceRelease?.releaseEvent !== target.releaseEvent
        || child.resourceRelease?.releaseDigest !== target.releaseDigest
        || child.taskId !== target.taskId || child.workerId !== target.workerId;
    })) {
    throw new Error('Context map settlement lacks exact provider and resource-release proof');
  }
  record = {
    schemaVersion: 1,
    runId: workflow.id,
    outcome: controller.signal.aborted ? 'operator_interrupted' : 'context_map_completed',
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team,
    source: { cellId: sourceCell.id, partitions: sourceOutput.items.length },
    predecessorMemberStops,
    call: {
      callId: call.id,
      state: completedCall.item.state,
      admittedEvent: callAdmission?.seq ?? null,
      settledEvent: callSettlement?.seq ?? null,
      providerEffects: settlementResult.providerEffects,
      resultChildren: output?.items?.length ?? 0,
      cleanup: {
        cleanupDigest: cleanupProof.cleanupDigest,
        targetDigest: cleanupProof.targetDigest,
        targetCount: cleanupProof.targetCount,
        remainingCount: cleanupProof.remainingCount,
        releaseEvents: cleanupProof.targets.map((target) => ({
          partitionId: target.partitionId,
          taskId: target.taskId,
          workerId: target.workerId,
          releaseEvent: target.releaseEvent,
          releaseDigest: target.releaseDigest,
        })),
      },
      wave: {
        batchId: waveDispatches[0].batch.id,
        waveDigest: waveDispatches[0].payload.wave.digest,
        timestamp: waveDispatches[0].ts,
        dispatches: waveDispatches.map((event) => ({
          seq: event.seq, batchIndex: event.batch.index, waveIndex: event.payload.wave.index,
          taskId: event.payload.taskId,
        })),
      },
    },
    attempts: status.attempts.map(({ role, nodeKey, taskId, state, route, candidateId }) => ({
      role, nodeKey, taskId, state, route, candidateId,
    })),
    resourceReleases: releaseProofs.map(({ release, mapped, operational, processStart, processTerminal }) => ({
      event: release, mappedEvidence: mapped, operationalAttestation: operational,
      processStart, processTerminal,
    })),
    contextOutline,
    manifestDigest: manifest.manifestDigest,
    checks: manifest.checks,
  };
} catch (error) {
  failure = error;
  if (workflow) {
    try {
      const failedStatus = await workflow.status();
      const failedContext = await workflow.context().outline();
      record = {
        schemaVersion: 1,
        runId: workflow.id,
        outcome: 'context_map_failed',
        error: { name: error.name, code: error.code ?? null, message: error.message },
        callId: activeCallId,
        phase: failedStatus.phase,
        attempts: failedStatus.attempts.map(
          ({ role, nodeKey, taskId, state, route, candidateId, terminalCause }) => ({
            role, nodeKey, taskId, state, route, candidateId, terminalCause,
          }),
        ),
        nodes: failedStatus.nodes,
        verification: failedStatus.verification,
        attention: failedStatus.attention,
        progress: failedStatus.progress,
        context: failedContext,
        coordinationDiagnostics: readFileSync(
          join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
        ).trim().split('\n').map((line) => JSON.parse(line)).filter((event) => (
          ['task.failed', 'task.completed', 'task.cancelled', 'artifact.registered',
            'artifact.accepted', 'artifact.rejected'].includes(event.kind)
        )),
      };
    } catch {}
  }
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop(controller.signal.aborted
        ? 'Signal received; stop and reap every Phase 84 dogfood descendant.'
        : 'Phase 84 evidence captured; stop and reap every dogfood descendant.');
      const status = await workflow.status();
      const receipt = status.stop?.receipt ?? null;
      stopped = {
        state: status.stop?.state ?? null,
        receipt,
        ownership: status.ownership,
      };
      if (stopped.state !== 'stopped' || receipt?.state !== 'stopped'
        || receipt.schemaVersion !== 3 || receipt.remainingCount !== 0
        || receipt.counts.pendingCancelled + receipt.counts.killConfirmed
          + receipt.counts.alreadyTerminal !== receipt.targetCount
        || receipt.counts.processesObserved !== receipt.counts.processesClosed
        || receipt.checks.dispatchClosed !== true
        || receipt.checks.interactionsResolved !== true
        || receipt.checks.runAuthorityReleased !== true
        || receipt.context?.targetCallCount < 1
        || receipt.context?.remainingSessionCount !== 0
        || receipt.context?.remainingCellCount !== 0
        || receipt.context?.remainingCallCount !== 0
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 84 Run-stop v3 proof is incomplete');
      }
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  for (const report of reports) {
    writeFileSync(join(evidenceDir, `partition-${String(report.index).padStart(4, '0')}.md`), report.body);
  }
  const generatedReports = reports.map((report) => ({
    name: `partition-${String(report.index).padStart(4, '0')}.md`,
    resultSha: report.resultSha,
    digest: createHash('sha256').update(report.body).digest('hex'),
    bytes: Buffer.byteLength(report.body),
  }));
  const callerAfter = { status: outsideEvidenceStatus(), indexTree: git(['write-tree']) };
  const cleanup = {
    stopped, closed, generatedReports,
    callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
    callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
  };
  const evidence = { record, cleanup };
  writeFileSync(join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  rmSync(deploymentRoot, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged
    || (cleanup.closed && (cleanup.closed.closed !== true || cleanup.closed.workers !== 0))) {
    failure ??= new Error('Phase 84 dogfood cleanup proof failed');
  }
}

if (failure) throw failure;
