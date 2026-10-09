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

function spawnTracked(...args) {
  const child = spawn(...args);
  child.closed = new Promise((resolve) => child.once('close', resolve));
  return child;
}

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error(name + ': ' + detail);
}

function baton(...args) {
  const r = spawnSync(EXE, [DB, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`baton2 ${args[0]} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

try {
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
  `const {readFileSync} = require('node:fs'); const {spawnSync} = require('node:child_process');\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'turn.input.user',payload:{kind:'turn_input_user',command_id:'worker-primary'}}));\n` +
  `const prompt = readFileSync(process.argv[process.argv.indexOf('--prompt-file')+1], 'utf8');\n` +
  `const inputs = ['qa-task-1', ...[...prompt.matchAll(/^Message \\([^\\n]*\\) from [^\\n]* \\[id: (.*?)\\]:$/gm)].map((match) => match[1])];\n` +
  `for (const id of new Set(inputs)) {\n` +
  `  const delivered = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, 'delivery', id], {encoding:'utf8'});\n` +
  `  if (delivered.status !== 0 || JSON.parse(delivered.stdout).recipient !== 'worker') throw new Error(delivered.stderr || 'wrong fixture recipient');\n` +
  `  const accepted = spawnSync(${JSON.stringify(EXE)}, [${JSON.stringify(DB)}, 'ack', id, 'worker', 'fixture-native-reviewed'], {encoding:'utf8'});\n` +
  `  if (accepted.status !== 0) throw new Error(accepted.stdout + accepted.stderr);\n` +
  `}\n` +
  `console.log(JSON.stringify({stream:{kind:'session',id:'native-worker'},payload_type:'run.terminal.completed',payload:{kind:'run_terminal',terminal:'completed',command_id:'worker-primary',text:'Worker completed the assigned task.'}}));\n`);
chmodSync(workerCmd, 0o755);
writeFileSync(join(WORK, 'worker-task.txt'), 'Task for worker');
{
  const turn = spawnSync(EXE, [DB, 'turn', 'worker', 'worker-finished', workerCmd, 'configured-model', 'low',
    join(WORK, 'worker'), join(WORK, 'worker-task.txt'), join(WORK, 'worker.jsonl'), ''], { encoding: 'utf8' });
  if (turn.status !== 0) throw new Error('fixture turn: ' + turn.stdout + turn.stderr);
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
  await navigatePage(pageWs, url);
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
await until('snapshot line leaves its unloaded state',
  `document.getElementById('snapshot-line') && !document.getElementById('snapshot-line').textContent.includes('No snapshot loaded')`);
await until('attention strip settles on the snapshot actors',
  `(document.getElementById('attention-band').textContent || '').length > 0`);
check('quiet seats fold behind the control by default', await evalJs(
  `document.getElementById('doc-ended').getAttribute('aria-pressed') === 'false' && document.querySelectorAll('#roster .doc-row').length === 0`));
await evalJs(`document.getElementById('doc-ended').click()`);
await until('roster renders the fixture actors in margin bands',
  `document.querySelectorAll('#roster .doc-row').length >= 4 && (document.getElementById('roster').textContent || '').includes('qa-ensemble')`);
check('roster rows lead with work before the name', await evalJs(
  `[...document.querySelectorAll('#roster .doc-row')].every((row) => { const btn = row.querySelector('.doc-open'); const lead = btn ? btn.firstElementChild : null; return !!btn && !!lead && lead.classList.contains('doc-lead') && !!lead.querySelector('.doc-work') && !!btn.querySelector('.doc-name'); })`));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('selection record opens for the chosen row',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
await until('knowledge strip attaches finding ticks to their authors',
  `document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-finding"] title') && document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-finding"] title').textContent === 'Worker retained finding. — 2 promotions'`);
check('strip ticks encode degree and destinations as marks', await evalJs(`(() => {
  const row = '#roster .doc-row[data-doc-id="worker"] ';
  const tick = document.querySelector(row + '.kw-tick[data-kw-node="qa-worker-finding"]');
  const aide = document.querySelector('#roster .doc-row[data-doc-id="aide"] .kw-tick[data-kw-node="qa-aide-finding"]');
  const stubs = [...document.querySelectorAll(row + '.kw-stub')].map((s) => s.textContent);
  return !!tick && tick.classList.contains('shared') && !!aide && aide.classList.contains('unshared')
    && stubs.some((s) => s.includes('→ aide')) && stubs.some((s) => s.includes('→ lead'));
})()`));
// Capture the rendered knowledge band before exercising its selection.
const knowledgeShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'knowledge.png'), Buffer.from(knowledgeShot.result.data, 'base64'));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
check('strip tick selection marks, labels claim plus evidence, and keeps focus', await evalJs(`(() => {
  const row = '#roster .doc-row[data-doc-id="worker"] ';
  const tick = document.querySelector(row + '.kw-tick[data-kw-node="qa-worker-finding"]');
  const label = document.querySelector(row + '.kw-claim');
  const evidence = document.querySelector(row + '.kw-evidence');
  const limits = document.querySelector(row + '.kw-limits');
  return !!tick && tick.classList.contains('selected') && document.activeElement === tick
    && !!label && label.textContent === 'Worker retained finding.'
    && !!evidence && evidence.textContent === 'Worker evidence.'
    && !!limits && limits.textContent === 'Worker limits.';
})()`));
await evalJs(`document.querySelector('details.doc-whole').open = true`);
await until('whole-orchestra canvas draws on demand behind its disclosure',
  `document.querySelector('#knowledge-whole svg.kw-canvas') && document.querySelectorAll('#knowledge-whole .kw-tier').length > 1`);
check('recorded edge types render directed', await evalJs(
  `['kw-edge-authorship', 'kw-edge-share', 'kw-edge-deliver'].every((cls) => [...document.querySelectorAll('#knowledge-whole .' + cls)].some((edge) => (edge.getAttribute('marker-end') || '').startsWith('url(')))`));
check('whole-orchestra nodes stay inside the drawn surface', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg');
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  return [...document.querySelectorAll('#knowledge-whole circle')].every((node) => {
    const x = Number(node.getAttribute('cx'));
    const y = Number(node.getAttribute('cy'));
    const r = Number(node.getAttribute('r'));
    return x - r >= 0 && y - r >= 0 && x + r <= width && y + r <= height;
  });
})()`));
check('shared findings read larger than unshared ones', await evalJs(`(() => {
  const shared = document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"] circle');
  const unshared = document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"] circle');
  return !!shared && !!unshared && Number(shared.getAttribute('r')) > Number(unshared.getAttribute('r'));
})()`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
check('whole finding selection marks and keeps focus', await evalJs(
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').classList.contains('selected') && document.activeElement === document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`));
// Capture the selected finding for review.
const selectedWorkShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'selected-work.png'), Buffer.from(selectedWorkShot.result.data, 'base64'));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open').click()`);
await until('second actor record replaces the first',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`);
baton('record', 'qa-worker-live-finding', 'worker', 'Worker live finding.',
  'Live evidence.', 'Live limits.');
await until('live record adds a second tick to the author strip through native SSE',
  `document.querySelectorAll('#roster .doc-row[data-doc-id="worker"] .kw-tick').length === 2`);
await until('live record draws the new whole-canvas node through native SSE',
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-live-finding"]')`);
baton('promote', 'qa-worker-live-share', 'aide', 'worker', 'aide', 'qa-worker-live-finding');
await until('live promotion inks the new tick through native SSE',
  `document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-live-finding"]').classList.contains('shared')`);
await until('live promotion draws the second recorded share edge through native SSE',
  `[...document.querySelectorAll('#knowledge-whole .kw-edge-share[aria-label="promotion from worker to aide"]')].length === 2`);
await evalJs(`window.__qaMark = 41`);
const ribbonMaxBeforeNativeCommit = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-native', 'root', 'worker', 'guidance', 'Committed through the native owner.');
await until('native owner SSE moves the ribbon without reload',
  `window.__qaMark === 41 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeNativeCommit)}`);
await evalJs(`document.querySelector('#ribbon [data-focus="ribbon-list"]').click()`);
await until('ribbon full list opens with recorded rows',
  `document.querySelector('#ribbon .ribbon-list') && document.querySelectorAll('#ribbon .ribbon-row').length > 0 && (document.querySelector('#ribbon .ribbon-list').textContent || '').includes('worker')`);

// operator-triggered reconnect re-reads the snapshot through the view command server
const ribbonMaxBeforeReconnect = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-1', 'root', 'worker', 'guidance', 'Follow-up input.');
await evalJs(`document.getElementById('reconnect').click()`);
await until('manual reconnect re-reads the snapshot with the new commit',
  `window.__qaMark === 41 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeReconnect)}`);

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
await until('phase B roster renders', `document.querySelectorAll('#roster .doc-row').length >= 3`);
await until('phase B attention settles on the snapshot actors',
  `(document.getElementById('attention-band').textContent || '').length > 0`);
await evalJs(`window.__qaMark = 42`);
await evalJs(`document.querySelector('#ribbon [data-focus="ribbon-list"]').click()`);
await until('phase B ribbon list opens', `document.querySelectorAll('#ribbon .ribbon-row').length > 0`);
check('phase B strip holds shared and unshared ticks with no inclusion toggle', await evalJs(
  `!!document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-finding"]') && !!document.querySelector('#roster .doc-row[data-doc-id="aide"] .kw-tick[data-kw-node="qa-aide-finding"]')`));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .kw-tick[data-kw-node="qa-aide-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
check('strip tick selection marks its tick', await evalJs(
  `document.querySelector('#roster .doc-row[data-doc-id="aide"] .kw-tick[data-kw-node="qa-aide-finding"]').classList.contains('selected')`));

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
  document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click();
})()`);
await evalJs('window.__qaKnowledgeHeld');
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open').click()`);
await until('second row selects while the first work response is held',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`);
await evalJs(`window.__qaReleaseKnowledge(); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
check('late first-actor work preserves the selected record', await evalJs(
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`));
await evalJs('window.__qaRestoreFetch()');

await evalJs(`(() => {
  const find = document.getElementById('doc-find');
  find.value = 'aide';
  find.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check('find dims non-matches in place with one cursor', await evalJs(`(() => {
  const rows = [...document.querySelectorAll('#roster .doc-row')];
  const aide = rows.filter((row) => row.dataset.docId === 'aide');
  const rest = rows.filter((row) => row.dataset.docId !== 'aide');
  return aide.length > 0 && rest.length > 0 && rest.every((row) => row.classList.contains('doc-dim'))
    && document.querySelectorAll('#roster .doc-cursor').length === 1;
})()`));
await evalJs(`(() => {
  const find = document.getElementById('doc-find');
  find.value = '';
  find.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check('clearing find restores undimmed rows', await evalJs(
  `document.querySelectorAll('#roster .doc-dim').length === 0`));
const pendingBody = '  Inspect the stalled work.\n\nRetain this complete evidence.  ';
baton('message', 'qa-aide-receipt', 'root', 'aide', 'guidance', pendingBody);
committed();
await until('ribbon rows name the recorded far side',
  `[...document.querySelectorAll('#ribbon .ribbon-row')].some((row) => (row.textContent || '').includes('aide'))`);
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open').click()`);
await until('pending message has a read control',
  `document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]') !== null`);
await evalJs(`(() => {
  const button = document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]');
  button.focus(); button.click();
})()`);
await until('pending message displays its complete stored body',
  `[...document.querySelectorAll('#selection .sel-body')].some((node) => node.textContent === ${JSON.stringify(pendingBody)})`);
check('message body remains open and focused after its asynchronous read', await evalJs(
  `document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]').getAttribute('aria-expanded') === 'true'
    && document.activeElement === document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]')`));
await evalJs(`document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'/', bubbles:true, cancelable:true}))`);
check('keyboard find shortcut focuses the visible query', await evalJs(
  `document.activeElement === document.getElementById('doc-find')`));
baton('ack', 'qa-aide-receipt', 'aide', 'fixture-ui-read');
committed();
const ribbonRowsBefore = await evalJs(`document.querySelectorAll('#ribbon .ribbon-row').length`);

// live committed update without reload
baton('message', 'qa-guidance-2', 'root', 'worker', 'guidance', 'Live update probe.');
committed();
await until('committed message arrives live without reload',
  `window.__qaMark === 42 && document.querySelectorAll('#ribbon .ribbon-row').length > ${ribbonRowsBefore}`);
check('pending badge updates live on the worker row', await evalJs(
  `document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-pending') !== null`));
let workerExecution;
{
  const db = new DatabaseSync(DB);
  workerExecution = db.prepare('SELECT id, phase, status FROM executions WHERE session = ?').get('worker');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('running', '', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded running execution reaches the attention strip',
  `document.querySelector('#attention-band [data-att-key="chip:worker"]') !== null`);
// Capture the document with running work.
const nowShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'now.png'), Buffer.from(nowShot.result.data, 'base64'));
await evalJs(`document.querySelector('#attention-band [data-att-key="chip:worker"]').click()`);
await until('attention selection opens the actor record',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
await evalJs(`document.querySelector('#attention-band [data-att-key="chip:worker"]').focus()`);
baton('message', 'qa-guidance-lane-focus', 'root', 'worker', 'guidance', 'Attention focus retained on live input.');
committed();
check('live attention redraw preserves focus on the same chip', await evalJs(
  `window.__qaMark === 42 && document.activeElement && document.activeElement.getAttribute('data-att-key') === 'chip:worker'`));
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded completion removes the worker chip while its findings persist in the band',
  `!document.querySelector('#attention-band [data-att-key="chip:worker"]') && !!document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-tick[data-kw-node="qa-worker-finding"]')`);

// reconnect: drop the server, restart on the same port, no duplicated transitions
server.close(); server.closeAllConnections?.();
await until('page notices the lost stream', `!document.getElementById('notice').hidden && /unavailable/i.test(document.getElementById('notice').textContent)`);
const server2 = createOrchestraServer({ databasePath: DB, reader: 'root', subject: 'root',
  subscribeCommittedChanges, port: portB });
await new Promise((r) => server2.on('listening', r));
await until('page reconnects and clears its notice',
  `window.__qaMark === 42 && document.getElementById('notice').hidden`);
check('no duplicated ribbon rows after reconnect', await evalJs(
  `(() => { const rows = [...document.querySelectorAll('#ribbon .ribbon-row')].map((li) => li.textContent); return rows.length > 0 && new Set(rows).size === rows.length; })()`));

// Remove an unnotified change after the page cursor, then let a later commit reveal the gap.
baton('message', 'qa-guidance-pruned', 'root', 'worker', 'guidance', 'Committed without a notice.');
{
  const db = new DatabaseSync(DB);
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

console.log('BROWSER_QA_OK');
} finally {
  await teardown();
}
process.exit(0);

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await child.closed;
}

async function teardown() {
  await Promise.all([chrome, view, view2].map(stopChild));
}
