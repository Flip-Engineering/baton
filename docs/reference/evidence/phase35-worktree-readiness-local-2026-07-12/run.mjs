import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriver, MockAdapter } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const taskId = 'phase35-readiness-dogfood';
const runtimeRoot = join(repoRoot, '.baton', 'runtime');
const worktreeRoot = join(repoRoot, '.baton', 'wt');
const logDir = join(repoRoot, '.baton', 'evidence-phase35');
const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(here, { recursive: true });
rmSync(logDir, { recursive: true, force: true });
const dirtyBefore = git(['status', '--porcelain']).length > 0;
const adapter = new MockAdapter({
  harness: 'mock-readiness', version: '1',
  scenario: { outcome: 'completed', edits: [{ path: 'should-not-exist.txt', content: 'forbidden\n' }] },
});
const { coordinator, log } = createDriver({ repoRoot, logDir, adapters: { mock: adapter } });
const handle = await coordinator.spawn('mock', {
  goal: 'Prove a dirty checkout fails before worker effect', constraints: [], pathScope: ['**'],
  definitionOfDone: 'No worker effect occurs', verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100, usd: 0, wallMin: 1 },
}, { taskId, runId: 'phase35-worktree-readiness' });

let result;
for (let i = 0; i < 100; i += 1) {
  result = await coordinator.result(handle.id);
  if (result.status === 'failed') break;
  await sleep(5);
}
const events = log.read(handle.id);
const crash = events.find((event) => event.kind === 'lifecycle.crashed');
for (let i = 0; i < 100 && (existsSync(join(runtimeRoot, handle.id)) || existsSync(join(worktreeRoot, taskId))); i += 1) await sleep(5);
const checks = {
  dirtyPrerequisitePresent: dirtyBefore,
  failedTerminal: result?.status === 'failed',
  oneCrash: events.filter((event) => event.kind === 'lifecycle.crashed').length === 1,
  typedPhase: crash?.payload?.phase === 'worktree' && crash?.payload?.code === 'worktree_unavailable',
  fixedMessage: crash?.payload?.error === 'worktree unavailable',
  noWorkerTurn: !events.some((event) => event.actor === 'worker' && event.kind === 'lifecycle.turn_started'),
  noWorkerEdit: !events.some((event) => event.kind === 'content.file_edit'),
  noRawFailure: !JSON.stringify(crash ?? {}).includes(repoRoot),
  worktreeGone: !existsSync(join(worktreeRoot, taskId)),
  metadataGone: !existsSync(join(worktreeRoot, `${taskId}.meta.json`)),
  runtimeGone: !existsSync(join(runtimeRoot, handle.id)),
  branchGone: git(['branch', '--list', `baton/${taskId}`]) === '',
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId: handle.id,
  outcome: result?.status ?? null,
  crash: crash ? { kind: crash.kind, actor: crash.actor, payload: crash.payload, taskId: crash.taskId, runId: crash.runId } : null,
  checks, pass: Object.values(checks).every(Boolean),
};
writeFileSync(join(here, 'events.jsonl'), events.filter((event) => ['lifecycle.crashed'].includes(event.kind)).map((event) => `${JSON.stringify(event)}\n`).join(''));
writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(logDir, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks }, null, 2));
if (!summary.pass) process.exitCode = 1;
