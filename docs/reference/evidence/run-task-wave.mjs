// GENERIC SINGLE-MEMBER TASK WAVE — the ONE interim driver for single-member waves until #114
// (workflow-as-data) lands and retires the class. Composition-law aligned: no new per-wave script;
// the wave is declared by ARGS, not code. Brief-by-reference (objective stays far under the 4KiB
// cap, issue #129). Facade-only.
//
// Usage:
//   node run-task-wave.mjs --evidence <abs-or-repo-rel evidence dir> --role <role>
//     --brief <repo-rel brief file inside the evidence dir> --scope <glob> [--scope <glob>...]
//     --targets <repo-rel file> [--targets <repo-rel file>...] --verdict <NAME> --log <prefix>
//     [--harness deepseek] [--model deepseek-v4-flash] [--effort high] [--salt-prefix xx]
//     [--deadline-min 90]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../impl/src/index.mjs';

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
};
const takeAll = (flag) => {
  const out = [];
  for (let i = 0; i < args.length - 1; i += 1) if (args[i] === flag) out.push(args[i + 1]);
  return out;
};

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, take('--evidence') ?? '');
const ROLE = take('--role');
const BRIEF = take('--brief');
const SCOPES = takeAll('--scope');
const TARGETS = takeAll('--targets');
const VERDICT = take('--verdict');
const LOGP = take('--log') ?? 'task';
const HARNESS = take('--harness') ?? 'deepseek';
const MODEL = take('--model') ?? 'deepseek-v4-flash';
const EFFORT = take('--effort') ?? 'high';
const SALT_PREFIX = take('--salt-prefix') ?? 'tw';
const DEADLINE_MIN = Number(take('--deadline-min') ?? '90');

const usage = 'usage: node run-task-wave.mjs --evidence DIR --role ROLE --brief FILE --scope GLOB --targets FILE --verdict NAME [--log P] [--harness H] [--model M] [--effort E] [--salt-prefix P] [--deadline-min N]';
if (!take('--evidence') || !ROLE || !BRIEF || SCOPES.length === 0 || TARGETS.length === 0 || !VERDICT) {
  console.error(usage);
  process.exit(2);
}
if (Buffer.byteLength(BRIEF) > 3072) { console.error('brief path suspiciously long — pass a path, not content'); process.exit(2); }

mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `${SALT_PREFIX}${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[${LOGP} ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, role: ROLE, steps: [] };
const RECEIPT_PATH = resolve(EVIDENCE, `${ROLE}-receipt.json`);
const persist = () => writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const briefRel = BRIEF.startsWith('docs/') || BRIEF.startsWith('impl/') ? BRIEF : `docs/reference/evidence/${EVIDENCE.split('/').slice(-1)[0]}/${BRIEF}`;
const OBJECTIVE = [
  `[attempt: ${SALT_PREFIX}-${ATTEMPT}] Your complete brief is ${briefRel} — read it IN FULL first; it carries your read-order with verified anchors, your decisions/tasks, the campaign laws, and your deliverables. Then execute exactly.`,
  `Deliverables (edit ONLY these): ${TARGETS.join(' · ')}.`,
].join(' ');
if (Buffer.byteLength(OBJECTIVE) > 3800) { console.error(`objective ${Buffer.byteLength(OBJECTIVE)}B nears the 4096B cap — shorten targets`); process.exit(2); }

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `taskwave-${ROLE}-${SALT}`),
    routes: [{ harness: HARNESS, model: MODEL, effort: EFFORT }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: [{
      role: ROLE,
      exact: { harness: HARNESS, model: MODEL, effort: EFFORT },
      scope: SCOPES,
      objective: OBJECTIVE,
    }],
  });
  step('waves.start', { runs: [wave.runs.get(ROLE)?.id ?? null] });
  if (!wave.runs.get(ROLE)?.id) {
    step('start-refused', { reason: 'no run returned at admission — see issue #129 class' });
    receipts.verdict = `${VERDICT}-START-REFUSED`;
    persist();
    log(`verdict: ${receipts.verdict}`);
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + DEADLINE_MIN * 60_000;
    const pending = new Set([ROLE]);
    let approved = false;
    const nudged = new Set();
    const claimed = new Set();
    while (Date.now() < deadline && pending.size > 0) {
      await sleep(15_000);
      for (const role of [...pending]) {
        const handle = wave.runs.get(role);
        if (!handle?.id) { pending.delete(role); continue; }
        const view = await handle.status().catch(() => null);
        const outline = view?.view ?? view ?? {};
        const phase = outline.phase ?? outline.outline?.phase ?? null;
        const actions = view?.actions ?? outline?.actions ?? [];
        const approveAction = Array.isArray(actions) ? actions.find((a) => a?.kind === 'approve_plan') : null;
        if (approveAction && !approved) {
          approved = true;
          const result = await handle._command('run.approve', { runId: handle.id, planDigest: approveAction.planDigest }).catch((error) => ({ error: String(error?.message ?? error) }));
          step(`approve:${role}`, { result: result?.result ?? result?.error ?? 'ok' });
        }
        const attention = view?.attention ?? outline?.attention ?? [];
        const checkpoint = Array.isArray(attention) ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string') : null;
        if (checkpoint) {
          if (checkpoint.claim != null && !claimed.has(checkpoint.requestId)) {
            claimed.add(checkpoint.requestId);
            await handle.act('claim_turn', {}).catch(() => {});
          } else if (!nudged.has(checkpoint.requestId)) {
            nudged.add(checkpoint.requestId);
            await handle.act('nudge_turn', { message: 'Continue: complete the deliverable file(s) per the brief.' }).catch(() => {});
          }
        }
        const terminalStatus = view?.terminalOutcome?.status ?? outline?.terminalOutcome?.status ?? null;
        if (['work_completed', 'completed', 'result_ready'].includes(phase) || terminalStatus === 'completed') {
          pending.delete(role);
          step(`terminal:${role}`, { phase: phase ?? terminalStatus });
        } else if (['cancelled', 'failed'].includes(phase) || ['cancelled', 'failed'].includes(terminalStatus)) {
          pending.delete(role);
          step(`dead:${role}`, { phase: phase ?? terminalStatus });
        }
      }
    }
    step('loop-drained', { pending: [...pending] });
    await sleep(10_000);
    const pins = [
      ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
      ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ];
    const harvested = {};
    for (const pin of pins.slice(0, 20)) {
      if (harvested[ROLE]) continue;
      try {
        const contents = TARGETS.map((path) => {
          try { return { path, content: execFileSync('git', ['show', `${pin}:${path}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }; } catch { return null; }
        }).filter(Boolean);
        if (contents.length === 0 || contents.some((entry) => entry.content.length < 200)) continue;
        harvested[ROLE] = { pin, paths: contents.map((entry) => entry.path) };
        for (const entry of contents) writeFileSync(resolve(repo, entry.path), entry.content);
      } catch { /* not in this pin */ }
    }
    receipts.harvest = harvested;
    receipts.verdict = Object.keys(harvested).length === 1 ? `${VERDICT}-OK` : `${VERDICT}-INCOMPLETE`;
    persist();
    log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
  }
} finally {
  persist();
  if (wave) await wave.close({ reason: `${ROLE} task wave complete` }).catch(() => {});
  await baton.close().catch(() => {});
}
