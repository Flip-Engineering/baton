// Fixture: exact inspector discovery surface. The endpoint is published on the
// child stderr and /json/list answers an unauthenticated loopback client; the
// entry carries no pid field, so direct-child identity must come from the
// keeper. Raw streams and awaited custody run on every path.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment, writeStream } from '../lib/assert.mjs';
import { cleanupOwned, own } from '../lib/children.mjs';
import { requirePin } from '../lib/pins.mjs';
import { loopbackGet, parseBanner, waitFor } from '../lib/net.mjs';

let environment;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['json-list-fields']);
  if (environment.pin !== null) requirePin(environment, 'json-list-fields');
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
const custody = own(child);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));

let banner = null;
let list = null;
let version = null;
let bodyFailure = null;
let rawStdout = null;
let rawStderr = null;
let custodyReport = null;

try {
  const found = await waitFor(() => parseBanner(stderr), 20000);
  banner = found.value;
  if (banner !== null) {
    list = await loopbackGet(banner.port, '/json/list');
    version = await loopbackGet(banner.port, '/json/version');
  }
} catch (error) {
  bodyFailure = String(error?.stack ?? error);
} finally {
  // Awaited custody first: a kill request is asynchronous, so trailing pipe data
  // may still arrive. Streams are persisted after closure and labelled partial
  // when closure was not observed.
  custody.kill('SIGKILL');
  custodyReport = await cleanupOwned({ timeoutMs: 5000 });
  const partial = child.pid !== undefined && custodyReport.unresolved.includes(child.pid);
  rawStdout = { ...writeStream(environment, 'json-list-fields.subject.stdout.txt', stdout), partial };
  rawStderr = { ...writeStream(environment, 'json-list-fields.subject.stderr.txt', stderr), partial };
}

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

reporter.check('fixture:no-uncaught-failure', bodyFailure === null, bodyFailure);
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
reporter.check('custody:owned-child-resolved', custodyReport.unresolved.length === 0, custodyReport);

reporter.note(custodyReport.signalObservation);
finish(environment, 'json-list-fields.result.json', reporter.finalize({
  banner,
  listBody: list?.body ?? null,
  listParsed,
  versionParsed,
  bodyFailure,
  rawStdout,
  rawStderr,
  custody: custodyReport,
}));
