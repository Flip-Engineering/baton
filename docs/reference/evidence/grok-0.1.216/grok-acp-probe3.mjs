// Live probe #3 of `grok agent stdio` — AUTHENTICATED. Post-auth smoke checklist items 1/4/5
// from spec/phase9/grok-acp-adapter.md:
//   (1) session/cancel conformance: does the outstanding session/prompt resolve
//       {stopReason:"cancelled"} and does the session survive?
//   (4) mid-turn second session/prompt: rejected, queued, or spliced?
//   (5) exact agent_message_chunk / terminal-response shapes; any usage _meta.
// Prompts are deliberately tiny (quota-respectful). Raw frames archived.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad';
const CWD = `${SCRATCH}/grok-live-cwd-a`;
mkdirSync(CWD, { recursive: true });

const frames = [];
const rec = (dir, obj) => { frames.push({ dir, at: Date.now(), frame: obj }); };
const say = (m) => console.log(`### ${m}`);

const p = spawn('grok', ['agent', 'stdio'], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: p.stdout });
let nextId = 1;
const pending = new Map();

function send(obj) {
  rec('->', obj);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
}
function request(method, params, tag) {
  const id = nextId++;
  send({ id, method, params });
  return { id, tag, promise: new Promise((resolve) => pending.set(id, resolve)) };
}
function requestAwait(method, params, timeoutMs) {
  const r = request(method, params);
  return Promise.race([
    r.promise,
    new Promise((res) => setTimeout(() => res({ __timeout: true, id: r.id }), timeoutMs)),
  ]);
}

let updateCount = 0;
rl.on('line', (line) => {
  let obj;
  try { obj = JSON.parse(line); } catch { rec('<-unparsed', line); return; }
  rec('<-', obj);
  if (obj.method === 'session/update') updateCount += 1;
  if (obj.id !== undefined && obj.method === undefined && pending.has(obj.id)) {
    pending.get(obj.id)(obj);
    pending.delete(obj.id);
  }
  if (obj.id !== undefined && obj.method !== undefined) {
    // server->client request during this probe — decline safely, record it
    send({ id: obj.id, error: { code: -32601, message: 'probe: unhandled server request' } });
  }
});
p.stderr.on('data', (d) => rec('stderr', d.toString().slice(0, 500)));
p.on('close', () => rec('close', {}));

function finish(why) {
  writeFileSync(`${SCRATCH}/grok-acp-probe3.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  say(`probe finished: ${why}; ${frames.length} frames archived`);
  // Print the interesting frames compactly (responses + first/last updates)
  for (const f of frames) {
    const s = JSON.stringify(f.frame);
    const isUpdate = f.frame?.method === 'session/update';
    if (!isUpdate || s.length < 400) console.log(f.dir, s.length > 700 ? s.slice(0, 700) + `…[${s.length}b]` : s);
  }
  try { p.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { p.kill('SIGKILL'); } catch {}; process.exit(0); }, 1200);
}

const GLOBAL = setTimeout(() => finish('GLOBAL DEADLINE'), 240000);

(async () => {
  say('step 0: initialize (adapter-identical capabilities)');
  const init = await requestAwait('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  }, 15000);
  if (init.__timeout || init.error) return finish('initialize failed/timeout');

  say('step 1: session/new (post-auth)');
  const sn = await requestAwait('session/new', { cwd: CWD, mcpServers: [] }, 20000);
  if (sn.__timeout || sn.error) return finish(`session/new: ${JSON.stringify(sn.error ?? 'timeout')}`);
  const sessionId = sn.result?.sessionId;
  say(`sessionId = ${sessionId}`);

  say('step 2: prompt A (trivial) — capture update + terminal shapes');
  const a = await requestAwait('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Reply with exactly OK and nothing else. Do not use any tools.' }],
  }, 60000);
  say(`prompt A resolved: ${JSON.stringify(a.result ?? a.error ?? a)}`);
  if (a.__timeout) return finish('prompt A timeout');

  say('step 3: prompt B (same session) — multi-turn proof');
  const b = await requestAwait('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Reply with exactly SECOND and nothing else. Do not use any tools.' }],
  }, 60000);
  say(`prompt B resolved: ${JSON.stringify(b.result ?? b.error ?? b)}`);
  if (b.__timeout) return finish('prompt B timeout');

  say('step 4: prompt C (long) + mid-turn prompt D + session/cancel');
  const c = request('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Count from 1 to 60, one number per line, no tools. Think briefly about each number as you go so this takes a while.' }],
  });
  c.promise.then((r) => { say(`prompt C resolved: ${JSON.stringify(r.result ?? r.error)}`); });

  await new Promise((r) => setTimeout(r, 4000)); // let C start streaming
  const cUpdatesBefore = updateCount;

  say('step 4a: mid-turn prompt D (checklist item 4: reject / queue / splice?)');
  const d = request('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Stop counting. Reply with exactly MIDTURN and nothing else.' }],
  });
  const dRace = await Promise.race([
    d.promise.then((r) => ({ kind: 'resolved', r })),
    new Promise((res) => setTimeout(() => res({ kind: 'still-pending-after-6s' }), 6000)),
  ]);
  say(`mid-turn prompt D after 6s: ${dRace.kind} ${dRace.r ? JSON.stringify(dRace.r.result ?? dRace.r.error) : ''} (updates since C started: ${updateCount - cUpdatesBefore})`);

  say('step 4b: session/cancel (checklist item 1)');
  send({ method: 'session/cancel', params: { sessionId } });
  const cFinal = await Promise.race([
    c.promise.then((r) => ({ kind: 'C-resolved', r })),
    new Promise((res) => setTimeout(() => res({ kind: 'C-unresolved-after-15s' }), 15000)),
  ]);
  say(`after cancel: ${cFinal.kind} ${cFinal.r ? JSON.stringify(cFinal.r.result ?? cFinal.r.error) : ''}`);
  const dFinal = await Promise.race([
    d.promise.then((r) => ({ kind: 'D-resolved', r })),
    new Promise((res) => setTimeout(() => res({ kind: 'D-unresolved-after-5s' }), 5000)),
  ]);
  say(`prompt D final state: ${dFinal.kind} ${dFinal.r ? JSON.stringify(dFinal.r.result ?? dFinal.r.error) : ''}`);

  say('step 5: prompt E — session survives cancel?');
  const e = await requestAwait('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Reply with exactly ALIVE and nothing else. Do not use any tools.' }],
  }, 60000);
  say(`prompt E resolved: ${JSON.stringify(e.result ?? e.error ?? e)}`);

  clearTimeout(GLOBAL);
  finish('all steps complete');
})().catch((err) => { say(`probe error: ${err.message}`); finish('exception'); });
