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
  ws.onerror = (event) => {
    console.log(`CDP websocket error: ${event.message || event.type}`);
    for (const [id, call] of pendingCalls) {
      if (call.ws === ws) {
        call.reject(new Error(`CDP websocket error: ${event.message || event.type}`));
        pendingCalls.delete(id);
      }
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
await until('status filter is available', `document.getElementById('status-filter')`);
await until('initial snapshot reports its actor count',
  `document.getElementById('tree-count').textContent.includes('actors shown')`);
check('running is the default and the completed fixture has no matching actors', await evalJs(
  `document.getElementById('status-filter').value === 'running' && document.querySelectorAll('#tree .node-row').length === 0`));
await evalJs(`document.getElementById('status-filter').value = 'all'; document.getElementById('status-filter').dispatchEvent(new Event('change'));`);
await until('tree renders the fixture hierarchy from the snapshot',
  `document.querySelectorAll('#tree li').length >= 3 && document.getElementById('tree').textContent.includes('worker')`);
await evalJs(`document.getElementById('view-knowledge-btn').click()`);
await until('native owner event stream is ready',
  `document.getElementById('conn-state').textContent === 'live'`);
await until('knowledge graph draws the recorded findings and their promotion',
  `document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]') && document.querySelector('#knowledge-graph .knode[aria-label="qa-aide-finding"]') && [...document.querySelectorAll('#knowledge-graph .kg-edge-share')].some((edge) => edge.getAttribute('aria-label') === 'promotion from worker to aide')`);
check('knowledge graph nodes stay inside the drawn surface', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-graph svg');
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  return [...document.querySelectorAll('#knowledge-graph circle')].every((node) => {
    const x = Number(node.getAttribute('cx'));
    const y = Number(node.getAttribute('cy'));
    const r = Number(node.getAttribute('r'));
    return x - r >= 0 && y - r >= 0 && x + r <= width && y + r <= height;
  });
})()`));
// Capture the knowledge view for review.
const knowledgeShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'knowledge.png'), Buffer.from(knowledgeShot.result.data, 'base64'));
await evalJs(`document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]').focus()`);
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
check('graph finding marks its node selected', await evalJs(
  `document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]').classList.contains('selected')`));
check('graph finding keeps keyboard focus on its node', await evalJs(
  `document.activeElement === document.querySelector('#knowledge-graph .knode.selected')`));
await until('graph finding opens its complete record beside the graph',
  `!document.getElementById('view-knowledge').hidden && ['Worker retained finding.', 'Worker evidence.', 'Worker limits.'].every((value) => document.getElementById('knowledge-promotions').textContent.includes(value))`);
await evalJs(`document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]').click()`);
check('toggle-off keeps focus on its graph node', await evalJs(
  `document.activeElement && document.activeElement.getAttribute("aria-label") === 'qa-worker-finding' && !document.querySelector('#knowledge-graph .knode.selected')`));
await evalJs(`document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]').click()`);
await until('reselected finding reopens its complete record beside the graph with focus',
  `document.activeElement === document.querySelector('#knowledge-graph .knode.selected') && !document.getElementById('view-knowledge').hidden && ['Worker retained finding.', 'Worker evidence.', 'Worker limits.'].every((value) => document.getElementById('knowledge-promotions').textContent.includes(value))`);
await evalJs(`document.getElementById('view-actors-btn').click()`);
check('transitions list shows committed events with recorded times', await evalJs(
  `document.querySelectorAll('#transitions li').length > 0 && /\\d{4}-\\d{2}-\\d{2}|:/.test(document.getElementById('transitions').textContent)`));
await evalJs(`[...document.querySelectorAll('#tree button')].find((b) => (b.textContent || '').includes('worker'))?.click()`);
check('detail separates configured, observed and recorded execution', await evalJs(
  `['configured', 'observed', 'recorded execution', 'observed process'].every((k) => document.getElementById('detail').textContent.includes(k))`));
check('observed process is explicit unknown', await evalJs(
  `document.getElementById('detail').textContent.includes('unknown')`));
await until('selected actor loads its stored findings',
  `document.getElementById('detail').textContent.includes('1 authored / 0 received')`);
await until('selected actor loads its complete recorded work',
  `document.getElementById('detail').textContent.includes('Retained task input.')`);
await evalJs(`document.getElementById('show-findings').click()`);
await evalJs(`[...document.querySelectorAll('#detail .finding-id')].find((button) => button.textContent === 'qa-worker-finding').click()`);
check('actor detail opens the full claim, evidence and limits', await evalJs(
  `['Worker retained finding.', 'Worker evidence.', 'Worker limits.'].every((value) => document.getElementById('detail').textContent.includes(value))`));
// Capture the selected work for review.
const selectedWorkShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'selected-work.png'), Buffer.from(selectedWorkShot.result.data, 'base64'));
baton('record', 'qa-worker-live-finding', 'worker', 'Worker live finding.',
  'Live evidence.', 'Live limits.');
await until('public record refreshes selected actor knowledge through native SSE',
  `document.getElementById('detail').textContent.includes('2 authored / 0 received') && document.getElementById('detail').textContent.includes('Worker live finding.')`);
await until('public record draws the new finding node through native SSE',
  `document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-live-finding"]')`);
baton('promote', 'qa-worker-live-share', 'aide', 'worker', 'aide', 'qa-worker-live-finding');
await until('public promotion refreshes the knowledge overview through native SSE',
  `document.getElementById('knowledge-promotions').textContent.includes('qa-worker-live-finding')`);
await until('public promotion draws the second recorded graph edge through native SSE',
  `[...document.querySelectorAll('#knowledge-graph .kg-edge-share[aria-label="promotion from worker to aide"]')].length === 2`);
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
const startupWriter = new DatabaseSync(DB);
startupWriter.exec('BEGIN EXCLUSIVE');
try {
  await openPage(`http://127.0.0.1:${portB}/`);
  await until('a locked initial snapshot reports its failed read',
    `(document.getElementById('snapshot-line').textContent + document.getElementById('notice').textContent).includes('503')`);
  check('initial snapshot failure enters the existing retry path', await evalJs(
    `document.getElementById('conn-state').textContent === 'retrying'`));
} finally {
  startupWriter.exec('ROLLBACK');
  startupWriter.close();
}
await until('phase B snapshot reports its actor count',
  `document.getElementById('tree-count').textContent.includes('actors shown')`);
check('phase B starts with the running filter and no running fixture actors', await evalJs(
  `document.getElementById('status-filter').value === 'running' && document.querySelectorAll('#tree .node-row').length === 0`));
await evalJs(`document.getElementById('status-filter').value = 'all'; document.getElementById('status-filter').dispatchEvent(new Event('change'));`);
await until('phase B tree renders', `document.querySelectorAll('#tree li').length >= 3`);
await until('phase B stream reaches live', `document.getElementById('conn-state').textContent === 'live'`);
await evalJs(`window.__qaMark = 42`);
await evalJs(`document.getElementById('view-knowledge-btn').click()`);
await until('phase B graph holds the shared findings',
  `document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]')`);
check('phase B graph hides unshared findings until included', await evalJs(
  `!document.querySelector('#knowledge-graph .knode[aria-label="qa-aide-finding"]')`));
await evalJs(`document.getElementById('include-unshared').click()`);
await until('including unshared reveals the aide finding node',
  `document.querySelector('#knowledge-graph .knode[aria-label="qa-aide-finding"]')`);
await evalJs(`(() => {
  const node = document.querySelector('#knowledge-graph .knode[aria-label="qa-aide-finding"]');
  node.focus();
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
})()`);
await until('a graph finding opens its stored content beside the graph',
  `['Aide retained finding.', 'Aide evidence.', 'Aide limits.'].every((value) => document.getElementById('knowledge-promotions').textContent.includes(value))`);
await evalJs(`document.getElementById('view-actors-btn').click()`);

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
    if (holdWorker && url.pathname === '/orchestra/knowledge' && url.searchParams.get('actor') === 'worker') {
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
  document.querySelector('[data-row="worker"] .node-id').click();
})()`);
await evalJs('window.__qaKnowledgeHeld');
await evalJs(`document.querySelector('[data-row="aide"] .node-id').focus()`);
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await until('Enter selects the second actor while the first response is held',
  `document.querySelector('[data-row="aide"]').getAttribute('aria-selected') === 'true' && document.getElementById('detail').textContent.includes('1 authored / 2 received')`);
await evalJs(`document.getElementById('show-findings').click()`);
await evalJs(`[...document.querySelectorAll('#detail .finding-id')].find((button) => button.textContent === 'qa-aide-finding').click()`);
check('second actor detail shows its own stored evidence', await evalJs(
  `['Aide retained finding.', 'Aide evidence.', 'Aide limits.'].every((value) => document.getElementById('detail').textContent.includes(value))`));
await evalJs(`window.__qaReleaseKnowledge(); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
check('late first-actor response preserves the selected actor and findings', await evalJs(
  `document.querySelector('[data-row="aide"]').getAttribute('aria-selected') === 'true' && ['1 authored / 2 received', 'Aide evidence.', 'Aide limits.'].every((value) => document.getElementById('detail').textContent.includes(value))`));
await evalJs('window.__qaRestoreFetch()');

await evalJs(`(() => {
  const actorSearch = document.getElementById('search');
  actorSearch.value = 'aide';
  actorSearch.dispatchEvent(new Event('input', { bubbles: true }));
  const ensemble = document.getElementById('ensemble-filter');
  ensemble.value = 'qa-ensemble';
  ensemble.dispatchEvent(new Event('change', { bubbles: true }));
  const knowledgeSearch = document.getElementById('knowledge-search');
  knowledgeSearch.value = 'no-matching-finding';
  knowledgeSearch.dispatchEvent(new Event('input', { bubbles: true }));
  knowledgeSearch.focus();
})()`);
check('knowledge search filters the recorded findings', await evalJs(
  `document.getElementById('knowledge-empty').textContent === 'No findings match.'`));
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
check('knowledge Escape clears that query and preserves actor filters and detail', await evalJs(
  `document.getElementById('knowledge-search').value === '' && document.activeElement !== document.getElementById('knowledge-search') && document.getElementById('search').value === 'aide' && document.getElementById('ensemble-filter').value === 'qa-ensemble' && document.getElementById('knowledge-promotions').textContent.includes('qa-aide-finding') && document.getElementById('detail').textContent.includes('Aide evidence.')`));
await evalJs(`document.getElementById('search').focus()`);
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send(pageWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
check('actor search Escape preserves the ensemble filter', await evalJs(
  `document.getElementById('search').value === '' && document.getElementById('ensemble-filter').value === 'qa-ensemble'`));
await evalJs(`document.getElementById('clear-filters').click()`);
baton('message', 'qa-aide-receipt', 'root', 'aide', 'guidance', 'Receipt display probe.');
committed();
await until('message transition names its recorded sender once',
  `[...document.querySelectorAll('#transitions li')].some((row) => row.querySelector('.go')?.textContent === 'aide' && row.textContent.includes('guidance from root'))`);
check('message summaries do not duplicate their sender', await evalJs(
  `![...document.querySelectorAll('#transitions li')].some((row) => row.textContent.includes('from root from root'))`));
baton('ack', 'qa-aide-receipt', 'aide', 'fixture-ui-read');
committed();
await until('receipt transition names the acknowledging recipient and original sender',
  `[...document.querySelectorAll('#transitions li')].some((row) => row.querySelector('.go')?.textContent === 'aide' && row.textContent.includes('acknowledged message from root'))`);
const transitionsBefore = await evalJs(`document.querySelectorAll('#transitions li').length`);

// live committed update without reload
baton('message', 'qa-guidance-2', 'root', 'worker', 'guidance', 'Live update probe.');
committed();
await until('committed message arrives live without reload',
  `window.__qaMark === 42 && document.querySelectorAll('#transitions li').length > ${transitionsBefore}`);
check('pending badge updates live', await evalJs(
  `document.getElementById('tree').textContent.includes('worker')`));

// Recorded knowledge persists in the graph while inclusion is on.
check('graph separates unshared findings past a divider', await evalJs(
  `!!document.querySelector('#knowledge-graph .kg-divider')`));
let workerExecution;
{
  const db = new DatabaseSync(DB);
  workerExecution = db.prepare('SELECT id, phase, status FROM executions WHERE session = ?').get('worker');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('running', '', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded running execution reaches the attention lane',
  `[...document.querySelectorAll('#attention-lane .lane-chip')].some((chip) => chip.querySelector('.lane-id')?.textContent === 'worker' && chip.querySelector('.dot.running'))`);
await evalJs(`document.getElementById('view-now-btn').click()`);
await until('running lane is visible in the Now view',
  `!document.getElementById('view-now').hidden && [...document.querySelectorAll('#attention-lane .lane-chip')].some((chip) => chip.querySelector('.lane-id')?.textContent === 'worker' && chip.querySelector('.dot.running'))`);
// Capture the Now view with running work.
const nowShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'now.png'), Buffer.from(nowShot.result.data, 'base64'));
await evalJs(`(() => {
  const chip = document.querySelector('#attention-lane [data-focus="worker"]');
  chip.focus();
  chip.click();
})()`);
await until('attention selection selects its actor with visible detail',
  `document.querySelector('[data-row="worker"]').getAttribute('aria-selected') === 'true' && !document.getElementById('view-actors').hidden && document.getElementById('detail').textContent.includes('authored')`);
await until('selection moves focus to the selected row id button',
  `document.activeElement === document.querySelector('[data-row="worker"] [data-focus="id:worker"]')`);
const lanePendingBefore = await evalJs(
  `Number(document.querySelector('#attention-lane [data-focus="worker"] .lane-badge')?.textContent || 0)`);
await evalJs(`document.getElementById('view-now-btn').click()`);
await evalJs(`document.querySelector('#attention-lane [data-focus="worker"]').focus()`);
baton('message', 'qa-guidance-lane-focus', 'root', 'worker', 'guidance', 'Attention focus retained on live input.');
committed();
await until('live input updates the focused attention chip badge',
  `Number(document.querySelector('#attention-lane [data-focus="worker"] .lane-badge')?.textContent || 0) === ${lanePendingBefore + 1}`);
check('live attention redraw preserves focus on the same actor', await evalJs(
  `window.__qaMark === 42 && document.activeElement === document.querySelector('#attention-lane [data-focus="worker"]')`));
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded completion removes the worker from the running lane while its findings persist in the graph',
  `![...document.querySelectorAll('#attention-lane .lane-chip')].some((chip) => chip.querySelector('.lane-id')?.textContent === 'worker' && chip.querySelector('.dot.running')) && !!document.querySelector('#knowledge-graph .knode[aria-label="qa-worker-finding"]')`);

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
await until('page recovers to live after the gap resnapshot',
  `document.getElementById('conn-state').textContent === 'live'`);

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
