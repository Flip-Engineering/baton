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
const CAPTURE_ONLY = process.env.FINAL_NATIVE_CONTEXT_BROWSER_CAPTURE_ONLY === 'true';
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

async function qualify() {
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
if (!CAPTURE_ONLY) {
  baton('promote-scoped', 'qa-group-share', 'lead', 'session', 'worker',
    'group', 'qa-ensemble', 'qa-worker-finding');
}
baton('record', 'qa-msg-finding', 'worker', 'Worker message finding.',
  'message:qa-task-1', 'Worker message limits.');
{
  const db = new DatabaseSync(DB);
  db.exec('CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL)');
  db.prepare(`INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES
    ('qa-rel-msg','worker','finding:qa-msg-finding','evidenced by','message:qa-task-1'),
    ('qa-rel-ext','worker','finding:qa-worker-finding','recorded in','external:qa-log-7'),
    ('qa-rel-gone','worker','finding:qa-worker-finding','answers','message:qa-missing-1'),
    ('qa-rel-orphan','worker','finding:qa-nope','continues','finding:qa-worker-finding'),
    ('qa-rel-refs','worker','message:qa-missing-1','references','external:qa-log-8')`).run();
  db.close();
}

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
  console.log('WAIT ' + name);
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
await send(pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const earlyShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'initial.png'), Buffer.from(earlyShot.result.data, 'base64'));
await until('snapshot line leaves its unloaded state',
  `document.getElementById('snapshot-line') && !document.getElementById('snapshot-line').textContent.includes('No snapshot loaded')`);
await until('the stage settles on the snapshot actors',
  `(document.getElementById('attention-band').textContent || '').length > 0`);
const initialShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'initial.png'), Buffer.from(initialShot.result.data, 'base64'));
check('the default scope shows live work and puts the rest behind the control', await evalJs(
  `document.getElementById('doc-ended').getAttribute('aria-pressed') === 'false'
    && document.querySelectorAll('#roster .doc-row.state-quiet').length === 0
    && /^Show /.test((document.getElementById('doc-ended').textContent || '').trim())`));
await evalJs(`document.getElementById('doc-ended').click()`);
await until('roster renders the fixture actors in margin bands',
  `document.querySelectorAll('#roster .doc-row').length >= 4 && (document.getElementById('roster').textContent || '').includes('qa-ensemble')`);
check('plate carries its heading and one plain state word', await evalJs(`(() => {
  const h1 = document.querySelector('h1.plate-title');
  const mark = document.getElementById('plate-mark');
  return !!h1 && h1.textContent === 'Baton'
    && !!mark && ['running', 'stopped', 'failed', 'queued', 'idle']
      .includes((mark.textContent || '').trim());
})()`));
check('the plate moves through the regions in their redesigned order', await evalJs(`(() => {
  const links = [...document.querySelectorAll('.plate-nav a')];
  const want = [['#pit', 'Activity'], ['#staves', 'Agents'], ['#map', 'Knowledge'],
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
check('Agents give every row a staff and bands a rehearsal letter', await evalJs(`(() => {
  const rows = [...document.querySelectorAll('#roster .doc-row')];
  const heads = [...document.querySelectorAll('#roster .doc-band-head .doc-bracket')];
  return rows.length > 0 && rows.every((row) => row.querySelector('.doc-staff'))
    && heads.length > 0 && heads.every((h) => /^[A-Z]+$/.test((h.textContent || '').trim()))
    && !!document.querySelector('#roster .doc-row .staff-note');
})()`));
await until('map opens on the universal view',
  `document.querySelector('#map-scope').textContent === 'Universal knowledge · 0 items'`);
check('universal view holds no fixture records', await evalJs(
  `document.querySelectorAll('#knowledge-whole .knode').length === 0 && document.querySelectorAll('#knowledge-whole .kw-anchor').length === 0`));
check('the exemplar is absent where nothing draws', await evalJs(
  `!document.querySelector('#knowledge-whole .kw-exemplar') && !document.querySelector('#knowledge-whole .kw-macro')`));
check('an empty map draws one staff rule at its short height', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg');
  return document.querySelectorAll('#knowledge-whole line.kw-staff').length === 1
    && !!svg && svg.getAttribute('height') === '120';
})()`));
{
  const db = new DatabaseSync(DB);
  db.prepare("INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES ('qa-rel-only','root','message:qa-root-message','references','external:qa-root-log')").run();
  db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('relation-only holdings draw their author and both references',
  `!!document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="root"]')
    && !!document.querySelector('#knowledge-whole .kw-edge-relate[data-from="message:qa-root-message"][data-to="external:qa-root-log"]')`);
{
  const db = new DatabaseSync(DB);
  db.prepare("DELETE FROM knowledge_relations WHERE id='qa-rel-only'").run();
  db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('removing the only relation restores the empty universal view',
  `document.querySelectorAll('#knowledge-whole .kw-anchor').length === 0
    && document.getElementById('knowledge-whole').textContent.includes('No recorded findings')`);
check('roster rows read the name, the work, then the staff', await evalJs(
  `[...document.querySelectorAll('#roster .doc-row')].every((row) => { const btn = row.querySelector('.doc-open'); if (!btn) return false; const kids = [...btn.children]; const name = btn.querySelector('.doc-name'); const lead = btn.querySelector('.doc-lead'); const staff = btn.querySelector('.doc-staff'); return !!name && !!lead && !!staff && kids.indexOf(name) < kids.indexOf(lead) && kids.indexOf(lead) < kids.indexOf(staff); })`));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('the selected actor opens for the chosen row',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
const selectedActorHash = await evalJs(`location.hash`);
await evalJs(`document.querySelector('#selection .sel-index a').click()`);
check('selected actor navigation preserves its address', await evalJs(
  `location.hash === ${JSON.stringify(selectedActorHash)} && document.querySelector('#selection h2')?.textContent === 'worker'`));
await until('row selection lights its own arcs',
  `!!document.querySelector('#roster .kw-arc-hot[data-from="worker"]')`);
await until('the map draws on the page without a disclosure',
  `document.querySelector('#knowledge-whole svg.kw-canvas') && document.querySelectorAll('#knowledge-whole .kw-tier').length > 1`);
await until('selecting a worker loads that scope holdings',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 2 items')`);
check('promotion arcs join the rendered rows in the margin', await evalJs(
  `!!document.querySelector('#roster > svg.kw-arcs') && !!document.querySelector('#roster .kw-arc[data-from="worker"][data-to="aide"]')`));
check('sharing seats carry a holding halo in the row gutter', await evalJs(
  `!!document.querySelector('#roster .kw-row-halo[data-row="worker"]')`));
check('row knowledge reads as one compact line', await evalJs(`(() => {
  const line = document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-compact');
  return !!line && (line.textContent || '').includes('Worker retained finding');
})()`));
// The payload contract, read once from the live overview endpoint. The nodes and
// edges the contract adds are checked here; the drawing checks stay in the page.
const overviewPayload = await evalJs(`(async () => {
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  const base = String((meta && meta.content) || location.origin).replace(/\\/+$/, '');
  const response = await fetch(base + '/orchestra/knowledge/overview');
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
    /^(message:|finding:|file:|https?:\\/\\/|external:)/.test(String(row.evidence || ''))]));
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
check('a roster row and its knowledge band each hold one row', await evalJs(`(() => {
  const rows = [...document.querySelectorAll('#roster .doc-row')].filter((row) => row.offsetHeight > 0);
  if (rows.length < 2) return false;
  const ROW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row'));
  if (!ROW) return false;
  return rows.every((row) => {
    const band = row.querySelector('.doc-row-knowledge');
    const own = row.getBoundingClientRect().height - (band ? band.getBoundingClientRect().height : 0);
    if (Math.abs(own - ROW) > 2) return false;
    return !band || Math.abs(band.getBoundingClientRect().height - ROW) <= 2;
  });
})()`));
// Capture the compact row knowledge for review.
const knowledgeShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'knowledge.png'), Buffer.from(knowledgeShot.result.data, 'base64'));
if (CAPTURE_ONLY) {
  await evalJs(`document.querySelector('#knowledge-whole [aria-label="Fit the map to the frame"]').click()`);
  const mapShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'knowledge-map.png'), Buffer.from(mapShot.result.data, 'base64'));
  console.log('BROWSER_CAPTURE_OK — partial visual inspection: initial and worker knowledge views');
  return;
}
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('all-records toggle discovers every held record',
  `document.querySelector('#map-scope').textContent === 'All held records · 3 items'`);
check('all-records toggle states its pressed state', await evalJs(
  `document.getElementById('map-scope-all').getAttribute('aria-pressed') === 'true' && document.getElementById('map-scope-all').textContent === 'Back to universal knowledge'`));
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('leaving all-records returns to universal knowledge',
  `document.querySelector('#map-scope').textContent === 'Universal knowledge · 0 items'`);
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('worker scope restores its holdings',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 2 items') && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))`);
await until('Escape clears the worker selection and returns to universal holdings',
  `document.getElementById('map-scope').textContent === 'Universal knowledge · 0 items'
    && !document.querySelector('#roster .doc-open[aria-current="true"]')
    && !document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')
    && location.hash === ''`);
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('worker holdings reopen after clearing the selection',
  `document.getElementById('map-scope').textContent === 'worker · 2 items'
    && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`);
await evalJs(`document.querySelector('#roster [data-doc-group="qa-ensemble"]').click()`);
await until('ensemble band opens the owner holdings on the map',
  `document.querySelector('#map-scope').textContent === 'Group qa-ensemble · 1 item' && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`);
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('worker scope restores after the ensemble probe',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 2 items') && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-msg-finding"]')`);
check('tiers read as ruled bands', await evalJs(
  `document.querySelectorAll('#knowledge-whole .kw-tier-rule').length >= 2`));
check('authored findings form a group below their recorded author', await evalJs(`(() => {
  const author = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"] rect');
  const findings = ['qa-worker-finding', 'qa-msg-finding'].map((id) =>
    document.querySelector('#knowledge-whole .knode[aria-label="' + id + '"] .kw-finding'));
  if (!author || findings.some((node) => !node)) return false;
  const anchor = author.getBoundingClientRect();
  const bounds = findings.map((node) => node.getBoundingClientRect());
  const centers = bounds.map((box) => (box.left + box.right) / 2);
  const authorCenter = (anchor.left + anchor.right) / 2;
  const groupCenter = (centers[0] + centers[1]) / 2;
  return Math.min(...centers) < authorCenter && Math.max(...centers) > authorCenter
    && groupCenter >= anchor.left && groupCenter <= anchor.right
    && bounds.every((box) => box.top >= anchor.bottom);
})()`));
check('the map frame scrolls nothing: the page carries the drawing at its own height', await evalJs(`(() => {
  const frame = document.querySelector('.map-frame');
  if (!frame || !frame.querySelector('#knowledge-whole svg')) return false;
  return frame.scrollHeight <= frame.clientHeight + 1
    && frame.scrollWidth <= frame.clientWidth + 1;
})()`));
check('zoom controls state their action and level', await evalJs(
  `!!document.querySelector('#knowledge-whole [aria-label="Zoom the map in"]') && !!document.querySelector('#knowledge-whole [aria-label="Zoom the map out"]') && !!document.querySelector('#knowledge-whole .kw-zoom-level')`));
const mapNodeWidthBeforeZoom = await evalJs(`document.querySelector('#knowledge-whole .kw-anchor').getBoundingClientRect().width`);
await evalJs(`document.querySelector('#knowledge-whole [aria-label="Zoom the map in"]').click()`);
check('zoom control scales the map view', await evalJs(
  `document.querySelector('#knowledge-whole .kw-anchor').getBoundingClientRect().width > ${JSON.stringify(mapNodeWidthBeforeZoom)} && parseFloat(document.querySelector('#knowledge-whole .kw-zoom-level').textContent) > 100`));
await evalJs(`document.querySelector('#knowledge-whole [aria-label="Fit the map to the frame"]').click()`);
check('fit returns the whole drawing to view', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  const frame = document.querySelector('#knowledge-whole').parentElement;
  const bounds = frame.getBoundingClientRect();
  const nodes = [...svg.querySelectorAll('.kw-anchor, .knode, .kw-lozenge, .kw-ref')];
  return nodes.length > 0 && nodes.every((node) => {
    const r = node.getBoundingClientRect();
    return r.left >= bounds.left - 2 && r.right <= bounds.right + 2
      && r.top >= bounds.top - 2 && r.bottom <= bounds.bottom + 2;
  });
})()`));
await evalJs(`document.querySelector('.map-frame').scrollIntoView({ block: 'center' })`);
const mapShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'knowledge-map.png'), Buffer.from(mapShot.result.data, 'base64'));
check('drag pans the map view', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  const node = svg.querySelector('.kw-anchor');
  const before = node.getBoundingClientRect();
  const r = svg.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }));
  document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: x + 60, clientY: y + 20 }));
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  const after = node.getBoundingClientRect();
  return Math.abs(after.left - before.left - 60) < 2
    && Math.abs(after.top - before.top - 20) < 2;
})()`));
const wheelZoom = await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  const node = svg.querySelector('.kw-anchor');
  const before = node.getBoundingClientRect().width;
  const beforeLevel = parseFloat(document.querySelector('#knowledge-whole .kw-zoom-level').textContent);
  const r = svg.getBoundingClientRect();
  svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  const after = node.getBoundingClientRect().width;
  const afterLevel = parseFloat(document.querySelector('#knowledge-whole .kw-zoom-level').textContent);
  return { before, after, beforeLevel, afterLevel };
})()`);
check('wheel zooms the map view', wheelZoom.after > wheelZoom.before && wheelZoom.afterLevel > wheelZoom.beforeLevel,
  JSON.stringify(wheelZoom));
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('finding search reads all held records',
  `document.querySelector('#map-scope').textContent === 'All held records · 3 items' && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"]')`);
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'qa-aide-finding'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('map search centres and pins its hit',
  `document.querySelector('#knowledge-whole g.kw-view').getAttribute('transform') !== 'translate(0,0) scale(1)' && !!document.querySelector('#knowledge-whole .kw-card')`);
check('search states its match count', await evalJs(
  `document.querySelector('#knowledge-whole .kw-search-status').textContent === '1 match'`));
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'zzz-no-such-thing'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
check('search with no match says so', await evalJs(
  `(document.querySelector('#knowledge-whole .kw-search-status').textContent || '').startsWith('No match')`));
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'root'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
check('search outside the drawn tiers says so', await evalJs(
  `document.querySelector('#knowledge-whole .kw-search-status').textContent === "'root' is outside the drawn tiers"`));
await evalJs(`document.querySelector('#knowledge-whole svg.kw-canvas').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
check('dismissing the map card keeps its selected actor and scope', await evalJs(
  `document.querySelector('#map-scope').textContent === 'All held records · 3 items' && document.querySelector('#selection h2')?.textContent === 'worker' && !document.querySelector('#knowledge-whole .kw-card')`));
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'qa-aide-finding'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('search re-pins its dismissed hit',
  `!!document.querySelector('#knowledge-whole .kw-card')`);
check('recorded edge types render directed', await evalJs(
  `['kw-edge-authorship', 'kw-edge-share', 'kw-edge-deliver'].every((cls) => [...document.querySelectorAll('#knowledge-whole .' + cls)].some((edge) => (edge.getAttribute('marker-end') || '').startsWith('url(')))`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('ensemble hull groups its drawn seats',
  `!!document.querySelector('#knowledge-whole .kw-hull[data-kw-hull="qa-ensemble"]')`);
await evalJs(`document.querySelector('#knowledge-whole .kw-hull[data-kw-hull="qa-ensemble"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('collapsing the hull hides its seats',
  `!document.querySelector('#knowledge-whole [data-kw-id="worker"]') && !!document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]')`);
await evalJs(`document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('expanding restores the seats',
  `!!document.querySelector('#knowledge-whole [data-kw-id="worker"]') && !document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]')`);
await evalJs(`document.querySelector('#knowledge-whole .kw-hull[data-kw-hull="qa-ensemble"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('the hull collapses again for the search probe',
  `!!document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]')`);
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'qa-worker-finding'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('search expands a collapsed ensemble to reach its hit',
  `!document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]') && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]') && !!document.querySelector('#knowledge-whole .kw-card')`);
await evalJs(`document.querySelector('#knowledge-whole .kw-hull[data-kw-hull="qa-ensemble"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('the hull collapses for the actor probe',
  `!!document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]')`);
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'lead'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('search reaches an actor inside a collapsed ensemble',
  `!document.querySelector('#knowledge-whole .kw-lozenge[data-kw-hull="qa-ensemble"]') && !!document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="lead"]')`);
await until('selecting the actor pins its card on the map',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'lead'`);
check('actor card states the shell status word', await evalJs(
  `!!document.querySelector('#knowledge-whole .kw-card .kw-card-status')`));
await evalJs(`document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('selecting an actor pins its card and loads its holdings', `(() => {
  const card = document.querySelector('#knowledge-whole .kw-card .kw-card-title');
  const self = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"]');
  const stranger = document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"]');
  return !!card && card.textContent === 'worker' && !!self && !self.classList.contains('kw-hover-dim')
    && !stranger && document.getElementById('map-scope').textContent === 'worker · 2 items';
})()`);
await evalJs(`document.getElementById('map-scope-all').click()`);
await until('all scope restores unrelated findings for the graph probes',
  `document.getElementById('map-scope').textContent === 'All held records · 3 items'
    && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"]')`);
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
check('shared findings carry a halo and unshared ones do not', await evalJs(
  `!!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"] .kw-halo') && !document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"] .kw-halo')`));
check('every recorded relation family is drawn once per record', await evalJs(`(() => {
  const findings = document.querySelectorAll('#knowledge-whole .knode').length;
  const authorship = document.querySelectorAll('#knowledge-whole .kw-edge-authorship').length;
  const shares = document.querySelectorAll('#knowledge-whole .kw-edge-share').length;
  return authorship >= findings - 1 && shares >= 1;
})()`));
check('typed relations draw one edge per record', await evalJs(
  `document.querySelectorAll('#knowledge-whole .kw-edge-relate').length === 5`));
check('the key folds shut at rest and its toggle states so', await evalJs(`(() => {
  const keys = document.querySelector('#knowledge-whole .kw-legend-keys');
  const toggle = document.querySelector('#knowledge-whole [data-kw-key-toggle="key"]');
  return !!keys && !!toggle && keys.hasAttribute('hidden')
    && toggle.getAttribute('aria-expanded') === 'false';
})()`));
check('the key button names the vocabularies it hides', await evalJs(`(() => {
  const toggle = document.querySelector('#knowledge-whole [data-kw-key-toggle="key"]');
  const text = toggle ? (toggle.textContent || '').trim() : '';
  return /^Key \u00b7 (edges|families|groups|marks)(, (edges|families|groups|marks))*$/.test(text);
})()`));
check('the key note states the affordance while the key is shut', await evalJs(`(() => {
  const note = document.querySelector('#knowledge-whole .kw-legend-note');
  const keys = document.querySelector('#knowledge-whole .kw-legend-keys');
  return !!note && !note.hasAttribute('hidden') && /hover|focus/.test(note.textContent || '')
    && !!keys && keys.hasAttribute('hidden');
})()`));
const keyRowsShut = await evalJs(`document.querySelectorAll('#knowledge-whole .kw-legend-keys li').length`);
await evalJs(`document.querySelector('#knowledge-whole [data-kw-key-toggle="key"]').click()`);
await until('clicking the key toggle opens the legend', `(() => {
  const keys = document.querySelector('#knowledge-whole .kw-legend-keys');
  const toggle = document.querySelector('#knowledge-whole [data-kw-key-toggle="key"]');
  return !!keys && !keys.hasAttribute('hidden')
    && !!toggle && toggle.getAttribute('aria-expanded') === 'true';
})()`);
const keyRowsOpen = await evalJs(`document.querySelectorAll('#knowledge-whole .kw-legend-keys li').length`);
check('the key rows stay in the document whether the fold is shut or open',
  keyRowsShut > 0 && keyRowsOpen === keyRowsShut, JSON.stringify({shut:keyRowsShut, open:keyRowsOpen}));
check('the open legend names the four relation families', await evalJs(`(() => {
  const keys = document.querySelector('#knowledge-whole .kw-legend-keys');
  const text = keys ? keys.textContent : '';
  return ['authorship. ', 'sharing. ', 'delivery. ', 'promotion. '].every((word) => text.includes(word));
})()`));
check('the macro band opens the knowledge region', await evalJs(`(() => {
  const mount = document.getElementById('knowledge-whole');
  const macro = mount && mount.firstElementChild;
  if (!macro || !macro.classList.contains('kw-macro')) return false;
  const rows = [...macro.querySelectorAll('.kw-tier-row')];
  if (rows.length < 2) return false;
  return rows.every((row) => !!row.querySelector('.kw-tier-bar') && !!row.querySelector('.kw-tier-num'));
})()`));
check('a tier row states its findings and its actors', await evalJs(`(() => {
  const rows = [...document.querySelectorAll('#knowledge-whole .kw-tier-row')];
  if (!rows.length) return false;
  return rows.every((row) => {
    const num = row.querySelector('.kw-tier-num');
    const text = num ? (num.textContent || '').trim() : '';
    return /^\d+ \u00b7 \d+$/.test(text);
  });
})()`));
await evalJs(`(() => { const row = document.querySelector('#knowledge-whole .kw-tier-row'); if (row) row.click(); return true; })()`);
await until('a tier row moves the canvas', `(() => {
  const view = document.querySelector('#knowledge-whole g.kw-view');
  return !!view && view.getAttribute('transform') !== 'translate(0,0) scale(1)';
})()`);
check('the worker to aide cell of the flow grid reads one before the live promotions', await evalJs(`(() => {
  const grid = document.querySelector('#knowledge-whole .kw-flow-grid');
  const cap = document.querySelector('#knowledge-whole .kw-flow-cap');
  if (!grid || !cap) return false;
  const words = cap.textContent || '';
  const heads = [...grid.querySelectorAll('th')].map((th) => (th.textContent || '').trim());
  const col = heads.indexOf('aide');
  const row = heads.indexOf('worker');
  if (col < 0 || row < 0) return false;
  const cells = [...grid.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => (c.textContent || '').trim()));
  const line = cells.find((line) => line.includes('worker')) || [];
  const header = cells[0] || [];
  const colAt = header.findIndex((h) => h === 'aide');
  const cell = colAt >= 0 ? (line[colAt] || '') : '';
  return /promotion/i.test(words) && /source/i.test(words) && /destination/i.test(words)
    && heads.includes('worker') && heads.includes('aide') && cell === '1';
})()`));
check('the tier census states the counts the canvas draws', await evalJs(`(() => {
  const rows = [...document.querySelectorAll('#knowledge-whole .kw-tier-row')];
  const nodes = document.querySelectorAll('#knowledge-whole .knode').length;
  if (!rows.length) return false;
  const nums = rows.map((row) => {
    const num = row.querySelector('.kw-tier-num');
    const parts = ((num && num.textContent) || '').split('\u00b7').map((s) => s.trim());
    return { findings: Number(parts[0]), actors: Number(parts[1]) };
  });
  if (nums.some((n) => !Number.isFinite(n.findings) || !Number.isFinite(n.actors))) return false;
  const total = nums.reduce((sum, n) => sum + n.findings, 0);
  const widths = rows.map((row) => {
    const bar = row.querySelector('.kw-tier-bar');
    return parseFloat(((bar && bar.getAttribute('style')) || 'width:0%').replace(/[^0-9.]/g, ''));
  });
  const maxNum = Math.max(...nums.map((n) => n.findings));
  const maxWidth = Math.max(...widths);
  const proportional = nums.every((n, i) => Math.abs(widths[i] - (n.findings / maxNum) * 100) <= 2);
  return total === nodes && proportional && maxWidth > 0;
})()`));
check('the flow field sums to the caption and groups its tail', await evalJs(`(() => {
  const grid = document.querySelector('#knowledge-whole .kw-flow-grid');
  const cap = document.querySelector('#knowledge-whole .kw-flow-cap');
  if (!grid || !cap) return false;
  const words = cap.textContent || '';
  const total = Number((/(\d+) promotion/.exec(words) || [0, 0])[1]);
  const sources = Number((/(\d+) source/.exec(words) || [0, 0])[1]);
  const destinations = Number((/(\d+) destination/.exec(words) || [0, 0])[1]);
  const lines = [...grid.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => (c.textContent || '').trim()));
  const body = lines.slice(1).filter((line) => line.length > 1);
  const cells = body.flatMap((line) => line.slice(1).map((c) => c === '' ? 0 : Number(c)));
  const sum = cells.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  const tailRows = body.filter((line) => (line[0] || '').includes('other holders')).length;
  const heads = [...grid.querySelectorAll('th')].map((th) => (th.textContent || '').trim());
  const tailCols = heads.filter((h) => h.includes('other holders')).length;
  const grouped = /tail grouped/.test(words) === (tailRows > 0 || tailCols > 0);
  return sum === total && body.length === sources + tailRows && (heads.length - 1) === destinations + tailCols && grouped;
})()`));
check('the exemplar draws a transfer the canvas also draws', await evalJs(`(() => {
  const ex = document.querySelector('#knowledge-whole .kw-exemplar');
  if (!ex) return false;
  const label = ex.getAttribute('aria-label') || '';
  const ids = [...document.querySelectorAll('#knowledge-whole [data-kw-id]')].map((a) => a.getAttribute('data-kw-id'));
  return /transfer/i.test(label) && /shares finding/i.test(label)
    && ids.some((id) => id && label.includes(id));
})()`));
check('the exemplar names its transfer and its share', await evalJs(`(() => {
  const ex = document.querySelector('#knowledge-whole .kw-exemplar');
  if (!ex) return false;
  const label = (ex.getAttribute('aria-label') || '').toLowerCase();
  return /transfer/.test(label) && /share/.test(label)
    && /deliver/.test((ex.textContent || '').toLowerCase());
})()`));
check('relations between two references retain both endpoints', await evalJs(
  `!!document.querySelector('#knowledge-whole .kw-edge-relate[data-from="message:qa-missing-1"][data-to="external:qa-log-8"]')`));
await evalJs(`(() => { const edge = document.querySelector('#knowledge-whole g.kw-edge-relate');
  edge.focus(); edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
await until('activating a relate edge lights its two ends and names the relation',
  `(() => {
    const edge = document.querySelector('#knowledge-whole g.kw-edge-relate');
    const name = edge.getAttribute('data-rel-name') || '';
    const from = edge.getAttribute('data-from') || '';
    const to = edge.getAttribute('data-to') || '';
    const card = document.querySelector('#knowledge-whole .kw-card');
    const title = card && card.querySelector('.kw-card-title');
    const fact = card && card.querySelector('.kw-card-fact');
    const lit = [...document.querySelectorAll('#knowledge-whole g.kw-edge-relate')]
      .filter((e) => !e.classList.contains('kw-hover-dim'))
      .every((e) => e.getAttribute('data-rel-name') === name);
    const ends = ['data-kw-id', 'data-kw-ref'].flatMap((attr) =>
      [from, to].map((id) => document.querySelector('#knowledge-whole [' + attr + '="' + id + '"]')))
      .filter(Boolean);
    return lit && !!title && title.textContent === name
      && !!fact && fact.textContent.includes(from) && fact.textContent.includes(to)
      && fact.textContent !== name
      && ends.length > 0 && ends.every((g) => !g.classList.contains('kw-hover-dim'));
  })()`);
check('the relation card reads both ends as their kind and id', await evalJs(`(() => {
  const edge = document.querySelector('#knowledge-whole g.kw-edge-relate');
  const fact = document.querySelector('#knowledge-whole .kw-card .kw-card-fact');
  if (!fact) return false;
  return ['from', 'to'].every((side) => {
    const kind = edge.getAttribute('data-' + side + '-kind') || '';
    const id = edge.getAttribute('data-' + side) || '';
    if (!kind || !id) return false;
    return kind === 'ref' ? fact.textContent.includes(id) : fact.textContent.includes(kind + ' ' + id);
  });
})()`));
check('message endpoints draw as held tags', await evalJs(`(() => {
  const g = document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-task-1"]');
  return !!g && !g.classList.contains('unheld') && (g.getAttribute('aria-label') || '').includes('held');
})()`));
check('missing endpoints draw as unheld tags', await evalJs(`(() => {
  const g = document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-missing-1"]');
  return !!g && g.classList.contains('unheld') && (g.textContent || '').includes('not held');
})()`));
check('external endpoints draw as plain tags', await evalJs(`(() => {
  const g = document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="external:qa-log-7"]');
  return !!g && !g.classList.contains('unheld');
})()`));
check('absent finding endpoints draw as unheld tags', await evalJs(
  `!!document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="finding:qa-nope"].unheld')`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-msg-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('message evidence reads as a reference on the card',
  `(document.querySelector('#knowledge-whole .kw-card') || {}).textContent?.includes('evidence message: message:qa-task-1')`);
await evalJs(`document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-task-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('reference tag pins its card',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'message:qa-task-1'`);
check('reference card states its holding', await evalJs(
  `document.querySelector('#knowledge-whole .kw-card .kw-card-state')?.textContent === 'held'`));
check('reference card offers its finding', await evalJs(
  `document.querySelector('#knowledge-whole .kw-card .kw-card-full')?.textContent === 'Show the finding'`));
await evalJs(`document.querySelector('#knowledge-whole .kw-card .kw-card-full').click()`);
await until('following the reference selects its finding',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'Worker message finding.'`);
await evalJs(`document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-missing-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('unheld reference pins its card',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'message:qa-missing-1'`);
check('unheld reference offers no finding', await evalJs(
  `document.querySelector('#knowledge-whole .kw-card .kw-card-state')?.textContent === 'not held' && !document.querySelector('#knowledge-whole .kw-card button')`));
{
  const db = new DatabaseSync(DB);
  db.prepare("UPDATE knowledge SET evidence='message:qa-missing-1' WHERE id='qa-msg-finding'").run();
  db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('an absent cited message remains unheld',
  `!!document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-missing-1"].unheld')
    && !!document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-task-1"].unheld')`);
{
  const db = new DatabaseSync(DB);
  db.prepare("UPDATE knowledge SET evidence='message:qa-task-1' WHERE id='qa-msg-finding'").run();
  db.close();
}
await evalJs(`document.getElementById('reconnect').click()`);
await until('restoring the retained citation restores the held tag',
  `!!document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="message:qa-task-1"]:not(.unheld)')`);
check('conductor anchors read distinct from player anchors', await evalJs(
  `!!document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="lead"] rect.role-conductor') && !document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"] rect.role-conductor')`));
check('most promoted findings carry visible claims', await evalJs(
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"] .kw-word')?.textContent.includes('Worker retained finding') && !document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"] .kw-word')`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
check('whole finding selection marks and keeps focus', await evalJs(
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').classList.contains('selected') && document.activeElement === document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`));
await until('selecting a finding pins its card on the map',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'Worker retained finding.'`);
check('card states the finding without printing its recorded bodies', await evalJs(`(() => {
  const card = document.querySelector('#knowledge-whole .kw-card');
  return !!card.querySelector('.kw-card-title') && !!card.querySelector('.kw-card-state')
    && !card.textContent.includes('Worker evidence.') && !card.textContent.includes('Worker limits.');
})()`));
check('selected relations retain incoming and outgoing endpoints', await evalJs(
  `document.getElementById('selection').textContent.includes('finding:qa-nope — continues → finding:qa-worker-finding')
    && document.getElementById('selection').textContent.includes('finding:qa-worker-finding — recorded in → external:qa-log-7')`));
check('the finding card offers one record action', await evalJs(
  `document.querySelectorAll('#knowledge-whole .kw-card button').length === 1`));
await evalJs(`(() => { const card = document.querySelector('#knowledge-whole .kw-card');
  const action = card && card.querySelector('button');
  if (action) action.click(); return true; })()`);
await until('the card action opens the record at its finding', `(() => {
  const block = document.querySelector('#selection #sel-sec-finding');
  if (!block) return false;
  const box = block.getBoundingClientRect();
  return box.top <= 96 && box.bottom >= 0;
})()`);
check('the finding posture states what its facts hold', await evalJs(`(() => {
  const block = document.querySelector('#selection #sel-sec-finding');
  if (!block) return false;
  const lines = [...block.querySelectorAll('p')].map((p) => p.textContent || '');
  return lines.some((line) => /(evidence cited|no evidence cited)/.test(line)
    && /(limits stated|no limits stated)/.test(line)
    && /(shared \d+ times?|not shared)/.test(line));
})()`));
check('the evidence citation carries its number, tail and full title', await evalJs(`(() => {
  const block = document.querySelector('#selection #sel-sec-finding');
  if (!block) return false;
  const cite = [...block.querySelectorAll('p')].find((p) => /^\[\d+\] message /.test(p.textContent || ''));
  if (!cite) return false;
  const tail = (cite.textContent || '').replace(/^\[\d+\] message /, '').split(' ')[0];
  const id = cite.getAttribute('title') || '';
  return tail.startsWith('\u2026') && id.endsWith(tail.replace(/^\u2026/, '')) && id.length > tail.length;
})()`));
check('a message reference draws its full id and holds no body until read', await evalJs(`(async () => {
  const block = document.querySelector('#selection #sel-sec-finding');
  if (!block) return false;
  const cite = [...block.querySelectorAll('p')].find((p) => /^\\[\\d+\\] message /.test(p.textContent || ''));
  if (!cite) return false;
  const full = cite.getAttribute('title') || '';
  if (full.slice(0, 8) !== 'message:') return false;
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  const base = String((meta && meta.content) || location.origin).replace(/\\/+$/, '');
  const response = await fetch(base + '/orchestra/message?id=' + encodeURIComponent(full.slice(8)));
  const payload = await response.json();
  const body = payload && payload.message && payload.message.body;
  return typeof body === 'string' && body.length > 0 && !(block.textContent || '').includes(body);
})()`));
check('the prose holds its measure and leading as element style', await evalJs(`(() => {
  const prose = document.querySelector('#selection .sel-lead');
  if (!prose) return false;
  return prose.style.maxWidth === '33em' && prose.style.lineHeight === '1.5';
})()`));
await evalJs(`document.querySelector('#knowledge-whole svg.kw-canvas').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
check('escape dismisses the pinned card', await evalJs(
  `!document.querySelector('#knowledge-whole .kw-card') && document.querySelectorAll('#knowledge-whole .kw-hover-dim').length === 0`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('card re-pins on selection',
  `!!document.querySelector('#knowledge-whole .kw-card')`);
await evalJs(`document.querySelector('#knowledge-whole svg.kw-canvas').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
await evalJs(`{ const n = document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]'); n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('keyboard re-pins the dismissed finding',
  `!!document.querySelector('#knowledge-whole .kw-card')`);
await evalJs(`document.querySelector('#knowledge-whole svg.kw-canvas').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
check('background click returns to the overview', await evalJs(
  `!document.querySelector('#knowledge-whole .kw-card')`));
await evalJs(`(() => { const b = document.querySelector('#selection .sel-focus'); b.click(); return true; })()`);
await until('a record relation statement lights its map edges', `(() => {
  const b = document.querySelector('#selection .sel-lit .sel-focus');
  if (!b || b.getAttribute('aria-current') !== 'true') return false;
  const name = (b.dataset.selkey || '').split('|')[1] || '';
  const edges = [...document.querySelectorAll('#knowledge-whole g.kw-edge-relate')];
  return edges.some((e) => e.getAttribute('data-rel-name') === name && !e.classList.contains('kw-hover-dim'))
    && edges.filter((e) => !e.classList.contains('kw-hover-dim'))
      .every((e) => e.getAttribute('data-rel-name') === name);
})()`);
await evalJs(`(() => { const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  svg.focus(); svg.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
await until('Escape clears the relation card and its light', `(() => {
  const rel = [...document.querySelectorAll('#knowledge-whole .kw-card')]
    .some((c) => (c.querySelector('.kw-card-state') || {}).textContent === 'relation');
  const unlit = [...document.querySelectorAll('#knowledge-whole g.kw-edge-relate')]
    .every((e) => !e.classList.contains('kw-hover-dim'));
  return !rel && unlit;
})()`);
await evalJs(`(() => { const b = document.querySelector('#selection .sel-focus'); b.click(); return true; })()`);
await evalJs(`(() => { const b = document.querySelector('#selection .sel-focus'); b.click(); return true; })()`);
await until('activating the same relation again pins its card after a dismissal', `(() => {
  const card = document.querySelector('#knowledge-whole .kw-card');
  const title = card && card.querySelector('.kw-card-title');
  const state = card && card.querySelector('.kw-card-state');
  const lit = document.querySelector('#selection .sel-lit .sel-focus');
  const name = lit ? ((lit.dataset.selkey || '').split('|')[1] || '') : '';
  return !!title && !!state && state.textContent === 'relation'
    && !!name && title.textContent === name;
})()`);
const shareEdgesBefore = await evalJs(`document.querySelectorAll('#knowledge-whole .kw-edge-share').length`);
baton('promote', 'qa-relation-live-frame', 'root', 'root', 'worker', 'qa-worker-finding');
committed();
await until('a live frame renders while the relation is still named',
  `document.querySelectorAll('#knowledge-whole .kw-edge-share').length > ${JSON.stringify(shareEdgesBefore)}`);
check('a live frame keeps the card of a still-named relation', await evalJs(`(() => {
  const card = document.querySelector('#knowledge-whole .kw-card');
  const title = card && card.querySelector('.kw-card-title');
  const state = card && card.querySelector('.kw-card-state');
  const lit = document.querySelector('#selection .sel-lit .sel-focus');
  const name = lit ? ((lit.dataset.selkey || '').split('|')[1] || '') : '';
  return !!title && !!state && state.textContent === 'relation'
    && !!name && title.textContent === name;
})()`));
await evalJs(`(() => { const row = document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open');
  row.focus(); row.click(); return true; })()`);
await until('a new selection clears the named relation and unlights the map', `(() => {
  const edges = [...document.querySelectorAll('#knowledge-whole g.kw-edge-relate')];
  return edges.length > 0
    && edges.every((e) => !e.classList.contains('kw-hover-dim'))
    && !document.querySelector('#selection [aria-current="true"].sel-focus');
})()`);
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
check('hover isolates the finding neighborhood', await evalJs(`(() => {
  const hovered = document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]');
  const author = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"]');
  const stranger = document.querySelector('#knowledge-whole .knode[aria-label="qa-aide-finding"]');
  return hovered && !hovered.classList.contains('kw-hover-dim')
    && author && !author.classList.contains('kw-hover-dim')
    && stranger && stranger.classList.contains('kw-hover-dim');
})()`));
await evalJs(`(() => { const anchor = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"]');
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()`);
await until('a tag whose edge touches no node stays lit under the anchor hover',
  `(() => { const tag = document.querySelector('#knowledge-whole g.kw-ref[data-kw-ref="external:qa-log-8"]');
    return !!tag && !tag.classList.contains('kw-hover-dim'); })()`);
await evalJs(`(() => { const anchor = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"]');
  anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); return true; })()`);
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))`);
check('leaving the node restores the canvas', await evalJs(
  `document.querySelectorAll('#knowledge-whole .kw-hover-dim').length === 0`));
// Capture the selected finding for review.
const selectedWorkShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'selected-work.png'), Buffer.from(selectedWorkShot.result.data, 'base64'));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open').click()`);
await until('second actor record replaces the first',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'aide'`);
await until('roster actor selection shows the actor card on the map',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'aide'`);
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('live probes read the worker scope',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 2 items') && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]')`);
baton('record', 'qa-worker-live-finding', 'worker', 'Worker live finding.',
  'Live evidence.', 'Live limits.');
await until('live record updates the author compact line through native SSE',
  `(document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-compact') || {}).textContent?.includes('3 findings')`);
await until('live record draws the new whole-canvas node through native SSE',
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-live-finding"]')`);
check('a live frame does not restore a dismissed relation card', await evalJs(`(() => {
  const rel = [...document.querySelectorAll('#knowledge-whole .kw-card')]
    .some((c) => (c.querySelector('.kw-card-state') || {}).textContent === 'relation');
  const unlit = [...document.querySelectorAll('#knowledge-whole g.kw-edge-relate')]
    .every((e) => !e.classList.contains('kw-hover-dim'));
  return !rel && unlit;
})()`));
baton('promote', 'qa-worker-live-share', 'aide', 'worker', 'aide', 'qa-worker-live-finding');
await until('live promotion updates the shared count through native SSE',
  `(document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-compact') || {}).textContent?.includes('2 shared')`);
await until('live promotion draws the second recorded share edge through native SSE',
  `[...document.querySelectorAll('#knowledge-whole .kw-edge-share[aria-label="promotion from worker to aide"]')].length === 2`);
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
check('one-hop hover dims the second finding by the same author', await evalJs(
  `document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-live-finding"]').classList.contains('kw-hover-dim')`));
await evalJs(`document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('finding selection widens isolation to two hops',
  `(() => { const co = document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-live-finding"]');
    return !!co && !co.classList.contains('kw-hover-dim'); })()`);
await evalJs(`window.__qaMark = 41`);
const ribbonMaxBeforeNativeCommit = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-native', 'root', 'worker', 'guidance', 'Committed through the native owner.');
await until('native owner SSE moves the ribbon without reload',
  `window.__qaMark === 41 && document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonMaxBeforeNativeCommit)}`);
await evalJs(`document.querySelector('#ribbon [data-focus="ribbon-list"]').click()`);
await until('ribbon full list opens with recorded rows',
  `document.querySelector('#ribbon .ribbon-list') && document.querySelectorAll('#ribbon .ribbon-row').length > 0 && (document.querySelector('#ribbon .ribbon-list').textContent || '').includes('worker')`);

// Activity is the page spine: the axis draws its buckets, the needle moves by
// keyboard and by pointer, and a chip in the spine opens its seat.
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
const chipSeat = await evalJs(`(() => { const chip = document.querySelector('#ribbon .ribbon-chip'); return chip ? chip.dataset.seat || '' : ''; })()`);
await evalJs(`(() => { const chip = document.querySelector('#ribbon .ribbon-chip'); if (chip) chip.click(); return true; })()`);
await until('a chip in the spine opens its seat record',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === ${JSON.stringify(chipSeat)}`);
check('the spine marks the seat it holds', await evalJs(
  `!!document.querySelector('#ribbon .ribbon-chip[aria-current="true"]')`));

// Visual evidence for the two redesigned surfaces, clipped to their own boxes.
const surfaceCaptures = [];
for (const [name, selector] of [['pit.png', '.pit'], ['map.png', '.map'], ['agents.png', '#staves']]) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  if (box && box.width > 1 && box.height > 1) {
    const shot = await send(pageWs, 'Page.captureScreenshot', {
      format: 'png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    });
    writeFileSync(join(OUT, name), Buffer.from(shot.result.data, 'base64'));
    surfaceCaptures.push(name);
  }
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
await evalJs(`{ const box = document.querySelector('#knowledge-whole .kw-search'); box.value = 'qa-worker-finding'; box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }`);
await until('narrow search selects its finding',
  `document.querySelector('#knowledge-whole .kw-card .kw-card-title')?.textContent === 'Worker retained finding.'`);
check('narrow search puts the finding in the viewport', await evalJs(`(() => {
  const hit = document.querySelector('#knowledge-whole .knode[aria-label="qa-worker-finding"] .kw-finding');
  if (!hit) return false;
  const box = hit.getBoundingClientRect();
  return box.left >= 0 && box.right <= window.innerWidth
    && box.top >= 0 && box.bottom <= window.innerHeight;
})()`));
check('narrow dragging moves the finding with the pointer', await evalJs(`(() => {
  const svg = document.querySelector('#knowledge-whole svg.kw-canvas');
  const hit = svg.querySelector('.knode[aria-label="qa-worker-finding"] .kw-finding');
  const before = hit.getBoundingClientRect();
  const x = (before.left + before.right) / 2, y = (before.top + before.bottom) / 2;
  svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, clientX:x, clientY:y}));
  document.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, clientX:x + 35, clientY:y + 15}));
  document.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
  const after = hit.getBoundingClientRect();
  return Math.abs(after.left - before.left - 35) < 2 && Math.abs(after.top - before.top - 15) < 2;
})()`));
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
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="aide"] .doc-open').click()`);
await until('phase B knowledge scope settles on the aide holdings',
  `(document.querySelector('#map-scope').textContent || '').endsWith('· 3 items')`);
check('phase B rows carry compact knowledge lines', await evalJs(
  `!!document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-compact') && !!document.querySelector('#roster .doc-row[data-doc-id="aide"] .kw-compact')`));

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
check('a cut recorded text states plainly that it continues', await evalJs(`(() => {
  const lead = document.querySelector('#selection .sel-lead');
  if (!lead) return false;
  const line = (lead.textContent || '').trim();
  if (!line) return false;
  const first = (${JSON.stringify(pendingBody)}.split('\n').map((s) => s.trim()).find((s) => s) || '');
  const whole = Boolean(first) && line.includes(first) && !/\u2026/.test(line);
  const cut = /\u2026\s*continues/.test(line);
  return whole || cut;
})()`));
await evalJs(`(() => {
  const button = document.querySelector('#selection [data-selkey="sel:msg:qa-aide-receipt"]');
  button.focus(); button.click();
})()`);
await until('pending message displays its complete stored body',
  `[...document.querySelectorAll('#selection .sel-body')].some((node) => node.textContent === ${JSON.stringify(pendingBody)})`);
check('queued list names the owed total', await evalJs(
  `[...document.querySelectorAll('#selection h2')].some((h) => (h.textContent || '').startsWith('Queued '))`));
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
check('arrival dot marks the worker row on new owed work', await evalJs(
  `!!document.querySelector('#roster .kw-row-arrival[data-row="worker"]')`));
// A report is owed work without queued input: the pending set excludes it,
// the unacknowledged count records it. The aide row must mark it.
{
  const db = new DatabaseSync(DB);
  db.prepare("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('qa-report-owed','worker','aide','report','Owed report probe.')").run();
  db.close();
}
committed();
await until('owed report marks the aide row',
  `(() => { const row = document.querySelector('#roster .doc-row[data-doc-id="aide"]');
    const mark = row && row.querySelector('.doc-owed');
    return mark !== null && mark.textContent === '1'; })()`);
// The stage is one tab stop: focus announces the cursor seat, arrows walk,
// Enter opens.
await evalJs(`document.querySelector('#attention-band svg.att-stage').focus()`);
const stageFirst = await evalJs(`(document.querySelector('#attention-band .att-sr').textContent || '').split(',')[0].trim()`);
check('stage focus announces its cursor seat', ['root', 'lead', 'worker', 'aide'].includes(stageFirst), stageFirst);
check('the stage draws its seats inside the Agents region', await evalJs(
  `!!document.querySelector('#staves #attention-band svg.att-stage')
    && document.querySelectorAll('#staves #attention-band .att-seat').length > 0`));
// The stage's typed seams. The payload decides how many edges the hall can place:
// an end is placed by a seat or by a reference the node list marks referenceOnly.
// Every seam, wherever it appears, must answer to one of those edges.
check('the stage draws a seam only where the payload places both ends', await evalJs(`(async () => {
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  const base = String((meta && meta.content) || location.origin).replace(/\\/+$/, '');
  const payload = await (await fetch(base + '/orchestra/knowledge/overview')).json();
  const seats = new Set([...document.querySelectorAll('#attention-band .att-seat[data-att-id]')]
    .map((seat) => seat.getAttribute('data-att-id') || '').filter(Boolean));
  const unheld = new Set((payload.nodes || []).filter((node) => node.referenceOnly === true)
    .map((node) => String(node.reference || '')));
  const place = (value) => seats.has(String(value)) || unheld.has(String(value));
  const heldById = new Map((payload.nodes || []).filter((node) => node.referenceOnly === false)
    .map((node) => [String(node.reference || ''), node]));
  // A cited edge may anchor at its author's seat once the stage lands that shape, so
  // a cited pair is expected only when both ends are placed outright, and the
  // author-anchored ones are checked as a subset of the payload rather than a count.
  const anchor = (edge) => edge.provenance === 'recorded-evidence'
    && (heldById.has(String(edge.source)) || heldById.has(String(edge.target)));
  // The cited ceiling is the payload's own distinct drawn pairs once a held source
  // is anchored at its author seat (attention.js:1139-1194).
  const citedPairs = new Set();
  for (const edge of payload.edges || []) {
    if (edge.provenance !== 'recorded-evidence') continue;
    const src = String(edge.source || '');
    const author = heldById.has(src) ? String((heldById.get(src) || {}).author || '') : '';
    const from = seats.has(src) ? src : (author && seats.has(author) ? author : '');
    const to = place(edge.target) ? String(edge.target) : '';
    if (!from || !to || from === to) continue;
    citedPairs.add(from + '|' + to);
  }
  const expected = (payload.edges || []).filter((edge) => edge.provenance !== 'recorded-evidence'
    && place(edge.source) && place(edge.target)).length
    + (payload.edges || []).filter((edge) => edge.provenance === 'recorded-evidence'
      && place(edge.source) && place(edge.target)).length;
  const seamIds = new Set();
  const seams = [...document.querySelectorAll('.att-seam')];
  const named = seams.every((seam) => seam.classList.contains('att-seam-cited')
    || seam.classList.contains('att-seam-authored'));
  const glyphs = seams.every((seam) => {
    const cited = seam.classList.contains('att-seam-cited');
    const stage = seam.parentNode;
    if (!stage) return false;
    if (seam.tagName.toLowerCase() === 'path') {
      const bars = stage.querySelector('.att-seam-bars');
      const chevron = stage.querySelector('.att-seam-chevron');
      return cited
        ? Boolean(bars) && bars.querySelectorAll('.att-seam-bar').length === 2 && !chevron
        : Boolean(chevron) && !bars;
    }
    return Boolean(stage.querySelector('.att-ref'));
  });
  const authored = seams.filter((seam) => seam.classList.contains('att-seam-authored')).length;
  const cited = seams.filter((seam) => seam.classList.contains('att-seam-cited')).length;
  const seatEnds = (edge) => (seats.has(String(edge.source)) ? 1 : 0)
    + (seats.has(String(edge.target)) ? 1 : 0);
  const expectedAuthored = (payload.edges || []).filter((edge) => edge.provenance === 'authored'
    && place(edge.source) && place(edge.target)
    && seatEnds(edge) >= 1 && String(edge.source) !== String(edge.target)).length;
  const expectedCitedOutright = (payload.edges || []).filter((edge) => edge.provenance === 'recorded-evidence'
    && place(edge.source) && place(edge.target)).length;
  // Cited seams may exceed the outright count by the author-anchored shape; they may
  // not exceed the payload.
  const citedWithinPayload = cited <= citedPairs.size;
  return authored === expectedAuthored && cited >= expectedCitedOutright && citedWithinPayload && named && glyphs;
})()`));
check('a reference bead states that the store does not hold what it names', await evalJs(`(async () => {
  const beads = [...document.querySelectorAll('circle.att-ref')];
  if (!beads.length) return true;
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  const base = String((meta && meta.content) || location.origin).replace(/\\/+$/, '');
  const payload = await (await fetch(base + '/orchestra/knowledge/overview')).json();
  const held = new Set((payload.nodes || []).filter((node) => node.referenceOnly === false)
    .map((node) => String(node.reference || '')));
  return beads.every((bead) => {
    const title = bead.textContent || '';
    const named = /^reference (.+) \u2014 the store does not hold this record$/.exec(title);
    return Boolean(named) && !held.has(named[1].replace(/ \(.*\)$/, '').trim());
  });
})()`));
check('the band does not scroll: the page carries its drawing at its own height', await evalJs(`(() => {
  const band = document.getElementById('attention-band');
  if (!band) return false;
  return band.scrollHeight <= band.clientHeight + 1;
})()`));
check('the owed units count what the seat title states', await evalJs(`(() => {
  const seats = [...document.querySelectorAll('#attention-band .att-seat')];
  const owed = seats.filter((s) => /\d+ owed/.test(s.textContent || ''));
  if (!owed.length) return false;
  return owed.every((seat) => {
    const stated = Number((/(\d+) owed/.exec(seat.textContent || '') || [0, 0])[1]);
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
  const chip = document.querySelector('#attention-band .lane-chip');
  const summary = document.querySelector('#ribbon .ribbon-summary');
  if (!chip || !summary) return false;
  const a = getComputedStyle(chip).fontFamily, b = getComputedStyle(summary).fontFamily;
  return !!a && a === b;
})()`));
const stageOther = stageFirst === 'aide' ? 'worker' : 'aide';
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="${stageOther}"] .doc-open').click()`);
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
  const row = document.querySelector('#roster .doc-row[data-doc-id="${stageEnd.id}"] .doc-open');
  row.focus(); row.click();
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
  workerExecution = db.prepare('SELECT id, phase, status FROM executions WHERE session = ?').get('worker');
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('running', '', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded running execution reaches the attention strip',
  `document.querySelector('#attention-band [data-att-key="chip:worker"]') !== null`);
await evalJs(`document.querySelector('#snapshot-line [aria-label="Focus the first running seat"]').click()`);
check('running count focuses the running actor while it owes input', await evalJs(
  `document.activeElement === document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open')`));
// Capture the document with running work.
const nowShot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'now.png'), Buffer.from(nowShot.result.data, 'base64'));
await evalJs(`document.querySelector('#attention-band [data-att-key="chip:worker"]').click()`);
await until('attention selection opens the actor record',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
const runningDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
await evalJs(`document.querySelector('#attention-band [data-att-key="chip:worker"]').focus()`);
const ribbonBeforeFocusedGuidance = await evalJs(`document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax')`);
baton('message', 'qa-guidance-lane-focus', 'root', 'worker', 'guidance', 'Attention focus retained on live input.');
committed();
await until('focused guidance reaches the live view',
  `document.querySelector('#ribbon .ribbon-slider').getAttribute('aria-valuemax') !== ${JSON.stringify(ribbonBeforeFocusedGuidance)}`);
check('live attention redraw preserves focus on the same chip', await evalJs(
  `window.__qaMark === 42 && document.activeElement && document.activeElement.getAttribute('data-att-key') === 'chip:worker'`));
// Ordinary owed input stays with the actor after its process exits.
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('exited', 'exit 0', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('exited seat retains its own owed work',
  `document.querySelector('#roster .doc-row[data-doc-id="worker"].state-queued') !== null`);
check('ordinary owed work leaves the rail hidden', await evalJs(
  `document.getElementById('rail').hidden === true`));
const queuedDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
check('queued and running record states look different', queuedDotColor !== runningDotColor);
for (const id of ['qa-guidance-native', 'qa-guidance-1', 'qa-guidance-2', 'qa-guidance-lane-focus']) {
  baton('ack', id, 'worker', 'fixture-ui-read');
}
committed();
await until('cleared seats fold the rail away',
  `document.getElementById('rail').hidden === true`);
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded completion removes the worker chip while its findings persist in the band',
  `!document.querySelector('#attention-band [data-att-key="chip:worker"]') && !!document.querySelector('#roster .doc-row[data-doc-id="worker"] .kw-compact')`);
// Exit-zero provider failure reads failed, not completed: stage the
// recorded terminal, prove the row and the record, then restore.
let workerEvent;
{
  const db = new DatabaseSync(DB);
  workerEvent = db.prepare('SELECT event FROM turns WHERE worker = ? AND id = ?').get('worker', workerExecution.id);
  db.close();
}
check('failure staging join row exists', !!workerEvent);
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE turns SET event = ? WHERE worker = ? AND id = ?')
    .run('{"is_error":1,"type":"agent_error","exitCode":403,"result":"provider quota refused the attempt."}', 'worker', workerExecution.id);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run('exited', 'exit 0', 'worker', workerExecution.id);
  db.close();
}
committed();
await until('recorded failure marks the worker row failed',
  `document.querySelector('#roster .doc-row[data-doc-id="worker"].state-failed') !== null`);
// A provider failure is a state the record holds: the row states failed and the
// rail lists the seat with that state as a fact, with the cause on the row's record.
await until('a provider failure lists the seat in the rail as failed',
  `document.getElementById('rail').hidden === false
    && (document.querySelector('#rail [data-rail-id="worker"]') || {}).textContent === 'worker · failed'`);
check('failed row reads its rule and word', await evalJs(`(() => {
  const row = document.querySelector('#roster .doc-row[data-doc-id="worker"]');
  const word = row && row.querySelector('.doc-work.failed');
  return !!row && !!word && word.textContent === 'failed';
})()`));
await evalJs(`document.querySelector('#roster .doc-row[data-doc-id="worker"] .doc-open').click()`);
await until('failed record opens for the worker row',
  `document.querySelector('#selection h2') && document.querySelector('#selection h2').textContent === 'worker'`);
check('record states the provider cause', await evalJs(
  `[...document.querySelectorAll('#selection p')].some((p) => (p.textContent || '').includes('Failure: provider-failure'))`));
const failedDotColor = await evalJs(
  `getComputedStyle(document.querySelector('#selection .sel-dot')).backgroundColor`);
check('failed and queued record states look different', failedDotColor !== queuedDotColor);
{
  const db = new DatabaseSync(DB);
  db.prepare('UPDATE turns SET event = ? WHERE worker = ? AND id = ?').run(workerEvent.event, 'worker', workerExecution.id);
  db.prepare('UPDATE executions SET phase = ?, status = ? WHERE session = ? AND id = ?')
    .run(workerExecution.phase, workerExecution.status, 'worker', workerExecution.id);
  db.close();
}
committed();
await until('restored execution clears the failed row',
  `document.querySelector('#roster .doc-row[data-doc-id="worker"].state-failed') === null`);

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

// Prolific authors collapse to one count badge that expands on focus.
// Worker already holds two findings above; eleven more cross the dozen.
for (let i = 0; i < 11; i += 1) {
  baton('record', 'qa-cluster-' + i, 'worker', 'Cluster finding ' + i + '.', 'Cluster evidence.', 'Cluster limits.');
}
committed();
await until('prolific author collapses to a count badge',
  `document.querySelector('#knowledge-whole .kw-cluster[data-kw-cluster="worker"] .kw-cluster-count')?.textContent === '13'`);
check('cluster badge sits at its author', await evalJs(`(() => {
  const a = document.querySelector('#knowledge-whole .kw-anchor[data-kw-id="worker"] rect');
  const b = document.querySelector('#knowledge-whole .kw-cluster[data-kw-cluster="worker"] rect');
  return !!a && !!b && Math.abs((Number(a.getAttribute('x')) + Number(a.getAttribute('width')) / 2)
    - (Number(b.getAttribute('x')) + Number(b.getAttribute('width')) / 2)) < 0.000001;
})()`));
await evalJs(`document.querySelector('#knowledge-whole .kw-cluster[data-kw-cluster="worker"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await until('activating the badge expands the author fan',
  `!document.querySelector('#knowledge-whole .kw-cluster[data-kw-cluster="worker"]') && !!document.querySelector('#knowledge-whole .knode[aria-label="qa-cluster-0"]')`);

// ============ the fixture document: the typed knowledge payload ============
// The page is fed from the fixture file rather than the live server, so the typed
// drawing can be exercised on data the fixture states. The fixture file carries the
// shapes the projection emits, plus three named probes it never emits.
const fixtureUrl = urlA + 'index.html?fixture=fixture-knowledge';
await openPage(fixtureUrl);
await until('the fixture map draws its canvas',
  `!!document.querySelector('#knowledge-whole svg.kw-canvas')`);
const fixturePayload = await evalJs(`(async () => {
  const response = await fetch('fixtures/fixture-knowledge.json');
  const document_ = await response.json();
  return (document_ && document_.knowledge) || null;
})()`);
check('the fixture payload carries the typed shapes the checks read',
  Boolean(fixturePayload)
    && Array.isArray(fixturePayload.nodes) && fixturePayload.nodes.length > 0
    && Array.isArray(fixturePayload.edges) && fixturePayload.edges.length > 0
    && fixturePayload.edges.some((edge) => edge.provenance === 'authored')
    && fixturePayload.edges.some((edge) => edge.provenance === 'recorded-evidence')
    && fixturePayload.edges.some((edge) => edge.id === 'probe-self')
    && fixturePayload.nodes.every((node) => node.deliveryRead === undefined
      || Array.isArray(node.deliveryRead))
    && fixturePayload.nodes.some((node) => Array.isArray(node.deliveryRead)));
check('the map draws both provenances and nothing outside them', await evalJs(`(() => {
  const drawn = [...document.querySelectorAll('.kw-edge-typed')];
  const provs = drawn.map((edge) => edge.getAttribute('data-provenance'));
  return drawn.some((edge) => edge.classList.contains('kw-edge-authored'))
    && drawn.some((edge) => edge.classList.contains('kw-edge-cited'))
    && provs.every((prov) => prov === 'authored' || prov === 'recorded-evidence')
    && !document.querySelector('[data-provenance="inferred"]');
})()`));
check('the map draws nothing for the probes', await evalJs(`(() => {
  const drawn = [...document.querySelectorAll('.kw-edge-typed')];
  return drawn.every((edge) => {
    const from = edge.getAttribute('data-from') || '';
    const to = edge.getAttribute('data-to') || '';
    return from !== '' && to !== '' && from !== to;
  });
})()`));
check('an unheld endpoint draws the hollow ring and a held one the dot', await evalJs(`(() => {
  const marks = [...document.querySelectorAll('#knowledge-whole [data-reference-only]')];
  const unheld = marks.filter((mark) => mark.getAttribute('data-reference-only') === 'true');
  const held = marks.filter((mark) => mark.getAttribute('data-reference-only') === 'false');
  if (!unheld.length || !held.length) return false;
  return unheld.every((mark) => mark.querySelector('circle.kw-typeref-ring')
      && !mark.querySelector('.knode, rect.knode'))
    && held.every((mark) => mark.querySelector('circle.kw-typeref-dot'));
})()`));
// The mixed projection names one authored relation and one citation twice: once in the
// compatibility rows and once in the typed edges. The canvas may draw each semantic fact
// once. The expected count is read from the payload's own edges, never pinned.
check('the map draws each semantic edge once, however many payload shapes name it', await evalJs(`(async () => {
  const document_ = await (await fetch('fixtures/fixture-knowledge.json')).json();
  const knowledge = (document_ && document_.knowledge) || {};
  const facts = new Map();
  for (const edge of knowledge.edges || []) {
    if (edge.provenance !== 'authored' && edge.provenance !== 'recorded-evidence') continue;
    const role = edge.provenance === 'recorded-evidence' ? 'cited' : 'authored';
    const key = role + '|' + String(edge.source) + '|' + String(edge.target);
    facts.set(key, (facts.get(key) || 0) + 1);
  }
  const drawn = new Map();
  for (const node of document.querySelectorAll('#knowledge-whole [data-from][data-to]')) {
    const from = node.getAttribute('data-from') || '';
    const to = node.getAttribute('data-to') || '';
    if (!from || !to) continue;
    const role = node.classList.contains('kw-edge-cited') ? 'cited'
      : (node.classList.contains('kw-edge-authored')
        || node.classList.contains('kw-edge-relate')) ? 'authored' : '';
    if (!role) continue;
    const key = role + '|' + from + '|' + to;
    drawn.set(key, (drawn.get(key) || 0) + 1);
  }
  if (!facts.size) return false;
  for (const [key, count] of facts) {
    if ((drawn.get(key) || 0) !== count) return false;
  }
  return true;
})()`));
check('the key rows follow the drawn provenance', await evalJs(`(() => {
  const words = (document.querySelector('#knowledge-whole') || { textContent: '' }).textContent || '';
  return /authored claim/.test(words) && /recorded evidence/.test(words);
})()`));
await evalJs(`(() => {
  const mark = [...document.querySelectorAll('#knowledge-whole [data-reference-only="true"]')]
    .find((node) => (node.getAttribute('data-kw-node') || '').includes('not-held'));
  if (mark) mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await until('the reference-only mark answers with a card or the record',
  `!!document.querySelector('#selection #sel-sec-finding') || !!document.querySelector('#knowledge-whole .kw-card')`);
await evalJs(`(() => {
  const block = document.querySelector('#selection #sel-sec-finding');
  if (block && /The full record is not held here/.test(block.textContent || '')) return true;
  const card = document.querySelector('#knowledge-whole .kw-card');
  const action = card && card.querySelector('button');
  if (action) action.click();
  return true;
})()`);
await until('the reference-only endpoint reaches its record',
  `(() => { const block = document.querySelector('#selection #sel-sec-finding');
    return !!block && /The full record is not held here/.test(block.textContent || ''); })()`);
check('a reference-only endpoint states the full record is not held and offers no way back',
  await evalJs(`(() => {
    const block = document.querySelector('#selection #sel-sec-finding');
    if (!block) return false;
    return /The full record is not held here\./.test(block.textContent || '')
      && !block.querySelector('[data-selkey^="sel:map:"]')
      && !block.querySelector('[data-selkey^="sel:seat:"]');
  })()`));
await evalJs(`(() => {
  const node = document.querySelector('#knowledge-whole .knode[aria-label="fixture-finding-a1"]')
    || document.querySelector('#knowledge-whole .knode');
  if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await until('the held finding answers with its card or the record',
  `!!document.querySelector('#selection #sel-sec-finding') || !!document.querySelector('#knowledge-whole .kw-card')`);
check('a held finding offers the way back and reads its cited edge as recorded evidence',
  await evalJs(`(() => {
    const block = document.querySelector('#selection #sel-sec-finding');
    if (!block) return false;
    const map = block.querySelector('[data-selkey^="sel:map:"]');
    const seat = block.querySelector('[data-selkey^="sel:seat:"]');
    const words = block.textContent || '';
    const wayBack = Boolean(map) && Boolean(seat)
      && /Show on the map/.test((map.textContent || ''))
      && /Show the author/.test((seat.textContent || ''));
    return wayBack && /\[1\] recorded evidence \u00b7 message/.test(words);
  })()`));
check('the stage draws the authored seam on the arc with its chevron and its value',
  await evalJs(`(() => {
    const seams = [...document.querySelectorAll('.att-seam-authored')];
    if (!seams.length) return false;
    return seams.every((seam) => {
      const stage = seam.parentNode;
      if (!stage) return false;
      if (Number(getComputedStyle(seam).opacity) !== 0.85) return false;
      if (seam.tagName.toLowerCase() !== 'path') {
        return Boolean(stage.querySelector('circle.att-ref'));
      }
      const chevron = stage.querySelector('polygon.att-seam-chevron');
      return Boolean(chevron) && !chevron.querySelector('circle, rect, ellipse');
    });
  })()`));
// The placement rule the hall states, applied to the fixture payload and counted
// against the drawing rather than pinned: at least one end a seat, the ends distinct.
check('the stage draws exactly the edges the placement rule places', await evalJs(`(async () => {
  const document_ = await (await fetch('fixtures/fixture-knowledge.json')).json();
  const knowledge = (document_ && document_.knowledge) || {};
  const seats = new Set([...document.querySelectorAll('#attention-band .att-seat[data-att-id]')]
    .map((seat) => seat.getAttribute('data-att-id') || '').filter(Boolean));
  const nodes = knowledge.nodes || [];
  const unheld = new Set(nodes.filter((node) => node.referenceOnly === true)
    .map((node) => String(node.reference || '')));
  const held = new Set(nodes.filter((node) => node.referenceOnly !== true)
    .map((node) => String(node.reference || '')));
  const endOf = (value) => {
    const id = String(value || '');
    if (seats.has(id)) return { seat: id };
    return unheld.has(id) ? { ref: id } : null;
  };
  // A cited edge whose source is a held node is anchored at its author seat
  // (attention.js:1139-1160); an authored edge end is never anchored.
  const citedFrom = (edge) => {
    if (seats.has(String(edge.source || ''))) return { seat: String(edge.source) };
    if (!held.has(String(edge.source || ''))) return null;
    const author = String(edge.author || '');
    return author && seats.has(author) ? { seat: author } : null;
  };
  const pairs = new Map();
  for (const edge of knowledge.edges || []) {
    const provenance = String(edge.provenance || '');
    if (provenance !== 'authored' && provenance !== 'recorded-evidence') continue;
    const from = provenance === 'recorded-evidence' ? citedFrom(edge) : endOf(edge.source);
    const to = endOf(edge.target);
    if (!from || !to) continue;
    if (from.seat && to.seat && from.seat === to.seat) continue;
    if (!from.seat && !to.seat) continue;
    const key = provenance + '|' + (from.seat || 'ref:' + from.ref)
      + '|' + (to.seat || 'ref:' + to.ref);
    pairs.set(key, { provenance: provenance, seatEnds: (from.seat ? 1 : 0) + (to.seat ? 1 : 0) });
  }
  const expected = [...pairs.values()];
  const seams = document.querySelectorAll('.att-seam').length;
  const beads = document.querySelectorAll('circle.att-ref').length;
  const chevrons = document.querySelectorAll('polygon.att-seam-chevron').length;
  const bars = document.querySelectorAll('g.att-seam-bars').length;
  return pairs.size > 0 && seams === pairs.size
    && beads === expected.filter((pair) => pair.seatEnds === 1).length
    && chevrons === expected.filter((pair) => pair.seatEnds === 2
      && pair.provenance === 'authored').length
    && bars === expected.filter((pair) => pair.seatEnds === 2
      && pair.provenance === 'recorded-evidence').length;
})()`));
// The hall must not imply that an anchored seat is the edge endpoint.
check('a cited seam anchored at an author seat says whose seat it is', await evalJs(`(() => {
  const seams = [...document.querySelectorAll('.att-seam-cited')];
  if (!seams.length) return false;
  const anchored = seams.filter((seam) => (seam.textContent || '').includes('drawn at that author'));
  if (!anchored.length) return false;
  return anchored.every((seam) => {
    const words = seam.textContent || '';
    const single = /^1 cited edge recorded as evidence/.test(words);
    return /authored by fixture-knowledge-/.test(words)
      && /cited material/.test(words)
      && (!single || /finding:fixture-/.test(words))
      && /fixture-message-/.test(words)
      && /which the store does not hold/.test(words);
  });
})()`));
await evalJs(`(() => {
  const edge = [...document.querySelectorAll('.kw-edge-typed')]
    .find((node) => node.getAttribute('data-to') === 'message:fixture-message-2'
      || node.getAttribute('data-from') === 'message:fixture-message-2');
  if (edge) edge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await until('the pointer edge answers with its card',
  `!!document.querySelector('#knowledge-whole .kw-card')`);
check('the typed edge card states nothing about a read for a pointer', await evalJs(`(() => {
  const card = document.querySelector('#knowledge-whole .kw-card');
  if (!card) return false;
  const words = card.textContent || '';
  return /message:fixture-message-2/.test(words) && !/read the delivery/.test(words);
})()`));
await evalJs(`(() => {
  const ring = document.querySelector('#knowledge-whole [data-reference-only="true"][data-kw-node="message:fixture-message-2"]');
  if (ring) ring.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await until('the pointer ring answers with its card',
  `!!document.querySelector('#knowledge-whole .kw-card')`);
check('the ring card states nothing about a read for a pointer', await evalJs(`(() => {
  const card = document.querySelector('#knowledge-whole .kw-card');
  if (!card) return false;
  const words = card.textContent || '';
  return /message reference/.test(words) && !/read the delivery/.test(words);
})()`));
check('a reference the store does not hold ends in an open bead, and a held end draws none',
  await evalJs(`(() => {
    const beads = [...document.querySelectorAll('circle.att-ref')];
    if (!beads.length) return false;
    return beads.every((bead) => /the store does not hold this record/.test(bead.textContent || ''));
  })()`));

// ============ the fixture document: the absent typed fields ============
await openPage(urlA + 'index.html?fixture=fixture-knowledge-empty');
await until('the empty fixture renders its knowledge mount',
  `!!document.getElementById('knowledge-whole')`);
check('without the typed fields the map draws no typed mark', await evalJs(`(() => {
  const whole = document.querySelector('#knowledge-whole');
  if (!whole) return false;
  const words = whole.textContent || '';
  return whole.querySelectorAll('.kw-edge-typed').length === 0
    && whole.querySelectorAll('[data-reference-only]').length === 0
    && !/authored claim/.test(words)
    && !/recorded evidence/.test(words);
})()`));

console.log('BROWSER_QA_OK');
} finally {
  await teardown();
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
