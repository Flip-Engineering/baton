// Fixture: repeated replacement refusal. Watcher delivery is event driven, so
// this fixture repeats each replacement to show the refusal is not a single
// lucky event.
import { writeFileSync, unlinkSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { historicalExpectation } from '../lib/pins.mjs';

let environment;
try {
  environment = openEnvironmentOrExit();
  if (environment.historicalPin !== null) historicalExpectation(environment, 'endpoint-replacement');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('endpoint-replacement', environment);
const module_ = await import(environment.runtimePath('cdp-endpoint.mjs'));
const { watchTargetStderr } = module_;
const work = join(environment.evidenceDir, 'endpoint-replacement-work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function trial(kind, index) {
  const path = join(work, `${kind}-${index}.stderr`);
  const temporary = `${path}.new`;
  writeFileSync(path, 'no banner yet\n');
  let failure = null;
  const handle = watchTargetStderr({ path, onFailure: (value) => (failure = value) });
  await settle(200);
  if (kind === 'rename') {
    writeFileSync(temporary, 'Debugger listening on ws://127.0.0.1:9200/gggg\n');
    renameSync(temporary, path);
  } else {
    unlinkSync(path);
    writeFileSync(path, 'Debugger listening on ws://127.0.0.1:9201/hhhh\n');
  }
  await settle(1500);
  const result = { kind, index, failure: failure?.condition ?? null };
  handle.stop();
  return result;
}

const trials = [];
for (let index = 0; index < 3; index += 1) trials.push(await trial('rename', index));
for (let index = 0; index < 3; index += 1) trials.push(await trial('unlink-recreate', index));

const renameRefused = trials.filter((entry) => entry.kind === 'rename' && entry.failure === 'endpointReplaced').length;
const unlinkRefused = trials.filter((entry) => entry.kind === 'unlink-recreate' && entry.failure === 'endpointReplaced').length;
reporter.check('rename-over:refused-3-of-3', renameRefused === 3, { renameRefused });
reporter.check('unlink-recreate:refused-3-of-3', unlinkRefused === 3, { unlinkRefused });

try {
  rmSync(work, { recursive: true, force: true });
} catch {
  // scratch cleanup is best effort
}

finish(environment, 'endpoint-replacement.result.json', reporter.finalize({ trials }));
