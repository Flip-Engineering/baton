const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Baton control seat</title>
  <link rel="stylesheet" href="/control/app.css">
  <script src="/control/app.js" defer></script>
</head>
<body>
  <header class="mast">
    <div><p class="eyebrow">Human authority / live fleet</p><h1>Baton <span>control seat</span></h1></div>
    <p id="status" class="status" role="status">Connecting to coordinator…</p>
  </header>
  <main>
    <section class="dispatch" aria-labelledby="dispatch-title">
      <header><p class="rail">Route tuple</p><h2 id="dispatch-title">Dispatch one worker</h2></header>
      <form id="spawn-form">
        <label>Harness<input id="harness" name="harness" required autocomplete="off" placeholder="codex"></label>
        <label>Exact model<input id="model" name="model" autocomplete="off" placeholder="gpt-5.6-sol"></label>
        <label>Effort<input id="effort" name="effort" autocomplete="off" placeholder="low"></label>
        <label class="wide">Goal<textarea id="goal" name="goal" required rows="3" placeholder="Describe the concrete outcome"></textarea></label>
        <label>Path scope<input id="path-scope" name="pathScope" required autocomplete="off" placeholder="impl/src/**"></label>
        <label>Verification<input id="verification" name="verification" required autocomplete="off" placeholder="npm test"></label>
        <button type="submit">Spawn worker</button>
      </form>
    </section>
    <section class="fleet" aria-labelledby="fleet-title">
      <header><p class="rail">Current authority</p><h2 id="fleet-title">Workers</h2>
        <div class="actions"><button id="refresh" type="button">Refresh list</button><button id="logout" type="button" class="quiet">Log out</button></div>
      </header>
      <div id="workers" class="workers"><p class="empty">No worker snapshot yet.</p></div>
    </section>
    <section class="signal" aria-labelledby="signal-title">
      <header><p class="rail">Resumable coordination stream</p><h2 id="signal-title">Signal ledger</h2><button id="connect-stream" type="button">Connect stream</button></header>
      <pre id="events" aria-live="polite">Waiting for a stream ticket.</pre>
    </section>
  </main>
</body>
</html>`;

const CSS = `:root{color-scheme:light;--ice:#e8f0f3;--paper:#f7fafb;--ink:#172b35;--muted:#60747d;--line:#bfd0d6;--copper:#ad5f3c;--teal:#276f6c;--white:#fff;--shadow:0 18px 45px rgba(23,43,53,.10);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,var(--ice),var(--paper) 52%);color:var(--ink);min-height:100vh}.mast{display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;padding:2.6rem clamp(1.2rem,4vw,4.5rem) 1.5rem;border-bottom:1px solid var(--line)}h1,h2,p{margin:0}h1{font-family:"Arial Narrow","Avenir Next Condensed",sans-serif;font-size:clamp(2.8rem,7vw,6.8rem);font-stretch:condensed;line-height:.82;letter-spacing:-.065em;text-transform:uppercase}h1 span{display:block;color:var(--copper);font-size:.34em;letter-spacing:.12em;margin-top:.5rem}h2{font-family:"Arial Narrow","Avenir Next Condensed",sans-serif;font-size:1.65rem;letter-spacing:-.025em}.eyebrow,.rail{font:700 .7rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.16em;color:var(--teal);margin-bottom:.7rem}.status{font:600 .76rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);max-width:26rem;text-align:right}.status[data-tone="error"]{color:#8d352c}.status[data-tone="live"]{color:var(--teal)}main{display:grid;grid-template-columns:minmax(18rem,.85fr) minmax(24rem,1.4fr);gap:1px;background:var(--line);border-bottom:1px solid var(--line)}section{background:rgba(247,250,251,.94);padding:clamp(1.2rem,3vw,2.5rem);min-width:0}section>header{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin-bottom:1.5rem}.dispatch{grid-row:span 2}.dispatch form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.dispatch .wide,.dispatch button{grid-column:1/-1}label{display:grid;gap:.45rem;font:700 .68rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}input,textarea{width:100%;border:1px solid var(--line);border-radius:0;background:var(--white);color:var(--ink);font:500 .9rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;padding:.78rem .82rem;outline:none;transition:border-color .16s,box-shadow .16s}input:focus,textarea:focus,button:focus-visible{border-color:var(--teal);box-shadow:0 0 0 3px rgba(39,111,108,.17)}textarea{resize:vertical}button{border:1px solid var(--ink);border-radius:0;background:var(--ink);color:var(--white);padding:.75rem 1rem;font:750 .72rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;cursor:pointer}button:hover{background:var(--teal);border-color:var(--teal)}button.quiet,.actions button{background:transparent;color:var(--ink)}button.quiet:hover,.actions button:hover{color:var(--white);background:var(--teal)}.actions{display:flex;gap:.5rem}.workers{display:grid;gap:.7rem}.worker{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.7rem 1rem;padding:1rem;border-left:4px solid var(--teal);background:var(--white);box-shadow:var(--shadow)}.worker h3{margin:0;font:700 .9rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}.worker p{color:var(--muted);font:.76rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:.35rem}.worker-controls{display:flex;gap:.4rem;flex-wrap:wrap;justify-content:flex-end}.worker-controls button{padding:.5rem .65rem;font-size:.62rem}.worker-input{grid-column:1/-1;display:flex;gap:.5rem}.worker-input input{flex:1}.empty{color:var(--muted);font:.86rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.signal{min-height:18rem}.signal header button{margin-left:auto}.signal pre{max-height:21rem;overflow:auto;margin:0;padding:1rem;background:#dce8ec;color:#29434e;border-top:3px solid var(--copper);font:500 .72rem/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}@media(max-width:850px){.mast{align-items:flex-start;flex-direction:column}.status{text-align:left}main{grid-template-columns:1fr}.dispatch{grid-row:auto}.dispatch form{grid-template-columns:1fr}.dispatch .wide,.dispatch button{grid-column:auto}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}`;

const JS = `'use strict';
const byId=(id)=>document.getElementById(id);
const statusNode=byId('status');
const workersNode=byId('workers');
const eventsNode=byId('events');
let session=null;
let stream=null;
const eventLines=[];
function setStatus(message,tone){statusNode.textContent=message;statusNode.dataset.tone=tone||'';}
function readCookie(name){const prefix=name+'=';const rows=document.cookie.split(';').map((row)=>row.trim());const value=rows.find((row)=>row.startsWith(prefix));return value?value.slice(prefix.length):null;}
async function request(path,options){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});const body=await response.json();if(!response.ok){const error=new Error(body&&body.error&&body.error.code||'request_failed');error.status=response.status;throw error;}return body;}
function ids(){const commandId=crypto.randomUUID();return{commandId,idempotencyKey:commandId};}
async function command(name,args,expectedFence){const identity=ids();const envelope={schemaVersion:1,...identity,command:name,args:args||{},repoId:session.identity.repoIds[0],origin:location.origin};if(Number.isInteger(expectedFence))envelope.expectedFence=expectedFence;return request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-baton-csrf':readCookie('__Host-baton_csrf')||''},body:JSON.stringify(envelope)});}
function appendEvent(type,data){eventLines.push(type+' '+data);while(eventLines.length>200)eventLines.shift();eventsNode.textContent=eventLines.join('\n');eventsNode.scrollTop=eventsNode.scrollHeight;}
function button(label,action,quiet){const node=document.createElement('button');node.type='button';node.textContent=label;if(quiet)node.className='quiet';node.addEventListener('click',()=>action().catch((error)=>setStatus(error.message,'error')));return node;}
function renderWorkers(rows){workersNode.replaceChildren();if(!Array.isArray(rows)||rows.length===0){const empty=document.createElement('p');empty.className='empty';empty.textContent='No workers are currently visible in this repository.';workersNode.append(empty);return;}for(const worker of rows){const card=document.createElement('article');card.className='worker';const summary=document.createElement('div');const title=document.createElement('h3');title.textContent=worker.id||'worker';const detail=document.createElement('p');detail.textContent=[worker.status,worker.harnessResolved||worker.vendor,worker.modelResolved,worker.effortResolved,'fence '+worker.fence].filter(Boolean).join(' / ');summary.append(title,detail);const controls=document.createElement('div');controls.className='worker-controls';controls.append(button('Interrupt',()=>command('interrupt',{workerId:worker.id,then:null},worker.fence)),button('Kill',()=>command('kill',{workerId:worker.id},worker.fence),true));if(worker.pendingApprovalId)controls.append(button('Allow',()=>command('respond',{requestId:worker.pendingApprovalId,answer:{decision:'allow'}})),button('Deny',()=>command('respond',{requestId:worker.pendingApprovalId,answer:{decision:'deny'}},undefined),true));const inputRow=document.createElement('form');inputRow.className='worker-input';const input=document.createElement('input');input.name='message';input.placeholder='Send a fenced nudge';input.required=true;const send=document.createElement('button');send.type='submit';send.textContent='Send';inputRow.append(input,send);inputRow.addEventListener('submit',(event)=>{event.preventDefault();command('send',{workerId:worker.id,message:input.value,mode:'nudge'},worker.fence).then(()=>{input.value='';setStatus('Nudge admitted.','live');}).catch((error)=>setStatus(error.message,'error'));});card.append(summary,controls,inputRow);workersNode.append(card);}}
async function refreshWorkers(){const body=await command('list',{});renderWorkers(body.result);setStatus('Fleet snapshot refreshed.','live');}
async function connectStream(){if(stream)stream.close();const ticket=await request('/v1/stream-tickets',{method:'POST',headers:{'content-type':'application/json','x-baton-csrf':readCookie('__Host-baton_csrf')||''},body:JSON.stringify({repoId:session.identity.repoIds[0]})});stream=new EventSource('/v1/events?ticket='+encodeURIComponent(ticket.ticket),{withCredentials:true});for(const type of ['snapshot','coordination','lag','shutdown'])stream.addEventListener(type,(event)=>appendEvent(type,event.data));stream.onerror=()=>setStatus('Event stream disconnected; reconnect explicitly.','error');setStatus('Event stream connected.','live');}
byId('spawn-form').addEventListener('submit',(event)=>{event.preventDefault();const scope=byId('path-scope').value.split(',').map((value)=>value.trim()).filter(Boolean);const goal=byId('goal').value;const args={harness:byId('harness').value,brief:{goal,constraints:[],pathScope:scope,definitionOfDone:goal,verification:{command:byId('verification').value,expectExit:0,timeoutMs:240000},budget:{tokens:200000,usd:5,wallMin:15}}};if(byId('model').value)args.model=byId('model').value;if(byId('effort').value)args.effort=byId('effort').value;command('spawn',args).then(()=>{setStatus('Worker spawn admitted.','live');return refreshWorkers();}).catch((error)=>setStatus(error.message,'error'));});
byId('refresh').addEventListener('click',()=>refreshWorkers().catch((error)=>setStatus(error.message,'error')));
byId('connect-stream').addEventListener('click',()=>connectStream().catch((error)=>setStatus(error.message,'error')));
byId('logout').addEventListener('click',()=>request('/v1/auth/logout',{method:'POST',headers:{'content-type':'application/json','x-baton-csrf':readCookie('__Host-baton_csrf')||''},body:'{}'}).then(()=>location.replace('/control')).catch((error)=>setStatus(error.message,'error')));
request('/v1/session').then((value)=>{session=value;setStatus('Authenticated as '+value.identity.userId+'.','live');return refreshWorkers();}).catch((error)=>setStatus(error.message,'error'));
`;

const ASSETS = Object.freeze({
  '/control': Object.freeze({ type: 'text/html; charset=utf-8', body: HTML }),
  '/control/app.js': Object.freeze({ type: 'text/javascript; charset=utf-8', body: JS }),
  '/control/app.css': Object.freeze({ type: 'text/css; charset=utf-8', body: CSS }),
});

export function operatorAsset(pathname) { return ASSETS[pathname] ?? null; }
