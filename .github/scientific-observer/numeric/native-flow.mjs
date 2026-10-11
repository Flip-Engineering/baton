import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const [WORK, OUT, CHROMIUM, EXE] = process.argv.slice(2);
const SOURCE = new URL('.', import.meta.url);
await import(new URL('ui/knowledge-json.js',SOURCE));
const authoredText=readFileSync(new URL('authored-nodes.json',SOURCE),'utf8');
const scientific={nodes:KnowledgeJSON.parse(authoredText),edges:[]};
const binding = JSON.parse(readFileSync(new URL('native-binding.json', SOURCE)));
const node = id => scientific.nodes.find(row => row.id === id);
const edge = id => scientific.edges.find(row => row.id === id);
const ROOT = 'native-numeric-root', AUTHOR = 'example-researcher';
const DB = join(WORK, 'orchestra.db');
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
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message);
    }
  };
  ws.onclose = (event) => {
    for (const [id, call] of pending) if (call.ws === ws) {
      call.reject(new Error('CDP closed ' + event.code + ': ' + event.reason)); pending.delete(id);
    }
    navigations.get(ws)?.reject(new Error('CDP closed during navigation'));
  };
  ws.onerror = (event) => {
    for (const [id, call] of pending) if (call.ws === ws) {
      call.reject(new Error('CDP error ' + event.type)); pending.delete(id);
    }
  };
}
async function socket(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  attach(ws); return ws;
}
function send(ws, method, params = {}) {
  if (ws.readyState !== WebSocket.OPEN)
    return Promise.reject(new Error('CDP socket is not open for ' + method + ': ' + ws.readyState));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { ws, resolve, reject });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) { pending.delete(id); reject(error); }
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

const expectedTokens=JSON.parse(readFileSync(new URL('expected-numeric-tokens.json',SOURCE)));
const numericChecks=[];
function observeNumeric(name,actual,detail) {
  const row={name,pass:actual===true,detail};numericChecks.push(row);
  writeJson('numeric-checks.json',numericChecks);
  console.log((row.pass?'PASS ':'FAIL ')+name);
}
function numericWire(name,text,rows) {
  const values=rows.map(row=>({id:row.id,author:row.author,kind:row.kind,
    valueType:typeof row.details?.result?.value,
    valueSource:KnowledgeJSON.numberSource(row.details?.result,'value',row.details?.result?.value)}));
  writeFileSync(join(OUT,name+'.exact.json'),text);
  writeJson(name+'.numeric-values.json',{values,bodyBytes:Buffer.byteLength(text),
    bodySha256:createHash('sha256').update(text).digest('hex')});
  for(const [id,token] of Object.entries(expectedTokens)) {
    const value=values.find(row=>row.id===id);
    observeNumeric(name+' retains authored JSON number '+id,
      value?.author===AUTHOR&&value?.kind==='observation'&&value?.valueType==='number'&&value?.valueSource===token,
      {expectedToken:token,actual:value});
  }
}
async function publicNumeric(name,path) {
  await http(name,path);
  const text=readFileSync(join(OUT,name+'.body'),'utf8'),parsed=KnowledgeJSON.parse(text);
  const rows=parsed.scientific?.nodes||[];
  numericWire(name,text,rows);
  if(parsed.scientific?.authored)numericWire(name+'-authored',text,parsed.scientific.authored);
  check(name+' returns both authored native observation identities',rows.length===2
    &&scientific.nodes.every(expected=>rows.some(row=>row.id===expected.id&&row.author===AUTHOR&&row.kind==='observation')));
}
async function numericObservation(name,id) {
  const value=await evaluate(`(() => {
    const detail=document.querySelector('#knowledge-whole .kw-science-detail');
    const field=Array.from(detail?.querySelectorAll('.kw-science-field')||[]).find(p=>p.querySelector('h4')?.textContent==='value');
    const numeric=field?.querySelector('.kw-science-value');
    const box=element=>{const r=element?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const range=numeric&&document.createRange();if(range)range.selectNodeContents(numeric);
    const fields=Array.from(detail?.querySelectorAll('.kw-science-details > .kw-science-field > h4')||[]).map(p=>p.textContent);
    const rows=value=>(value||[]).map(row=>({id:row.id,type:typeof row.details?.result?.value,
      source:KnowledgeJSON.numberSource(row.details?.result,'value',row.details?.result?.value)}));
    return {url:location.href,selected:state.scientificSelected,actor:state.selectionId,
      scope:state.knowledge?.scope,title:detail?.querySelector('.kw-science-detail-title')?.textContent,
      displayedValue:numeric?.textContent,detailsOrder:fields,detailText:detail?.textContent,
      appNumeric:rows(state.knowledge?.scientific?.nodes),actorNumeric:rows(state.knowledgeActor?.scientific?.authored),
      overviewText:KnowledgeJSON.stringify(state.knowledge),actorText:state.knowledgeActor&&KnowledgeJSON.stringify(state.knowledgeActor),
      layout:{detail:box(detail),value:box(numeric),textRects:range?Array.from(range.getClientRects()).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})):[],
        valueClientWidth:numeric?.clientWidth,valueScrollWidth:numeric?.scrollWidth,
        documentClientWidth:document.documentElement.clientWidth,documentScrollWidth:document.documentElement.scrollWidth,
        viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},fontSize:numeric&&getComputedStyle(numeric).fontSize},
      active:document.activeElement?.outerHTML};
  })()`);
  writeJson(name+'.numeric-observation.json',value);
  const token=expectedTokens[id],expected=scientific.nodes.find(row=>row.id===id);
  observeNumeric(name+' displays the authored number token',value.selected==='node:'+id
    &&value.title===expected.statement&&value.displayedValue===token,{expectedToken:token,actual:value.displayedValue});
  observeNumeric(name+' reads the observation result first',value.detailsOrder[0]==='result',value.detailsOrder);
  for(const row of value.appNumeric)observeNumeric(name+' preserves app number source '+row.id,
    row.type==='number'&&row.source===expectedTokens[row.id],row);
  for(const row of value.actorNumeric)observeNumeric(name+' preserves actor number source '+row.id,
    row.type==='number'&&row.source===expectedTokens[row.id],row);
  observeNumeric(name+' keeps the numeric text within its field and viewport width',
    value.layout.valueScrollWidth<=value.layout.valueClientWidth
    &&value.layout.value.left>=0&&value.layout.value.right<=value.layout.viewport.width,value.layout);
  await capture(name);
}
async function numericSearchPhase(name) {
  for(const [id,token] of Object.entries(expectedTokens)) {
    await evaluate(`(() => {const input=document.querySelector('#knowledge-whole [data-science-focus="search"]');
      input.value=${JSON.stringify(token)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frames();
    const found=await evaluate(`Array.from(document.querySelectorAll('#knowledge-whole .kw-science-node')).map(row=>({id:row.getAttribute('data-science-id'),text:row.textContent}))`);
    writeJson(name+'-'+id+'.search.json',{token,found});
    observeNumeric(name+' searches the original authored token '+id,found.length===1&&found[0].id===id,{token,found});
    await evaluate(`(() => {const input=document.querySelector('#knowledge-whole [data-science-focus="search"]');
      input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frames();
  }
}
async function numericReadPhase(name) {
  for(const row of scientific.nodes) {
    await click('#knowledge-whole [data-science-focus="overview"]');
    await click('#knowledge-whole [data-science-focus="node:'+row.id+'"]');
    await selected(row.id,row.statement);
    await numericObservation(name+'-'+row.id,row.id);
  }
  await numericSearchPhase(name);
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
  baton('attach',ROOT,'fixture','native-numeric-root-conversation','');
  baton('role',ROOT,'principal-conductor');
  baton('recruit',AUTHOR,ROOT,'muse','configured-model','low',REPO,AUTHOR+'-branch',join(WORK,AUTHOR),'HEAD');
  writeFileSync(join(OUT,'original-authored-nodes.exact.json'),authoredText);
  writeFileSync(join(OUT,'native-input.batch.exact.json'),readFileSync(new URL('numeric.batch.json',SOURCE)));
  writeJson('numeric-input-identity.json',{root:ROOT,author:AUTHOR,database:DB,
    input:{path:new URL('numeric.batch.json',SOURCE).pathname,sha256:digest(new URL('numeric.batch.json',SOURCE))},
    originalAuthoredInput:{path:new URL('authored-nodes.json',SOURCE).pathname,sha256:digest(new URL('authored-nodes.json',SOURCE))},
    expectedTokens,nativeBinding:binding,nativeAdmissionRequested:true,fictionalScientificInputs:true});
  const featureExpression=readFileSync(new URL('standard-json-feature-expression.js',SOURCE),'utf8');
  writeJson('node-standard-json-features.json',(0,eval)(featureExpression));
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
        const result = await send(pageWs,'Page.navigate',{url});
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
  writeJson('browser-standard-json-features.json',await evaluate(featureExpression));
  baton('knowledge-admit-v1-file',AUTHOR,new URL('numeric.batch.json',SOURCE).pathname);
  await transitions('knowledge-v1-node',scientific.nodes);
  await until('both native quantity records reach the actual app',`Object.values(${JSON.stringify(scientific.nodes.map(row=>row.id))}).every(id=>!!document.querySelector('[data-science-focus="node:'+id+'"]'))`);
  const cliText=baton('knowledge-scope',ROOT,'all','');
  numericWire('native-all-cli',cliText,KnowledgeJSON.parse(cliText).filter(row=>row.schemaVersion===1));
  await publicNumeric('native-public-overview','/orchestra/knowledge/overview?scope=all');
  await publicNumeric('native-public-actor','/orchestra/knowledge?actor='+AUTHOR);
  await numericReadPhase('native-app-all-wide');
  await navigate('#seat='+AUTHOR);
  await until('actual actor selection loads its authored quantities',`state.selectionId===${JSON.stringify(AUTHOR)}&&state.knowledgeActor?.scientific?.authored?.length===2&&!!document.querySelector('[data-science-focus="node:decimal-observation"]')`);
  await numericReadPhase('native-app-actor-wide');
  await send(pageWs,'Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await frames();
  for(const row of scientific.nodes) {
    await click('#knowledge-whole [data-science-focus="overview"]');
    await click('#knowledge-whole [data-science-focus="node:'+row.id+'"]');
    await selected(row.id,row.statement);
    await numericObservation('native-app-actor-narrow-'+row.id,row.id);
  }
  writeJson('numeric-assessment-before-status.json',{numericChecks,errors,
    nativeAdmission:true,nativePublicCLI:true,nativePublicServerRead:true,nativeOwnerSSE:true,
    fictionalScientificInputs:true,fixtureTransportOnly:false,originalTokens:expectedTokens});
  check('actual app has no runtime exceptions',errors.length===0);
  check('all native number token, display and search observations retain the original inputs',numericChecks.every(row=>row.pass));
  writeJson('result.json',{status:'NUMERIC_NATIVE_LIVE_OK',checks,numericChecks,errors,observations,
    nativeAdmission:true,nativePublicServerRead:true,nativeOwnerSSE:true,
    fictionalScientificInputs:true,fixtureTransportOnly:false,unitOutcomesWrittenAsKnowledge:false});
  console.log('NUMERIC_NATIVE_LIVE_OK');
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

