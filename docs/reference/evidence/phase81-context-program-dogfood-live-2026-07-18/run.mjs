import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase81-dogfood-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
// Keep the handlers installed until awaited cleanup completes. A terminal can deliver more than
// one signal to the foreground process group; `once` would restore Node's default immediate exit
// after the first signal and strand an otherwise durably admitted Baton stop.
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const kimi = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });
const reportPath = 'reviews/dogfood/phase81-context-program-live-review.md';
const gitBytes = (args) => execFileSync('git', args, { cwd: repo });
const callerBefore = Object.freeze({
  status: gitBytes(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  indexTree: gitBytes(['write-tree']),
});

let baton = null;
let workflow = null;
let evidence = null;
let cleanup = null;
let failure = null;

try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [codex, kimi],
      verification: {
        command: 'node',
        arguments: [
          '--test',
          'impl/test/phase80-workflow-revision.test.mjs',
          'impl/test/phase81-context-program-red.test.mjs',
        ],
      },
    },
  });

  const readiness = await baton.doctor();
  workflow = await baton.workflow([
    'Independently audit the current effective-tree snapshot of Baton Phase 81.',
    'Inspect spec/phase81-context-program-rlm.md, impl/src/context-program.mjs, its tests,',
    'the existing Scratch/Atlas/Workflow/Plan/Wave machinery, and the progressive application surface.',
    'Critique whether the closed Context Program preserves authority, replay, stop/reap, evidence,',
    'exact orchestrator-selected harness/model/effort routing, and an intuitive Pythonic agent experience.',
    'Clearly separate what is implemented now from proposed ContextManifest-to-Plan/Wave compilation,',
    'dynamic depth-one map/reduce, transport parity, and evaluation work.',
    'Propose the smallest dependency-ordered red-test and implementation sequence in a concise report.',
    'Work directly in this one harness process: do not spawn Agent or subagent tools, and do not run',
    'the verification suite yourself because Baton performs fresh verification after the result.',
    `Write only ${reportPath}; do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team: [
      { role: 'codex-architect', exact: codex },
      { role: 'kimi-adversary', exact: kimi },
    ],
  });

  const initial = await workflow.complete({ signal: controller.signal });
  const initialCandidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  if (initialCandidates.length !== 2) {
    throw new Error(`expected two verified independent Candidates, observed ${initialCandidates.length}`);
  }
  const kimiCandidate = initialCandidates.find(({ role }) => role === 'kimi-adversary');
  if (!kimiCandidate) throw new Error('native Kimi Code did not produce a verified Candidate');

  await workflow.sendFeedback('kimi-adversary', {
    summary: 'Refine the report through one durable successor Plan without overstating the current rung.',
    findings: [
      {
        kind: 'risk', severity: 'high', path: reportPath, line: null,
        message: 'Distinguish the implemented stateless pure-cell substrate from the still-unimplemented authority path that compiles model-backed map/reduce into WorkItems, Waves, and Attempts.',
      },
      {
        kind: 'suggestion', severity: 'medium', path: reportPath, line: null,
        message: 'Make the next executable slice preserve the concise ContextSession AX while adding durable cell admission, exact route binding, restart identity, and stop/reap tests before deeper recursion.',
      },
    ],
  });
  await workflow.select('kimi-adversary',
    'Use the native Kimi adversarial review as the immutable basis for one bounded correction round.');
  const proposal = await workflow.revise(
    'Apply the typed feedback, preserve grounded source pointers, and produce a sharper dependency-ordered implementation plan.');
  if (proposal.outline.phase !== 'awaiting_plan_approval') {
    throw new Error(`revision did not pause for Plan approval: ${proposal.outline.phase}`);
  }
  await workflow.approve();
  const revised = await workflow.complete({ signal: controller.signal });
  const rounds = await workflow.rounds();
  const status = await workflow.status();
  const manifest = await workflow.evidence();

  evidence = {
    runId: workflow.id,
    initialPhase: initial.outline.phase,
    revisedPhase: revised.outline.phase,
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    attempts: status.attempts.map(({ role, state, route, candidateId }) => ({
      role, state, route, candidateId,
    })),
    rounds: rounds.section.items.map(({ value }) => ({
      kind: value.kind,
      version: value.plan.version,
      planDigest: value.plan.digest,
      selectedCandidateId: value.selection?.candidate?.id ?? null,
    })),
    manifestDigest: manifest.manifestDigest,
    checks: manifest.checks,
  };
} catch (error) {
  failure = error;
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop(controller.signal.aborted
        ? 'Signal received; fence, stop, and reap the Phase 81 dogfood Workflow.'
        : 'Phase 81 evidence captured; fence, stop, and reap every Workflow descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null,
        receiptDigest: status.stop?.receipt?.receiptDigest ?? null,
        ownership: status.ownership,
      };
    } catch (error) {
      failure ??= error;
    }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  const callerAfter = {
    status: gitBytes(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    indexTree: gitBytes(['write-tree']),
  };
  cleanup = {
    stopped,
    closed,
    callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
    callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
  };
  rmSync(deploymentRoot, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}

process.stdout.write(`${JSON.stringify({ evidence, cleanup })}\n`);
if (!cleanup?.callerStatusUnchanged || !cleanup?.callerIndexUnchanged
  || (cleanup?.closed && (cleanup.closed.closed !== true || cleanup.closed.workers !== 0))) {
  failure ??= new Error('Phase 81 dogfood cleanup proof failed');
}
if (failure) throw failure;
