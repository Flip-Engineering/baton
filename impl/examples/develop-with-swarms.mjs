// A host-owned self-development policy using the ordinary swarm SDK. Verification records a
// check; the caller still decides whether to review/accept/integrate the captured contribution.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openBaton } from '../src/index.mjs';

export async function developWithSwarms({ repo, task, evidencePath }) {
  const deployment = await openBaton({ repo, advanced: {
    routes: task.routes ?? [task.route], deploymentRoot: task.deploymentRoot,
    verification: task.verification,
  } });
  let swarm;
  let participant;
  const evidence = {};
  try {
    // Optional resident publication uses Baton's existing authenticated discovery. An external
    // root can connectBaton({ repo }).swarms.open(id) without borrowing a participant credential.
    if (task.host === true) evidence.host = await deployment.host();
    swarm = await deployment.swarms.create(task.purpose ?? 'Develop Baton using Baton');
    evidence.swarmId = swarm.id;
    const { harness, model, effort } = task.route;
    participant = await swarm.recruit(task.participantId, task.objective, {
      exact: { harness, model, effort }, scope: task.scope,
      ...(task.permissions ? { permissions: task.permissions } : {}),
    });
    evidence.participant = participant;
    let view = await swarm.view();
    for (;;) {
      const current = view.participants.find((row) => row.participantId === participant.participantId);
      if (current?.runtime.turn === 'paused') break;
      if (['dead', 'exited'].includes(current?.runtime.state)) {
        throw new Error(`Participant transport ended before a contribution boundary: ${current.runtime.state}`);
      }
      view = await swarm.watch();
    }
    evidence.capture = await swarm.capture(participant.participantId, 'implementation');
    evidence.check = await swarm.check(participant.participantId, 'implementation', 'initial');
    evidence.afterCheck = await swarm.view();
    return evidence;
  } catch (error) {
    evidence.failure = { code: error.code ?? null, message: error.message };
    throw error;
  } finally {
    const cleanupErrors = [];
    // Capture failure must not erase the collaboration findings and native observations when
    // private harness homes are subsequently removed by explicit stop.
    if (swarm) {
      try { evidence.beforeStop = await swarm.view(); }
      catch (error) { evidence.observationError = { code: error.code, message: error.message }; }
    }
    try {
      if (swarm && participant) evidence.stop = await swarm.stop(participant.participantId, 'Contribution preserved for root review.');
    } catch (error) {
      evidence.stopError = { code: error.code, message: error.message };
      cleanupErrors.push(error);
    }
    try { evidence.deployment = await deployment.close(); }
    catch (error) {
      evidence.deploymentError = { code: error.code, message: error.message };
      cleanupErrors.push(error);
    }
    if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Self-development cleanup is incomplete; see evidence');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repo, taskPath, evidencePath] = process.argv.slice(2);
  const task = JSON.parse(await readFile(taskPath, 'utf8'));
  const result = await developWithSwarms({ repo, task, evidencePath });
  console.log(JSON.stringify({ sha: result.capture.sha, passed: result.check.passed, authorTurnAfterCheck:
    result.afterCheck.participants.find((row) => row.participantId === task.participantId)?.runtime.turn }));
}
