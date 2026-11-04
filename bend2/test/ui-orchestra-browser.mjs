// #682 browser qualification, two phases (remote-only):
// Phase A drives the real `view` command and its elected native-owner event stream.
// Phase B uses the in-process server seam to exercise reconnect-cursor and gap
// recovery over the same committed database.
// Usage: node ui-orchestra-browser.mjs EXE WORKDIR OUTDIR [CHROMIUM]
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestraServer } from '../ui/orchestra/server.mjs';
import { qualifyKnowledgeGraphs } from './ui-knowledge-graph-browser.mjs';

const [EXE, WORK, OUT, CHROMIUM] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] || 'chromium'];
const DB = join(WORK, 'orchestra.db');
const CAPTURE_ONLY = process.env.FINAL_NATIVE_CONTEXT_BROWSER_CAPTURE_ONLY === 'true';
let view = null;
let view2 = null;
let chrome = null;
let retainBrowserFailure = null;
let retainedFailure = null;
let primaryFailure = null;
let lastEvaluation = null;
let activeWait = null;
let lastCoordinatorCall = null;
const fixtureCommands = [];
const fixtureFindings = new Map();

function errorRecord(error, seen = new Set()) {
  if (error === null || typeof error !== 'object') return { value: String(error) };
  if (seen.has(error)) return { circular: true };
  seen.add(error);
  const result = {};
  for (const key of ['name', 'message', 'stack', 'code', 'errno', 'syscall', 'path']) {
    if (error[key] !== undefined) result[key] = String(error[key]);
  }
  if (error.cause !== undefined) result.cause = errorRecord(error.cause, seen);
  if (error.retentionError !== undefined) result.retentionError = errorRecord(error.retentionError, seen);
  if (Array.isArray(error.errors)) result.errors = error.errors.map((item) => errorRecord(item, seen));
  if (error.fixtureCheck) result.check = error.fixtureCheck;
  if (error.coordinatorCall) result.coordinatorCall = error.coordinatorCall;
  if (error.cdpException) result.cdpException = error.cdpException;
  return result;
}

function writeFailureRecord() {
  try {
    writeFileSync(join(OUT, 'assertion-failure-dom.json'), JSON.stringify(retainedFailure, null, 2) + '\n');
  } catch (error) {
    console.error('Browser failure metadata retention error: ' + error.stack);
    retainedFailure.metadataRetentionError = errorRecord(error);
  }
}

function retainFixtureCommands() {
  writeFileSync(join(OUT, 'fixture-commands.json'), JSON.stringify(fixtureCommands, null, 2) + '\n');
}

function spawnTracked(...args) {
  const child = spawn(...args);
  child.closed = new Promise((resolve) => child.once('close', resolve));
  return child;
}

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) {
    const error = new Error(name + ': ' + detail);
    error.fixtureCheck = { name, detail, evaluation: lastEvaluation };
    throw error;
  }
}

function baton(...args) {
  const argv = [DB, ...args];
  const r = spawnSync(EXE, argv, { encoding: 'utf8' });
  lastCoordinatorCall = { executable: EXE, argv, status: r.status, signal: r.signal,
    stdout: r.stdout, stderr: r.stderr, error: r.error ? errorRecord(r.error) : null };
  if (r.status !== 0) {
    const error = new Error(`baton2 ${args[0]} failed: ${r.stdout}${r.stderr}`, { cause: r.error });
    error.coordinatorCall = lastCoordinatorCall;
    throw error;
  }
  fixtureCommands.push({ sequence: fixtureCommands.length + 1, ...lastCoordinatorCall });
  if (args[0] === 'record') {
    fixtureFindings.set(String(args[1]), { id: String(args[1]), author: String(args[2]) });
  }
  return r.stdout.trim();
}

async function qualify() {
try {
mkdirSync(OUT, { recursive: true });
// --- fixture: root conductor -> lead associate conductor -> worker/aide, ensemble+section
mkdirSync(WORK, { recursive: true });
const REPO = join(WORK, 'repo');
mkdirSync(REPO, { recursive: true });
for (const args of [['init', '-q'], ['config', 'user.name', 'UI fixture'],
                    ['config', 'user.email', 'ui-fixture@example.invalid'],
                    ['commit', '-qm', 'Initial tree', '--allow-empty']]) {
  spawnSync('git', ['-C', REPO, ...args], { stdio: 'inherit' });
}
baton('attach', 'root', 'fixture', 'root-native', '');
baton('role', 'root', 'principal-conductor');
for (const [name, parent] of [['lead', 'root'], ['worker', 'lead'], ['aide', 'lead']]) {
  const ws = join(WORK, name);
  baton('recruit', name, parent, 'muse', 'configured-model', 'low', REPO, `${name}-branch`, ws, 'HEAD');
}
baton('role', 'lead', 'associate-conductor');
baton('ensemble', 'qa-ensemble', 'lead', 'tight');
baton('ensemble-member', 'qa-ensemble', 'lead', 'lead', 'add');
baton('ensemble-member', 'qa-ensemble', 'lead', 'worker', 'add');
baton('ensemble-member', 'qa-ensemble', 'lead', 'aide', 'add');
baton('section', 'qa-ensemble', 'qa-section', 'lead', 'qualification coverage');
baton('section-member', 'qa-ensemble', 'qa-section', 'lead', 'worker', 'add');
baton('message', 'qa-task-1', 'root', 'worker', 'task', 'Retained task input.');
const parentState = JSON.parse(baton('session', 'lead'));
const parentReviewer = join(WORK, 'lead-completion-review.cjs');
writeFileSync(parentReviewer,
  `const {spawnSync} = require('node:child_process');\n` +
  `const coordinator = (...args) => {\n` +
  `  const result = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, ...args], {encoding:'utf8'});\n` +
  `  if (result.status !== 0) throw new Error(result.stdout + result.stderr);\n` +
  `  return JSON.parse(result.stdout);\n` +
  `};\n` +
  `const request = process.argv.at(-1);\n` +
  `const message = coordinator('delivery', request);\n` +
  `if (message.recipient !== 'lead') throw new Error(JSON.stringify(message));\n` +
  `if (message.kind === 'completion-request') {\n` +
  `  if (message.sender !== 'worker' || message.body !== 'Worker completed the assigned task.') throw new Error(JSON.stringify(message));\n` +
  `  const completion = coordinator('session', 'worker').taskCompletion;\n` +
  `  if (completion.coordinator !== 'lead' || completion.requestId !== request) throw new Error(JSON.stringify(completion));\n` +
  `  const assignment = coordinator('delivery', completion.assignmentId);\n` +
  `  if (assignment.recipient !== 'worker') throw new Error(JSON.stringify(assignment));\n` +
  `  coordinator('as', 'lead', 'read', request);\n` +
  `  coordinator('message', request + ':confirmed', 'lead', 'worker', 'completion-confirmed', request);\n` +
  `}\n`);
baton('connect', 'lead', parentState.native, JSON.stringify([process.execPath, parentReviewer]));
const workerCmd = join(WORK, 'worker-native');
writeFileSync(workerCmd, `#!${process.execPath}\n` +
  `const {readFileSync} = require('node:fs'); const {spawnSync} = require('node:child_process');\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'turn.input.user',payload:{kind:'turn_input_user',command_id:'worker-primary'}}));\n` +
  `const {DatabaseSync} = require('node:sqlite');\n` +
  `const readinessDb = new DatabaseSync(${JSON.stringify(DB)}, {readOnly:true});\n` +
  `readinessDb.exec('PRAGMA busy_timeout = 250');\n` +
  `const readiness = readinessDb.prepare('SELECT e.phase,s.native FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=? AND e.directory=?');\n` +
  `const readinessPause = new Int32Array(new SharedArrayBuffer(4));\n` +
  `try {\n` +
  `  while (true) {\n` +
  `    const current = readiness.get('worker', process.env.BATON_ATTEMPT_DIRECTORY);\n` +
  `    if (current?.phase === 'running' && current.native === 'native-worker') break;\n` +
  `    if (!current || current.phase === 'exited') throw new Error('Fixture worker execution is unavailable: ' + JSON.stringify(current));\n` +
  `    Atomics.wait(readinessPause, 0, 0, 10);\n` +
  `  }\n` +
  `} finally { readinessDb.close(); }\n` +
  `const prompt = readFileSync(process.argv[process.argv.indexOf('--prompt-file')+1], 'utf8');\n` +
  `const inputs = ['qa-task-1', ...[...prompt.matchAll(/^Message \\([^\\n]*\\) from [^\\n]* \\[id: (.*?)\\]:$/gm)].map((match) => match[1])];\n` +
  `for (const id of new Set(inputs)) {\n` +
  `  const delivered = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, 'delivery', id], {encoding:'utf8'});\n` +
  `  if (delivered.status !== 0 || JSON.parse(delivered.stdout).recipient !== 'worker') throw new Error(delivered.stderr || 'wrong fixture recipient');\n` +
  `  const accepted = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, 'as', 'worker', 'read', id], {encoding:'utf8'});\n` +
  `  if (accepted.status !== 0) throw new Error(accepted.stdout + accepted.stderr);\n` +
  `}\n` +
  `const coordinator = (...args) => {\n` +
  `  const result = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, ...args], {encoding:'utf8'});\n` +
  `  if (result.status !== 0) throw new Error(result.stdout + result.stderr);\n` +
  `  return JSON.parse(result.stdout);\n` +
  `};\n` +
  `const state = coordinator('session', 'worker');\n` +
  `const completion = state.taskCompletion;\n` +
  `if (!completion.open || completion.coordinator !== state.parent) throw new Error(JSON.stringify(state));\n` +
  `const assignment = coordinator('delivery', completion.assignmentId);\n` +
  `if (assignment.recipient !== 'worker') throw new Error(JSON.stringify(assignment));\n` +
  `const request = 'qa-worker-completion:' + completion.assignmentId;\n` +
  `const resultText = 'Worker completed the assigned task.';\n` +
  `coordinator('message', request, 'worker', completion.coordinator, 'completion-request', resultText);\n` +
  `const reviewed = coordinator('delivery', request);\n` +
  `if (reviewed.sender !== 'worker' || reviewed.recipient !== completion.coordinator || reviewed.kind !== 'completion-request' || reviewed.body !== resultText) throw new Error(JSON.stringify(reviewed));\n` +
  `const confirmation = request + ':confirmed';\n` +
  `const confirmed = coordinator('delivery', confirmation);\n` +
  `if (confirmed.sender !== completion.coordinator || confirmed.recipient !== 'worker' || confirmed.kind !== 'completion-confirmed' || confirmed.body !== request) throw new Error(JSON.stringify(confirmed));\n` +
  `coordinator('as', 'worker', 'read', confirmation);\n` +
  `const settled = coordinator('session', 'worker').taskCompletion;\n` +
  `if (settled.assignmentId !== completion.assignmentId || settled.requestId !== request || !settled.confirmed || settled.open) throw new Error(JSON.stringify(settled));\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'run.terminal.completed',payload:{kind:'run_terminal',terminal:'completed',command_id:'worker-primary',text:'Worker completed the assigned task.'}}));\n`);
chmodSync(workerCmd, 0o755);
writeFileSync(join(WORK, 'worker-task.txt'), 'Task for worker');
{
  const argv = [DB, 'turn', 'worker', 'worker-finished', workerCmd, 'configured-model', 'low',
    join(WORK, 'worker'), join(WORK, 'worker-task.txt'), join(WORK, 'worker.jsonl'), ''];
  const turn = spawnSync(EXE, argv, { encoding: 'utf8' });
  fixtureCommands.push({sequence: fixtureCommands.length + 1, executable: EXE, argv,
    status: turn.status, signal: turn.signal, stdout: turn.stdout, stderr: turn.stderr,
    error: turn.error ? errorRecord(turn.error) : null});
  if (turn.status !== 0) throw new Error('fixture turn: ' + turn.stdout + turn.stderr);
}
{
  const worker = JSON.parse(baton('session', 'worker'));
  check('the worker assignment has coordinator confirmation',
    worker.taskCompletion.confirmed && !worker.taskCompletion.open, JSON.stringify(worker));
  // Later display probes retain input for the same recorded native session.
  baton('connect', 'worker', worker.native, '');
  baton('connect', parentState.id, parentState.native, parentState.endpoint);
}
baton('record', 'qa-worker-finding', 'worker', 'Worker retained finding.',
  'Worker evidence.', 'Worker limits.');
baton('record', 'qa-aide-finding', 'aide', 'Aide retained finding.',
  'Aide evidence.', 'Aide limits.');
baton('promote', 'qa-worker-share', 'aide', 'worker', 'aide', 'qa-worker-finding');
// The coordinator records a promotion under its destination, so the lead
// promotes the worker finding from the worker to itself; the author and
// source stay the worker while the destination and promoter are the lead.
baton('promote', 'qa-lead-share', 'lead', 'worker', 'lead', 'qa-worker-finding');
if (!CAPTURE_ONLY) {
  baton('promote-scoped', 'qa-group-share', 'lead', 'session', 'worker',
    'group', 'qa-ensemble', 'qa-worker-finding');
}
baton('record', 'qa-msg-finding', 'worker', 'Worker message finding.',
  'message:qa-task-1', 'Worker message limits.');
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.exec('CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL)');
  db.prepare(`INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES
    ('qa-rel-msg','worker','finding:qa-msg-finding','evidenced by','message:qa-task-1'),
    ('qa-rel-ext','worker','finding:qa-worker-finding','recorded in','external:qa-log-7'),
    ('qa-rel-gone','worker','finding:qa-worker-finding','answers','message:qa-missing-1'),
    ('qa-rel-orphan','worker','finding:qa-nope','continues','finding:qa-worker-finding'),
    ('qa-rel-refs','worker','message:qa-missing-1','references','external:qa-log-8')`).run();
  db.close();
}

// This expectation describes the initial fixture before replacement and live records.
const initialFindings = [...fixtureFindings.values()];
const initialWorkerRecords = initialFindings.filter((finding) => finding.author === 'worker').length;
const initialScopeText = {
  worker: `Individual: worker · ${initialWorkerRecords} records`,
  all: `All tiers · ${initialFindings.length} records`,
};

async function fileIdentity(path) {
  try {
    const actual = realpathSync(path);
    const stat = statSync(actual);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(actual)) hash.update(chunk);
    return { path, resolvedPath: actual, bytes: stat.size, sha256: hash.digest('hex'),
      device: stat.dev, inode: stat.ino };
  } catch (error) {
    return { path, error: errorRecord(error) };
  }
}
function executablePath(value) {
  if (isAbsolute(value) || value.includes('/')) return resolve(value);
  return (process.env.PATH || '').split(delimiter).map((dir) => join(dir, value))
    .find((path) => existsSync(path)) || value;
}
const driverPath = fileURLToPath(import.meta.url);
const driverRoot = resolve(dirname(driverPath), '../..');
const driverGit = spawnSync('git', ['-C', driverRoot, 'rev-parse', '--show-toplevel', 'HEAD'], { encoding: 'utf8' });
const importedServer = fileURLToPath(new URL('../ui/orchestra/server.mjs', import.meta.url));
const coordinatorPath = executablePath(EXE);
const executableDirectory = dirname(realpathSync(coordinatorPath));
const nativeServerCandidates = [resolve(executableDirectory, '../libexec/baton2/ui/server.mjs'),
  resolve(executableDirectory, '../../bend2/ui/orchestra/server.mjs')];
const nativeServer = nativeServerCandidates.find((path) => existsSync(path));
const assetDirectories = [...new Set([dirname(importedServer), ...(nativeServer ? [dirname(nativeServer)] : [])])];
const assetIdentities = [];
for (const directory of assetDirectories) {
  for (const name of readdirSync(directory).filter((name) => /\.(js|mjs|css|html)$/.test(name)).sort()) {
    assetIdentities.push(await fileIdentity(join(directory, name)));
  }
  for (const name of ['fixture-knowledge.json', 'fixture-knowledge-empty.json']) {
    assetIdentities.push(await fileIdentity(join(directory, 'fixtures', name)));
  }
}
// The file hashes identify source and packaged assets; the binary hash identifies the compiled core.
writeFileSync(join(OUT, 'provenance.json'), JSON.stringify({
  driver: await fileIdentity(driverPath),
  driverGit: { argv: driverGit.spawnargs || ['git', '-C', driverRoot, 'rev-parse', '--show-toplevel', 'HEAD'],
    status: driverGit.status, stdout: driverGit.stdout, stderr: driverGit.stderr,
    error: driverGit.error ? errorRecord(driverGit.error) : null },
  coordinator: { requested: EXE, ...await fileIdentity(coordinatorPath) }, node: await fileIdentity(process.execPath),
  chromium: { requested: CHROMIUM, ...await fileIdentity(executablePath(CHROMIUM)) },
  databasePath: DB, captureOnly: CAPTURE_ONLY,
  importedServer: await fileIdentity(importedServer),
  nativeServerSelection: { candidates: nativeServerCandidates, selectedCandidateByExistence: nativeServer || null,
    basis: 'Candidate path order from ui-view.bend; actual serving is established by retained HTTP responses.' },
  uiAssets: assetIdentities,
  initialFixtureCommands: fixtureCommands.slice(), initialFindings, initialScopeText,
  fixtureCommandCoverage: 'Public calls through this driver baton wrapper; native callback calls and direct SQL writes are outside this transcript.',
}, null, 2) + '\n');

// --- chromium over CDP
chrome = spawnTracked(CHROMIUM, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0',
  `--user-data-dir=${join(WORK, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeErr = '';
const wsUrl = await new Promise((resolve, reject) => {
  chrome.stderr.on('data', (d) => {
    chromeErr += d;
    const m = chromeErr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.once('error', reject);
  chrome.once('exit', (c) => reject(new Error(`chromium exited ${c}: ${chromeErr}`)));
}).catch((e) => { console.log('FAIL chromium startup — ' + e.message); throw e; });

let msgId = 0;
const pendingCalls = new Map();
const pendingNavigations = new Map();
const overviewProbeResponses = [];
let pageWs = null;
function attach(ws) {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Page.lifecycleEvent' && msg.params?.name === 'DOMContentLoaded') {
      const navigation = pendingNavigations.get(ws);
      if (navigation) {
        navigation.loaded.add(msg.params.loaderId);
        if (navigation.loaderId === msg.params.loaderId) navigation.resolve();
      }
    }
    if (msg.id && pendingCalls.has(msg.id)) {
      const call = pendingCalls.get(msg.id);
      pendingCalls.delete(msg.id);
      if (msg.error) call.reject(new Error(JSON.stringify(msg.error)));
      else call.resolve(msg);
    }
  };
  ws.onerror = (event) => {
    console.log(`CDP websocket error: ${event.message || event.type}`);
    pendingNavigations.get(ws)?.reject(new Error(`CDP websocket error: ${event.message || event.type}`));
    for (const [id, call] of pendingCalls) {
      if (call.ws === ws) {
        call.reject(new Error(`CDP websocket error: ${event.message || event.type}`));
        pendingCalls.delete(id);
      }
    }
  };
  ws.onclose = (event) => {
    pendingNavigations.get(ws)?.reject(new Error(`CDP connection closed ${event.code}: ${event.reason}`));
    for (const [id, call] of pendingCalls) {
      if (call.ws === ws) {
        call.reject(new Error(`CDP connection closed ${event.code}: ${event.reason}`));
        pendingCalls.delete(id);
      }
    }
  };
}
function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { ws, resolve, reject });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) { pendingCalls.delete(id); reject(error); }
  });
}
async function navigatePage(ws, url) {
  const navigation = { loaderId: null, loaded: new Set() };
  const loaded = new Promise((resolve, reject) => Object.assign(navigation, { resolve, reject }));
  pendingNavigations.set(ws, navigation);
  try {
    await Promise.all([
      send(ws, 'Page.navigate', { url }).then((response) => {
        if (response.result.errorText) throw new Error(JSON.stringify(response.result));
        navigation.loaderId = response.result.loaderId;
        if (!navigation.loaderId) throw new Error('Navigation returned no document loader: ' + JSON.stringify(response.result));
        if (navigation.loaded.has(navigation.loaderId)) navigation.resolve();
      }),
      loaded,
    ]);
  } finally {
    pendingNavigations.delete(ws);
  }
}

async function openPage(url) {
  let response;
  try {
    response = await fetch(
      wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '/json/new?about:blank'),
      { method: 'PUT' },
    );
  } catch (error) {
    const failure = new Error(
      `Chromium target request failed; exit=${chrome.exitCode}; signal=${chrome.signalCode}; stderr=${chromeErr}`,
      { cause: error },
    );
    const diagnostic = {
      requestedExecutable: CHROMIUM,
      requestedArgv: chrome.spawnargs,
      pid: chrome.pid,
      exitCode: chrome.exitCode,
      signalCode: chrome.signalCode,
      devToolsUrl: wsUrl,
      targetUrl: wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '/json/new?about:blank'),
      profile: join(WORK, 'chrome'),
      stderr: chromeErr,
      error: { message: error.message, code: error.code,
        cause: error.cause && { message: error.cause.message, code: error.cause.code,
          socket: error.cause.socket } },
    };
    for (const [name, read] of [
      ['actualArgv', () => readFileSync(`/proc/${chrome.pid}/cmdline`, 'utf8').split('\0').filter(Boolean)],
      ['actualExecutable', () => readlinkSync(`/proc/${chrome.pid}/exe`)],
      ['processStat', () => readFileSync(`/proc/${chrome.pid}/stat`, 'utf8')],
      ['profileStat', () => {
        const state = statSync(join(WORK, 'chrome'));
        return { device: state.dev, inode: state.ino, uid: state.uid, mode: state.mode,
          isDirectory: state.isDirectory() };
      }],
      ['profileEntries', () => readdirSync(join(WORK, 'chrome'))],
      ['devToolsActivePort', () => readFileSync(join(WORK, 'chrome', 'DevToolsActivePort'), 'utf8')],
    ]) {
      try { diagnostic[name] = read(); }
      catch (observationError) {
        diagnostic[name] = { error: observationError.message, code: observationError.code };
      }
    }
    try {
      writeFileSync(join(OUT, 'chromium-target-failure.json'), JSON.stringify(diagnostic, null, 2) + '\n');
    } catch (retentionError) {
      failure.retentionError = retentionError;
    }
    throw failure;
  }
  if (!response.ok) throw new Error(await response.text());
  const page = await response.json();
  if (pageWs) pageWs.close();
  pageWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    pageWs.onopen = resolve;
    pageWs.onerror = reject;
    pageWs.onclose = (event) => reject(new Error(`CDP closed before open ${event.code}: ${event.reason}`));
  });
  attach(pageWs);
  await send(pageWs, 'Runtime.enable');
  await send(pageWs, 'Page.enable');
  await send(pageWs, 'Page.setLifecycleEventsEnabled', { enabled: true });
  await send(pageWs, 'Performance.enable');
  navigationRedrawStart = await beginRedrawEvidence('page navigation ' + url);
  await navigatePage(pageWs, url);
}
async function evalJs(expression) {
  lastEvaluation = { expression };
  const observesOverview = expression.includes('/orchestra/knowledge/overview');
  const observedExpression = observesOverview ? `(async () => {
    const responses = [];
    const fetch = async (...args) => {
      const response = await globalThis.fetch(...args);
      responses.push({
        requestedUrl: new URL(String(args[0]), location.href).href,
        responseUrl: response.url,
        status: response.status,
        headers: [...response.headers.entries()],
        contentType: response.headers.get('content-type'),
        body: await response.clone().text(),
      });
      return response;
    };
    const value = await (${expression});
    return { value, responses };
  })()` : expression;
  const r = await send(pageWs, 'Runtime.evaluate', { expression: observedExpression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const error = new Error(JSON.stringify(r.result.exceptionDetails));
    error.cdpException = r.result.exceptionDetails;
    throw error;
  }
  const value = r.result && r.result.result ? r.result.result.value : undefined;
  if (!observesOverview) return value;
  const probe = { expression, responses: value.responses };
  overviewProbeResponses.push(probe);
  writeFileSync(join(OUT, 'overview-probe-responses.json'), JSON.stringify(overviewProbeResponses, null, 2) + '\n');
  for (const [index, response] of probe.responses.entries()) {
    writeFileSync(join(OUT, `overview-probe-${overviewProbeResponses.length}-${index + 1}.body`), response.body);
  }
  return value.value;
}
const redrawEvidence = [];
let navigationRedrawStart = null;
async function readRenderMetrics() {
  try {
    const reply = await send(pageWs, 'Performance.getMetrics');
    if (reply.error || !Array.isArray(reply.result?.metrics)) return { error: reply };
    return { metrics: Object.fromEntries(reply.result.metrics.map((metric) => [metric.name, metric.value])) };
  } catch (error) { return { error: { name: error.name, message: error.message } }; }
}
async function beginRedrawEvidence(label) {
  return { label, startedUtc: new Date().toISOString(), startedWallMs: Date.now(), before: await readRenderMetrics() };
}
async function finishRedrawEvidence(start) {
  const after = await readRenderMetrics();
  const deltaSeconds = {};
  for (const name of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']) {
    deltaSeconds[name] = typeof start.before.metrics?.[name] === 'number' && typeof after.metrics?.[name] === 'number'
      ? after.metrics[name] - start.before.metrics[name] : null;
  }
  redrawEvidence.push({ ...start, endedUtc: new Date().toISOString(), wallMs: Date.now() - start.startedWallMs,
    after, deltaSeconds, scope: 'Browser script, style, layout and task work during the existing redraw/readiness interval.' });
  writeFileSync(join(OUT, 'render-duration-evidence.json'), JSON.stringify(redrawEvidence, null, 2) + '\n');
}
async function checkKnowledgeRouteClearance(label) {
  const value = await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  const edges = [...svg.querySelectorAll('g.kw-edges > [data-from][data-to]')];
  const cardNodes = [...svg.querySelectorAll('.kw-record-hit')];
  const cards = cardNodes.map((node) => {
    const record = node.parentNode;
    return { kind: record.dataset.kwKind || '', id: record.dataset.kwId || record.dataset.kwNode || '',
      rect: node.getBoundingClientRect() };
  });
  const refs = [...svg.querySelectorAll('g.kw-ref[data-kw-ref]')].map((node) => {
    const shapes = [...node.querySelectorAll('.kw-typeref-ring, .kw-typeref-dot, .kw-ref-tag, .kw-folded-tag, .kw-ref-word')]
      .map((shape) => shape.getBoundingClientRect());
    return { id: node.dataset.kwRef, folded: node.classList.contains('kw-folded'), rect: {
      left: Math.min(...shapes.map((r) => r.left)), top: Math.min(...shapes.map((r) => r.top)),
      right: Math.max(...shapes.map((r) => r.right)), bottom: Math.max(...shapes.map((r) => r.bottom))
    } };
  });
  const inside = (point, rect) => point.x > rect.left && point.x < rect.right
    && point.y > rect.top && point.y < rect.bottom;
  const collisions = [];
  const counts = [];
  for (const edge of edges) {
    const from = { kind: edge.dataset.fromKind, id: edge.dataset.from };
    const to = { kind: edge.dataset.toKind, id: edge.dataset.to };
    const same = (end, record) => end.kind === record.kind
      && (end.kind === 'finding' ? end.id.replace(/^finding:/, '') : end.id) === record.id;
    const strokes = edge.tagName.toLowerCase() === 'g'
      ? [...edge.querySelectorAll(':scope > line, :scope > path')] : [edge];
    const points = [];
    for (const stroke of strokes) {
      const matrix = stroke.getScreenCTM();
      const length = stroke.getTotalLength();
      const steps = Math.max(1, Math.ceil(length));
      for (let i = 0; i <= steps; i += 1) {
        points.push(stroke.getPointAtLength(length * i / steps).matrixTransform(matrix));
      }
    }
    counts.push({ from, to, route: edge.dataset.kwRoute || '', strokes: strokes.length, points: points.length });
    if (!points.length) { collisions.push({ from, to, reason: 'no drawn stroke' }); continue; }
    const endpoints = [points[0], points[points.length - 1]];
    const obstacles = cards.filter((record) => !same(from, record) && !same(to, record))
      .map((record) => ({ kind: record.kind, id: record.id, rect: record.rect }));
    for (const ref of refs) {
      const own = (from.kind === 'ref' && from.id === ref.id) || (to.kind === 'ref' && to.id === ref.id)
        || (ref.folded && (from.kind === 'ref' || to.kind === 'ref')
          && endpoints.some((point) => inside(point, ref.rect)));
      if (!own) obstacles.push({ kind: 'ref', id: ref.id, rect: ref.rect });
    }
    for (const obstacle of obstacles) {
      const point = points.find((p) => inside(p, obstacle.rect));
      if (point) collisions.push({ from, to, obstacle: { kind: obstacle.kind, id: obstacle.id },
        point: { x: point.x, y: point.y }, rect: obstacle.rect });
    }
  }
  return { viewport: { width: innerWidth, height: innerHeight }, scope: document.getElementById('map-scope')?.textContent,
    cardCount: cards.length, referenceCount: refs.length, edgeCount: edges.length, counts, collisions };
})()`);
  writeFileSync(join(OUT, 'knowledge-route-geometry-' + label + '.json'), JSON.stringify(value, null, 2) + '\n');
  check('Knowledge connections avoid unrelated complete cards and reference boxes ' + label,
    value.edgeCount > 0 && value.cardCount > 0 && value.collisions.length === 0, JSON.stringify(value));
}
retainBrowserFailure = async () => {
  const retain = async (name, read) => {
    try { retainedFailure.observations[name] = await read(); }
    catch (error) { retainedFailure.observations[name + 'Error'] = errorRecord(error); }
  };
  let snapshot;
  await retain('dom', async () => {
    snapshot = await evalJs(`(() => {
      const map = document.querySelector('#knowledge-whole');
      const attributes = (node) => node ? Object.fromEntries([...node.attributes]
        .map((attribute) => [attribute.name, attribute.value])) : null;
      const focused = document.activeElement;
      return { url: location.href, title: document.title,
        documentHtml: document.documentElement.outerHTML, mapHtml: map && map.outerHTML,
        mapScopeText: document.querySelector('#map-scope')?.textContent || '',
        selectionHeading: document.querySelector('#selection h2')?.textContent || '',
        activeElement: focused && { attributes: attributes(focused), tag: focused.tagName },
        note: map && [...map.querySelectorAll('.kw-legend-note')]
          .map((node) => ({ attributes: attributes(node), text: node.textContent })),
        keys: map && [...map.querySelectorAll('.kw-legend-keys')]
          .map((node) => ({ attributes: attributes(node), text: node.textContent })),
        toggle: map && [...map.querySelectorAll('[data-kw-key-toggle="key"]')]
          .map((node) => ({ attributes: attributes(node), text: node.textContent })),
        midpointNames: map && [...map.querySelectorAll('.kw-rel-name')]
          .map((node) => ({ attributes: attributes(node), text: node.textContent })),
        typedEdges: map && [...map.querySelectorAll('.kw-edge-typed')]
          .map((node) => ({ attributes: attributes(node), text: node.textContent })),
      };
    })()`);
    const { documentHtml, mapHtml, ...values } = snapshot;
    return values;
  });
  if (snapshot) {
    await retain('pageHtml', () => {
      writeFileSync(join(OUT, 'assertion-failure-dom.html'), snapshot.documentHtml);
      return 'assertion-failure-dom.html';
    });
    if (typeof snapshot.mapHtml === 'string') {
      await retain('mapHtml', () => {
        writeFileSync(join(OUT, 'assertion-failure-map.html'), snapshot.mapHtml);
        return 'assertion-failure-map.html';
      });
    }
  }
  await retain('screenshot', async () => {
    const shot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'assertion-failure.png'), Buffer.from(shot.result.data, 'base64'));
    return 'assertion-failure.png';
  });
  await retain('knowledgeScreenshot', async () => {
    const box = await evalJs(`(() => {
      const map = document.querySelector('#knowledge-whole');
      if (!map) return null;
      const r = map.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    })()`);
    if (!box || box.width <= 1 || box.height <= 1) return { absent: true, box };
    const shot = await send(pageWs, 'Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 },
    });
    writeFileSync(join(OUT, 'assertion-failure-knowledge.png'), Buffer.from(shot.result.data, 'base64'));
    return 'assertion-failure-knowledge.png';
  });
};
async function until(name, expression) {
  console.log('WAIT ' + name);
  activeWait = { name, expression };
  const value = await evalJs(`new Promise((resolve) => {
    const matches = () => Boolean(${expression});
    if (matches()) return resolve(true);
    const observer = new MutationObserver(() => {
      if (matches()) { observer.disconnect(); resolve(true); }
    });
    observer.observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    if (matches()) { observer.disconnect(); resolve(true); }
  })`);
  check(name, value === true);
  activeWait = null;
  return value;
}

// ============ Phase A: the real view command ============
const ownerReady = JSON.parse(baton('owner-status'));
check('native owner reports a ready generation and cursor',
  /^\d+$/.test(String(ownerReady.generation))
    && /^\d+$/.test(String(ownerReady.cursor))
    && typeof ownerReady.gap === 'boolean', JSON.stringify(ownerReady));
view = spawnTracked(EXE, [DB, 'view', 'root', 'root', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
const viewLines = createInterface({ input: view.stdout })[Symbol.asyncIterator]();
const viewExit = new Promise((_, reject) => {
  view.once('error', reject);
  view.once('exit', (code) => reject(new Error(`view exited ${code} before the readiness line`)));
});
const firstViewLine = await Promise.race([viewLines.next(), viewExit]);
check('view command reports the live URL',
  !firstViewLine.done && firstViewLine.value.startsWith('Orchestra live view: '),
  firstViewLine.value || 'view command closed stdout');
const urlA = firstViewLine.value.slice('Orchestra live view: '.length).trim();
check('view URL uses the loopback HTTP listener', urlA.startsWith('http://127.0.0.1:'));

await openPage(urlA);
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const earlyShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'initial.png'), Buffer.from(earlyShot.result.data, 'base64'));
await until('snapshot line leaves its unloaded state',
  `document.getElementById('snapshot-line') && !document.getElementById('snapshot-line').textContent.includes('No snapshot loaded')`);
await until('the stage settles on the snapshot actors',
  `(document.getElementById('attention-band').textContent || '').length > 0`);
await until('the live stage keeps its quiet recorded Principal as reporting context',
  `(() => {
    const stage = document.querySelector('#attention-band svg.att-stage');
    const principal = stage && stage.querySelector('.att-seat[data-att-role="principal-conductor"][data-att-state="quiet"]');
    const id = principal && principal.getAttribute('data-att-id');
    return !!id && principal.getAttribute('data-att-context') === 'recorded-ancestor'
      && principal.querySelector('.att-seat-state').textContent.includes('quiet')
      && [...stage.querySelectorAll('.att-parent-link')].some((edge) =>
        edge.getAttribute('data-att-parent-from') === id)
      && principal.querySelector('.att-seat-role').textContent === 'Principal conductor';
  })()`);
const initialShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'initial.png'), Buffer.from(initialShot.result.data, 'base64'));
await captureSurfaceEvidence('initial-stage.png', '#staves');
await captureSurfaceEvidence('initial-memberships.png', '#attention-band .att-stage');
check('the default scope shows live work and puts the rest behind the control', await evalJs(
  `document.getElementById('doc-ended').getAttribute('aria-pressed') === 'false'
    && !document.querySelector('#attention-band .att-seat[data-att-id="worker"]')
    && /^Show /.test((document.getElementById('doc-ended').textContent || '').trim())`));
await evalJs(`document.getElementById('doc-ended').click()`);
await until('the recorded stage renders all fixture actors and their ensemble',
  `document.querySelectorAll('#attention-band .att-seat').length === 4
    && !!document.querySelector('#attention-band .att-peer-group[data-att-ensemble="qa-ensemble"]')`);
check('plate carries its heading and one plain state word', await evalJs(`(() => {
  const h1 = document.querySelector('h1.plate-title');
  const mark = document.getElementById('plate-mark');
  return !!h1 && h1.textContent === 'Baton'
    && !!mark && ['running', 'stopped', 'failed', 'queued', 'idle']
      .includes((mark.textContent || '').trim());
})()`));
check('the plate moves through the regions in their redesigned order', await evalJs(`(() => {
  const links = [...document.querySelectorAll('.plate-nav a')];
  const want = [['#staves', 'Orchestra'], ['#map', 'Knowledge'],
    ['#record', 'Selected actor'], ['#project', 'Project']];
  return links.length === want.length
    && want.every(([href, name], i) => links[i].getAttribute('href') === href
      && (links[i].textContent || '').trim().startsWith(name));
})()`));
check('snapshot line states running, stopped and queued counts', await evalJs(`(() => {
  const line = document.getElementById('snapshot-line').textContent || '';
  return line.includes('running') && line.includes('stopped or failed')
    && line.includes('queued');
})()`));
check('pit and paper grounds paint their materials', await evalJs(`(() => {
  const pit = document.querySelector('.pit');
  const paper = document.querySelector('.paper');
  return !!pit && !!paper
    && getComputedStyle(pit).backgroundColor !== getComputedStyle(paper).backgroundColor;
})()`));
check('rail stays hidden while no exited seat owes', await evalJs(
  `document.getElementById('rail').hidden === true`));
check('each actor has a caption, role, state and recorded activity staff', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  const tiers = [...document.querySelectorAll('#attention-band .att-section-label')];
  return seats.length === 4 && seats.every((seat) =>
    seat.querySelector('.att-seat-label').textContent === seat.dataset.attId
    && seat.querySelector('.att-seat-role').textContent
    && seat.querySelector('.att-seat-state').textContent
    && seat.querySelectorAll('.att-staff-line').length === 5)
    && tiers.length > 1 && tiers.every((tier) => tier.textContent.trim())
    && !!document.querySelector('#attention-band .att-activity-note');
})()`));
await until('map opens on the universal view',
  `document.querySelector('#map-scope').textContent === 'Orchestra: root · 0 records'`);
check('universal view holds no fixture records', await evalJs(
  `document.querySelectorAll('#knowledge-whole .knode').length === 0 && document.querySelectorAll('#knowledge-whole .kw-anchor').length === 0`));
check('the exemplar is absent where nothing draws', await evalJs(
  `!document.querySelector('#knowledge-whole .kw-exemplar') && !document.querySelector('#knowledge-whole .kw-macro')`));
check('empty knowledge has no actor stand-ins', await evalJs(
  `document.querySelectorAll('#knowledge-whole .kg-node,.kg-edge').length === 0
    && !!document.querySelector('#knowledge-whole .kg-empty')`));
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare("INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES ('qa-rel-only','root','message:qa-root-message','references','external:qa-root-log')").run();
  db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('relation-only holdings draw both citations and their relationship',
  `document.querySelectorAll('#knowledge-whole .kg-node').length === 2
    && !!document.querySelector('.kg-edge[data-knowledge-edge="qa-rel-only"]')
    && !document.querySelector('#knowledge-whole [data-knowledge-kind="session"]')`);
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare("DELETE FROM knowledge_relations WHERE id='qa-rel-only'").run(); db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('removing the only relation restores empty knowledge',
  `document.querySelectorAll('#knowledge-whole .kg-node,.kg-edge').length === 0
    && !!document.querySelector('#knowledge-whole .kg-empty')`);
check('actor captions and state fit inside their recorded cards', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  return seats.length === 4 && seats.every((seat) => {
    const card = seat.querySelector('.att-seat-card').getBoundingClientRect();
    return ['.att-seat-label', '.att-seat-role', '.att-seat-state'].every((selector) => {
      const box = seat.querySelector(selector).getBoundingClientRect();
      return box.width > 0 && box.left >= card.left && box.right <= card.right
        && box.top >= card.top && box.bottom <= card.bottom;
    });
  });
})()`));
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="worker"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('the selected actor opens for the chosen seat',
  `document.querySelector('#selection h2')?.textContent === 'worker'`);
const selectedActorHash = await evalJs(`location.hash`);
await evalJs(`document.querySelector('#selection .sel-index a').click()`);
check('selected actor navigation preserves its address', await evalJs(
  `location.hash === ${JSON.stringify(selectedActorHash)} && document.querySelector('#selection h2')?.textContent === 'worker'`));
await until('the selected seat retains its selection mark',
  `!!document.querySelector('#attention-band .att-seat.att-selected[data-att-id="worker"]')`);
await evalJs(`document.querySelector('button[data-knowledge-tier="worker"]').click()`);
await until('the map draws complete individual holdings on the page',
  `document.querySelector('#knowledge-whole .kg-canvas') && document.querySelectorAll('#knowledge-whole .kg-node').length > 1`);
await until('the Individual tier names the selected holder and complete record count',
  `document.querySelector('#map-scope').textContent === ${JSON.stringify(`Individual: worker · ${initialWorkerRecords} records`)}`);
check('the actor record lists its authored finding', await evalJs(
  `document.querySelector('#selection [data-selkey="sel:auth:qa-worker-finding"]')?.textContent.includes('Worker retained finding.')`));
await evalJs(`document.querySelector('.kg-node[data-knowledge-node="qa-worker-finding"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('the finding detail retains both recorded sharing destinations',
  `document.querySelector('.kw-science-detail')?.textContent.includes('qa-worker-share')
    && document.querySelector('.kw-science-detail')?.textContent.includes('qa-lead-share')`);
await evalJs(`document.querySelector('[data-science-focus="overview"]').click()`);
// The payload contract, read once from the live overview endpoint. The nodes and
// edges the contract adds are checked here; the drawing checks stay in the page.
const overviewPayload = await evalJs(`(async () => {
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  const base = String((meta && meta.content) || location.origin).replace(/\\/+$/, '');
  const response = await fetch(base + '/orchestra/knowledge/overview?actor=worker');
  return await response.json();
})()`);
check('the overview preserves its fields while adding nodes and edges',
  Boolean(overviewPayload)
    && ['scope', 'findings', 'promotions', 'relations', 'nodes', 'edges', 'actors']
      .every((key) => Object.prototype.hasOwnProperty.call(overviewPayload, key)));
check('the overview carries the contract node shapes', (() => {
  const nodes = (overviewPayload && overviewPayload.nodes) || [];
  const findings = (overviewPayload && overviewPayload.findings) || [];
  const held = nodes.filter((node) => node.referenceOnly === false);
  const unheld = nodes.filter((node) => node.referenceOnly === true);
  return nodes.length > 0 && held.length === findings.length
    && held.every((node) => node.reference === 'finding:' + node.id
      && typeof node.author === 'string' && typeof node.claim === 'string')
    && unheld.every((node) => typeof node.reference === 'string' && node.reference.length > 0
      && typeof node.kind === 'string' && node.kind.length > 0)
    && unheld.filter((node) => node.reference.startsWith('message:'))
      .every((node) => Array.isArray(node.deliveryRead) && node.deliveryRead.length === 2);
})());
check('cited edges come only from structured evidence', (() => {
  const edges = (overviewPayload && overviewPayload.edges) || [];
  const findings = (overviewPayload && overviewPayload.findings) || [];
  const structured = new Map(findings.map((row) => [row.id,
    /^(message:|finding:|file:|https?:\/\/|external:)/.test(String(row.evidence || ''))]));
  const cited = edges.filter((edge) => edge.provenance === 'recorded-evidence');
  return edges.every((edge) => edge.provenance === 'authored' || edge.provenance === 'recorded-evidence')
    && cited.length === findings.filter((row) => structured.get(row.id)).length
    && cited.every((edge) => edge.relation === 'Cited'
      && String(edge.source).startsWith('finding:')
      && structured.get(String(edge.source).slice('finding:'.length)) === true
      && typeof edge.id === 'string' && edge.id.startsWith('citation:'));
})());
check('authored edges match the relations the payload preserves', (() => {
  const authored = ((overviewPayload && overviewPayload.edges) || [])
    .filter((edge) => edge.provenance === 'authored');
  const relations = (overviewPayload && overviewPayload.relations) || [];
  return authored.length === relations.length
    && authored.every((edge) => relations.some((relation) =>
      relation.sourceReference === edge.source && relation.targetReference === edge.target))
    && relations.every((relation) => authored.some((edge) =>
      edge.source === relation.sourceReference && edge.target === relation.targetReference));
})());
check('actor cards and their activity staffs remain separated', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  const cards = seats.map((seat) => seat.querySelector('.att-seat-card').getBoundingClientRect());
  return cards.length === 4 && cards.every((card, index) => cards.every((other, otherIndex) =>
    index === otherIndex || card.right <= other.left || card.left >= other.right
      || card.bottom <= other.top || card.top >= other.bottom))
    && seats.every((seat) => seat.querySelectorAll('.att-staff-line').length === 5);
})()`));
// Capture the selected actor and complete individual holdings.
const knowledgeShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'knowledge.png'), Buffer.from(knowledgeShot.result.data, 'base64'));
if (CAPTURE_ONLY) {
  await evalJs(`document.querySelector('#knowledge-whole [data-science-focus="fit-graph"]').click()`);
  const mapShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'knowledge-map.png'), Buffer.from(mapShot.result.data, 'base64'));
  console.log('BROWSER_CAPTURE_OK — partial visual inspection: initial and worker knowledge views');
  return;
}
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('all-records scope retains its complete holdings',
  `document.querySelector('#map-scope').textContent === ${JSON.stringify(initialScopeText.all)}`);
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('scope returns to universal knowledge',
  `document.querySelector('#map-scope').textContent === 'Orchestra: root · 0 records'`);
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="worker"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await evalJs(`document.querySelector('button[data-knowledge-tier="worker"]').click()`);
await until('worker scope restores its knowledge records',
  `!!document.querySelector('.kg-node[data-knowledge-node="qa-worker-finding"]')`);
await evalJs(`document.querySelector('.kg-node[data-knowledge-node="qa-worker-finding"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('finding opens its complete content beside the graph',
  `document.querySelector('.kw-science-detail').textContent.includes('Worker retained finding.')
    && document.querySelector('.kw-science-detail').textContent.includes('Worker evidence.')
    && document.querySelector('.kw-science-detail').textContent.includes('Worker limits.')
    && !!document.querySelector('.kg-canvas')`);
const graphBeforeLive = await evalJs(`document.querySelector('.kg-world').getAttribute('transform')`);
baton('promote', 'qa-relation-live-frame', 'worker', 'aide', 'worker', 'qa-worker-finding');
await until('live sharing updates record details through native SSE',
  `document.querySelector('.kw-science-detail').textContent.includes('qa-relation-live-frame')`);
check('native redraw retains knowledge selection and camera', await evalJs(
  `document.querySelector('.kg-node.is-selected').dataset.knowledgeNode === 'qa-worker-finding'
    && document.querySelector('.kg-world').getAttribute('transform') === ${JSON.stringify(graphBeforeLive)}`));
await evalJs(`document.querySelector('[data-science-focus="overview"]').click()`);
baton('record', 'qa-worker-live-finding', 'worker', 'Worker live finding.', 'Live evidence.', 'Live limits.');
await until('native SSE adds the finding to both the graph and actor record',
  `!!document.querySelector('.kg-node[data-knowledge-node="qa-worker-live-finding"]')
    && !!document.querySelector('#selection [data-selkey="sel:auth:qa-worker-live-finding"]')`);
check('native redraw retains dismissed knowledge selection', await evalJs(`!document.querySelector('.kg-node.is-selected,.kg-edge.is-selected,.kw-science-detail')`));
baton('promote', 'qa-worker-live-share', 'aide', 'worker', 'aide', 'qa-worker-live-finding');
await evalJs(`document.querySelector('.kg-node[data-knowledge-node="qa-worker-live-finding"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('native SSE retains the new finding sharing record',
  `document.querySelector('.kw-science-detail')?.textContent.includes('qa-worker-live-share')`);
await evalJs(`document.querySelector('[data-science-focus="overview"]').click()`);
await evalJs(`window.__qaMark = 41`);
const ribbonMaxBeforeNativeCommit = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-native', 'root', 'worker', 'guidance', 'Committed through the native owner.');
await until('native owner SSE moves the ribbon without reload',
  `window.__qaMark === 41 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeNativeCommit)}`);
await evalJs(`document.querySelector('#ribbon [data-focus="ribbon-list"]').click()`);
await until('ribbon full list opens with recorded rows',
  `document.querySelector('#ribbon .ribbon-list') && document.querySelectorAll('#ribbon .ribbon-row').length > 0 && (document.querySelector('#ribbon .ribbon-list').textContent || '').includes('worker')`);

// Activity is the page spine: the axis draws its buckets, the needle moves by
// keyboard and by pointer, and the full list selects a recorded entry.
await until('the axis draws the staff and its needle in Activity',
  `document.querySelectorAll('#ribbon .ribbon-staffline').length === 5
    && document.querySelectorAll('#ribbon .ribbon-note').length > 1
    && !!document.querySelector('#ribbon .ribbon-needle')`);
check('every drawn note paints its ink', await evalJs(`(() => {
  const notes = [...document.querySelectorAll('#ribbon .ribbon-note')];
  return notes.length > 1 && notes.every((note) => {
    const ink = getComputedStyle(note).backgroundColor;
    return ink !== 'rgba(0, 0, 0, 0)' && ink !== 'transparent'
      && /(^| )ribbon-ink-[a-z]+( |$)/.test(note.className);
  });
})()`));
check('the axis states the window it draws', await evalJs(`(() => {
  const summary = document.querySelector('#ribbon .ribbon-summary');
  const mark = document.querySelector('#ribbon .ribbon-tempo');
  return !!summary && /entries over/.test(summary.textContent || '')
    && (!mark || ((mark.title || '').length > 0
      && !!document.querySelector('#ribbon .ribbon-tempo-read')));
})()`));
check('inspecting activity notes preserves the header axis and page position', await evalJs(`(() => {
  const mount = document.getElementById('ribbon');
  const head = mount.querySelector('.ribbon-head');
  const axis = mount.querySelector('.ribbon-axis');
  const summary = mount.querySelector('.ribbon-summary');
  if (!head || !axis || !summary) return false;
  const notes = [...axis.querySelectorAll('.ribbon-note')];
  if (notes.length < 2) return false;
  const geometry = () => [head, axis].flatMap((node) => {
    const box = node.getBoundingClientRect();
    return [box.x, box.y, box.width, box.height];
  }).concat(window.scrollX, window.scrollY).join(',');
  const before = geometry();
  const initial = summary.textContent;
  for (const note of [notes[0], notes.at(-1)]) {
    note.dispatchEvent(new PointerEvent('pointerenter'));
    if (!summary.textContent.trim() || geometry() !== before) return false;
  }
  const inspected = summary.textContent;
  axis.dispatchEvent(new PointerEvent('pointerleave'));
  return inspected !== initial && summary.textContent === inspected && geometry() === before;
})()`));

const needleBefore = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuenow')`);
await evalJs(`(() => { const s = document.querySelector('#ribbon .ribbon-slider'); s.focus(); return document.activeElement === s; })()`);
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
await until('the needle moves one entry on a keypress',
  `document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuenow') !== ${JSON.stringify(needleBefore)}`);
const needleBeforeDrag = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuenow')`);
await evalJs(`(() => {
  const slider = document.querySelector('#ribbon .ribbon-slider');
  const box = slider.getBoundingClientRect();
  const at = (fraction) => ({
    clientX: box.left + box.width * fraction,
    clientY: box.top + box.height / 2,
    bubbles: true,
  });
  const down = new PointerEvent('pointerdown', Object.assign({ pointerId: 7, button: 0 }, at(0.4)));
  slider.dispatchEvent(down);
  // The page redraws the whole document on a scrub report, so the pointer events
  // that follow are dispatched on the document, as a real drag delivers them.
  document.dispatchEvent(new PointerEvent('pointermove', Object.assign({ pointerId: 7 }, at(0.15))));
  document.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 7 }, at(0.15))));
  return true;
})()`);
await until('the needle moves under the pointer across the redraw',
  `document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuenow') !== ${JSON.stringify(needleBeforeDrag)}`);
const historyFocus = await evalJs(`(() => {
  const row = document.querySelector('#ribbon .ribbon-row:not([aria-current="true"])');
  const key = row.dataset.focus;
  row.click();
  return key;
})()`);
await until('selecting a recorded activity entry moves its history position',
  `document.querySelector('#ribbon .ribbon-row[aria-current="true"]')?.dataset.focus === ${JSON.stringify(historyFocus)}`);
check('the activity axis retains the selected entry', await evalJs(
  `Number(document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuenow'))
    === Number(document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax'))
      - Number(${JSON.stringify(historyFocus)}.split(':')[1])`));

// Capture each surface using page coordinates without moving the page.
async function captureSurfaceEvidence(name, selector) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY,
      width: r.width, height: r.height };
  })()`);
  if (!box || box.width <= 1 || box.height <= 1) return false;
  const shot = await send(pageWs, 'Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
  });
  writeFileSync(join(OUT, name), Buffer.from(shot.result.data, 'base64'));
  return true;
}
const surfaceCaptures = [];
for (const [name, selector] of [['pit.png', '.pit'], ['map.png', '.map'], ['agents.png', '#staves']]) {
  if (await captureSurfaceEvidence(name, selector)) surfaceCaptures.push(name);
}
check('activity, knowledge and agents evidence captured', surfaceCaptures.length === 3, surfaceCaptures.join(', '));
// operator-triggered reconnect re-reads the snapshot through the view command server
const ribbonMaxBeforeReconnect = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-1', 'root', 'worker', 'guidance', 'Follow-up input.');
await evalJs(`document.getElementById('reconnect').click()`);
await until('manual reconnect re-reads the snapshot with the new commit',
  `window.__qaMark === 41 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeReconnect)}`);

// narrow viewport + reduced motion evidence (phase A server stays up)
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evalJs('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
check('knowledge viewport fits the narrow screen', await evalJs(`(() => {
  const svg=document.querySelector('.kg-canvas');
  return svg.getBoundingClientRect().width <= innerWidth;
})()`));
await evalJs(`document.querySelector('[data-att-key="view:false"]').click()`);
check('the readable actor stage keeps complete captions and role labels inside its cards at 390px', await evalJs(`(() => {
  const stage = document.querySelector('#attention-band svg.att-stage');
  const seats = stage ? [...stage.querySelectorAll('.att-seat')] : [];
  if (!seats.length) return false;
  const inside = (node, card) => {
    const a = node.getBoundingClientRect(), b = card.getBoundingClientRect();
    return a.width > 0 && a.left >= b.left && a.right <= b.right
      && a.top >= b.top && a.bottom <= b.bottom;
  };
  return seats.every((seat) => {
    const card = seat.querySelector('.att-seat-card');
    const caption = seat.querySelector('.att-seat-label');
    const role = seat.querySelector('.att-seat-role');
    const box = card && card.getBoundingClientRect();
    return !!box && document.querySelector('.att-stage-viewport').clientWidth <= window.innerWidth
      && caption.textContent === seat.dataset.attId && !!role.textContent
      && inside(caption, card) && inside(role, card);
  });
})()`));
await evalJs(`document.querySelector('[data-att-key="view:true"]').click()`);
check('recorded parent links avoid actor cards and tier captions at 390px', await evalJs(`(() => {
  const stage = document.querySelector('#attention-band .att-stage');
  const seats = [...stage.querySelectorAll('.att-seat')].map((seat) => ({
    id: seat.dataset.attId, rect: seat.querySelector('.att-seat-card').getBoundingClientRect()
  }));
  const headers = [...stage.querySelectorAll('.att-section-label')].map((node) => node.getBoundingClientRect());
  const links = [...stage.querySelectorAll('.att-parent-link')];
  return links.length > 0 && links.every((link) => {
    const from = link.dataset.attParentFrom;
    const to = link.dataset.attParentTo;
    if (!seats.some((seat) => seat.id === from) || !seats.some((seat) => seat.id === to)) return false;
    const blocked = seats.filter((seat) => seat.id !== from && seat.id !== to).map((seat) => seat.rect).concat(headers);
    const matrix = link.getScreenCTM();
    const length = link.getTotalLength();
    const steps = Math.ceil(length);
    for (let i = 0; i <= steps; i += 1) {
      const point = link.getPointAtLength(length * i / steps).matrixTransform(matrix);
      if (blocked.some((rect) => point.x > rect.left && point.x < rect.right
        && point.y > rect.top && point.y < rect.bottom)) return false;
    }
    return true;
  });
})()`));
await captureSurfaceEvidence('agents-narrow-390.png', '#staves');
await captureSurfaceEvidence('agent-memberships-narrow-390.png', '#attention-band .att-stage');
const narrow = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'narrow-390.png'), Buffer.from(narrow.result.data, 'base64'));
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send(pageWs, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await evalJs('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
const reduced = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'reduced-motion.png'), Buffer.from(reduced.result.data, 'base64'));
check('narrow and reduced-motion evidence captured', true, 'narrow-390.png, reduced-motion.png');
view.kill('SIGTERM');
await new Promise((r) => view.on('exit', r));

// ============ Phase B: real server + test commit-notification seam ============
const subscribers = new Set();
const subscribeCommittedChanges = async ({ afterCursor, onNotice }) => {
  const subscriber = { onNotice };
  subscribers.add(subscriber);
  return { ready: true, generation: 'qa-owner-1', cursor: String(afterCursor ?? ''),
    close: () => subscribers.delete(subscriber) };
};
const committed = (cursor = '') => {
  for (const s of subscribers) s.onNotice({ kind: 'commit', cursor });
};
const server = createOrchestraServer({ databasePath: DB, reader: 'root', subject: 'root',
  subscribeCommittedChanges, baton2Executable: EXE, port: 0 });
await new Promise((r) => server.on('listening', r));
const portB = server.address().port;
const startupWriter = new DatabaseSync(DB);
startupWriter.exec('BEGIN EXCLUSIVE');
try {
  await openPage(`http://127.0.0.1:${portB}/`);
  await until('a locked initial snapshot reports its failed read',
    `document.getElementById('snapshot-line') && document.getElementById('notice') && (document.getElementById('snapshot-line').textContent + document.getElementById('notice').textContent).includes('503')`);
  check('initial snapshot failure enters the existing retry path', await evalJs(
    `!document.getElementById('notice').hidden && /retrying/i.test(document.getElementById('notice').textContent)`));
} finally {
  startupWriter.exec('ROLLBACK');
  startupWriter.close();
}
await until('phase B snapshot reports its actor line',
  `document.getElementById('snapshot-line') && !document.getElementById('snapshot-line').textContent.includes('No snapshot loaded')`);
await evalJs(`document.getElementById('doc-ended').click()`);
await until('phase B stage renders all recorded actors', `document.querySelectorAll('#attention-band .att-seat').length === 4`);
await until('phase B attention settles on the snapshot actors',
  `(document.getElementById('attention-band').textContent || '').length > 0`);
await evalJs(`window.__qaMark = 42`);
await evalJs(`document.querySelector('#ribbon [data-focus="ribbon-list"]').click()`);
await until('phase B ribbon list opens', `document.querySelectorAll('#ribbon .ribbon-row').length > 0`);
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="aide"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await evalJs(`document.querySelector('button[data-knowledge-tier="worker"]').click()`);
await until('phase B knowledge scope settles on the aide holdings',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 3 records')`);
check('the aide individual holdings include its authored and received findings', await evalJs(
  `!!document.querySelector('.kg-node[data-knowledge-node="qa-aide-finding"]')
    && !!document.querySelector('.kg-node[data-knowledge-node="qa-worker-finding"]')
    && !!document.querySelector('.kg-node[data-knowledge-node="qa-worker-live-finding"]')`));

// Hold one real actor response until another actor's detail has rendered.
await evalJs(`(() => {
  const actualFetch = window.fetch.bind(window);
  let holdWorker = true;
  let held;
  window.__qaKnowledgeHeld = new Promise((resolve) => { held = resolve; });
  const release = new Promise((resolve) => { window.__qaReleaseKnowledge = resolve; });
  window.__qaRestoreFetch = () => { window.fetch = actualFetch; };
  window.fetch = async (...args) => {
    const response = await actualFetch(...args);
    const url = new URL(args[0], location.href);
    if (holdWorker && url.pathname === '/orchestra/work' && url.searchParams.get('subject') === 'worker') {
      holdWorker = false;
      const actualJson = response.json.bind(response);
      response.json = async () => {
        const data = await actualJson();
        held();
        await release;
        return data;
      };
    }
    return response;
  };
  document.querySelector('#attention-band .att-seat[data-att-id="worker"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
})()`);
await evalJs('window.__qaKnowledgeHeld');
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="aide"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('second row selects while the first work response is held',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`);
check('selected record shows its ledged facts', await evalJs(
  `document.querySelectorAll('#selection .doc-facts dt').length >= 4`));
check('the record index resolves to the sections it names', await evalJs(`(() => {
  const links = [...document.querySelectorAll('#selection .sel-index a')];
  return links.length > 0 && links.every((link) => {
    const id = (link.getAttribute('href') || '').replace('#', '');
    const section = id ? document.getElementById(id) : null;
    return !!section && !!section.querySelector('h2');
  });
})()`));
await evalJs(`window.__qaReleaseKnowledge(); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
check('late first-actor work preserves the selected record', await evalJs(
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`));
await evalJs('window.__qaRestoreFetch()');

await evalJs(`(() => {
  const find = document.getElementById('doc-find');
  find.value = 'aide';
  find.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check('find retains the matching actor and its recorded reporting context', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  const aide = seats.filter((seat) => seat.dataset.attId === 'aide');
  const context = seats.filter((seat) => seat.dataset.attId !== 'aide');
  return aide.length === 1 && context.length === 2
    && context.every((seat) => seat.dataset.attContext === 'recorded-ancestor')
    && !document.querySelector('#attention-band .att-seat[data-att-id="worker"]')
    && document.querySelectorAll('#attention-band .att-cursor').length === 1;
})()`));
await evalJs(`(() => {
  const find = document.getElementById('doc-find');
  find.value = '';
  find.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check('clearing find restores all recorded actors', await evalJs(
  `document.querySelectorAll('#attention-band .att-seat').length === 4`));
const pendingBody = '  Inspect the stalled work.\n\nRetain this complete evidence.  ';
baton('message', 'qa-aide-receipt', 'root', 'aide', 'guidance', pendingBody);
committed();
await until('ribbon rows name the recorded far side',
  `[...document.querySelectorAll('#ribbon .ribbon-row')].some((row) => (row.textContent || '').includes('aide'))`);
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="aide"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('pending message has a read control',
  `document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]') !== null`);
await evalJs(`(() => {
  const button = document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]');
  button.focus(); button.click();
})()`);
await until('pending message displays its complete stored body',
  `[...document.querySelectorAll('#selection .sel-body')].some((node) => node.textContent === ${JSON.stringify(pendingBody)})`);
check('the opened short message retains its complete stored text', await evalJs(`(() => {
  const button = document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-receipt"]');
  const body = button && button.nextElementSibling;
  return !!button && button.title === 'guidance qa-aide-receipt'
    && button.getAttribute('aria-expanded') === 'true'
    && !!body && body.classList.contains('sel-body')
    && body.textContent === ${JSON.stringify(pendingBody)};
})()`));
check('queued list names the owed total', await evalJs(
  `[...document.querySelectorAll('#selection h2')].some((h) => (h.textContent || '').startsWith('Queued '))`));
check('message body remains open and focused after its asynchronous read', await evalJs(
  `document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]').getAttribute('aria-expanded') === 'true'
    && document.activeElement === document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]')`));
await evalJs(`document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'/', bubbles:true, cancelable:true}))`);
check('keyboard find shortcut focuses the visible query', await evalJs(
  `document.activeElement === document.getElementById('doc-find')`));
baton('as', 'aide', 'read', 'qa-aide-receipt');
committed();
const longPendingBody = '  Retain this complete quotation and every recorded line. Review the remaining evidence without changing the stored text, its spaces, or its punctuation.\n\nRetain this complete evidence with its blank line and exact trailing spaces for the full-body quotation check.  ';
const longPreview = 'Retain this complete quotation and every recorded line.\u2026 continues \u00b7 ' + longPendingBody.length + ' characters';
baton('message', 'qa-aide-long-quote', 'root', 'aide', 'guidance', longPendingBody);
committed();
await until('long pending message has its own read control',
  `document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]') !== null`);
await evalJs(`document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]').click()`);
await until('the opened long message draws its own lead', `(() => {
  const button = document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]');
  const lead = button && button.nextElementSibling;
  return !!lead && lead.classList.contains('sel-lead');
})()`);
check('a cut recorded text states plainly that it continues', await evalJs(`(() => {
  const button = document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]');
  const lead = button && button.nextElementSibling;
  const full = lead && lead.nextElementSibling;
  return !!button && button.title === 'guidance qa-aide-long-quote'
    && button.getAttribute('aria-expanded') === 'true'
    && !!lead && lead.classList.contains('sel-lead')
    && lead.textContent === ${JSON.stringify(longPreview)}
    && !!full && full.dataset.selkey === 'sel:full:msg:qa-aide-long-quote'
    && full.getAttribute('aria-expanded') === 'false'
    && (!full.nextElementSibling || full.nextElementSibling.textContent !== ${JSON.stringify(longPendingBody)});
})()`));
await evalJs(`document.querySelector('#selection #sel-sec-queued [data-selkey="sel:full:msg:qa-aide-long-quote"]').click()`);
await until('the long message displays its complete stored body', `(() => {
  const button = document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]');
  const lead = button && button.nextElementSibling;
  const full = lead && lead.nextElementSibling;
  const body = full && full.nextElementSibling;
  return !!lead && lead.classList.contains('sel-lead')
    && lead.textContent === ${JSON.stringify(longPreview)}
    && !!full && full.dataset.selkey === 'sel:full:msg:qa-aide-long-quote'
    && full.getAttribute('aria-expanded') === 'true'
    && !!body && body.classList.contains('sel-body')
    && body.textContent === ${JSON.stringify(longPendingBody)};
})()`);
baton('as', 'aide', 'read', 'qa-aide-long-quote');
committed();
await until('the acknowledged long message leaves the queued record',
  `document.querySelector('#selection #sel-sec-queued [data-selkey="sel:msg:qa-aide-long-quote"]') === null`);
const ribbonMaxBefore = await evalJs(`Number(document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax'))`);

// live committed update without reload
baton('message', 'qa-guidance-2', 'root', 'worker', 'guidance', 'Live update probe.');
committed();
await until('committed message arrives live without reload',
  `window.__qaMark === 42 && Number(document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')) > ${ribbonMaxBefore}`);
check('the worker seat states its newly queued input', await evalJs(
  `!!document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="queued"] .att-owed')`));
check('the worker seat retains the complete owed count in its state', await evalJs(
  `/\\d+ owed/.test(document.querySelector('#attention-band .att-seat[data-att-id="worker"] .att-seat-state').textContent)`));
// A report is owed work without queued input: the pending set excludes it,
// the unread count records it. The aide seat retains every owed item.
let aideOwed;
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  aideOwed = Number(db.prepare("SELECT count(*) AS count FROM messages m WHERE m.recipient='aide' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").get().count) + 1;
  db.prepare("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('qa-report-owed','worker','aide','report','Owed report probe.')").run();
  db.close();
}
committed();
await until('the aide seat states its owed report',
  `(() => { const seat = document.querySelector('#attention-band .att-seat[data-att-id="aide"]');
    return seat?.dataset.attState === 'owesWork'
      && seat.querySelector('.att-seat-state').textContent.includes('${aideOwed} owed')
      && seat.querySelectorAll('.att-owed').length === Math.min(${aideOwed}, 6); })()`);
// The stage is one tab stop: focus announces the cursor seat, arrows walk,
// Enter opens.
await send(pageWs, 'Page.bringToFront');
const stageFocus = await evalJs(`(() => {
  const strip = document.getElementById('attention-band');
  const stage = strip && strip.querySelector('svg.att-stage');
  const live = strip && strip.querySelector('.att-sr');
  const cursor = strip && strip.querySelector('.att-seat.att-cursor');
  if (stage) stage.focus();
  const active = document.activeElement;
  return {
    pageHasFocus: document.hasFocus(),
    stagePresent: !!stage,
    stageCurrent: !!stage && stage === strip.querySelector('svg.att-stage'),
    stageConnected: !!stage && stage.isConnected,
    stageKey: stage ? stage.getAttribute('data-att-key') : '',
    activeIsStage: !!stage && active === stage,
    activeKey: active && active.getAttribute ? active.getAttribute('data-att-key') : '',
    liveAdjacent: !!live && !!stage && stage.parentElement.nextElementSibling === live,
    liveParentIsStrip: !!live && live.parentElement === strip,
    cursorId: cursor ? cursor.getAttribute('data-att-id') : '',
    announcement: live ? live.textContent || '' : '',
  };
})()`);
check('stage focus reaches the current page and stage',
  stageFocus.pageHasFocus && stageFocus.stageCurrent && stageFocus.stageConnected
    && stageFocus.activeIsStage && stageFocus.liveAdjacent && !!stageFocus.cursorId,
  JSON.stringify(stageFocus));
const stageFirst = stageFocus.announcement.split(',')[0].trim();
check('stage focus announces its cursor seat', ['root', 'lead', 'worker', 'aide'].includes(stageFirst), stageFirst);
check('the stage draws its seats inside the Agents region', await evalJs(
  `!!document.querySelector('#staves #attention-band svg.att-stage')
    && document.querySelectorAll('#staves #attention-band .att-seat').length > 0`));
check('agent hierarchy draws reporting structure without knowledge citations', await evalJs(`(() => {
  const stage=document.querySelector('.att-stage'), depths=new Map();
  for(const seat of stage.querySelectorAll('.att-seat')) {
    const depth=seat.dataset.attDepth, y=seat.transform.baseVal.consolidate().matrix.f;
    if(depths.has(depth) && depths.get(depth)!==y)return false;depths.set(depth,y);
  }
  return depths.size > 1 && !stage.querySelector('.att-seam,.att-ref');
})()`));
check('the band does not scroll: the page carries its drawing at its own height', await evalJs(`(() => {
  const band = document.getElementById('attention-band');
  if (!band) return false;
  return band.scrollHeight <= band.clientHeight + 1;
})()`));
check('the owed units count what the seat title states', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  const owed = seats.filter((s) => /\\d+ owed/.test(s.textContent || ''));
  if (!owed.length) return false;
  return owed.every((seat) => {
    const stated = Number((/(\\d+) owed/.exec(seat.textContent || '') || [0, 0])[1]);
    const marks = seat.querySelectorAll('.att-owed').length;
    return marks === Math.min(stated, 6);
  });
})()`));
check('the flash takes the seat own ink and no other', await evalJs(`(() => {
  const core = document.querySelector('#attention-band .att-seat.att-new .att-core');
  if (!core) return true;
  const seat = core.closest('.att-seat');
  const ink = getComputedStyle(seat).color;
  return getComputedStyle(core).stroke === ink;
})()`));
check('the stage text and the pit sentence share one face', await evalJs(`(() => {
  const chip = document.querySelector('#attention-band .att-seat-label');
  const summary = document.querySelector('#ribbon .ribbon-summary');
  if (!chip || !summary) return false;
  const a = getComputedStyle(chip).fontFamily, b = getComputedStyle(summary).fontFamily;
  return !!a && a === b;
})()`));
const stageOther = stageFirst === 'aide' ? 'worker' : 'aide';
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="${stageOther}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('the selected actor changes before the stage jump',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === '${stageOther}'`);
await evalJs(`document.querySelector('#attention-band svg.att-stage').focus()`);
await evalJs(`document.querySelector('#attention-band svg.att-stage').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
await until('stage Enter opens the announced seat',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === '${stageFirst}'`);
await evalJs(`document.querySelector('#attention-band svg.att-stage').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
await evalJs(`document.querySelector('#attention-band svg.att-stage').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
await until('stage arrow walks to a different seat',
  `document.querySelector('#selection h2') && !['', '${stageFirst}'].includes(document.querySelector('#selection h2').textContent)`);
await evalJs(`(() => {
  const strip = document.getElementById('attention-band');
  window.__qaStageStyle = strip.getAttribute('style');
  strip.querySelector('svg.att-stage').focus();
  strip.querySelector('svg.att-stage').dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}));
})()`);
const stageEnd = await evalJs(`(() => {
  const strip = document.getElementById('attention-band');
  const seats = [...strip.querySelectorAll('.att-seat')];
  const cursor = strip.querySelector('.att-seat.att-cursor');
  const ring = cursor.querySelector('.att-seat-ring').getBoundingClientRect();
  const bounds = strip.getBoundingClientRect();
  return {id:cursor.dataset.attId, last:seats.at(-1).dataset.attId,
    visible:ring.top >= 0 && ring.bottom <= window.innerHeight};
})()`);
check('stage End reaches its last drawn seat where the reader can see it',
  stageEnd.id === stageEnd.last && stageEnd.visible, JSON.stringify(stageEnd));
await evalJs(`(() => {
  window.__qaOldStage = document.querySelector('#attention-band svg.att-stage');
  const row = document.querySelector('#attention-band .att-seat[data-att-id="${stageEnd.id}"]');
  document.getElementById('doc-find').focus();
  row.dispatchEvent(new MouseEvent('click',{bubbles:true}));
})()`);
await until('record selection redraws the unfocused stage',
  `document.querySelector('#attention-band svg.att-stage') !== window.__qaOldStage`);
check('the stage redraw keeps the seat it was reading', await evalJs(
  `(() => { const cursor = document.querySelector('#attention-band .att-seat.att-cursor');
    return !!cursor && cursor.dataset.attId === ${JSON.stringify(stageEnd.id)}; })()`));
await evalJs(`(() => {
  const stage = document.querySelector('#attention-band svg.att-stage');
  stage.focus(); stage.dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true}));
})()`);
const stageHome = await evalJs(`(() => {
  const strip = document.getElementById('attention-band');
  const cursor = strip.querySelector('.att-seat.att-cursor');
  const ring = cursor.querySelector('.att-seat-ring').getBoundingClientRect();
  const bounds = strip.getBoundingClientRect();
  return {id:cursor.dataset.attId, first:strip.querySelector('.att-seat').dataset.attId,
    visible:ring.top >= 0 && ring.bottom <= window.innerHeight};
})()`);
check('stage Home reaches its first drawn seat where the reader can see it',
  stageHome.id === stageHome.first && stageHome.visible, JSON.stringify(stageHome));
await evalJs(`(() => {
  const strip = document.getElementById('attention-band');
  if (window.__qaStageStyle === null) strip.removeAttribute('style');
  else strip.setAttribute('style', window.__qaStageStyle);
})()`);
let workerExecution;
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  workerExecution = db.prepare('SELECT id, phase, status FROM executions WHERE session = ?').get('worker');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('running', '', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded running execution reaches the attention strip',
  `document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="running"]') !== null`);
await evalJs(`document.querySelector('#snapshot-line [aria-label="Focus the first running seat"]').click()`);
check('running count focuses the running actor while it owes input', await evalJs(
  `document.activeElement === document.querySelector('#attention-band .att-seat[data-att-id="worker"]')`));
// Capture the document with running work.
const nowShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'now.png'), Buffer.from(nowShot.result.data, 'base64'));
await evalJs(`document.querySelector('#attention-band [data-att-key="seat:worker"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('attention selection opens the actor record',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
const runningDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
await evalJs(`document.querySelector('#attention-band [data-att-key="seat:worker"]').focus()`);
const ribbonBeforeFocusedGuidance = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-lane-focus', 'root', 'worker', 'guidance', 'Attention focus retained on live input.');
committed();
await until('focused guidance reaches the live view',
  `document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonBeforeFocusedGuidance)}`);
check('live attention redraw preserves focus on the same chip', await evalJs(
  `window.__qaMark === 42 && document.activeElement && document.activeElement.getAttribute('data-att-key') === 'seat:worker'`));
// Ordinary owed input stays with the actor after its process exits.
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('exited', 'exit 0', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('exited seat retains its own owed work',
  `document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="queued"]') !== null`);
check('ordinary owed work leaves the rail hidden', await evalJs(
  `document.getElementById('rail').hidden === true`));
const queuedDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
check('queued and running record states look different', queuedDotColor !== runningDotColor);
const promotionNotice = JSON.parse(baton('delivery', 'qa-relation-live-frame:promotion-notice'));
check('the worker reads its recorded promotion notice',
  promotionNotice.recipient === 'worker' && promotionNotice.kind === 'question'
    && JSON.parse(promotionNotice.body).finding === 'qa-worker-finding');
const promotedFindings = JSON.parse(baton('knowledge', 'worker', '--id', 'qa-worker-finding'));
check('the worker reviews the complete promoted finding',
  Array.isArray(promotedFindings) && promotedFindings.length === 1
    && promotedFindings[0].id === 'qa-worker-finding'
    && promotedFindings[0].evidence === 'Worker evidence.'
    && promotedFindings[0].limits === 'Worker limits.');
for (const id of ['qa-guidance-native', 'qa-guidance-1', 'qa-guidance-2', 'qa-guidance-lane-focus',
                  'qa-relation-live-frame:promotion-notice']) {
  baton('as', 'worker', 'read', id);
}
committed();
await until('cleared seats fold the rail away',
  `document.getElementById('rail').hidden === true`);
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded completion leaves a quiet worker and retains its authored findings',
  `!!document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="quiet"]')
    && !!document.querySelector('#selection [data-selkey="sel:auth:qa-worker-live-finding"]')`);
// Exit-zero provider failure reads failed, not completed: stage the
// recorded terminal, prove the row and the record, then restore.
let workerEvent;
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  workerEvent = db.prepare('SELECT event FROM turns WHERE worker = ? AND id = ?').get('worker', workerExecution.id);
  db.close();
}
check('failure staging join row exists', !!workerEvent);
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare('UPDATE turns SET event = ? WHERE worker = ? AND id = ?')
    .run('{"is_error":1,"type":"agent_error","exitCode":403,"result":"provider quota refused the attempt."}', 'worker', workerExecution.id);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('exited', 'exit 0', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded failure marks the worker row failed',
  `document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="failed"]') !== null`);
// A provider failure is a state the record holds: the row states failed and the
// rail lists the seat with that state as a fact, with the cause on the row's record.
await until('a provider failure lists the seat in the rail as failed',
  `document.getElementById('rail').hidden === false
    && (document.querySelector('#rail [data-rail-id="worker"]') || {}).textContent === 'worker · failed'`);
check('failed row reads its rule and word', await evalJs(`(() => {
  const row = document.querySelector('#attention-band .att-seat[data-att-id="worker"]');
  const word = row && row.querySelector('.att-seat-state');
  return !!row && !!word && word.textContent === 'failed';
})()`));
await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="worker"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('failed record opens for the worker row',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
check('record states the provider cause', await evalJs(
  `[...document.querySelectorAll('#selection p')].some((p) => (p.textContent || '').includes('Failure: provider-failure'))`));
const failedDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
check('failed and queued record states look different', failedDotColor !== queuedDotColor);
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.prepare('UPDATE turns SET event = ? WHERE worker = ? AND id = ?').run(workerEvent.event, 'worker', workerExecution.id);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('restored execution clears the failed row',
  `document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="failed"]') === null`);

// reconnect: drop the server, restart on the same port, no duplicated transitions
server.close(); server.closeAllConnections?.();
await until('page notices the lost stream', `(() => {
  const notice = document.getElementById('notice');
  const body = notice && notice.textContent;
  return !!notice && !notice.hidden && (
    body === 'Stream lost. Re-reading current state.'
    || (body.startsWith('Snapshot endpoint unreachable (') && body.endsWith('). Retrying in 1s.'))
  );
})()`);
const server2 = createOrchestraServer({ databasePath: DB, reader: 'root', subject: 'root',
  subscribeCommittedChanges, baton2Executable: EXE, port: portB });
await new Promise((r) => server2.on('listening', r));
await until('page reconnects and clears its notice',
  `window.__qaMark === 42 && document.getElementById('notice').hidden`);
check('no duplicated ribbon rows after reconnect', await evalJs(
  `(() => { const rows = [...document.querySelectorAll('#ribbon .ribbon-row')].map((li) => li.textContent); return rows.length > 0 && new Set(rows).size === rows.length; })()`));

// Remove an unnotified change after the page cursor, then let a later commit reveal the gap.
baton('message', 'qa-guidance-pruned', 'root', 'worker', 'guidance', 'Committed without a notice.');
{
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 250');
  db.exec('DELETE FROM native_changes WHERE change_id <= (SELECT max(change_id) FROM native_changes)');
  db.close();
}
baton('message', 'qa-guidance-3', 'root', 'worker', 'guidance', 'After pruning.');
committed();
await until('pruned cursor produces a gap notice and fresh state',
  `window.__qaMark === 42 && !document.getElementById('notice').hidden && document.getElementById('notice').textContent.length > 0`);
const ribbonMaxBeforeRecovery = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-4', 'root', 'worker', 'guidance', 'After the gap.');
committed();
await until('page recovers to live after the gap resnapshot',
  `window.__qaMark === 42 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeRecovery)}`);

for (let i=0;i<11;i++) baton('record','qa-cluster-'+i,'worker','Cluster finding '+i+'.','Cluster evidence.','Cluster limits.');
committed();
await until('native SSE preserves every added knowledge record',
  `[...Array(11).keys()].every(i=>document.querySelector('.kg-node[data-knowledge-node="qa-cluster-'+i+'"]'))`);

await evalJs(`document.querySelector('#attention-band .att-seat[data-att-id="aide"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await until('the aide record retains its owed report',
  `document.querySelector('#selection [data-selkey="sel:msg:qa-report-owed"]') !== null`);
baton('stop', 'aide', 'qa-aide-stop', 'Recorded explicit stop with retained report.');
committed();
await until('the recorded view shows the explicit stop',
  `document.querySelector('#attention-band .att-seat[data-att-id="aide"][data-att-state="stopped"]') !== null`);
await evalJs(`document.getElementById('doc-ended').click()`);
await until('the active view retains the stopped actor and its unfinished work',
  `(() => {
    const seat = document.querySelector('#attention-band .att-seat[data-att-id="aide"][data-att-state="stopped"]');
    return document.getElementById('doc-ended').getAttribute('aria-pressed') === 'false'
      && seat?.querySelector('.att-seat-state').textContent.includes('${aideOwed} owed')
      && seat.querySelectorAll('.att-owed').length === Math.min(${aideOwed}, 6)
      && !!document.querySelector('#attention-band .att-seat[data-att-id="worker"][data-att-state="queued"]');
  })()`);
check('the stopped actor record and owed report remain selected', await evalJs(
  `document.querySelector('#selection h2')?.textContent === 'aide'
    && !!document.querySelector('#selection [data-selkey="sel:msg:qa-report-owed"]')`));
await evalJs(`document.getElementById('doc-ended').click()`);
await until('the recorded view restores the stopped actor and owed count',
  `(() => {
    const row = document.querySelector('#attention-band .att-seat[data-att-id="aide"][data-att-state="stopped"]');
    return document.getElementById('doc-ended').getAttribute('aria-pressed') === 'true'
      && !!document.querySelector('#attention-band .att-seat[data-att-id="aide"]')
      && row?.querySelector('.att-seat-state')?.textContent.includes('${aideOwed} owed')
      && row.querySelectorAll('.att-owed').length === Math.min(${aideOwed}, 6);
  })()`);

// Check the same graph layer with complete scientific and orchestra fixtures.
const graphSend = (method,params) => send(pageWs,method,params);
graphSend.navigate = url => navigatePage(pageWs,url);
await qualifyKnowledgeGraphs({origin:'http://127.0.0.1:'+portB,send:graphSend,out:OUT,
  scientificExampleText:readFileSync(fileURLToPath(new URL('./fixtures/knowledge-v1-scientific-example.json',import.meta.url)),'utf8')});

retainFixtureCommands();
console.log('BROWSER_QA_OK');
} catch (error) {
  primaryFailure = error;
  retainedFailure = { originalError: errorRecord(error), wait: activeWait,
    evaluation: lastEvaluation, lastCoordinatorCall, observations: {} };
  if (retainBrowserFailure) {
    try { await retainBrowserFailure(); }
    catch (retentionError) { retainedFailure.retentionError = errorRecord(retentionError); }
  }
  try { retainFixtureCommands(); }
  catch (retentionError) { retainedFailure.fixtureCommandsRetentionError = errorRecord(retentionError); }
  writeFailureRecord();
  throw error;
} finally {
  try { await teardown(); }
  catch (cleanupError) {
    if (!primaryFailure) throw cleanupError;
    retainedFailure.cleanupError = errorRecord(cleanupError);
    writeFailureRecord();
    console.error('Browser cleanup failed after the original failure: ' + cleanupError.stack);
  }
}
}
await qualify();
process.exit(0);

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await child.closed;
}

async function teardown() {
  await Promise.all([chrome, view, view2].map(stopChild));
}
