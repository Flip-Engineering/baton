// Fixture: exact inspector discovery surface. The endpoint is published on the
// child stderr and /json/list answers an unauthenticated loopback client. The
// entry carries no pid field, so direct-child identity must come from the keeper.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { historicalExpectation } from '../lib/pins.mjs';
import { loopbackGet, parseBanner, waitFor } from '../lib/net.mjs';

let environment;
try {
  environment = openEnvironmentOrExit();
  if (environment.historicalPin !== null) historicalExpectation(environment, 'json-list-fields');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('json-list-fields', environment);
const child = spawn(
  '/usr/bin/env',
  ['-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
    environment.floorNode, '--inspect-brk=127.0.0.1:0', environment.helperPath('subject.mjs')],
  { cwd: environment.evidenceDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
// Observation is installed before any work so an early exit is not missed.
const exitObservation = new Promise((resolve) => {
  child.on('close', (code, signal) => resolve({ code, signal, at: Date.now() }));
  child.on('error', (error) => resolve({ error: error.code ?? String(error), at: Date.now() }));
});

let banner = null;
let list = null;
let version = null;
try {
  const found = await waitFor(() => parseBanner(stderr), 20000);
  banner = found.value;
  if (banner !== null) {
    list = await loopbackGet(banner.port, '/json/list');
    version = await loopbackGet(banner.port, '/json/version');
  }
} finally {
  child.kill('SIGKILL');
}
const observedExit = await exitObservation;

let listParsed = null;
try {
  listParsed = list === null ? null : JSON.parse(list.body);
} catch {
  listParsed = null;
}
let versionParsed = null;
try {
  versionParsed = version === null ? null : JSON.parse(version.body);
} catch {
  versionParsed = null;
}

reporter.check('banner:present', banner !== null, stderr.split('\n').slice(-3).join(' | '));
reporter.check('banner:loopback', banner !== null && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(banner.host),
  banner?.host ?? null);
reporter.check('list:status-200', list?.status === 200, list?.status ?? list?.error ?? null);
reporter.check('list:publishes-uuid', list !== null && typeof list.body === 'string' && banner !== null
  && list.body.includes(banner.uuid), null);
reporter.check('list:no-pid-field', list !== null && !/"pid"\s*:/.test(list.body), null);
reporter.check('list:entry-shape', Array.isArray(listParsed) && listParsed.length === 1
  && typeof listParsed[0].webSocketDebuggerUrl === 'string', listParsed);
reporter.check('version:names-node', typeof versionParsed?.Browser === 'string'
  && versionParsed.Browser.includes('node.js'), versionParsed);
reporter.check('subject:reaped', observedExit.signal === 'SIGKILL' || observedExit.code !== undefined, observedExit);

finish(environment, 'json-list-fields.result.json', reporter.finalize({
  banner,
  listBody: list?.body ?? null,
  listParsed,
  versionParsed,
  observedExit,
}));
