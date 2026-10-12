// Remote browser checks for knowledge relations and orchestra hierarchy.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export async function qualifyKnowledgeGraphs({ origin, send, out, scientificExampleText = null }) {
  const results = [];
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.result.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails));
    return answer.result.result.value;
  };
  const check = async (name, expression) => {
    const value = await evaluate(expression);
    assert.equal(value, true, name);
    results.push({ name, passed: true });
    console.log('PASS ' + name);
    writeFileSync(join(out, 'graph-checks.json'), JSON.stringify(results, null, 2) + '\n');
  };
  const navigate = async (url) => {
    await send.navigate(url);
    await evaluate(`new Promise(resolve => {
      const ready = () => !!document.querySelector('#knowledge-whole .kg-canvas');
      if (ready()) return resolve(true);
      const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(true); } });
      observer.observe(document.documentElement, {childList:true, subtree:true});
    })`);
  };
  const screenshot = async (name) => {
    const selector = name.startsWith('orchestra') ? '.att-stage-viewport' : '#knowledge-whole';
    const box = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}; })()`);
    const value = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip:{...box,scale:1} });
    writeFileSync(join(out, name), Buffer.from(value.result.data, 'base64'));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + '/index.html?fixture=fixture-knowledge');
  await check('orchestra peers share one row per depth', `(() => {
    const nodes = [...document.querySelectorAll('.att-seat')];
    const depths = new Map();
    for (const node of nodes) {
      const depth = node.dataset.attDepth, y = node.transform.baseVal.consolidate().matrix.f;
      if (depths.has(depth) && depths.get(depth) !== y) return false;
      depths.set(depth, y);
    }
    return nodes.length > 3 && document.querySelectorAll('.att-section-label').length === depths.size;
  })()`);
  await check('ensembles group peers inside depth rows', `(() => {
    const groups = [...document.querySelectorAll('.att-peer-group[data-att-ensemble]')].filter(g => g.dataset.attEnsemble);
    return groups.length > 0 && groups.every(g => !!g.querySelector('.att-peer-boundary') && !!g.querySelector('.att-peer-name'));
  })()`);
  await check('parent links remain complete', `(() => {
    const nodes = new Map([...document.querySelectorAll('.att-seat')].map(n => [n.dataset.attId, n]));
    return [...nodes.values()].every(n => !nodes.has(n.dataset.attParent) || !!document.querySelector(
      '.att-parent-link[data-att-parent-from="' + n.dataset.attParent + '"][data-att-parent-to="' + n.dataset.attId + '"]'));
  })()`);
  await check('dense hierarchy keeps readable depth labels and every peer', `(() => {
    const mount=document.createElement('div');mount.className='lane-strip';mount.style.width='1200px';document.body.appendChild(mount);
    const players=[{id:'overview-root',role:'principal-conductor',parent:''}];
    const ensembles=[];
    for(let i=0;i<80;i++)players.push({id:'overview-player-'+i,role:'player',parent:'overview-root',memberEnsembles:['overview-group-'+Math.floor(i/5)]});
    for(let i=0;i<16;i++)ensembles.push({id:'overview-group-'+i,owner:'overview-root',members:players.slice(1+i*5,6+i*5).map(p=>p.id)});
    renderAttention(mount,{players,ensembles},{showEnded:true});
    const svg=mount.querySelector('.att-stage');const peers=[...mount.querySelectorAll('.att-seat[data-att-depth="1"]')];
    const labels=[...mount.querySelectorAll('.att-section-label')];
    const okay=peers.length===80 && new Set(peers.map(p=>p.transform.baseVal.consolidate().matrix.f)).size===1
      && labels.every(n=>parseFloat(getComputedStyle(n).fontSize)>=12)
      && Math.abs(svg.getBoundingClientRect().width-svg.viewBox.baseVal.width)<1
      && mount.querySelectorAll('.att-peer-group').length===16
      && [...mount.querySelectorAll('.att-peer-name')].every(n=>n.textContent.includes('group-'))
      && peers.every(p=>p.querySelector('title').textContent.includes(p.dataset.attId));
    mount.remove();return okay;
  })()`);
  await check('knowledge contains records and citations without actor membership', `(() => {
    const root = document.querySelector('#knowledge-whole');
    return root.querySelectorAll('.kg-node').length > 0 && root.querySelectorAll('.kg-edge').length > 0
      && !root.querySelector('.kw-memberships, .kw-anchor, .kw-actor, .kw-ensemble-entry')
      && [...root.querySelectorAll('[data-knowledge-kind]')].every(n => !['session', 'group'].includes(n.dataset.knowledgeKind));
  })()`);
  await evaluate(`document.querySelector('#map-scope-all').click()`);
  await check('empty space never creates an actor knowledge node', `(() => {
    const nodes = [...document.querySelectorAll('#knowledge-whole .kg-node')];
    return nodes.length > 0 && nodes.every(n => !n.dataset.knowledgeNode.startsWith('fixture-knowledge-'));
  })()`);
  await evaluate(`document.querySelector('#knowledge-whole .kg-node[data-knowledge-node="fixture-finding-a1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await check('legacy claim opens complete evidence and limits', `(() => {
    const detail = document.querySelector('.kw-science-detail');
    return !!detail && detail.textContent.includes('The snapshot read stays authoritative')
      && detail.textContent.includes('Limits') && !!document.querySelector('.kg-canvas');
  })()`);
  await check('selection retains the whole graph', `document.querySelectorAll('.kg-node').length > 4 && document.querySelectorAll('.kg-edge').length > 2`);
  await screenshot('knowledge-legacy.png');

  // Render the same public layer with a complete typed payload.
  await evaluate(`(async () => {
    const scientific = KnowledgeJSON.parse(${scientificExampleText === null ? "await (await fetch('/scientific-example.json')).text()" : JSON.stringify(scientificExampleText)});
    scientific.schemaId = 'urn:baton:knowledge:schema:1';
    scientific.edges.push({id:'example-causal-relation',kind:'causes',author:'example-researcher',
      source:{kind:'hypothesis',id:'shade-hypothesis'}, target:{kind:'observation',id:'temperature-observation'},
      rationale:'The illustrative intervention tests the shade mechanism.',limits:'Fictional browser fixture.',
      details:{identification:'Paired shade intervention.',alternativeExplanations:['Concurrent air warming.']}});
    window.graphData = {overview:{scientific}};
    window.graphOptions = {mode:'whole', onSelectScientific:key => { window.selectedKnowledge = key; },
      onOpenScientificReference:ref => { window.outsideReference = ref; }};
    window.drawKnowledge = () => KnowledgeLayer.renderKnowledge(document.querySelector('#knowledge-whole'), graphData, graphOptions);
    drawKnowledge();
    document.querySelector('#map').scrollIntoView();
    return true;
  })()`);
  await check('every typed node and relation is drawn', `(() => {
    const nodes = [...document.querySelectorAll('.kg-node')].map(n => n.dataset.knowledgeNode);
    const edges = [...document.querySelectorAll('.kg-edge')].map(n => n.dataset.knowledgeEdge);
    return graphData.overview.scientific.nodes.every(n => nodes.includes(n.id))
      && graphData.overview.scientific.edges.every(e => edges.includes(e.id))
      && new Set(nodes).size === nodes.length && new Set(edges).size === edges.length;
  })()`);
  await check('causal and evidentiary relations have labels and arrowheads', `['causes','supports','derived-from'].every(kind => {
    const edge = document.querySelector('.kg-edge[data-relation="'+kind+'"]');
    return edge && edge.querySelector('.kg-edge-label').textContent === kind.replaceAll('-', ' ')
      && edge.querySelector('.kg-edge-line').getAttribute('marker-end').startsWith('url(');
  })`);
  await screenshot('knowledge-scientific.png');
  await evaluate(`document.querySelector('.kg-edge[data-relation="causes"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await check('causal relation exposes identification and alternatives', `(() => {
    const detail = document.querySelector('.kw-science-detail');
    return detail && detail.textContent.toLowerCase().includes('identification')
      && detail.textContent.toLowerCase().includes('alternative explanations')
      && detail.textContent.includes('Limits') && selectedKnowledge.startsWith('edge:');
  })()`);
  await check('relation endpoints can be traversed', `document.querySelectorAll('.kw-science-incoming .kw-science-node, .kw-science-outgoing .kw-science-node').length === 2`);
  await evaluate(`document.querySelector('.kw-science-outgoing .kw-science-statement').click()`);
  await check('endpoint traversal selects the knowledge record', `selectedKnowledge.startsWith('node:') && !!document.querySelector('.kg-node.is-selected')`);
  await check('history returns to the relation', `(() => {
    document.querySelector('[data-science-focus="back"]').click();
    return selectedKnowledge.startsWith('edge:') && !!document.querySelector('.kg-edge.is-selected');
  })()`);
  await check('selected relation endpoints remain readable beside its evidence', `(() => {
    const svg=document.querySelector('.kg-canvas').getBoundingClientRect();
    const endpoints=[...document.querySelectorAll('.kg-node:not(.is-dim)')];
    return parseInt(document.querySelector('.kg-zoom-level').textContent)>=70
      && endpoints.length===2 && endpoints.every(n=>{const b=n.getBoundingClientRect();
        return b.left>=svg.left && b.right<=svg.right && b.top>=svg.top && b.bottom<=svg.bottom;});
  })()`);
  await screenshot('knowledge-causal-relation.png');
  await evaluate(`document.querySelector('[data-science-focus="overview"]').click()`);
  await check('search highlights matches without dropping relationships', `(() => {
    const before = document.querySelectorAll('.kg-node, .kg-edge').length;
    const search = document.querySelector('[data-science-focus="search"]');
    search.value = 'shade'; search.dispatchEvent(new Event('input'));
    return document.querySelectorAll('.kg-node, .kg-edge').length === before
      && document.querySelector('[data-science-focus="search"]').value === 'shade';
  })()`);
  await check('relation filter keeps the whole graph', `(() => {
    const count = document.querySelectorAll('.kg-edge').length;
    const select = document.querySelector('[data-science-focus="relation-filter"]');
    select.value = 'causes'; select.dispatchEvent(new Event('change'));
    return document.querySelectorAll('.kg-edge').length === count
      && !!document.querySelector('.kg-edge[data-relation="causes"]:not(.is-dim)')
      && !!document.querySelector('.kg-edge.is-dim');
  })()`);
  await evaluate(`const search = document.querySelector('[data-science-focus="search"]');
    search.value = ''; search.dispatchEvent(new Event('input')); graphOptions.scientificSelected='';
    const filter = document.querySelector('[data-science-focus="relation-filter"]'); filter.value=''; filter.dispatchEvent(new Event('change'));`);
  await check('zoom and fit work', `(() => {
    const read = () => document.querySelector('.kg-zoom-level').textContent;
    const before = read(); document.querySelector('[data-science-focus="zoom-in"]').click();
    const after = read(); document.querySelector('[data-science-focus="fit-graph"]').click();
    return before !== after && read() === before;
  })()`);
  await check('supporting message citations are graph resources with complete stored bodies', `(() => {
    graphData.messages={'example-support-message':{state:'ok',message:{kind:'report',sender:'example-source',recipient:'example-reader',body:'Complete retained evidence body with its qualification limits.'}}};
    graphData.overview.scientific.nodes.find(n=>n.id==='shade-hypothesis').evidence={kind:'message',id:'example-support-message'};
    drawKnowledge();
    const node=document.querySelector('.kg-node[data-knowledge-node="example-support-message"]');
    if(!node)return false;node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return document.querySelector('.kw-science-message-body')?.textContent==='Complete retained evidence body with its qualification limits.'
      && !!document.querySelector('.kg-edge[data-to="node:example-support-message"]');
  })()`);
  await check('record details preserve exact stored numeric tokens', `(() => {
    graphData.overview.scientific.nodes.find(n=>n.id==='shade-question').details=KnowledgeJSON.parse('{"large":900719925474099312345,"small":1.0000000000000000000000000000001e-42}');
    graphOptions.scientificSelected='node:shade-question';drawKnowledge();
    const text=document.querySelector('.kw-science-detail').textContent;
    return text.includes('900719925474099312345') && text.includes('1.0000000000000000000000000000001e-42');
  })()`);
  await check('cycle layout retains both directions', `(() => {
    const a = {id:'cycle-a',kind:'claim',statement:'First cyclic proposition',schemaVersion:1};
    const b = {id:'cycle-b',kind:'claim',statement:'Second cyclic proposition',schemaVersion:1};
    graphData = {overview:{scientific:{schemaVersion:1,schemaId:'urn:baton:knowledge:schema:1',nodes:[a,b],edges:[
      {id:'cycle-ab',kind:'implies',source:{kind:'claim',id:a.id},target:{kind:'claim',id:b.id}},
      {id:'cycle-ba',kind:'implies',source:{kind:'claim',id:b.id},target:{kind:'claim',id:a.id}}
    ]}}}; graphOptions.scientificSelected=''; drawKnowledge();
    return document.querySelectorAll('.kg-node').length === 2 && document.querySelectorAll('.kg-edge').length === 2;
  })()`);
  await check('assertions about a relation have a distinct junction', `(() => {
    graphData.overview.scientific.edges.push({id:'edge-challenge',kind:'challenges',source:{kind:'claim',id:'cycle-a'},target:{kind:'edge',edgeKind:'implies',id:'cycle-ab'}});
    drawKnowledge();
    return !!document.querySelector('.kg-node[data-knowledge-node="cycle-ab"]')
      && document.querySelector('.kg-edge[data-knowledge-edge="edge-challenge"]').dataset.to === 'edge:cycle-ab';
  })()`);
  await check('outside references retain identity and open all holdings', `(() => {
    graphData.overview.scientific.edges.push({id:'outside-edge',kind:'supports',source:{kind:'evidence',id:'outside-evidence'},target:{kind:'claim',id:'cycle-a'}});
    drawKnowledge(); const node=document.querySelector('.kg-node[data-knowledge-node="outside-evidence"]'); node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return node.classList.contains('is-reference') && outsideReference.id === 'outside-evidence' && outsideReference.kind === 'evidence';
  })()`);
  await check('keyboard activates knowledge nodes', `(() => {
    const node = document.querySelector('.kg-node[data-knowledge-node="cycle-a"]');
    node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return selectedKnowledge === 'node:cycle-a' && !!document.querySelector('.kw-science-detail');
  })()`);
  await check('live redraw retains selection and camera', `(() => {
    document.querySelector('[data-science-focus="zoom-in"]').click();
    const before = document.querySelector('.kg-world').getAttribute('transform'); drawKnowledge();
    return document.querySelector('.kg-world').getAttribute('transform') === before
      && document.querySelector('.kg-node.is-selected').dataset.knowledgeNode === 'cycle-a';
  })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 850, deviceScaleFactor: 1, mobile: false });
  await check('knowledge viewport fits narrow screens', `(() => {
    drawKnowledge(); const svg = document.querySelector('.kg-canvas'), frame=svg.parentElement;
    return svg.getBoundingClientRect().width <= frame.clientWidth + 1
      && document.querySelectorAll('.kg-edge').length === 4;
  })()`);
  await screenshot('knowledge-narrow.png');
  await navigate(origin + '/index.html?fixture=fixture-knowledge');
  await check('orchestra preserves peer depth on narrow screens', `(() => {
    const byDepth = new Map();
    for (const node of document.querySelectorAll('.att-seat')) {
      const d=node.dataset.attDepth, y=node.transform.baseVal.consolidate().matrix.f;
      if (byDepth.has(d) && byDepth.get(d)!==y) return false; byDepth.set(d,y);
    }
    return byDepth.size >= 3;
  })()`);
  await screenshot('orchestra-narrow.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await screenshot('orchestra-wide.png');
  await navigate(origin + '/index.html?fixture=fixture-knowledge-empty');
  await check('empty knowledge graph contains no agent stand-ins', `document.querySelectorAll('.kg-node,.kg-edge').length === 0
    && document.querySelector('.kg-empty').textContent.includes('No knowledge records')`);
  return results;
}

async function standalone() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const [out, chromium = 'chromium'] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const ui = join(root, 'bend2/ui/orchestra');
  const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json' };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname === '/scientific-example.json'
      ? join(root, 'bend2/test/fixtures/knowledge-v1-scientific-example.json')
      : resolve(ui, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(ui + sep) && url.pathname !== '/scientific-example.json') { response.writeHead(404); response.end(); return; }
    try {
      const body = readFileSync(path);
      response.writeHead(200, { 'content-type':types[extname(path)] || 'application/octet-stream',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'" });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-breakpad', '--disable-crash-reporter', '--crash-dumps-dir='+join(out,'crashes'),
    '--remote-debugging-port=0', '--user-data-dir='+join(out,'profile'), 'about:blank'], { stdio:['ignore','pipe','pipe'] });
  const raw = { stdout:'', stderr:'' };
  const exit = once(chrome, 'exit');
  chrome.on('exit', (code,signal)=>writeFileSync(join(out,'browser-exit.json'),JSON.stringify({code,signal})+'\n'));
  let ws;
  try {
    const browserURL = await new Promise((resolve, reject) => {
      chrome.on('error', reject);
      chrome.on('exit', code => reject(new Error('Browser exited before CDP: '+code)));
      for (const name of ['stdout','stderr']) chrome[name].on('data', chunk => {
        raw[name] += chunk.toString(); writeFileSync(join(out,'chrome.'+name), raw[name]);
        const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(raw.stderr); if(match) resolve(match[1]);
      });
    });
    const base = browserURL.replace(/^ws:/,'http:').split('/devtools/')[0];
    const target = (await (await fetch(base+'/json/list')).json()).find(t=>t.type==='page');
    ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws,'open');
    let serial=0; const pending=new Map(), events=new Map();
    ws.addEventListener('message', event=>{
      appendFileSync(join(out,'cdp.jsonl'),event.data+'\n');
      const message=JSON.parse(event.data);
      if (message.method && events.has(message.method)) {
        for (const resolve of events.get(message.method)) resolve(message);
        events.delete(message.method);
      }
      const call=pending.get(message.id); if(!call)return;
      pending.delete(message.id); if(message.error)call.reject(new Error(JSON.stringify(message.error))); else call.resolve(message);
    });
    ws.addEventListener('close', ()=>{for(const call of pending.values())call.reject(new Error('CDP closed'));pending.clear();});
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
    });
    send.navigate = async url => {
      const loaded = new Promise(resolve => events.set('Page.loadEventFired', [resolve]));
      const response = await send('Page.navigate', {url});
      if (response.result.errorText) throw new Error(response.result.errorText);
      await loaded;
    };
    let results;
    try { results=await qualifyKnowledgeGraphs({origin:'http://127.0.0.1:'+server.address().port,send,out}); }
    catch (error) {
      writeFileSync(join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack})+'\n');
      const screenshot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(out,'failure.png'),Buffer.from(screenshot.result.data,'base64'));
      const dom=await send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
      writeFileSync(join(out,'failure.html'),dom.result.result.value);
      throw error;
    }
    console.log('KNOWLEDGE_GRAPH_QA_OK '+results.length);
    await send('Browser.close');
    const [code,signal]=await exit;
    writeFileSync(join(out,'browser-exit.json'),JSON.stringify({code,signal})+'\n');
    assert.equal(code,0); assert.equal(signal,null);
  } finally {
    if(ws)ws.close();
    if(chrome.exitCode===null && chrome.signalCode===null) { chrome.kill('SIGTERM'); await exit; }
    await new Promise(resolve=>server.close(resolve));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) standalone().catch(error=>{console.error(error);process.exitCode=1;});
