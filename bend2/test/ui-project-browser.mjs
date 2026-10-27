// Remote browser checks for recorded project identity and resume outcomes.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { qualifyKnowledgeGraphs } from './ui-knowledge-graph-browser.mjs';

const [out, chromium] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/orchestra');
const snapshot = JSON.parse(readFileSync(join(assets, 'fixtures/fixture-small.json')));
snapshot.cursor = '4';
const identity = { input: '/recorded/input λ', canonical: '/recorded/canonical λ',
  project: '/recorded/common-dir', pointer: '/recorded/common-dir/baton2/database',
  database: '/recorded/orchestra.db', rule: 'common-dir', git: { ok: 1, cause: '' } };
const report = '<script>window.reportExecuted=true</script>\nOriginal retained report. λ';
const sessions = [
  { id: 'fixture-player-1', kind: 'player', role: 'player', parent: 'fixture-conductor-b',
    harness: 'muse', model: 'configured-model', effort: 'high', observedHarness: 'muse',
    observedModel: 'reported-model', observedEffort: 'low', workspace: '/recorded/workspace λ',
    branch: 'recorded-branch', native: 'recorded-native', execution: { phase: 'running', status: 'pid 4242' },
    pendingCount: 2, unreadCount: 3, latestReportId: 'original-report' },
  { id: 'earlier-principal', kind: 'player', role: 'principal-conductor', harness: 'muse',
    model: 'prior-model', effort: 'low', workspace: '/recorded/earlier', branch: 'earlier-branch',
    execution: { phase: 'exited', status: 'exit 0' }, pendingCount: 0, latestReportId: 'earlier-report' },
  { id: 'stopped-conversation', role: 'player', kind: 'player', workspace: '/recorded/stopped',
    pendingCount: 1, unreadCount: 1, stop: { status: 'stopped', reason: 'Operator stop. λ',
      outcome: 'native-exited', attempt: 'original-stopped-attempt' }, latestReportId: 'stopped-report' },
];
let projectMode = 'normal';
let resumeMode = 'pending';
let heldProject = null;
let heldResume = null;
const requests = [];
const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/orchestra/snapshot') return json(response, 200, snapshot);
  if (url.pathname === '/orchestra/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    return response.write(': connected\n\n');
  }
  if (url.pathname === '/orchestra/project-sessions') {
    const actor = url.searchParams.get('actor');
    if (projectMode === 'held' && actor === 'fixture-player-1') { heldProject = response; return; }
    if (projectMode === 'missing') return json(response, 400, { error: 'project-workspace-required', actor });
    if (projectMode === 'failed') return json(response, 502, { error: 'project-sessions-failed',
      cause: 'Recorded project failure.', execution: { code: 7, stdout: 'complete stdout λ', stderr: 'complete stderr λ' } });
    const selected = projectMode === 'null' ? null : sessions.find(s => s.id === actor);
    return json(response, 200, { contractVersion: 1, project: identity, sessions,
      selected: selected ? { ...selected, latestReport: actor === 'fixture-player-1' ? report : 'Earlier retained report.' } : null });
  }
  if (url.pathname === '/orchestra/resume') {
    let raw = ''; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    writeFileSync(join(out, 'resume-requests.json'), JSON.stringify(requests, null, 2));
    if (resumeMode === 'held') { heldResume = response; return; }
    if (resumeMode === 'empty') return json(response, 200, { ok: 0, cause: 'nothing-owed-recorded-cause' });
    if (resumeMode === 'refused') return json(response, 409, { error: 'resume-failed',
      execution: { code: 2, stdout: 'recorded stdout', stderr: 'Session is terminally stopped; preserved operator stop.' } });
    return json(response, 200, { message: 'owed-message',
      delivery: { id: 'owed-message', recipient: requests.at(-1).session, kind: 'task',
        receipt: resumeMode === 'receipt' ? 'recipient handled original input λ' : null },
      latestReportId: 'resume-retained-report', latestReport: 'Actual report returned by resume. λ' });
  }
  if (url.pathname.startsWith('/orchestra/')) return json(response, 200, {
    scope: { kind: 'actor', id: url.searchParams.get('actor') || '' }, findings: [], relations: [],
    nodes: [], edges: [], authored: [], received: [], counts: { authored: 0, received: 0, unshared: 0 }, empty: true,
  });
  const path = resolve(assets, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(assets + '/')) return json(response, 404, {});
  try {
    response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(path)] || 'text/plain' });
    response.end(readFileSync(path));
  } catch { json(response, 404, {}); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'profile'), 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(chrome, 'exit');
let ws; const checks = [];
try {
  const debug = await new Promise((resolve, reject) => {
    chrome.on('error', reject); chrome.on('exit', code => reject(new Error('Early browser exit ' + code)));
    let stderr = '';
    chrome.stdout.on('data', chunk => appendFileSync(join(out, 'chrome.stdout'), chunk));
    chrome.stderr.on('data', chunk => { appendFileSync(join(out, 'chrome.stderr'), chunk); stderr += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr); if (match) resolve(match[1]); });
  });
  const base = debug.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const target = (await (await fetch(base + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let serial = 0; const pending = new Map(); let loaded;
  ws.addEventListener('message', event => {
    appendFileSync(join(out, 'cdp.jsonl'), event.data + '\n');
    const body = JSON.parse(event.data);
    if (body.method === 'Page.loadEventFired' && loaded) { loaded(); loaded = null; }
    const item = pending.get(body.id); if (!item) return; pending.delete(body.id);
    body.error ? item.reject(new Error(JSON.stringify(body.error))) : item.resolve(body);
  });
  ws.addEventListener('close', () => { for (const item of pending.values()) item.reject(new Error('CDP closed')); pending.clear(); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.result.exceptionDetails) throw new Error(JSON.stringify(value.result.exceptionDetails));
    return value.result.result.value;
  };
  send.navigate = async url => { const ready = new Promise(resolve => { loaded = resolve; }); await send('Page.navigate', { url }); await ready; };
  const check = async (name, expression) => {
    assert.equal(await evaluate(expression), true, name); checks.push({ name, passed: true });
    console.log('PASS ' + name); writeFileSync(join(out, 'project-checks.json'), JSON.stringify(checks, null, 2));
  };
  const screenshot = async name => {
    const viewport = await evaluate(`({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})`);
    const height = await evaluate(`document.querySelector('#project').getBoundingClientRect().height`);
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: Math.ceil(height) + 60, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('#project').scrollIntoView({block:'start',behavior:'instant'})`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const box = await evaluate(`(()=>{const b=document.querySelector('#project').getBoundingClientRect();return{x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height}})()`);
    const value = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...box, scale: 1 } });
    writeFileSync(join(out, name + '.png'), Buffer.from(value.result.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width:viewport.width, height:viewport.height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`scrollTo(${viewport.x},${viewport.y});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send.navigate(origin + '/?api=' + encodeURIComponent(origin));
  await evaluate(`new Promise(resolve=>{const ready=()=>document.querySelector('.att-seat');if(ready())return resolve(true);const obs=new MutationObserver(()=>{if(ready()){obs.disconnect();resolve(true)}});obs.observe(document.body,{childList:true,subtree:true})})`);
  await evaluate(`loadProject('fixture-player-1')`);
  await check('all recorded identity fields and complete ordered conversations are visible', `(()=>{
    const values=[...document.querySelectorAll('.project-identity dd')].map(n=>n.textContent);
    const rows=[...document.querySelectorAll('.project-list li')];return values.includes('/recorded/common-dir')&&values.includes('/recorded/canonical λ')&&values.includes('/recorded/common-dir/baton2/database')&&values.includes('/recorded/orchestra.db')&&values.includes('common-dir')&&rows.map(n=>n.querySelector('.project-session-id').textContent).join('|')==='fixture-player-1|earlier-principal|stopped-conversation';})()`);
  await check('route differences, counts, execution, stop and unknown fields retain their meanings', `(()=>{const rows=[...document.querySelectorAll('.project-list li')];return rows[0].textContent.includes('reported-model')&&rows[0].textContent.includes('Unacknowledged input3')&&rows[0].textContent.includes('Execution statuspid 4242')&&rows[2].textContent.includes('Operator stop. λ')&&rows[2].textContent.includes('original-stopped-attempt')&&rows[1].textContent.includes('unknown')&&rows[0].querySelector('.project-current').textContent==='current'})()`);
  await evaluate(`document.querySelector('[data-project-detail]').open=true`);
  await check('the retained report is exact text and cannot execute markup', `document.querySelector('.project-report').textContent===${JSON.stringify(report)}&&!window.reportExecuted`);
  await screenshot('project-wide');
  await evaluate(`resumeSession('fixture-player-1',false)`);
  await check('pending delivery is separate from both exact retained reports', `(()=>{const body=document.querySelector('.project-response').textContent;return document.querySelector('.project-outcome').textContent.includes('Delivery pending')&&body.includes('owed-message')&&body.includes('pending (no recipient receipt)')&&body.includes('Actual report returned by resume. λ')&&!body.includes('Original retained report.')&&!document.querySelector('.project-outcome').textContent.includes('accepted')})()`);
  resumeMode = 'receipt'; await evaluate(`resumeSession('fixture-player-1',false)`);
  await check('a recipient receipt is displayed without claiming task completion', `document.querySelector('.project-response').textContent.includes('recipient handled original input λ')&&document.querySelector('.project-outcome').textContent==='Recipient receipt recorded.'`);
  resumeMode = 'empty'; await evaluate(`resumeSession('fixture-player-1',false)`);
  await check('nothing owed preserves the actual coordinator cause', `document.querySelector('.project-outcome').textContent==='nothing-owed-recorded-cause'&&document.querySelector('.project-response').textContent.includes('Result0')`);
  resumeMode = 'refused'; await evaluate(`resumeSession('fixture-player-1',false)`);
  await check('a stop arriving during resume requires a separate explicit lift control', `document.querySelector('[data-project-key="continue"]').disabled&&!!document.querySelector('[data-project-key="lift-stop"]')&&document.querySelector('.project-response').textContent.includes('preserved operator stop.')`);
  await evaluate(`loadProject('stopped-conversation')`);
  await check('recorded stops disable ordinary continue and preserve the stop reason', `document.querySelector('[data-project-key="continue"]').disabled&&document.querySelector('[data-project-key="lift-stop"]').textContent==='Lift stop and continue'`);
  resumeMode = 'pending'; await evaluate(`document.querySelector('[data-project-key="lift-stop"]').click()`);
  await evaluate(`new Promise(resolve=>{const ready=()=>!!document.querySelector('.project-response');if(ready())return resolve();const obs=new MutationObserver(()=>{if(ready()){obs.disconnect();resolve()}});obs.observe(document.querySelector('#project'),{childList:true,subtree:true})})`);
  assert.equal(requests.at(-1).liftStop, true); assert.equal(requests.slice(0,-1).every(r => r.liftStop === undefined), true);
  await check('arrow keys and Home retain accessible ordered conversation navigation', `(()=>{const buttons=[...document.querySelectorAll('.project-session')];buttons[0].focus();buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));if(document.activeElement!==buttons[1])return false;buttons[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));return document.activeElement===buttons[0]})()`);
  projectMode = 'null'; await evaluate(`loadProject('outside-project')`);
  await check('a null selected conversation shows no fallback report or continue', `document.querySelector('.project-outcome').textContent.includes('No conversation is selected')&&!document.querySelector('.project-report')&&!document.querySelector('[data-project-key="continue"]')&&document.querySelectorAll('.project-session').length===3`);
  projectMode = 'missing'; await evaluate(`loadProject('workspace-missing')`);
  await check('a missing workspace retains the refusal and selection guidance', `document.querySelector('#project').textContent.includes('project-workspace-required')&&document.querySelector('#project-state').textContent.includes('Select a conversation')&&!document.querySelector('.project-list')`);
  projectMode = 'failed'; await evaluate(`loadProject('fixture-player-1')`);
  await check('failed project discovery preserves status, code and complete streams', `(()=>{const body=document.querySelector('#project').textContent;return body.includes('HTTP status502')&&body.includes('Exit code7')&&body.includes('complete stdout λ')&&body.includes('complete stderr λ')})()`);
  projectMode = 'held';
  const oldRead = evaluate(`loadProject('fixture-player-1')`);
  await new Promise(resolve=>{const poll=()=>heldProject?resolve():setTimeout(poll,10);poll()});
  await evaluate(`loadProject('earlier-principal')`);
  json(heldProject, 200, { project: identity, sessions, selected: { ...sessions[0], latestReport: report } });
  await oldRead;
  await check('a delayed older project read cannot replace the selected conversation', `document.querySelector('.project-selected-title').textContent.endsWith('earlier-principal')`);
  projectMode = 'normal'; await evaluate(`loadProject('fixture-player-1')`);
  resumeMode = 'held'; const oldResume = evaluate(`resumeSession('fixture-player-1',false)`);
  await new Promise(resolve=>{const poll=()=>heldResume?resolve():setTimeout(poll,10);poll()});
  await evaluate(`loadProject('earlier-principal')`);
  json(heldResume, 200, { message: 'obsolete-resume', delivery: { receipt: 'obsolete-receipt' } }); await oldResume;
  await check('a delayed resume response cannot appear under another conversation', `document.querySelector('.project-selected-title').textContent.endsWith('earlier-principal')&&!document.querySelector('.project-response')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const narrowLayout = await evaluate(`(()=>{const project=document.querySelector('#project').getBoundingClientRect();return{right:project.right,width:project.width,nodes:[...document.querySelectorAll('.project-facts dd,.project-outcome,.project-selected-title')].map(n=>{const range=document.createRange();range.selectNodeContents(n);const style=getComputedStyle(n);return{text:n.textContent,right:n.getBoundingClientRect().right,fontSize:style.fontSize,whiteSpace:style.whiteSpace,rects:[...range.getClientRects()].map(r=>({left:r.left,right:r.right}))}})}})()`);
  writeFileSync(join(out, 'project-narrow-layout.json'), JSON.stringify(narrowLayout, null, 2));
  await check('narrow project rows scroll locally and retain complete identity', `(()=>{const list=document.querySelector('.project-list');const right=document.querySelector('#project').getBoundingClientRect().right;return list.scrollHeight>list.clientHeight&&right<=innerWidth&&[...document.querySelectorAll('.project-facts dd,.project-outcome,.project-selected-title')].every(n=>{const text=document.createRange();text.selectNodeContents(n);return n.getBoundingClientRect().right<=right&&[...text.getClientRects()].every(box=>box.right<=right)})})()`);
  await screenshot('project-narrow');
  await qualifyKnowledgeGraphs({ origin, send, out, scientificExampleText: readFileSync(resolve(assets, '../../test/fixtures/knowledge-v1-scientific-example.json'), 'utf8') });
  await send('Browser.close'); const [code, signal] = await exited;
  assert.equal(code,0); assert.equal(signal,null);
  writeFileSync(join(out,'result.json'), JSON.stringify({ passed:true, projectChecks:checks.length, knowledgeRegression:true })+'\n');
  console.log('PROJECT_BROWSER_QA_OK');
} catch(error) {
  writeFileSync(join(out,'failure.json'), JSON.stringify({ message:error.message, stack:error.stack })+'\n');
  throw error;
} finally {
  if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({id:999999,method:'Browser.close'}));
  if(ws) ws.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
