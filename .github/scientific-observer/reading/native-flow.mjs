import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const [WORK, OUT, CHROMIUM, EXE] = process.argv.slice(2);
const SOURCE = new URL('.', import.meta.url);
const scientific = JSON.parse(readFileSync(new URL('scientific-example.exact.json', SOURCE)));
const supportNode = JSON.parse(readFileSync(new URL('supporting-evidence.node.json', SOURCE)));
const supportBody = readFileSync(new URL('supporting-message.txt', SOURCE), 'utf8');
const binding = JSON.parse(readFileSync(new URL('native-binding.json', SOURCE)));
const node = id => scientific.nodes.find(row => row.id === id);
const edge = id => scientific.edges.find(row => row.id === id);
const ROOT = 'native-science-root', AUTHOR = 'example-researcher', REVIEWER = 'native-science-reviewer';
const GROUP = 'native-science-review', DB = join(WORK, 'orchestra.db');
mkdirSync(WORK); mkdirSync(OUT);
const checks = [], observations = [], commands = [], responses = [], events = [], eventWaiters = [];
const pending = new Map(), navigations = new Map();
const navigationHistory = [], pointerControls = [];
let sequence = 0, current = null, lastExpression = '', view = null, chrome = null;
let browserWs = null, pageWs = null, chromeErr = '', primaryFailure = null, eventTask = null;
let eventRequest = null, eventResponse = null, eventClosing = false, eventOwnedClose = null;
let eventRequestClosed = null, eventResponseClosed = null, origin = '', viewText = '';
let eventFailure = null;
const errors = [];
const errorRecord = (error, seen = new Set()) => {
  if (error === null || typeof error !== 'object') return { value: String(error) };
  if (seen.has(error)) return { circular: true }; seen.add(error);
  const result = {};
  for (const key of ['name','message','stack','code','errno','syscall','path'])
    if (error[key] !== undefined) result[key] = error[key];
  if (error.cause !== undefined) result.cause = errorRecord(error.cause, seen);
  if (error.coordinatorCall) result.coordinatorCall = error.coordinatorCall;
  return result;
};
const writeJson = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2) + '\n');
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function command(executable, argv, expectedStatus = 0, options = {}) {
  const startedAt = new Date().toISOString();
  const r = spawnSync(executable, argv, { encoding: 'utf8', ...options });
  const row = { sequence: commands.length + 1, executable, argv, startedAt,
    endedAt: new Date().toISOString(), status: r.status, signal: r.signal,
    stdout: r.stdout, stderr: r.stderr, error: r.error && errorRecord(r.error) };
  commands.push(row); writeJson('native-commands.json', commands);
  if (r.status !== expectedStatus || r.signal || r.error) {
    const error = new Error('Command failed: ' + executable + ' ' + argv[0], { cause: r.error });
    error.coordinatorCall = row; throw error;
  }
  return row.stdout;
}
const baton = (...args) => command(EXE, [DB, ...args]);
const answer = (...args) => JSON.parse(baton(...args));
function refuse(args, rule) {
  command(EXE, [DB, ...args], 2);
  const call = commands.at(-1); let value;
  for (const text of [call.stdout, call.stderr]) {
    try { value = JSON.parse(text.trim()); break; } catch {}
  }
  check('native refusal retains ' + rule, value?.error === 'v1-refused' && value?.rule === rule);
  return value;
}
function tracked(executable, argv) {
  const child = spawn(executable, argv, { stdio: ['ignore','pipe','pipe'] });
  child.ownerAtSpawn = child.pid ? proc(child.pid) : null;
  child.closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdout.on('data', text => writeFileSync(join(OUT, child === view ? 'view.stdout' : 'chromium.stdout'), text, { flag: 'a' }));
  child.stderr.on('data', text => writeFileSync(join(OUT, child === view ? 'view.stderr' : 'chromium.stderr'), text, { flag: 'a' }));
  return child;
}
const PROCESS_PYTHON = process.env.BATON_OBSERVER_PYTHON;
const REAL_EXE = realpathSync(EXE);
const REAL_CHROMIUM = realpathSync(CHROMIUM);
function processQuery(args) {
  if (!PROCESS_PYTHON) throw new Error('BATON_OBSERVER_PYTHON is required');
  const result = spawnSync(PROCESS_PYTHON,
    [fileURLToPath(new URL('darwin-process.py', SOURCE)), ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || result.signal)
    throw new Error('Darwin process identity read failed: ' + String(result.stderr), { cause: result.error });
  return JSON.parse(result.stdout);
}
const proc = pid => processQuery(['one', String(pid)]);
function custody(name) {
  const surveyed = processQuery(['all', WORK, REAL_EXE]);
  const zombies = surveyed.filter(row => row.status === 5);
  const vanished = surveyed.filter(row => row.unavailable?.errno === 3);
  const rows = surveyed.filter(row => row.pid !== process.pid && row.status !== 5
    && row.unavailable?.errno !== 3 &&
    (row.unavailable || row.argv?.some(arg => arg.includes(WORK) || arg === EXE || arg === REAL_EXE)));
  writeJson(name, { observer: proc(process.pid), databasePath: DB,
    ownProcesses: rows, settledZombies: zombies, settledVanished: vanished,
    runtime: process.env.XDG_RUNTIME_DIR, executable: { path: EXE, realpath: REAL_EXE, sha256: digest(EXE) } });
  return rows;
}
const sameBirth = (left, right) => !!left?.birth && isDeepStrictEqual(left.birth, right?.birth);
async function http(name, path, expectedStatus = 200) {
  const response = await fetch(origin + path);
  const body = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(OUT, name + '.body'), body);
  const row = { name, url: response.url, status: response.status,
    headers: Object.fromEntries(response.headers), bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex') };
  responses.push(row); writeJson('http-responses.json', responses);
  check('HTTP response ' + name, response.status === expectedStatus);
  return JSON.parse(body.toString());
}
function scientificRows(value) { return [...value.scientific.nodes, ...value.scientific.edges]; }
function exactRecord(expected, actual) {
  return !!actual && Object.entries(expected).every(([key,value]) => isDeepStrictEqual(actual[key], value))
    && actual.schemaVersion === 1 && actual.schemaId === 'urn:baton:knowledge:schema:1'
    && actual.provenance === 'authored';
}
function fullScientific(expected, actual) {
  return actual.length === expected.length && expected.every(row => exactRecord(row, actual.find(item => item.id === row.id)));
}
async function startEvents(cursor) {
  eventClosing = false;
  const url = origin + '/orchestra/events?subject=' + ROOT + '&since=' + cursor;
  eventResponse = await new Promise((resolve, reject) => {
    eventRequest = httpRequest(url, { method: 'GET', agent: false }, response => {
      eventResponseClosed = new Promise(done => response.once('close', done));
      resolve(response);
    });
    eventRequestClosed = new Promise(done => eventRequest.once('close', done));
    eventRequest.once('error', error => {
      reject(error);
      if (eventResponse && !eventClosing) eventResponse.destroy(error);
    });
    eventRequest.end();
  });
  writeJson('event-response.json', { url, status: eventResponse.statusCode,
    headers: eventResponse.headers, rawHeaders: eventResponse.rawHeaders });
  check('native owner SSE response', eventResponse.statusCode === 200
    && String(eventResponse.headers['content-type'] || '').startsWith('text/event-stream'));
  eventTask = (async () => {
    const decoder = new TextDecoder(); let remaining = '';
    for await (const chunk of eventResponse) {
      const text = decoder.decode(chunk, { stream: true });
      writeFileSync(join(OUT, 'native-events.sse'), text, { flag: 'a' }); remaining += text;
      let end;
      while ((end = remaining.indexOf('\n\n')) !== -1) {
        const raw = remaining.slice(0,end); remaining = remaining.slice(end + 2);
        const record = { raw, receivedAt: new Date().toISOString() }; let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) record.event = line.slice(6).trim();
          if (line.startsWith('id:')) record.id = line.slice(3).trim();
          if (line.startsWith('data:')) data += line.slice(5).trimStart() + '\n';
        }
        if (data) record.data = JSON.parse(data);
        events.push(record); writeJson('native-events.json', events);
        if(record.event==='gap')throw new Error('Native event gap: '+JSON.stringify(record));
        for (const waiter of [...eventWaiters]) if (waiter.predicate(record)) {
          eventWaiters.splice(eventWaiters.indexOf(waiter),1); waiter.resolve(record);
        }
      }
    }
    if (!eventClosing) throw new Error('Native SSE ended before owned close');
    for (const waiter of eventWaiters.splice(0)) waiter.reject(new Error('Owned SSE closed'));
  })().catch(error => {
    if (eventClosing && error === eventOwnedClose) {
      writeJson('event-owned-close.json', { observedAt: new Date().toISOString(), error: errorRecord(error) });
      return;
    };
    eventFailure = error;
    writeJson('event-error.json', errorRecord(error));
    for (const waiter of eventWaiters.splice(0)) waiter.reject(error);
    throw error;
  });
  // This branch retains early failure while the main flow owns eventTask settlement.
  eventTask.catch(() => {});
  await event('native owner hello', row => row.event === 'hello' && typeof row.data.generation === 'string');
}
async function event(name, predicate) {
  if(eventFailure)throw eventFailure;
  const existing = events.find(predicate);
  const row = existing || await new Promise((resolve,reject) => eventWaiters.push({name,predicate,resolve,reject}));
  check(name, !!row); return row;
}
async function transitions(kind, records) {
  for (const record of records) await event('committed ' + kind + ' ' + record.id,
    row => row.event === 'transition' && row.data.kind === kind && row.data.entityId === record.id
      && row.data.operation === 'insert' && Number(row.id) > 0);
}

function check(name, actual) {
  checks.push({ name, actual, pass: actual === true });
  console.log((actual === true ? 'PASS ' : 'FAIL ') + name);
  writeJson('checks.json', checks);
  if (actual !== true) throw new Error(name + ': ' + JSON.stringify(actual));
}
function recordNavigationTrace(trace, fields) {
  Object.assign(trace, fields);
  try { writeJson('navigation-history.json', navigationHistory); }
  catch (error) {
    try { process.stderr.write('Navigation trace observation failed: ' + String(error) + '\n'); }
    catch {}
  }
}
function attach(ws) {
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
    if (message.method === 'Page.lifecycleEvent' && message.params.name === 'DOMContentLoaded') {
      const navigation = navigations.get(ws);
      if (navigation) {
        navigation.loaded.add(message.params.loaderId);
        navigation.trace.lifecycle.push(message.params);
        if (navigation.reloadRequested && message.params.frameId === navigation.frameId
            && message.params.loaderId !== navigation.previousLoaderId) {
          navigation.loaderId = message.params.loaderId;
          navigation.resolve();
        } else if (navigation.loaderId === message.params.loaderId) navigation.resolve();
        writeJson('navigation-history.json', navigationHistory);
      }
    }
    const call = pending.get(message.id);
    if (call) {
      if (call.navigationTrace) {
        recordNavigationTrace(call.navigationTrace, {replyReceivedAt:new Date().toISOString(),
          replyHasError:Boolean(message.error)});
      }
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message);
    }
  };
  ws.onclose = (event) => {
    for (const [id, call] of pending) if (call.ws === ws) {
      if (call.navigationTrace) {
        recordNavigationTrace(call.navigationTrace, {socketClosedAt:new Date().toISOString(),
          socketCloseCode:event.code});
      }
      call.reject(new Error('CDP closed ' + event.code + ': ' + event.reason)); pending.delete(id);
    }
    navigations.get(ws)?.reject(new Error('CDP closed during navigation'));
  };
  ws.onerror = (event) => {
    for (const [id, call] of pending) if (call.ws === ws) {
      if (call.navigationTrace) {
        recordNavigationTrace(call.navigationTrace, {socketErrorAt:new Date().toISOString(),
          socketErrorType:event.type});
      }
      call.reject(new Error('CDP error ' + event.type)); pending.delete(id);
    }
  };
}
async function socket(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  attach(ws); return ws;
}
function send(ws, method, params = {}, navigationTrace = null) {
  if (ws.readyState !== WebSocket.OPEN)
    return Promise.reject(new Error('CDP socket is not open for ' + method + ': ' + ws.readyState));
  const id = ++sequence;
  if (navigationTrace) {
    recordNavigationTrace(navigationTrace, {commandId:id,sendAttemptedAt:new Date().toISOString()});
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { ws, resolve, reject, navigationTrace });
    try {
      ws.send(JSON.stringify({ id, method, params }));
      if (navigationTrace) {
        recordNavigationTrace(navigationTrace, {sendReturnedAt:new Date().toISOString()});
      }
    } catch (error) {
      if (navigationTrace) {
        recordNavigationTrace(navigationTrace, {sendErrorAt:new Date().toISOString(),
          sendError:errorRecord(error)});
      }
      pending.delete(id); reject(error);
    }
  });
}
async function evaluate(expression) {
  lastExpression = expression;
  const result = await send(pageWs, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result.result.value;
}
async function until(name, expression) {
  current = { name, expression }; console.log('WAIT ' + name);
  const value = await evaluate(`new Promise((resolve) => {
    const matches = () => Boolean(${expression});
    if (matches()) return resolve(true);
    const observer = new MutationObserver(() => {
      if (matches()) { observer.disconnect(); resolve(true); }
    });
    observer.observe(document, {subtree:true,childList:true,attributes:true,characterData:true});
    if (matches()) { observer.disconnect(); resolve(true); }
  })`);
  check(name, value); current = null;
}
async function frames() {
  return evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
async function click(selector) {
  const row = {selector,startedAt:new Date().toISOString(),requests:[]};
  pointerControls.push(row);
  row.scroll = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return {missing:${JSON.stringify(selector)}};
    element.scrollIntoView({block:'center',inline:'nearest'});
    return {element:element.outerHTML,scroll:{x:scrollX,y:scrollY}};
  })()`);
  await frames();
  const found = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return {missing:${JSON.stringify(selector)}};
    const r=element.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,element:element.outerHTML};
  })()`);
  row.point = found; writeJson('pointer-controls.json',pointerControls);
  check('public control is reachable: ' + selector,!!found&&!found.missing&&found.width>0&&found.height>0);
  const dispatch = async params => {
    const response = await send(pageWs,'Input.dispatchMouseEvent',params);
    row.requests.push({method:'Input.dispatchMouseEvent',params,response});
    writeJson('pointer-controls.json',pointerControls);
  };
  await dispatch({type:'mouseMoved',x:found.x,y:found.y});
  await frames();
  row.beforePress = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const hit = document.elementFromPoint(${JSON.stringify(found.x)},${JSON.stringify(found.y)});
    const r=element?.getBoundingClientRect();
    return {matches:!!element&&!!hit&&(element===hit||element.contains(hit)),
      hit:hit?.outerHTML,element:element?.outerHTML,scroll:{x:scrollX,y:scrollY},
      box:r&&{x:r.x,y:r.y,width:r.width,height:r.height}};
  })()`);
  writeJson('pointer-controls.json',pointerControls);
  check('public pointer reaches intended control: ' + selector,row.beforePress.matches===true);
  await dispatch({type:'mousePressed',x:found.x,y:found.y,button:'left',clickCount:1});
  await dispatch({type:'mouseReleased',x:found.x,y:found.y,button:'left',clickCount:1});
  row.endedAt=new Date().toISOString();writeJson('pointer-controls.json',pointerControls);
}
async function selected(id, expected) {
  const value = await evaluate(`(() => {
    const detail = document.querySelector('#knowledge-whole .kw-science-detail');
    return detail && detail.querySelector('.kw-science-detail-title')?.textContent === ${JSON.stringify(expected)}
      && [...detail.querySelectorAll('.kw-science-reference-id')].some(el => el.textContent === ${JSON.stringify(id)});
  })()`);
  check('scientific detail retains exact record ' + id, value);
}
async function capture(name) {
  const snapshot = await evaluate(`(() => {
    const map = document.querySelector('#knowledge-whole');
    const box = (element) => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return {url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},
      scroll:{x:scrollX,y:scrollY},pageHtml:document.documentElement.outerHTML,mapHtml:map?.outerHTML,
      scope:document.querySelector('#map-scope')?.textContent,notice:document.querySelector('#notice')?.textContent,
      activeElement:document.activeElement?.outerHTML,
      supportingControls:[...document.querySelectorAll('[data-science-focus^="message:"]')].map(el=>({tag:el.tagName,key:el.dataset.scienceFocus,text:el.textContent,ariaDisabled:el.getAttribute('aria-disabled'),focused:el===document.activeElement})),
      caption:map?.querySelector('.kw-science-caption')?.textContent,
      detail:map?.querySelector('.kw-science-detail')?.textContent,
      records:[...(map?.querySelectorAll('.kw-science-node')||[])].map(el => ({id:el.dataset.scienceId,kind:el.dataset.scienceKind,text:el.textContent,box:box(el)})),
      relations:[...(map?.querySelectorAll('.kw-science-connection')||[])].map(el => ({id:el.dataset.scienceEdge,text:el.textContent,box:box(el)})),
      mapBox:map&&box(map)};
  })()`);
  writeFileSync(join(OUT, name + '.page.html'), snapshot.pageHtml);
  writeFileSync(join(OUT, name + '.map.html'), snapshot.mapHtml || '');
  const {pageHtml,mapHtml,...metadata}=snapshot; writeJson(name+'.json',metadata);
  const layout = await send(pageWs, 'Page.getLayoutMetrics');
  const size = layout.result.cssContentSize;
  const shot = await send(pageWs, 'Page.captureScreenshot', {format:'png',captureBeyondViewport:true,
    clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});
  writeFileSync(join(OUT,name+'.png'),Buffer.from(shot.result.data,'base64'));
  if (snapshot.mapBox?.width>1 && snapshot.mapBox?.height>1) {
    const {x,y,width,height}=snapshot.mapBox;
    const mapShot=await send(pageWs,'Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
      clip:{x:x+snapshot.scroll.x,y:y+snapshot.scroll.y,width,height,scale:1}});
    writeFileSync(join(OUT,name+'.knowledge.png'),Buffer.from(mapShot.result.data,'base64'));
  }
  observations.push(metadata); writeJson('observations.json',observations);
}

try {
  check('qualified native binding matches this executable', EXE === binding.executable.path
    && digest(EXE) === binding.executable.sha256);
  writeJson('native-binding-used.json', binding);
  check('fresh owned process namespace', custody('custody-before.json').length === 0);
  const REPO = join(WORK, 'repo'); mkdirSync(REPO);
  for (const args of [['init','-q'],['config','user.name','Scientific fixture'],
    ['config','user.email','scientific-fixture@example.invalid'],['commit','-qm','Initial tree','--allow-empty']])
    command('git', ['-C',REPO,...args]);
  baton('attach',ROOT,'fixture','native-science-root-conversation','');
  baton('role',ROOT,'principal-conductor');
  for (const id of [AUTHOR,REVIEWER]) baton('recruit',id,ROOT,'muse','configured-model','low',
    REPO,id+'-branch',join(WORK,id),'HEAD');
  baton('role',REVIEWER,'associate-conductor');
  baton('ensemble',GROUP,REVIEWER,'tight');
  for (const id of [REVIEWER,AUTHOR]) baton('ensemble-member',GROUP,REVIEWER,id,'add');
  const legacyClaim = 'Fictional legacy record with the same raw ID as a scientific hypothesis.';
  const legacyEvidence = 'Legacy evidence remains an authored string.';
  const legacyLimits = 'This is an isolated integration input; no empirical result is claimed.';
  baton('record','shade-hypothesis',AUTHOR,legacyClaim,legacyEvidence,legacyLimits);
  baton('relate','hypothesis-rival',AUTHOR,'finding:shade-hypothesis','mentions','external:fictional-source');
  baton('promote','native-root-node',ROOT,AUTHOR,ROOT,'shade-hypothesis');
  const legacyBefore = answer('knowledge-scope',ROOT,'all','').filter(row => row.schemaVersion !== 1);
  view = tracked(EXE,[DB,'view',ROOT,ROOT,'0']);
  origin = await new Promise((resolve,reject) => {
    view.stdout.on('data', text => { viewText += text;
      const match = viewText.match(/Orchestra live view: (http:\/\/\S+)/);
      if (match) resolve(new URL(match[1]).origin); });
    view.once('error',reject);
    view.once('exit',code => reject(new Error('Native view exited before URL: '+code+' '+viewText)));
  });
  writeJson('native-view-start.json', { origin, child: proc(view.pid), executable: EXE, argv: view.spawnargs });
  const initialSnapshot = await http('snapshot-before','/orchestra/snapshot?subject='+ROOT+'&since=0');
  await startEvents(initialSnapshot.cursor);
  const served = [];
  for (const file of ['index.html','knowledge-json.js','knowledge.js','knowledge.css','app.js','document.js','styles.css',
    'attention.js','attention.css','ribbon.js','ribbon.css','selection.js','selection.css','order.js']) {
    const response = await fetch(origin+'/'+file), body = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(OUT,'served-'+file),body);
    const row = {file,url:response.url,status:response.status,headers:Object.fromEntries(response.headers),
      bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')}; served.push(row);
    check('exact served asset '+file,response.status===200 && row.sha256===digest(new URL('ui/'+file,SOURCE)));
  }
  writeJson('served-assets.json',served);
  chrome = tracked(CHROMIUM,['--headless=new','--remote-debugging-port=0',
    '--user-data-dir='+join(WORK,'chrome'),'about:blank']);
  const browserUrl = await new Promise((resolve,reject) => {
    chrome.stderr.on('data',text => { chromeErr += text;
      const match = chromeErr.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]); });
    chrome.once('error',reject); chrome.once('exit',code => reject(new Error('Chromium exited '+code+': '+chromeErr)));
  });
  browserWs = await socket(browserUrl);
  const created = await fetch(browserUrl.replace('ws://','http://').replace(/\/devtools\/.*$/,'/json/new?about:blank'),{method:'PUT'});
  if (!created.ok) throw new Error(await created.text());
  const target = await created.json(); pageWs = await socket(target.webSocketDebuggerUrl);
  writeJson('browser-target.json',{origin,target,browserUrl,chrome:proc(chrome.pid),view:proc(view.pid)});
  custody('custody-live.json');
  await send(pageWs,'Runtime.enable'); await send(pageWs,'Page.enable');
  await send(pageWs,'Page.setLifecycleEventsEnabled',{enabled:true}); await send(pageWs,'Page.bringToFront');
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  const navigate = async hash => {
    const url = origin+'/?api='+encodeURIComponent(origin)+'&subject='+ROOT+hash;
    const trace = {url,startedAt:new Date().toISOString(),lifecycle:[]};
    navigationHistory.push(trace);
    const navigation = {loaderId:null,loaded:new Set(),trace,reloadRequested:false};
    const loaded = new Promise((resolve,reject) => Object.assign(navigation,{resolve,reject}));
    navigations.set(pageWs,navigation);
    try {
      await Promise.all([(async () => {
        trace.navigate = {request:{method:'Page.navigate',params:{url}}};
        writeJson('navigation-history.json',navigationHistory);
        const result = await send(pageWs,'Page.navigate',{url},trace.navigate);
        trace.navigate.response=result;writeJson('navigation-history.json',navigationHistory);
        if (result.result.errorText) throw new Error(JSON.stringify(result.result));
        navigation.frameId=result.result.frameId;
        if (result.result.loaderId) {
          navigation.loaderId=result.result.loaderId;
          if(navigation.loaded.has(navigation.loaderId))navigation.resolve();
        } else {
          const tree = await send(pageWs,'Page.getFrameTree');
          trace.frameTree=tree;writeJson('navigation-history.json',navigationHistory);
          const frame=tree.result.frameTree.frame;
          const frameUrl=frame.url+(frame.urlFragment??'');
          if(frame.id!==navigation.frameId||frameUrl!==url)
            throw new Error('Same-document address differs before reload: '+JSON.stringify(frame));
          navigation.previousLoaderId=frame.loaderId;
          navigation.reloadRequested=true;
          trace.reload={request:{method:'Page.reload',params:{}}};
          writeJson('navigation-history.json',navigationHistory);
          trace.reload.response=await send(pageWs,'Page.reload');
          writeJson('navigation-history.json',navigationHistory);
        }
      })(),loaded]);
    } finally {
      navigations.delete(pageWs);trace.endedAt=new Date().toISOString();
      writeJson('navigation-history.json',navigationHistory);
    }
    await frames();
  };
  await navigate('');
  await until('native snapshot mounts the Knowledge controls',`!!document.querySelector('#map-scope-all')&&document.querySelector('#map-scope')?.textContent.includes('record')`);
  await click('#map-scope-all');
  await until('All holdings is active before native scientific writes',`document.querySelector('#map-scope-all')?.getAttribute('aria-pressed')==='true'`);
  baton('knowledge-admit-v1-file',AUTHOR,new URL('nodes.batch.json',SOURCE).pathname);
  await transitions('knowledge-v1-node',scientific.nodes);
  await until('committed native nodes reach the live scientific index',`(${JSON.stringify(scientific.nodes)}).every(row=>[...document.querySelectorAll('#knowledge-whole .kw-science-node')].some(el=>el.dataset.scienceId===row.id&&el.dataset.scienceKind===row.kind&&el.querySelector('.kw-science-statement')?.textContent===row.statement))`);
  await capture('native-nodes-live-wide');
  baton('knowledge-admit-v1-file',AUTHOR,new URL('edges.batch.json',SOURCE).pathname);
  await transitions('knowledge-v1-edge',scientific.edges);
  await until('committed native edges reach the live scientific index',`(${JSON.stringify(scientific.edges)}).every(row=>!!document.querySelector('#knowledge-whole .kw-science-edge-index [data-science-focus="edge:'+row.id+'"]'))`);
  await capture('native-graph-live-wide');
  const expected = [...scientific.nodes,...scientific.edges];
  const complete = answer('knowledge-scope',ROOT,'all','');
  check('public native read preserves every authored field',fullScientific(expected,complete.filter(row=>row.schemaVersion===1)));
  check('native scientific writes preserve legacy full rows',isDeepStrictEqual(legacyBefore,complete.filter(row=>row.schemaVersion!==1)));
  const allHTTP = await http('knowledge-all','/orchestra/knowledge/overview?scope=all');
  check('HTTP preserves complete native scientific envelopes',isDeepStrictEqual(scientificRows(allHTTP),complete.filter(row=>row.schemaVersion===1)));
  check('HTTP legacy same-ID record stays distinct',allHTTP.findings.some(row=>row.id==='shade-hypothesis'
    &&row.claim===legacyClaim&&row.evidence===legacyEvidence&&row.limits===legacyLimits)
    &&allHTTP.relations.some(row=>row.id==='hypothesis-rival'&&row.relation==='mentions')
    &&allHTTP.scientific.nodes.some(row=>row.id==='shade-hypothesis'&&row.kind==='hypothesis')
    &&allHTTP.scientific.edges.some(row=>row.id==='hypothesis-rival'&&row.kind==='competes-with'));
  const detail = answer('knowledge-v1-detail',ROOT,'all','','shade-hypothesis');
  check('scientific detail resolves its exact namespace',detail.length===1&&exactRecord(node('shade-hypothesis'),detail[0]));
  const legacyDetail = answer('knowledge-scope',ROOT,'all','','--id','shade-hypothesis');
  check('legacy detail resolves its exact namespace',legacyDetail.length===1&&legacyDetail[0].claim===legacyClaim
    &&legacyDetail[0].details===null&&legacyDetail[0].provenance==='legacy');
  const badNode = structuredClone(node('shade-hypothesis')); badNode.id='native-invalid-shape'; delete badNode.details.explanation;
  refuse(['record-v1',JSON.stringify(badNode)],'structure');
  const badEdge = structuredClone(edge('hypothesis-rival')); badEdge.id='native-invalid-endpoint'; badEdge.target.id='native-unrecorded-hypothesis';
  refuse(['relate-v1',JSON.stringify(badEdge)],'endpoint');
  check('refusals preserve complete native contents',isDeepStrictEqual(complete,answer('knowledge-scope',ROOT,'all','')));
  baton('message','native-science-support',AUTHOR,REVIEWER,'task',supportBody);
  const supportHTTP = await http('supporting-message','/orchestra/message?id=native-science-support');
  check('public message read retains full authored body',supportHTTP.message.id==='native-science-support'
    &&supportHTTP.message.sender===AUTHOR&&supportHTTP.message.recipient===REVIEWER&&supportHTTP.message.body===supportBody);
  const missingHTTP = await http('missing-message','/orchestra/message?id=native-science-never-written');
  check('missing public message is explicitly null',missingHTTP.message===null);
  baton('record-v1',JSON.stringify(supportNode));
  await transitions('knowledge-v1-node',[supportNode]);
  await until('supporting-message evidence arrives through the live native read',`!!document.querySelector('#knowledge-whole [data-science-focus="node:native-supporting-evidence"]')`);
  await click('#knowledge-whole [data-science-focus="node:native-supporting-evidence"]');
  await selected(supportNode.id,supportNode.statement);
  await click('#knowledge-whole [data-science-focus="message:native-science-support"]');
  await until('native supporting message body is complete and focused',`(() => {const p=document.querySelector('#knowledge-whole pre.kw-science-message-body');return p?.textContent===${JSON.stringify(supportBody)}&&p===document.activeElement;})()`);
  await capture('native-supporting-message-wide');
  await click('#knowledge-whole [data-science-focus="overview"]');
  await click('#knowledge-whole [data-science-focus="node:warming-argument"]');
  await selected('warming-argument',node('warming-argument').statement);
  check('argument reads its premises and complete derivation before general context',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-detail'),d=p?.querySelector('.kw-science-details');
    return d?.querySelector(':scope > .kw-science-field > h4')?.textContent==='premises'
      &&d.textContent.includes(${JSON.stringify(node('warming-argument').details.derivation)})
      &&d.textContent.includes(${JSON.stringify(node('warming-argument').details.method)})
      &&Array.from(p.querySelectorAll(':scope > .kw-science-field > h4')).some(h=>h.textContent==='Cited records');
  })()`));
  check('immediate public filter redraw retains a newly opened reference disclosure',await evaluate(`(() => {
    const summary=document.querySelector('[data-science-focus="uses:node:warming-argument:made"]');
    const before=summary?.closest('details');if(!before||before.open)return false;
    summary.click();
    document.querySelector('[data-science-focus="relation-filter"]').dispatchEvent(new Event('change',{bubbles:true}));
    const after=document.querySelector('details[data-science-uses-key="node:warming-argument:made"]');
    return !before.isConnected&&after!==before&&after?.open===true;
  })()`));
  check('argument reference roles preserve their exact stored paths and targets',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-detail details[data-science-uses="made"]');
    const actual=Array.from(p?.querySelectorAll('.kw-science-reference-use')||[]).map(entry=>({
      path:entry.getAttribute('data-science-reference-path'),target:entry.querySelector('button')?.getAttribute('data-science-focus')
    }));
    return p?.open&&JSON.stringify(actual)===JSON.stringify([
      {path:'evidence[0]',target:'reference:observation:temperature-observation'},
      {path:'evidence[1]',target:'reference:research-finding:warming-finding'},
      {path:'details.premises[0]',target:'reference:hypothesis:shade-hypothesis'},
      {path:'details.premises[1]',target:'reference:observation:temperature-observation'}
    ]);
  })()`));
  await click('#knowledge-whole .kw-science-detail details[data-science-uses="made"] [data-science-reference-path="details.premises[0]"] [data-science-focus="reference:hypothesis:shade-hypothesis"]');
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('premise navigation reads the recorded hypothesis predictions',await evaluate(`document.querySelector('.kw-science-details')?.textContent.includes(${JSON.stringify(node('shade-hypothesis').details.predictions[0].statement)})`));
  await click('#knowledge-whole [data-science-focus="back"]');
  await selected('warming-argument',node('warming-argument').statement);
  check('Back retains the argument reference disclosure and All scope',await evaluate(`document.querySelector('details[data-science-uses-key="node:warming-argument:made"]')?.open===true&&new URLSearchParams(location.hash.slice(1)).get('scope')==='all'`));
  const referencesBeforeResize=await send(pageWs,'Runtime.evaluate',{
    expression:'document.querySelector(\'details[data-science-uses-key="node:warming-argument:made"]\')',returnByValue:false});
  const referencesObjectId=referencesBeforeResize.result.result.objectId;
  check('open reference disclosure exists before viewport redraw',!!referencesObjectId);
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});await frames();
  const referencesReplacement=await send(pageWs,'Runtime.callFunctionOn',{objectId:referencesObjectId,
    functionDeclaration:'function(){return !this.isConnected;}',returnByValue:true});
  check('viewport redraw replaces the reference disclosure and retains its open state',referencesReplacement.result.result.value===true
    &&await evaluate(`document.querySelector('details[data-science-uses-key="node:warming-argument:made"]')?.open===true&&document.querySelector('.kw-science-detail-title')?.textContent===${JSON.stringify(node('warming-argument').statement)}`));
  await send(pageWs,'Runtime.releaseObject',{objectId:referencesObjectId});
  check('immediate public filter redraw retains a newly closed reference disclosure',await evaluate(`(() => {
    const summary=document.querySelector('[data-science-focus="uses:node:warming-argument:made"]');
    const before=summary?.closest('details');if(!before?.open)return false;
    summary.click();
    document.querySelector('[data-science-focus="relation-filter"]').dispatchEvent(new Event('change',{bubbles:true}));
    const after=document.querySelector('details[data-science-uses-key="node:warming-argument:made"]');
    return !before.isConnected&&after!==before&&after?.open===false;
  })()`));
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await frames();
  await click('#knowledge-whole [data-science-focus="uses:node:warming-argument:made"]');
  await click('#knowledge-whole [data-science-focus="uses:node:warming-argument:by"]');
  check('argument Referenced by identifies the authored relation basis without endpoint metadata',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-detail details[data-science-uses="by"]');
    const entries=Array.from(p?.querySelectorAll('.kw-science-reference-use')||[]);
    return p?.open&&entries.length===1&&entries[0].getAttribute('data-science-reference-path')==='basis[1]'
      &&entries[0].querySelector('[data-science-focus="reference:edge:finding-proposal"]')?.textContent===${JSON.stringify(edge('finding-proposal').rationale)}
      &&entries[0].textContent.includes(${JSON.stringify(edge('finding-proposal').author)});
  })()`));
  await capture('native-argument-reference-uses-wide');
  await click('#knowledge-whole .kw-science-detail details[data-science-uses="by"] [data-science-reference-path="basis[1]"] [data-science-focus="reference:edge:finding-proposal"]');
  await selected('finding-proposal',edge('finding-proposal').rationale);
  check('basis reverse navigation reads the full authored relation and its context',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-detail');
    return p?.textContent.includes(${JSON.stringify('Authored by '+edge('finding-proposal').author)})
      &&p.textContent.includes(${JSON.stringify(edge('finding-proposal').context.scope)})
      &&p.textContent.includes(${JSON.stringify(edge('finding-proposal').context.conditions[0])})
      &&p.textContent.includes(${JSON.stringify(edge('finding-proposal').limits)})
      &&p.querySelector(':scope > .kw-science-field [data-science-focus="reference:argument:warming-argument"]')?.textContent===${JSON.stringify(node('warming-argument').statement)};
  })()`));
  await click('#knowledge-whole .kw-science-detail > .kw-science-field [data-science-focus="reference:argument:warming-argument"]');
  await selected('warming-argument',node('warming-argument').statement);
  check('forward basis navigation preserves the opened reverse-reference disclosure',await evaluate(`document.querySelector('details[data-science-uses-key="node:warming-argument:by"]')?.open===true`));
  await click('#knowledge-whole [data-science-focus="overview"]');
  await click('#knowledge-whole [data-science-focus="node:warming-finding"]');
  await selected('warming-finding',node('warming-finding').statement);
  check('outgoing relation card presents its author, basis and applicable limits',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-outgoing [data-science-edge="finding-proposal"]');
    return p?.querySelector(':scope > .kw-science-author')?.textContent===${JSON.stringify('Relation authored by '+edge('finding-proposal').author)}
      &&p.querySelector('[data-science-focus="reference:argument:warming-argument"]')?.textContent===${JSON.stringify(node('warming-argument').statement)}
      &&p.querySelector('[data-science-focus="reference:observation:temperature-observation"]')?.textContent===${JSON.stringify(node('temperature-observation').statement)}
      &&p.textContent.includes(${JSON.stringify(edge('finding-proposal').limits)})
      &&p.textContent.includes(${JSON.stringify(edge('finding-proposal').context.scope)});
  })()`));
  await click('#knowledge-whole .kw-science-outgoing [data-science-edge="finding-proposal"] [data-science-focus="reference:observation:temperature-observation"]');
  await selected('temperature-observation',node('temperature-observation').statement);
  check('basis observation presents its exact quantity result before procedure and context',await evaluate(`(() => {
    const p=document.querySelector('.kw-science-detail'),d=p?.querySelector('.kw-science-details');
    const first=d?.querySelector(':scope > .kw-science-field');
    return first?.querySelector('h4')?.textContent==='result'
      &&Array.from(first.querySelectorAll('.kw-science-value')).some(v=>v.textContent==='2.1')
      &&first.textContent.includes(${JSON.stringify(node('temperature-observation').details.result.unit)})
      &&d.textContent.includes(${JSON.stringify(node('temperature-observation').details.procedure)})
      &&p.textContent.includes(${JSON.stringify(node('temperature-observation').context.scope)})
      &&Array.from(p.querySelectorAll(':scope > .kw-science-field > h4')).some(h=>h.textContent==='Cited records');
  })()`));
  await capture('native-observation-result-first-wide');
  await click('#knowledge-whole [data-science-focus="overview"]');

  await click('#map-scope-all');
  await until('universal holdings are restored before promotion',`document.querySelector('#map-scope-all')?.getAttribute('aria-pressed')==='false'`);
  baton('promote-v1','native-root-node',ROOT,AUTHOR,ROOT,'shade-hypothesis');
  await event('committed scientific node promotion',row=>row.event==='transition'&&row.data.kind==='promotion-v1'
    &&row.data.entityId==='shade-hypothesis'&&row.data.summary===AUTHOR+' to '+ROOT);
  await until('scientific node promotion updates universal holdings live',`!!document.querySelector('#knowledge-whole [data-science-focus="node:shade-hypothesis"]')`);
  baton('promote-v1','native-root-edge',ROOT,AUTHOR,ROOT,'hypothesis-rival');
  await event('committed scientific edge promotion',row=>row.event==='transition'&&row.data.kind==='promotion-v1'
    &&row.data.entityId==='hypothesis-rival'&&row.data.summary===AUTHOR+' to '+ROOT);
  const universal = await http('knowledge-universal','/orchestra/knowledge/overview?scope=universal');
  check('universal scientific holdings contain the exact promoted node and edge',
    fullScientific([node('shade-hypothesis'),edge('hypothesis-rival')],scientificRows(universal)));
  check('same promotion ID remains in separate legacy and scientific namespaces',
    universal.promotions.some(row=>row.id==='native-root-node'&&row.finding==='shade-hypothesis')
    &&universal.scientific.nodes[0].promotions.some(row=>row.id==='native-root-node'&&row.recordId==='shade-hypothesis'
      &&row.schemaVersion===1&&row.sourceKind==='session'&&row.destinationKind==='session'));
  baton('promote-v1-scoped','native-group-node',REVIEWER,'session',AUTHOR,'group',GROUP,'shade-hypothesis');
  baton('promote-v1-scoped','native-group-edge',REVIEWER,'session',AUTHOR,'group',GROUP,'hypothesis-rival');
  for (const id of ['shade-hypothesis','hypothesis-rival']) await event('committed group promotion '+id,
    row=>row.event==='transition'&&row.data.kind==='promotion-v1'&&row.data.entityId===id&&row.data.summary===AUTHOR+' to '+GROUP);
  const group = await http('knowledge-group','/orchestra/knowledge/overview?group='+GROUP);
  check('Ensemble scientific holdings retain exact node and edge envelopes',
    fullScientific([node('shade-hypothesis'),edge('hypothesis-rival')],scientificRows(group))
    &&scientificRows(group).every(row=>row.promotions.some(p=>p.destinationKind==='group'&&p.destination===GROUP&&p.promotedBy===REVIEWER)));
  baton('promote-v1','native-reviewer-study',REVIEWER,AUTHOR,REVIEWER,'shade-study');
  await event('committed recipient promotion',row=>row.event==='transition'&&row.data.kind==='promotion-v1'
    &&row.data.entityId==='shade-study'&&row.data.summary===AUTHOR+' to '+REVIEWER);
  const received = await http('knowledge-reviewer','/orchestra/knowledge?actor='+REVIEWER);
  check('actor scientific received route retains full record and promotion coordinates',
    fullScientific([node('shade-study')],scientificRows(received))&&received.scientific.authored.length===0
    &&received.scientific.received.some(row=>exactRecord(node('shade-study'),row.record)
      &&row.promotion.id==='native-reviewer-study'&&row.promotion.destination===REVIEWER));
  const authored = await http('knowledge-author','/orchestra/knowledge?actor='+AUTHOR);
  check('actor scientific authored route retains original and supporting records',
    fullScientific([...expected,supportNode],authored.scientific.authored));
  const outsideDetail = answer('knowledge-v1-detail',ROOT,'universal','','air-hypothesis');
  check('outside universal detail remains outside holdings',outsideDetail.length===0);
  await navigate('#science=node:shade-hypothesis&scope=universal');
  await until('native scientific node deep address opens',`document.querySelector('.kw-science-detail-title')?.textContent===${JSON.stringify(node('shade-hypothesis').statement)}`);
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  await click('#knowledge-whole [data-science-focus="identity:node:shade-hypothesis"]');
  check('scientific identity disclosure names schema and authored promotion',await evaluate(`(() => {const p=document.querySelector('[data-science-identity="node:shade-hypothesis"]');return p?.open&&p.textContent.includes('urn:baton:knowledge:schema:1')&&p.textContent.includes('native-root-node')&&p.textContent.includes('authored');})()`));
  const identityExpression = "document.querySelector('[data-science-identity=\"node:shade-hypothesis\"]')";
  const identityBeforeOpenResize = await send(pageWs,'Runtime.evaluate',{expression:identityExpression,returnByValue:false});
  const openObjectId = identityBeforeOpenResize.result.result.objectId;
  check('open identity is a rendered DOM element before resize',!!openObjectId);
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false}); await frames();
  const openReplacement = await send(pageWs,'Runtime.callFunctionOn',{objectId:openObjectId,
    functionDeclaration:'function(){return !this.isConnected;}',returnByValue:true});
  check('viewport redraw replaces the prior open identity element',openReplacement.result.result.value===true);
  await send(pageWs,'Runtime.releaseObject',{objectId:openObjectId});
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('open identity persists through actual viewport redraw',await evaluate(`document.querySelector('[data-science-identity="node:shade-hypothesis"]')?.open===true&&new URLSearchParams(location.hash.slice(1)).get('science')==='node:shade-hypothesis'&&new URLSearchParams(location.hash.slice(1)).get('scope')==='universal'`));
  await capture('native-open-identity-redraw');
  await click('#knowledge-whole [data-science-focus="identity:node:shade-hypothesis"]');
  check('public identity summary closes the disclosure',await evaluate(`document.querySelector('[data-science-identity="node:shade-hypothesis"]')?.open===false`));
  const identityBeforeClosedResize = await send(pageWs,'Runtime.evaluate',{expression:identityExpression,returnByValue:false});
  const closedObjectId = identityBeforeClosedResize.result.result.objectId;
  check('closed identity is a rendered DOM element before resize',!!closedObjectId);
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false}); await frames();
  const closedReplacement = await send(pageWs,'Runtime.callFunctionOn',{objectId:closedObjectId,
    functionDeclaration:'function(){return !this.isConnected;}',returnByValue:true});
  check('viewport redraw replaces the prior closed identity element',closedReplacement.result.result.value===true);
  await send(pageWs,'Runtime.releaseObject',{objectId:closedObjectId});
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('closed identity persists through actual viewport redraw',await evaluate(`document.querySelector('[data-science-identity="node:shade-hypothesis"]')?.open===false&&new URLSearchParams(location.hash.slice(1)).get('science')==='node:shade-hypothesis'&&new URLSearchParams(location.hash.slice(1)).get('scope')==='universal'`));
  await capture('native-closed-identity-redraw');
  await click('#knowledge-whole [data-science-focus="identity:node:shade-hypothesis"]');
  await capture('native-universal-hypothesis-wide');
  await click('#knowledge-whole .kw-science-outgoing [data-science-focus="edge:hypothesis-rival"]');
  await selected('hypothesis-rival',edge('hypothesis-rival').rationale);
  check('actual scoped edge retains basis and outside typed target',await evaluate(`(() => {const p=document.querySelector('.kw-science-detail');return p.textContent.includes(${JSON.stringify(edge('hypothesis-rival').basis[0].id)})&&!!document.querySelector('.kw-science-outgoing [data-science-focus="outside:hypothesis:air-hypothesis"]')&&!document.querySelector('.kw-science-outgoing [data-science-focus="node:air-hypothesis"]');})()`));
  await capture('native-universal-edge-wide');
  await click('#knowledge-whole [data-science-focus="back"]');
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('Back restores the actual held node and its open identity',await evaluate(`document.querySelector('[data-science-identity="node:shade-hypothesis"]')?.open===true&&new URLSearchParams(location.hash.slice(1)).get('scope')==='universal'`));
  await click('#knowledge-whole [data-science-focus="identity:node:shade-hypothesis"]');
  await click('#knowledge-whole .kw-science-outgoing [data-science-focus="edge:hypothesis-rival"]');
  await selected('hypothesis-rival',edge('hypothesis-rival').rationale);
  await click('#knowledge-whole [data-science-focus="back"]');
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('Back preserves the actual node with its identity disclosure closed',await evaluate(`document.querySelector('[data-science-identity="node:shade-hypothesis"]')?.open===false&&new URLSearchParams(location.hash.slice(1)).get('science')==='node:shade-hypothesis'&&new URLSearchParams(location.hash.slice(1)).get('scope')==='universal'`));
  await capture('native-closed-identity-back');
  await click('#knowledge-whole .kw-science-outgoing [data-science-focus="edge:hypothesis-rival"]');
  await click('#knowledge-whole .kw-science-outgoing [data-science-focus="outside:hypothesis:air-hypothesis"]');
  await until('outside reference loads actual All-held detail',`document.querySelector('.kw-science-detail-title')?.textContent===${JSON.stringify(node('air-hypothesis').statement)}&&new URLSearchParams(location.hash.slice(1)).get('scope')==='all'`);
  await capture('native-outside-all-wide');
  await click('#knowledge-whole [data-science-focus="back"]');
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  check('Back after outside read retains current All holdings',await evaluate(`new URLSearchParams(location.hash.slice(1)).get('science')==='node:shade-hypothesis'&&new URLSearchParams(location.hash.slice(1)).get('scope')==='all'`));
  await navigate('#science=edge:hypothesis-rival&scope=all');
  await until('actual edge deep address survives full navigation',`document.querySelector('.kw-science-detail-title')?.textContent===${JSON.stringify(edge('hypothesis-rival').rationale)}`);
  await capture('native-edge-deep-address-wide');
  await navigate('#science=node:shade-study&scope=all');
  await until('actual study deep address reads full method',`document.querySelector('.kw-science-detail')?.textContent.includes(${JSON.stringify(node('shade-study').details.method.protocol)})`);
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false}); await frames();
  check('narrow actual scientific study retains full method and fits viewport',await evaluate(`(() => {const p=document.querySelector('.kw-science-detail'),r=p?.getBoundingClientRect();return !!r&&r.left>=0&&r.right<=innerWidth&&p.textContent.includes(${JSON.stringify(node('shade-study').details.method.controls[0])})&&p.textContent.includes(${JSON.stringify(node('shade-study').context.scope)});})()`));
  await click('#knowledge-whole [data-science-focus="jump:outgoing"]');
  check('narrow actual relation region receives readable focus',await evaluate(`(() => {const p=document.querySelector('[data-science-focus="outgoing"]'),r=p?.getBoundingClientRect();return !!p&&document.activeElement===p&&r.top>=0&&r.top<innerHeight;})()`));
  await capture('native-study-outgoing-narrow');
  await click('#knowledge-whole [data-science-focus="return:outgoing"]');
  check('narrow Return restores inspector focus without address change',await evaluate(`document.activeElement===document.querySelector('.kw-science-detail')&&new URLSearchParams(location.hash.slice(1)).get('science')==='node:shade-study'`));
  await capture('native-study-return-narrow');
  await click('#knowledge-whole [data-science-focus="overview"]');
  await click('#knowledge-whole [data-science-focus="node:shade-hypothesis"]');
  await evaluate(`(() => {const p=document.querySelector('[data-science-focus="search"]');p.focus();p.value='air-temperature';p.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  check('selected record search reaches global matching native records',await evaluate(`!document.querySelector('.kw-science-detail')&&!!document.querySelector('[data-science-focus="node:air-hypothesis"]')&&!document.querySelector('[data-science-focus="node:shade-hypothesis"]')`));
  await click('#knowledge-whole [data-science-focus="node:air-hypothesis"]');
  await selected('air-hypothesis',node('air-hypothesis').statement);
  await click('#knowledge-whole [data-science-focus="back"]');
  check('search Back returns to the matching native index',await evaluate(`!document.querySelector('.kw-science-detail')&&document.querySelector('[data-science-focus="search"]')?.value==='air-temperature'`));
  await click('#knowledge-whole [data-science-focus="back"]');
  await selected('shade-hypothesis',node('shade-hypothesis').statement);
  await capture('native-search-back-narrow');
  const finalHTTP = await http('knowledge-final-all','/orchestra/knowledge/overview?scope=all');
  check('final HTTP retains all admitted authored payloads',fullScientific([...expected,supportNode],scientificRows(finalHTTP)));
  check('final legacy record retains its complete original fields',finalHTTP.findings.some(row=>row.id==='shade-hypothesis'&&row.claim===legacyClaim&&row.evidence===legacyEvidence&&row.limits===legacyLimits));
  check('browser has no runtime exceptions',errors.length===0);
  writeJson('result.json',{status:'SCIENTIFIC_NATIVE_LIVE_OK',checks,errors,observations,
    nativeAdmission:true,nativePublicServerRead:true,nativeOwnerSSE:true,
    fictionalScientificInputs:true,sourceExampleUnchanged:true,unitOutcomesWrittenAsKnowledge:false});
  console.log('SCIENTIFIC_NATIVE_LIVE_OK');
} catch (error) {
  primaryFailure = error;
  writeJson('failure-diagnostic.json',{originalError:errorRecord(error),current,lastExpression,errors,checks,
    lastCommand:commands.at(-1),lastResponse:responses.at(-1)});
  if (pageWs) try { await capture('failure'); }
  catch (captureError) { writeJson('capture-error.json',errorRecord(captureError)); }
  throw error;
} finally {
  const cleanupErrors = [];
  const clean = async (name,action) => { try { await action(); } catch (error) {cleanupErrors.push({name,error:errorRecord(error)});} };
  await clean('native SSE close',async()=>{
    eventClosing = true;
    eventOwnedClose = new Error('Owned SSE closed');
    eventResponse?.destroy(eventTask ? eventOwnedClose : undefined); eventRequest?.destroy(eventOwnedClose);
    await Promise.all([eventResponseClosed, eventRequestClosed].filter(Boolean));
    if (eventTask) await eventTask;
  });
  await clean('browser close',async()=>{
    let closeFailure = null;
    if(browserWs)try{await send(browserWs,'Browser.close');}
      catch(error){closeFailure=error;writeJson('browser-close-response.json',errorRecord(error));}
    if(chrome&&(closeFailure||!browserWs)&&chrome.exitCode===null&&chrome.signalCode===null){
      const now=proc(chrome.pid),owner=chrome.ownerAtSpawn;
      if(now.unavailable?.errno===3){
        writeJson('browser-close-owned-settled.json',{ownerAtSpawn:owner,current:now,
          state:'kernel-ESRCH',cause:closeFailure&&errorRecord(closeFailure)});
      }else{
        if(now.unavailable)throw new Error('Owned Chromium identity unavailable before cleanup',{cause:closeFailure});
        if(!owner||owner.unavailable||!sameBirth(now,owner)||now.ppid!==process.pid)
          throw new Error('Owned Chromium birth or parent changed before cleanup',{cause:closeFailure});
        if(now.status===5){
          writeJson('browser-close-owned-settled.json',{ownerAtSpawn:owner,current:now,
            state:'kernel-zombie',cause:closeFailure&&errorRecord(closeFailure)});
        }else{
          if(now.exe!==REAL_CHROMIUM||!owner.cwd||now.cwd!==owner.cwd
            ||!isDeepStrictEqual(now.argv,owner.argv))
            throw new Error('Owned Chromium active identity changed before cleanup',{cause:closeFailure});
          writeJson('browser-close-owned-fallback.json',{ownerAtSpawn:owner,current:now,
            signal:'SIGTERM',cause:closeFailure&&errorRecord(closeFailure)});
          if(!chrome.kill('SIGTERM'))throw new Error('Owned Chromium SIGTERM failed',{cause:closeFailure});
        }
      }
    }
    if(chrome)writeJson('chromium-exit.json',await chrome.closed);
  });
  pageWs?.close();browserWs?.close();
  await clean('native view close',async()=>{if(view){
    if(view.exitCode===null&&view.signalCode===null){
      const now=proc(view.pid),owner=view.ownerAtSpawn;
      if(now.unavailable?.errno===3){
        writeJson('view-close-owned-settled.json',{ownerAtSpawn:owner,current:now,state:'kernel-ESRCH'});
      }else{
        if(now.unavailable)throw new Error('Owned native view identity unavailable before cleanup');
        if(!owner||owner.unavailable||!sameBirth(now,owner)||now.ppid!==process.pid)
          throw new Error('Owned native view birth or parent changed before cleanup');
        if(now.status===5){
          writeJson('view-close-owned-settled.json',{ownerAtSpawn:owner,current:now,state:'kernel-zombie'});
        }else{
          if(now.exe!==REAL_EXE||!owner.cwd||now.cwd!==owner.cwd
            ||!isDeepStrictEqual(now.argv,owner.argv))
            throw new Error('Owned native view active identity changed before cleanup');
          writeJson('view-close-owned-fallback.json',{ownerAtSpawn:owner,current:now,signal:'SIGTERM'});
          if(!view.kill('SIGTERM'))throw new Error('Owned native view SIGTERM failed');
        }
      }
    }
    writeJson('view-exit.json',await view.closed);
  }});
  await clean('native instance shutdown',async()=>{
    if(!existsSync(DB))return;
    const owned = custody('custody-before-shutdown.json').filter(row=>
      row.exe===REAL_EXE&&row.argv?.includes('--instance-owner')&&row.argv?.includes(DB));
    command(EXE,['--instance-shutdown',DB]);
    for(const row of owned) {
      for(;;) {
        const now=proc(row.pid);
        if(now.unavailable?.errno===3)break;
        if(now.unavailable)throw new Error('Owned native instance identity unavailable after shutdown');
        if(!sameBirth(now,row))throw new Error('Owned native instance birth changed after shutdown');
        if(now.status===5)break;
        if(now.exe!==REAL_EXE||!isDeepStrictEqual(now.argv,row.argv))
          throw new Error('Owned native instance identity changed after shutdown');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    }
  });
  if(existsSync(DB+'.view.stderr'))writeFileSync(join(OUT,'native-view-server.stderr'),readFileSync(DB+'.view.stderr'));
  await clean('owned after-state',async()=>{check('owned native/browser processes are settled',custody('custody-after.json').length===0);});
  writeJson('cleanup.json',{errors:cleanupErrors,originalFailure:primaryFailure&&errorRecord(primaryFailure)});
  if(cleanupErrors.length&&!primaryFailure)throw new AggregateError(cleanupErrors.map(row=>new Error(row.name+': '+row.error.message)),'Owned cleanup failed');
}

