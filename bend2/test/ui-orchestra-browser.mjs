// #682 browser qualification: drives the real `view` command, a real fixture
// Orchestra built through the native binary, and headless Chromium over CDP.
// Usage: node ui-orchestra-browser.mjs EXE WORKDIR OUTDIR [CHROMIUM]
// Prints one PASS/FAIL line per check; exits nonzero on the first FAIL.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [EXE, WORK, OUT, CHROMIUM] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] || 'chromium'];
const DB = join(WORK, 'orchestra.db');
const results = [];
let view2 = null;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) { teardown(); process.exit(1); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baton(...args) {
  const r = spawnSync(EXE, [DB, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`baton2 ${args[0]} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

// --- fixture: root conductor -> lead associate conductor -> worker, one section, one ensemble
baton('attach', 'root', 'fixture', 'root-native', '');
// recruit requires a real git worktree target
const REPO = join(WORK, 'repo');
mkdirSync(REPO, { recursive: true });
for (const args of [['init', '-q'], ['config', 'user.name', 'UI fixture'],
                    ['config', 'user.email', 'ui-fixture@example.invalid'],
                    ['commit', '-qm', 'Initial tree', '--allow-empty']]) {
  spawnSync('git', ['-C', REPO, ...args], { stdio: 'inherit' });
}
baton('role', 'root', 'principal-conductor');
for (const [name, parent] of [['lead', 'root'], ['worker', 'lead'], ['aide', 'lead']]) {
  const ws = join(WORK, name);
  mkdirSync(ws, { recursive: true });
  baton('recruit', name, parent, 'muse', 'configured-model', 'low', join(WORK, 'repo'), `${name}-branch`, ws, 'HEAD');
}
baton('role', 'lead', 'associate-conductor');
baton('ensemble', 'qa-ensemble', 'lead', 'tight');
baton('ensemble-member', 'qa-ensemble', 'lead', 'lead', 'add');
baton('ensemble-member', 'qa-ensemble', 'lead', 'worker', 'add');
baton('ensemble-member', 'qa-ensemble', 'lead', 'aide', 'add');
baton('section', 'qa-ensemble', 'qa-section', 'lead', 'qualification coverage');
baton('section-member', 'qa-ensemble', 'qa-section', 'lead', 'worker', 'add');
baton('message', 'qa-task-1', 'root', 'worker', 'task', 'Retained task input.');

// one completed turn so execution/report transitions exist
const workerCmd = join(WORK, 'worker-native');
writeFileSync(workerCmd, `#!${process.execPath}\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'run.terminal.completed',payload:{kind:'run_terminal',terminal:'completed',text:'Worker completed the assigned task.'}}));\n`);
writeFileSync(join(WORK, 'worker-task.txt'), 'Task for worker');
const turn = spawnSync(EXE, [DB, 'turn', 'worker', 'worker-finished', workerCmd, 'configured-model', 'low',
  join(WORK, 'worker'), join(WORK, 'worker-task.txt'), join(WORK, 'worker.jsonl'), ''], { encoding: 'utf8' });
if (turn.status !== 0) { console.log('FAIL fixture turn — ' + turn.stdout + turn.stderr); process.exit(1); }

// --- start the real view command on a fixed port
const PORT = 17682;
const view = spawn(EXE, [DB, 'view', 'root', 'root', String(PORT)], { stdio: ['pipe', 'pipe', 'pipe'] });
let viewLines = [];
let viewStdout = '';
view.stdout.on('data', (d) => { viewStdout += d; });
const firstLine = await new Promise((resolve, reject) => {
  let buf = '';
  view.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) resolve(buf.slice(0, i)); });
  view.on('exit', (c) => reject(new Error(`view exited ${c}: ${viewStdout}`)));
  setTimeout(() => reject(new Error('view produced no listening line')), 15000);
}).catch((e) => { console.log('FAIL view startup — ' + e.message); process.exit(1); });
let secondBuf = '';
const urlLine = await new Promise((resolve, reject) => {
  view.stdout.on('data', (d) => { secondBuf += d; const i = secondBuf.indexOf('\n'); if (i >= 0) resolve(secondBuf.slice(0, i)); });
  setTimeout(() => reject(new Error('view produced no URL line')), 15000);
}).catch((e) => { console.log('FAIL view URL line — ' + e.message); process.exit(1); });
const pageUrl = urlLine.trim();
check('view command reports listener JSON and URL line', firstLine.includes('"port"') && pageUrl.startsWith('http://127.0.0.1:'), `${firstLine} / ${pageUrl}`);

// --- chromium over CDP
const chrome = spawn(CHROMIUM, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0',
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

const browserWs = new WebSocket(wsUrl);
await new Promise((r, j) => { browserWs.onopen = r; browserWs.onerror = j; });
let msgId = 0;
const pending = new Map();
browserWs.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
// find the page target
const list = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '/json/list'))).json();
const page = list.find((t) => t.type === 'page');
const pageWs = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { pageWs.onopen = r; pageWs.onerror = j; });
await send(pageWs, 'Runtime.enable');
await send(pageWs, 'Page.enable');

async function evalJs(expression) {
  const r = await send(pageWs, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function until(name, expression, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) { check(name, false, 'timeout'); return; }
    await sleep(250);
  }
}

await send(pageWs, 'Page.navigate', { url: pageUrl });
check('page loads from the view server', true, pageUrl);

// initial render
await until('tree renders the fixture hierarchy',
  `document.querySelectorAll('#tree li').length >= 3 && document.getElementById('tree').textContent.includes('worker')`);
await until('stream reaches live state',
  `document.getElementById('conn-state').textContent === 'live'`);
check('transitions list shows committed events with recorded times', await evalJs(
  `document.querySelectorAll('#transitions li').length > 0 && /\\d{4}-\\d{2}-\\d{2}|:/.test(document.getElementById('transitions').textContent)`));
await evalJs(`[...document.querySelectorAll('#tree button')].find((b) => (b.textContent || '').includes('worker'))?.click()`);
check('detail separates configured, observed and recorded execution', await evalJs(
  `['configured', 'observed', 'recorded execution', 'actual process'].every((k) => document.getElementById('detail').textContent.includes(k))`));
check('actual process is explicit unknown', await evalJs(
  `document.getElementById('detail').textContent.includes('unknown')`));
await evalJs(`window.__qaMark = 41`);

// live commit while the page is open: no reload, SSE updates
const transitionsBefore = await evalJs(`document.querySelectorAll('#transitions li').length`);
baton('message', 'qa-guidance-1', 'root', 'worker', 'guidance', 'Follow-up input.');
await until('committed message arrives live without reload',
  `window.__qaMark === 41 && document.querySelectorAll('#transitions li').length > ${transitionsBefore}`);

// server restart: page reconnects from its durable cursor without duplication
view.kill('SIGTERM');
await new Promise((r) => view.on('exit', r));
view2 = spawn(EXE, [DB, 'view', 'root', 'root', String(PORT)], { stdio: ['pipe', 'pipe', 'pipe'] });
view2.stdout.on('data', () => {});
await until('page reconnects after server restart',
  `window.__qaMark === 41 && document.getElementById('conn-state').textContent === 'live'`, 40000);
check('no duplicated transitions after reconnect', await evalJs(
  `(() => { const kinds = [...document.querySelectorAll('#transitions li')].map((li) => li.textContent); return new Set(kinds).size === kinds.length; })()`));

// retention gap: prune below the cursor, then commit; the page must gap and resnapshot
{
  const db = new DatabaseSync(DB);
  db.exec(`DELETE FROM native_changes WHERE change_id <= (SELECT max(change_id) - 1 FROM native_changes)`);
  db.close();
}
baton('message', 'qa-guidance-2', 'root', 'worker', 'guidance', 'After pruning.');
await until('pruned cursor produces a visible gap notice and fresh state',
  `window.__qaMark === 41 && !document.getElementById('notice').hidden && document.getElementById('conn-state').textContent !== 'idle'`, 40000);

// narrow viewport + reduced motion evidence
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(500);
const narrow = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'narrow-390.png'), Buffer.from(narrow.result.data, 'base64'));
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send(pageWs, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
baton('message', 'qa-guidance-3', 'root', 'worker', 'guidance', 'Reduced motion probe.');
await sleep(1500);
const reduced = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'reduced-motion.png'), Buffer.from(reduced.result.data, 'base64'));
check('narrow and reduced-motion evidence captured', true, 'narrow-390.png, reduced-motion.png');

console.log('BROWSER_QA_OK');
teardown();
process.exit(0);

function teardown() {
  try { chrome.kill('SIGTERM'); } catch {}
  try { view.kill('SIGTERM'); } catch {}
  try { view2?.kill('SIGTERM'); } catch {}
}
