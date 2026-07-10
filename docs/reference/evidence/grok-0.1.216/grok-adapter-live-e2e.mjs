// Live E2E smoke of GrokAcpCli (the REAL adapter) against the REAL `grok agent stdio` binary —
// the spec/phase9 live-smoke gate for every verb the card declares native:
//   spawn (initialize -> session/new -> first turn), prompt(turn), approve(allow),
//   steer (GA13 emulation: cancel -> control.steer -> re-prompt), interrupt (+ session survives),
//   kill (+ kill.confirmed). answer() is unsupported-by-design; deny/cancel decisions were
//   live-proven shape-wise in probe #4.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrokAcpCli } from '/Users/wahargis/Development/Experiments/baton/impl/src/grok-acp.mjs';

const SCRATCH = '/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad';
const dir = mkdtempSync(join(tmpdir(), 'grok-e2e-'));
const say = (m) => console.log(`### ${m}`);
say(`workdir: ${dir}`);

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000 });
const events = [];
const approvals = [];
adapter.onEvent((e) => {
  events.push({ at: Date.now(), ...e });
  const p = JSON.stringify(e.payload ?? {});
  console.log(`  [${e.kind}] ${p.length > 220 ? p.slice(0, 220) + '…' : p}`);
  if (e.kind === 'approval.requested') {
    approvals.push(e.payload.requestId);
    adapter.approve('w1', e.payload.requestId, 'allow').then((a) => say(`approve(allow) ack: ${JSON.stringify(a)}`));
  }
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find(pred);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`TIMEOUT waiting for ${label}; kinds so far: ${events.map((e) => e.kind).join(',')}`);
    await delay(120);
  }
}
const brief = {
  goal: 'Create a file named probe.txt in the current directory containing exactly the text GROK-LIVE. Use your file tools. Do nothing else, then stop.',
  constraints: [], pathScope: ['**'], definitionOfDone: 'probe.txt exists with content GROK-LIVE',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100000, usd: 1, wallMin: 10 },
};

const verdicts = [];
function verdict(name, ok, note = '') { verdicts.push({ name, ok, note }); say(`VERDICT ${ok ? 'PASS' : 'FAIL'}: ${name} ${note}`); }

try {
  // ---- 1. spawn + first turn + approve(allow) + usage ----
  say('STEP 1: spawn (file-writing brief; approvals auto-allowed through adapter.approve)');
  const ack = await adapter.spawn('w1', brief, { worktree: dir });
  say(`spawn ack: ${JSON.stringify(ack)}`);
  const t1 = await waitFor((e) => e.kind === 'lifecycle.turn_completed' || e.kind === 'lifecycle.crashed', 'first turn terminal');
  const probeTxt = (() => { try { return readFileSync(join(dir, 'probe.txt'), 'utf8'); } catch { return null; } })();
  verdict('spawn+prompt+approve: probe.txt created via approved tool', t1.kind === 'lifecycle.turn_completed' && probeTxt !== null && probeTxt.includes('GROK-LIVE'), `content=${JSON.stringify(probeTxt)} approvals=${approvals.length}`);
  verdict('usage on wire -> budgetUsed.tokens', (t1.payload.result?.budgetUsed?.tokens ?? 0) > 0, `tokens=${t1.payload.result?.budgetUsed?.tokens}`);
  verdict('resource.tokens emitted', events.some((e) => e.kind === 'resource.tokens' && e.payload.source === 'promptMeta'));

  // ---- 2. multi-turn on the same session ----
  say('STEP 2: prompt(turn) — multi-turn');
  const mark2 = events.length;
  const p2 = await adapter.prompt('w1', 'Reply with exactly SECOND-TURN and nothing else. Do not use any tools.', 'turn');
  say(`prompt ack: ${JSON.stringify(p2)}`);
  const t2 = await waitFor((e, i) => e.kind === 'lifecycle.turn_completed' && events.indexOf(e) >= mark2, 'second turn terminal');
  verdict('multi-turn: same sessionId', t2.payload.sessionId === t1.payload.sessionId && t2.payload.turnId !== t1.payload.turnId, `${t1.payload.turnId} -> ${t2.payload.turnId}`);

  // ---- 3. steer (emulated) against a genuinely running tool turn ----
  say('STEP 3: slow tool turn, then steer mid-flight');
  const mark3 = events.length;
  await adapter.prompt('w1', 'Create files g1.txt through g20.txt in the current directory, one at a time with a separate write each, each containing its own number. Do them strictly in order.', 'turn');
  await waitFor((e) => e.kind === 'content.tool_call' && events.indexOf(e) >= mark3, 'first tool activity of slow turn');
  await delay(1500);
  const steerAck = await adapter.prompt('w1', 'Stop creating files immediately. Reply with exactly STEER-OK and nothing else. Do not use any tools.', 'steer');
  say(`steer ack: ${JSON.stringify(steerAck)}`);
  const steered = await waitFor((e) => e.kind === 'control.steer', 'control.steer');
  const t3 = await waitFor((e) => e.kind === 'lifecycle.turn_completed' && events.indexOf(e) > events.indexOf(steered), 'post-steer turn terminal');
  const noPhantom = !events.slice(mark3).some((e) => e.kind === 'control.interrupt_confirmed');
  const steerText = events.slice(events.indexOf(steered)).filter((e) => e.kind === 'content.message').map((e) => e.payload.text).join('');
  verdict('steer: emulated ack + control.steer + redirected turn completed, no phantom interrupt', steerAck.ok === true && steerAck.emulated === true && t3 && noPhantom, `post-steer text=${JSON.stringify(steerText.slice(0, 60))}`);

  // ---- 4. interrupt + session survives ----
  say('STEP 4: slow tool turn, then interrupt');
  const mark4 = events.length;
  await adapter.prompt('w1', 'Create files h1.txt through h20.txt, one at a time, each containing its own number, strictly in order.', 'turn');
  await waitFor((e) => e.kind === 'content.tool_call' && events.indexOf(e) >= mark4, 'first tool activity of interrupt-target turn');
  await delay(1200);
  const iAck = await adapter.interrupt('w1');
  say(`interrupt ack: ${JSON.stringify(iAck)}`);
  const confirmed = await waitFor((e) => e.kind === 'control.interrupt_confirmed' && events.indexOf(e) >= mark4, 'interrupt_confirmed');
  verdict('interrupt: ack immediate, confirmed via event, result cancelled', iAck.ok === true && confirmed.payload.result.status === 'cancelled');
  const mark5 = events.length;
  const p5 = await adapter.prompt('w1', 'Reply with exactly ALIVE and nothing else. Do not use any tools.', 'turn');
  const t5 = await waitFor((e) => e.kind === 'lifecycle.turn_completed' && events.indexOf(e) >= mark5, 'post-interrupt turn terminal');
  verdict('session survives interrupt', p5.ok === true && t5.payload.sessionId === t1.payload.sessionId);

  // ---- 5. kill ----
  say('STEP 5: kill');
  const kAck = await adapter.kill('w1');
  const kConf = await waitFor((e) => e.kind === 'kill.confirmed', 'kill.confirmed', 15000);
  verdict('kill: ack + kill.confirmed, no crash event from deliberate kill', kAck.ok === true && !!kConf && !events.slice(mark5).some((e) => e.kind === 'lifecycle.crashed'));
} catch (err) {
  say(`E2E error: ${err.message}`);
  verdict('run completed without harness error', false, err.message);
  try { await adapter.kill('w1'); } catch {}
}

say(`files in workdir: ${readdirSync(dir).sort().join(',')}`);
writeFileSync(`${SCRATCH}/grok-adapter-live-e2e.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
say(`ledger archived (${events.length} events)`);
console.log('\n=== VERDICTS ===');
for (const v of verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} — ${v.name}${v.note ? ` (${v.note})` : ''}`);
process.exit(verdicts.every((v) => v.ok) ? 0 : 1);
