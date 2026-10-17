// Live probe #4 of `grok agent stdio` — AUTHENTICATED. The decisive smoke items:
//   (1) session/cancel against a GENUINELY RUNNING turn: stopReason on the pending prompt?
//   (2) cancelRewind: are files written during the cancelled turn reverted?
//   (3) session/request_permission: does it fire under default config? exact shape? allow flow?
//   (4) mid-turn second session/prompt while tools are running: reject / queue / splice?
//   (5) tool_call update payload shapes.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-user-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad';
const CWD = `${SCRATCH}/grok-live-cwd-b`;
rmSync(CWD, { recursive: true, force: true });
mkdirSync(CWD, { recursive: true });

const frames = [];
const rec = (dir, obj) => { frames.push({ dir, at: Date.now(), frame: obj }); };
const say = (m) => console.log(`### ${m}`);
const lsCwd = () => { try { return readdirSync(CWD).sort().join(','); } catch { return '(gone)'; } };

const p = spawn('grok', ['agent', 'stdio'], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: p.stdout });
let nextId = 1;
const pending = new Map();
let permissionCount = 0;
let toolCallSeen = 0;

function send(obj) {
  rec('->', obj);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
}
function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return { id, promise: new Promise((resolve) => pending.set(id, resolve)) };
}
function requestAwait(method, params, timeoutMs) {
  const r = request(method, params);
  return Promise.race([
    r.promise,
    new Promise((res) => setTimeout(() => res({ __timeout: true, id: r.id }), timeoutMs)),
  ]);
}

rl.on('line', (line) => {
  let obj;
  try { obj = JSON.parse(line); } catch { rec('<-unparsed', line); return; }
  rec('<-', obj);
  if (obj.method === 'session/update') {
    const u = obj.params?.update ?? {};
    if (String(u.sessionUpdate ?? '').startsWith('tool_call')) {
      toolCallSeen += 1;
      if (toolCallSeen <= 6) say(`tool update #${toolCallSeen}: ${JSON.stringify(u).slice(0, 300)}`);
    }
  }
  if (obj.id !== undefined && obj.method === undefined && pending.has(obj.id)) {
    pending.get(obj.id)(obj);
    pending.delete(obj.id);
    return;
  }
  if (obj.id !== undefined && obj.method !== undefined) {
    if (obj.method === 'session/request_permission') {
      permissionCount += 1;
      say(`PERMISSION REQUEST #${permissionCount}: ${JSON.stringify(obj.params).slice(0, 500)}`);
      const options = obj.params?.options ?? [];
      const allow = options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always') ?? options[0];
      if (allow) {
        send({ id: obj.id, result: { outcome: { outcome: 'selected', optionId: allow.optionId } } });
        say(`  -> answered selected:${allow.optionId}`);
      } else {
        send({ id: obj.id, result: { outcome: { outcome: 'cancelled' } } });
        say('  -> no options; answered cancelled');
      }
      return;
    }
    say(`OTHER SERVER REQUEST: ${obj.method} ${JSON.stringify(obj.params ?? {}).slice(0, 200)}`);
    send({ id: obj.id, error: { code: -32601, message: 'probe: unhandled server request' } });
  }
});
p.stderr.on('data', (d) => rec('stderr', d.toString().slice(0, 400)));
p.on('close', () => rec('close', {}));

function finish(why) {
  writeFileSync(`${SCRATCH}/grok-acp-probe4.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  say(`probe finished: ${why}; ${frames.length} frames archived; permissionCount=${permissionCount}; toolUpdates=${toolCallSeen}`);
  say(`final cwd contents: [${lsCwd()}]`);
  try { p.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { p.kill('SIGKILL'); } catch {}; process.exit(0); }, 1200);
}
const GLOBAL = setTimeout(() => finish('GLOBAL DEADLINE'), 280000);

(async () => {
  const init = await requestAwait('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  }, 15000);
  if (init.__timeout || init.error) return finish('initialize failed');
  const sn = await requestAwait('session/new', { cwd: CWD, mcpServers: [] }, 20000);
  if (sn.__timeout || sn.error) return finish(`session/new: ${JSON.stringify(sn.error ?? 'timeout')}`);
  const sessionId = sn.result?.sessionId;
  say(`sessionId = ${sessionId}`);

  say('T1: slow tool-using turn (8 file writes, one at a time)');
  const t1 = request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Create eight files named f1.txt through f8.txt in the current directory, each containing only its own number. Create them ONE AT A TIME with a separate write for each, in order. Do not do anything else. Do not run shell commands other than what your file tools need.' }],
  });
  let t1Resolved = null;
  t1.promise.then((r) => { t1Resolved = r; say(`T1 resolved: ${JSON.stringify(r.result ?? r.error)} | cwd=[${lsCwd()}]`); });

  // Wait until tool activity is genuinely underway (or 20s cap).
  const start = Date.now();
  while (toolCallSeen < 2 && !t1Resolved && Date.now() - start < 20000) {
    await new Promise((r) => setTimeout(r, 150));
  }
  say(`tool activity underway after ${Date.now() - start}ms (toolUpdates=${toolCallSeen}, files=[${lsCwd()}])`);
  if (t1Resolved) { say('T1 finished before we could interfere — mid-turn tests inconclusive'); clearTimeout(GLOBAL); return finish('too fast'); }

  say('M: MID-TURN second session/prompt (reject / queue / splice?)');
  const m = request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'STOP creating files. Reply with exactly MIDTURN and nothing else.' }],
  });
  let mResolved = null;
  m.promise.then((r) => { mResolved = r; say(`M resolved: ${JSON.stringify(r.result ?? r.error).slice(0, 300)} | T1 resolved yet: ${!!t1Resolved} | cwd=[${lsCwd()}]`); });
  const mEarly = await Promise.race([
    m.promise.then(() => 'M-resolved-quickly'),
    new Promise((res) => setTimeout(() => res('M-still-pending-after-4s'), 4000)),
  ]);
  say(`mid-turn M after 4s: ${mEarly} (T1 resolved: ${!!t1Resolved}, files=[${lsCwd()}])`);

  say(`CANCEL: session/cancel with turn(s) in flight (files now: [${lsCwd()}])`);
  const filesBeforeCancel = lsCwd();
  send({ method: 'session/cancel', params: { sessionId } });

  const t1Final = await Promise.race([
    t1.promise.then((r) => `T1 -> ${JSON.stringify(r.result ?? r.error).slice(0, 200)}`),
    new Promise((res) => setTimeout(() => res('T1 STILL PENDING 20s after cancel'), 20000)),
  ]);
  say(`after cancel: ${t1Final}`);
  const mFinal = await Promise.race([
    m.promise.then((r) => `M -> ${JSON.stringify(r.result ?? r.error).slice(0, 200)}`),
    new Promise((res) => setTimeout(() => res('M still pending 8s after cancel'), 8000)),
  ]);
  say(`after cancel: ${mFinal}`);
  await new Promise((r) => setTimeout(r, 2500)); // give any rewind a moment
  say(`cancelRewind check: files before cancel=[${filesBeforeCancel}] after=[${lsCwd()}]`);

  say('E: session survives?');
  const e = await requestAwait('session/prompt', {
    sessionId, prompt: [{ type: 'text', text: 'Reply with exactly ALIVE and nothing else. Do not use any tools.' }],
  }, 60000);
  say(`E resolved: ${JSON.stringify(e.result?.stopReason ?? e.error ?? e)}`);

  clearTimeout(GLOBAL);
  finish('all steps complete');
})().catch((err) => { say(`probe error: ${err.message}`); finish('exception'); });
