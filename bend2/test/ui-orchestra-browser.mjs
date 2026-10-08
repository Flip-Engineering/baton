// #682 browser qualification, two phases (remote-only):
// Phase A drives the real `view` command end-to-end. Until the shared per-DB
// owner subscription (#676) exists, the events route answers 503 and the page
// must show the stream as explicitly unavailable without a retry loop.
// Phase B runs the real server in-process with a test commit-notification
// seam (the same helper shape as ui-orchestra-server.test.mjs) over the real
// database, so live update, reconnect-cursor and gap recovery are exercised in
// the browser while the canonical owner interface is absent.
// Usage: node ui-orchestra-browser.mjs EXE WORKDIR OUTDIR [CHROMIUM]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestraServer } from '../ui/orchestra/server.mjs';

const [EXE, WORK, OUT, CHROMIUM] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] || 'chromium'];
const DB = join(WORK, 'orchestra.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  mkdirSync(ws, { recursive: true });
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
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'run.terminal.completed',payload:{kind:'run_terminal',terminal:'completed',text:'Worker completed the assigned task.'}}));\n`);
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
  chrome.on('exit', (c) => reject(new Error(`chromium exited ${c}: ${chromeErr.slice(-400)}`)));
  setTimeout(() => reject(new Error('no DevTools endpoint')), 20000);
}).catch((e) => { console.log('FAIL chromium startup — ' + e.message); teardown(); process.exit(1); });

let msgId = 0;
const pendingCalls = new Map();
let pageWs = null;
function attach(ws) {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendingCalls.has(msg.id)) { pendingCalls.get(msg.id)(msg); pendingCalls.delete(msg.id); }
  };
}
function send(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pendingCalls.set(id, resolve));
}
async function openPage(url) {
  const list = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '/json/list'))).json();
  const page = list.find((t) => t.type === 'page');
  pageWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { pageWs.onopen = r; pageWs.onerror = j; });
  attach(pageWs);
  await send(pageWs, 'Runtime.enable');
  await send(pageWs, 'Page.enable');
  await send(pageWs, 'Page.navigate', { url });
}
async function evalJs(expression) {
  const r = await send(pageWs, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function until(name, expression, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) { check(name, false, 'timeout'); return; }
    await sleep(250);
  }
}

// ============ Phase A: the real view command ============
const PORT_A = 17682;
view = spawn(EXE, [DB, 'view', 'root', 'root', String(PORT_A)], { stdio: ['pipe', 'pipe', 'pipe'] });
let viewBuf = '';
view.stdout.on('data', (d) => { viewBuf += d; });
let viewLines = await new Promise((resolve) => {
  const t = setInterval(() => {
    const lines = viewBuf.split('\n').filter(Boolean);
    if (lines.length >= 2) { clearInterval(t); resolve(lines); }
  }, 100);
  setTimeout(() => { clearInterval(t); resolve(viewBuf.split('\n').filter(Boolean)); }, 15000);
});
check('view command reports listener JSON and URL line',
  viewLines.length >= 2 && viewLines[0].includes('"port"') && viewLines[1].startsWith('http://127.0.0.1:'),
  viewLines.join(' / '));
const urlA = viewLines[1].trim();

await openPage(urlA);
await until('tree renders the fixture hierarchy from the snapshot',
  `document.querySelectorAll('#tree li').length >= 3 && document.getElementById('tree').textContent.includes('worker')`);
check('transitions list shows committed events with recorded times', await evalJs(
  `document.querySelectorAll('#transitions li').length > 0 && /\\d{4}-\\d{2}-\\d{2}|:/.test(document.getElementById('transitions').textContent)`));
await evalJs(`[...document.querySelectorAll('#tree button')].find((b) => (b.textContent || '').includes('worker'))?.click()`);
check('detail separates configured, observed and recorded execution', await evalJs(
  `['configured', 'observed', 'recorded execution', 'actual process'].every((k) => document.getElementById('detail').textContent.includes(k))`));
check('actual process is explicit unknown', await evalJs(
  `document.getElementById('detail').textContent.includes('unknown')`));

// Until the 676 subscription exists the page must report the stream as
// unavailable and stop retrying (no browser polling loop).
await until('events 503 surfaces as explicitly unavailable, not a retry loop',
  `document.getElementById('conn-state').textContent === 'unavailable' && document.getElementById('notice').textContent.includes('#676')`, 45000);
await sleep(4000);
check('no retry loop after the permanent 503', await evalJs(
  `document.getElementById('conn-state').textContent === 'unavailable'`));
await evalJs(`window.__qaMark = 41`);

// operator-triggered reconnect re-reads the snapshot through the view command server
baton('message', 'qa-guidance-1', 'root', 'worker', 'guidance', 'Follow-up input.');
await evalJs(`document.getElementById('reconnect').click()`);
await until('manual reconnect re-reads the snapshot with the new commit',
  `window.__qaMark === 41 && [...document.querySelectorAll('#transitions li')].some((li) => li.textContent.includes('guidance'))`);

// narrow viewport + reduced motion evidence (phase A server stays up)
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(600);
const narrow = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'narrow-390.png'), Buffer.from(narrow.result.data, 'base64'));
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send(pageWs, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(600);
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
  `window.__qaMark === 42 && document.getElementById('conn-state').textContent === 'live'`, 45000);
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
  `window.__qaMark === 42 && !document.getElementById('notice').hidden && document.getElementById('notice').textContent.length > 0`, 45000);
await until('page recovers to live after the gap resnapshot',
  `document.getElementById('conn-state').textContent === 'live'`, 45000);

console.log('BROWSER_QA_OK');
teardown();
process.exit(0);

function teardown() {
  try { chrome && chrome.kill('SIGTERM'); } catch {}
  try { view && view.kill('SIGTERM'); } catch {}
  try { view2 && view2.kill('SIGTERM'); } catch {}
}
