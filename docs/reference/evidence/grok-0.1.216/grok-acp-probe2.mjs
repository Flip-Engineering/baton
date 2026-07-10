// Live probe #2 of `grok agent stdio` (ACP): initialize -> session/new -> session/prompt.
// Unauthenticated on purpose: captures the exact error shapes for the adapter dossier.
// Raw frames archived to grok-acp-probe2.jsonl with dir markers.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad';
const CWD = `${SCRATCH}/grok-probe-cwd`;
mkdirSync(CWD, { recursive: true });

const frames = [];
const rec = (dir, obj) => frames.push({ dir, at: Date.now(), frame: obj });

const p = spawn('grok', ['agent', 'stdio'], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: p.stdout });
let nextId = 1;
const pending = new Map();

function request(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  rec('->', msg);
  p.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

rl.on('line', (line) => {
  let obj;
  try { obj = JSON.parse(line); } catch { rec('<-unparsed', line); return; }
  rec('<-', obj);
  if (obj.id !== undefined && pending.has(obj.id) && (obj.result !== undefined || obj.error !== undefined)) {
    pending.get(obj.id)(obj);
    pending.delete(obj.id);
  }
  // server->client requests: answer nothing, just record (probe only)
});
p.stderr.on('data', (d) => rec('stderr', d.toString()));

const deadline = setTimeout(() => finish('deadline'), 25000);
let finished = false;
function finish(why) {
  if (finished) return; finished = true;
  clearTimeout(deadline);
  writeFileSync(`${SCRATCH}/grok-acp-probe2.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  console.log(`--- probe finished (${why}); ${frames.length} frames ---`);
  for (const f of frames) {
    const s = JSON.stringify(f.frame);
    console.log(f.dir, s.length > 900 ? s.slice(0, 900) + `...[${s.length} bytes]` : s);
  }
  p.kill('SIGTERM');
  setTimeout(() => { p.kill('SIGKILL'); process.exit(0); }, 1500);
}

(async () => {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  if (init.error) return finish('initialize error');
  const sn = await request('session/new', { cwd: CWD, mcpServers: [] });
  if (sn.error || !sn.result?.sessionId) return finish('session/new terminal');
  const pr = await request('session/prompt', {
    sessionId: sn.result.sessionId,
    prompt: [{ type: 'text', text: 'Reply with exactly OK and nothing else.' }],
  });
  finish('prompt returned');
})();
