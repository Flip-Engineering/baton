// Fixture: stderr endpoint watch refusal behavior against the admitted closure.
//
// Claims: a banner split across appends is found; a replaced or recreated file
// is refused as endpointReplaced; truncation below the consumed offset is
// refused as endpointTruncated; a missing file is refused through the module
// failure channel without a throw.
//
// No historical expectation is registered for this fixture: the pre-fix stderr
// throw belongs to a source revision whose digest this critic did not retain, so
// it is not asserted against any closure. A historical pin therefore refuses.
import { openSync, writeSync, writeFileSync, closeSync, unlinkSync, renameSync, mkdirSync, truncateSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { requirePin } from '../lib/pins.mjs';

let environment;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['endpoint-watch']);
  if (environment.pin !== null) requirePin(environment, 'endpoint-watch');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('endpoint-watch', environment);
const { watchTargetStderr, parseInspectorBanner } = await import(environment.runtimePath('cdp-endpoint.mjs'));

const work = join(environment.evidenceDir, 'endpoint-watch-work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const observations = {};

observations.parse = {
  loopback: parseInspectorBanner('Debugger listening on ws://127.0.0.1:5/abc\n'),
  localhost: parseInspectorBanner('Debugger listening on ws://localhost:5/abc\n'),
  remote: parseInspectorBanner('Debugger listening on ws://10.0.0.5:5/abc\n'),
  noNewline: parseInspectorBanner('Debugger listening on ws://127.0.0.1:5/abc'),
};
reporter.check('parse:loopback-accepted', observations.parse.loopback !== null, observations.parse.loopback);
reporter.check('parse:remote-refused', observations.parse.remote === null, observations.parse.remote);
reporter.check('parse:incomplete-line-not-accepted', observations.parse.noNewline === null, observations.parse.noNewline);

async function scenario(name, action, options = {}) {
  const expectFailure = options.expectFailure ?? null;
  const path = join(work, `${name}.stderr`);
  const temporary = `${path}.new`;
  writeFileSync(path, 'no banner yet\n');
  let endpoint = null;
  let failure = null;
  const handle = watchTargetStderr({
    path,
    onEndpoint: (value) => (endpoint = value),
    onFailure: (value) => (failure = value),
  });
  await settle();
  await action({ path, temporary, handle });
  await settle(400);
  const observed = { endpoint, failure: failure?.condition ?? null, detail: failure?.detail ?? null };
  handle.stop();
  observations[name] = observed;
  if (expectFailure !== null) {
    reporter.check(`${name}:refused-as-${expectFailure}`, observed.failure === expectFailure, observed);
  }
  return observed;
}

await scenario('split-append', async ({ path }) => {
  const fd = openSync(path, 'a');
  writeSync(fd, 'Debugger listening on ws://127.0.0.1:9001/aaaa');
  closeSync(fd);
  await settle(250);
  const fd2 = openSync(path, 'a');
  writeSync(fd2, 'bbbb\n');
  closeSync(fd2);
});
reporter.check('split-append:endpoint-found', observations['split-append'].endpoint !== null,
  observations['split-append']);

await scenario('rename-over', async ({ path, temporary }) => {
  writeFileSync(temporary, 'Debugger listening on ws://127.0.0.1:9002/cccc\n');
  renameSync(temporary, path);
}, { expectFailure: 'endpointReplaced' });

await scenario('unlink-recreate', async ({ path }) => {
  unlinkSync(path);
  writeFileSync(path, 'Debugger listening on ws://127.0.0.1:9003/dddd\n');
}, { expectFailure: 'endpointReplaced' });

await scenario('truncate', async ({ path }) => {
  truncateSync(path, 2);
}, { expectFailure: 'endpointTruncated' });

{
  const path = join(work, 'missing.stderr');
  let failure = null;
  let threw = null;
  try {
    watchTargetStderr({ path, onFailure: (value) => (failure = value) });
  } catch (error) {
    threw = error.code ?? String(error);
  }
  await settle();
  observations['missing-file'] = { threw, failure: failure?.condition ?? null };
  reporter.check('missing-file:refused-without-throw',
    threw === null && observations['missing-file'].failure === 'endpointWatchFailed', observations['missing-file']);
}

try {
  rmSync(work, { recursive: true, force: true });
} catch {
  // scratch cleanup is best effort; results are retained
}

finish(environment, 'endpoint-watch.result.json', reporter.finalize({ observations }));
