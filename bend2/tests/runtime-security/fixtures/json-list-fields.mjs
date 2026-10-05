// Fixture: exact inspector discovery surface. The endpoint is published on the
// child stderr and /json/list answers an unauthenticated loopback client. The
// entry carries no pid field, so direct-child identity must come from the keeper.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, loadEnvironment } from '../lib/env.mjs';
import { createReport, finish, failEnvironment } from '../lib/assert.mjs';
import { loopbackGet, parseBanner, waitFor } from '../lib/net.mjs';

let environment;
try {
  environment = loadEnvironment();
} catch (error) {
  if (error instanceof EnvironmentRefusal) failEnvironment(error.condition, error.detail);
  throw error;
}

const reporter = createReport('json-list-fields', environment, environment.expect);
const subject = environment.helperPath('subject.mjs');
const child = spawn(
  '/usr/bin/env',
  ['-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
    environment.floorNode, '--inspect-brk=127.0.0.1:0', subject],
  { cwd: environment.evidenceDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));

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
  await new Promise((resolve) => child.on('close', resolve));
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

finish(environment, 'json-list-fields.result.json', reporter.finalize({
  banner,
  listBody: list?.body ?? null,
  listParsed,
  versionParsed,
}));
