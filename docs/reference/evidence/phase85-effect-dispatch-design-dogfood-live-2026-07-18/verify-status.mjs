import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const [deploymentRoot, runId] = process.argv.slice(2);
if (!deploymentRoot || !runId) {
  throw new Error('usage: verify-status.mjs <exact-deployment-root> <exact-run-id>');
}
const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot,
    routes: [
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
    ],
    verification: {
      command: 'node', arguments: [
        '--test', 'impl/test/phase85-context-effect-admission-red.test.mjs',
        'impl/test/phase85-context-call-envelope-red.test.mjs',
      ],
    },
  },
});
let record;
try {
  const status = await baton.open(runId).status();
  record = {
    schemaVersion: 1, runId, phase: status.phase,
    attempts: status.attempts.map(({ role, state, activity, terminalCause }) => ({
      role, state, activity, terminalCause,
    })),
  };
} finally {
  record = { ...record, close: (await baton.close()).ownership };
}
writeFileSync(join(evidenceDir, 'status-after-ax-fix.json'),
  `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(record)}\n`);
if (!record.attempts.every((attempt) => (
  attempt.activity?.turnCount >= 1
    && attempt.activity.state === 'exited'
    && attempt.terminalCause?.code === 'recovery_terminalized'
)) || record.attempts.find((attempt) => attempt.role === 'dispatch-design-architect')
  ?.activity?.usage?.tokens <= 0
  || !record.close?.closed || record.close.workers !== 0) {
  throw new Error('replayed workflow status did not preserve truthful activity and cause');
}
