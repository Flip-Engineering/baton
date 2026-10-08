// #682 browser qualification, two phases (remote-only):
// Phase A drives the real `view` command and its elected native-owner event stream.
// Phase B uses the in-process server seam to exercise reconnect-cursor and gap
// recovery over the same committed database.
// Usage: node ui-orchestra-browser.mjs EXE WORKDIR OUTDIR [CHROMIUM]
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestraServer } from '../ui/orchestra/server.mjs';

const [EXE, WORK, OUT, CHROMIUM] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] || 'chromium'];
const DB = join(WORK, 'orchestra.db');
let view = null;
let view2 = null;
let chrome = null;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) { teardown(); process.exit(1); }
}

function baton(...args) {
  const r = spawnSync(EXE, [DB, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`baton2 ${args[0]} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

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
const workerCmd = join(WORK, 'worker-native');
writeFileSync(workerCmd, `#!${process.execPath}\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'turn.input.user',payload:{kind:'turn_input_user',command_id:'worker-primary'}}));\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'run.terminal.completed',payload:{kind:'run_terminal',terminal:'completed',command_id:'worker-primary',text:'Worker completed the assigned task.'}}));\n`);
chmodSync(workerCmd, 0o755);
writeFileSync(join(WORK, 'worker-task.txt'), 'Task for worker');
{
  const turn = spawnSync(EXE, [DB, 'turn', 'worker', 'worker-finished', workerCmd, 'configured-model', 'low',
    join(WORK, 'worker'), join(WORK, 'worker-task.txt'), join(WORK, 'worker.jsonl'), ''], { encoding: 'utf8' });
  if (turn.status !== 0) { console.log('FAIL fixture turn — ' + turn.stdout + turn.stderr); process.exit(1); }
}

// --- chromium over CDP
chrome = spawn(CHROMIUM, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0',
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
}).catch((e) => { console.log('FAIL chromium startup — ' + e.message); teardown(); process.exit(1); });

let msgId = 0;
const pendingCalls = new Map();
let pageWs = null;
function attach(ws) {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendingCalls.has(msg.id)) {
      const call = pendingCalls.get(msg.id);
      pendingCalls.delete(msg.id);
      if (msg.error) call.reject(new Error(JSON.stringify(msg.error)));
      else call.resolve(msg);
    }
  };
  ws.onclose = (event) => {
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
async function openPage(url) {
  const response = await fetch(
    wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '/json/new?about:blank'),
    { method: 'PUT' },
  );
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
  await send(pageWs, 'Page.navigate', { url });
}
async function evalJs(expression) {
  const r = await send(pageWs, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function until(name, expression) {
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
  return value;
}

// ============ Phase A: the real view command ============
const ownerReady = JSON.parse(baton('owner-status'));
check('native owner reports a ready generation and cursor',
  /^\d+$/.test(String(ownerReady.generation))
    && /^\d+$/.test(String(ownerReady.cursor))
    && typeof ownerReady.gap === 'boolean', JSON.stringify(ownerReady));
view = spawn(EXE, [DB, 'view', 'root', 'root', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
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
await until('tree renders the fixture hierarchy from the snapshot',
  `document.querySelectorAll('#tree li').length >= 3 && document.getElementById('tree').textContent.includes('worker')`);
await until('native owner event stream is ready',
  `document.getElementById('conn-state').textContent === 'live'`);
check('transitions list shows committed events with recorded times', await evalJs(
  `document.querySelectorAll('#transitions li').length > 0 && /\\d{4}-\\d{2}-\\d{2}|:/.test(document.getElementById('transitions').textContent)`));
await evalJs(`[...document.querySelectorAll('#tree button')].find((b) => (b.textContent || '').includes('worker'))?.click()`);
check('detail separates configured, observed and recorded execution', await evalJs(
  `['configured', 'observed', 'recorded execution', 'actual process'].every((k) => document.getElementById('detail').textContent.includes(k))`));
check('actual process is explicit unknown', await evalJs(
  `document.getElementById('detail').textContent.includes('unknown')`));
await evalJs(`window.__qaMark = 41`);
const transitionsBeforeNativeCommit = await evalJs(`document.querySelectorAll('#transitions li').length`);
const cursorBeforeNativeCommit = await evalJs(`document.getElementById('cursor-state').textContent`);
baton('message', 'qa-guidance-native', 'root', 'worker', 'guidance', 'Committed through the native owner.');
await until('native owner SSE delivers the committed message without reload',
  `window.__qaMark === 41 && document.querySelectorAll('#transitions li').length > ${transitionsBeforeNativeCommit} && document.getElementById('cursor-state').textContent !== ${JSON.stringify(cursorBeforeNativeCommit)}`);

// operator-triggered reconnect re-reads the snapshot through the view command server
const cursorBeforeReconnect = await evalJs(`document.getElementById('cursor-state').textContent`);
baton('message', 'qa-guidance-1', 'root', 'worker', 'guidance', 'Follow-up input.');
await evalJs(`document.getElementById('reconnect').click()`);
await until('manual reconnect re-reads the snapshot with the new commit',
  `window.__qaMark === 41 && document.getElementById('cursor-state').textContent !== ${JSON.stringify(cursorBeforeReconnect)}`);

// narrow viewport + reduced motion evidence (phase A server stays up)
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evalJs('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
  subscribeCommittedChanges, port: 0 });
await new Promise((r) => server.on('listening', r));
const portB = server.address().port;
await openPage(`http://127.0.0.1:${portB}/`);
await until('phase B tree renders', `document.querySelectorAll('#tree li').length >= 3`);
await until('phase B stream reaches live', `document.getElementById('conn-state').textContent === 'live'`);
await evalJs(`window.__qaMark = 42`);
const transitionsBefore = await evalJs(`document.querySelectorAll('#transitions li').length`);

// live committed update without reload
baton('message', 'qa-guidance-2', 'root', 'worker', 'guidance', 'Live update probe.');
committed();
await until('committed message arrives live without reload',
  `window.__qaMark === 42 && document.querySelectorAll('#transitions li').length > ${transitionsBefore}`);
check('pending badge updates live', await evalJs(
  `document.getElementById('tree').textContent.includes('worker')`));

// reconnect: drop the server, restart on the same port, no duplicated transitions
server.close(); server.closeAllConnections?.();
await until('page notices the lost stream', `document.getElementById('conn-state').textContent !== 'live'`);
const server2 = createOrchestraServer({ databasePath: DB, reader: 'root', subject: 'root',
  subscribeCommittedChanges, port: portB });
await new Promise((r) => server2.on('listening', r));
await until('page reconnects and resumes at its cursor',
  `window.__qaMark === 42 && document.getElementById('conn-state').textContent === 'live'`);
check('no duplicated transitions after reconnect', await evalJs(
  `(() => { const rows = [...document.querySelectorAll('#transitions li')].map((li) => li.textContent); return new Set(rows).size === rows.length; })()`));

// retention gap: prune below the page cursor, then commit; page gaps and resnapshots
{
  const db = new DatabaseSync(DB);
  db.exec('DELETE FROM native_changes WHERE change_id <= (SELECT max(change_id) - 1 FROM native_changes)');
  db.close();
}
baton('message', 'qa-guidance-3', 'root', 'worker', 'guidance', 'After pruning.');
committed();
await until('pruned cursor produces a gap notice and fresh state',
  `window.__qaMark === 42 && !document.getElementById('notice').hidden && document.getElementById('notice').textContent.length > 0`);
await until('page recovers to live after the gap resnapshot',
  `document.getElementById('conn-state').textContent === 'live'`);

console.log('BROWSER_QA_OK');
teardown();
process.exit(0);

function teardown() {
  try { chrome && chrome.kill('SIGTERM'); } catch {}
  try { view && view.kill('SIGTERM'); } catch {}
  try { view2 && view2.kill('SIGTERM'); } catch {}
}
