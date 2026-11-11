// #94 RING 3 ACCEPTANCE — a dynamic multi-agent workflow executed as a SCRIPTED WORKFLOW
// THROUGH THE BATON SURFACE (the openBaton deployment facade ONLY). The operator law
// (docs/PROGRESS.md:391): no new orchestration wave may require a new script file reaching
// the kernel — this script holds ONE openBaton facade and nothing else. The static assertion
// at the end greps this file's workflow code for kernel reaches and records the result.
//
// THE WORKFLOW (eight steps, every verb a facade command):
//   1. waves.start          — 4 heterogeneous members (glm lead+grammar, deepseek cli+mcp)
//   2. board.post ×4        — per-member bound boards, each carrying that member's assignment
//   3. knowledge.seed ×4    — the canary, one per member run horizon
//   4. status→approve loop  — facade plan approvals + checkpoint steering (act nudge/claim)
//   5. message.send/receipt — orchestrator status query per member; workers reply MESSAGE_SEND
//   6. scratchpad.read/elevate — task→shared promotion mid-flight, per member
//   7. attention+answer     — the lead's DECISION_REQUEST synthesis gate, answered by the driver
//   8. harvest + verdict    — result pins (local git tooling), per-lane receipts, the audit bundle
//
// Cross-member note (receipted, issue #96): horizons are per-run today — the driver re-seeds
// the synthesis pointer into the lead's horizon via knowledge.seed (orchestrator-mediated
// cross-pollination; the automatic workflow tier is the filed gap).
//
// Facade call shapes (all surface): baton.waves.start; wave.runs.get(role) → BatonRun handle;
// handle.status() / handle.act(action, inputs) / handle.answer(requestId, answer) /
// handle._command(name, args) for the sugarless lanes (message.send/receipt, scratchpad.*,
// board.*, knowledge.seed, run.approve).
//
// Usage: node run-dynamic-workflow.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dynamic-workflow-2026-08-03');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `dw${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const CANARY = `COPPER-FOXNIFE-${String(Date.now() % 90_000 + 10_000)}`;
const log = (line) => console.log(`[dw ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const receipts = { attempt: ATTEMPT, salt: SALT, canary: CANARY, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'dynamic-workflow-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => {
  receipts.steps.push({ step: name, receipt: receipt ?? null });
  persist();
  log(`step ${name}: ${JSON.stringify(receipt)?.slice(0, 160) ?? 'done'}`);
};

const DIALECTS = Object.freeze({
  cli: Object.freeze({
    seat: Object.freeze({ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }),
    survey: [
      'Audit the CLI dialect for an orchestrating AGENT (not a human): read impl/CLI.md,',
      'impl/scripts/baton.mjs (small), and impl/src/application-cli.mjs verb regions (grep -an',
      'for verb spellings + sed -n regions; the file is large). Judge: JSON-only stdout discipline,',
      'verb discoverability, error shapes, the new stderr brand faces, and what an agent must LEARN',
      'before its first successful call.',
    ].join(' '),
    report: 'cli-surface-audit.md',
  }),
  mcp: Object.freeze({
    seat: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    survey: [
      'Audit the MCP dialect for an orchestrating AGENT: read impl/MCP.md,',
      'impl/src/mcp-descriptor.mjs (small), and the initialize/tool-table region of',
      'impl/src/mcp-northbound.mjs (grep -an + sed -n; large file). Judge: tool discoverability',
      '(which surface a default client sees), closed schemas, the six new workflow-surface tools,',
      'the initialize instructions line, and the ordinary-vs-combined surface split.',
    ].join(' '),
    report: 'mcp-surface-audit.md',
  }),
  grammar: Object.freeze({
    seat: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    survey: [
      'Audit the WIRE-GRAMMAR dialect for an orchestrating AGENT and for WORKERS: the six scanner',
      'grammars in impl/src/claude-session.mjs:60-240 (grep -an "scanFor" + sed -n regions — the',
      'file contains NUL bytes, never open it whole). Judge: grammar discovery (how does a worker',
      'LEARN the six wire shapes today?), closed-shape refusals, identity derivation, and the',
      'consistency of the four worker lanes (decision/scratchpad/read/message) with the two board lanes.',
    ].join(' '),
    report: 'grammar-surface-audit.md',
  }),
});

const wirePreamble = (role, keys, boardName) => [
  `[attempt: dw-${ATTEMPT}] You are the ${role} in a baton scripted dynamic workflow — a live control-surface audit of baton BY baton workers, coordinated entirely through the surface.`,
  'Five wire lanes are live for you. Each is TEXT you print, never a tool you call. Print wire lines ONE per assistant message, exactly in these shapes (fill the ... parts):',
  `SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"..."},"expectedFence":"current","idempotencyKey":"${keys.note}"}`,
  `CONTEXT_READ: {"query":{"kind":"board","board":"${boardName}"},"expectedFence":"current","idempotencyKey":"${keys.board}"}`,
  `CONTEXT_READ: {"query":{"kind":"knowledge","text":"acceptance canary"},"expectedFence":"current","idempotencyKey":"${keys.knowledge}"}`,
  'MESSAGE_SEND: {"inReplyTo":"message:<64 lowercase hex from the message frame>","body":"..."}',
  'Rules: TURN 1 — print the SCRATCHPAD_WRITE note first (it is your liveness artifact), then the board CONTEXT_READ; your assignment arrives as a framed nudge. Mid-work the orchestrator sends you a MESSAGE (kind query) asking you to acknowledge with the word BLUE — print BLUE and the MESSAGE_SEND reply line naming that message\'s id in your next assistant message. If a CONTEXT_READ answer arrives without what you asked for, continue other work and re-emit it once with idempotencyKey suffixed -2 in a later turn. Never invent content: quote only what actually arrived, and say plainly what did not.',
].join(' ');

const surveyorObjective = (roleKey, dialect) => [
  wirePreamble(`${roleKey} surveyor`, { note: `${SALT}-${roleKey}-note`, board: `${SALT}-${roleKey}-board`, knowledge: `${SALT}-${roleKey}-kg` }, `board-${SALT}-${roleKey}`),
  `Your audit task: ${dialect.survey}`,
  `Deliverable (FINAL turns only, after the survey is real): write docs/reference/evidence/dynamic-workflow-2026-08-03/${dialect.report} with three sections (The dialect / Frictions found / Recommendations), grounded in file:line references, quoting the board assignment you received and the knowledge canary phrase (form WORD-WORD-NUMBER) exactly as they arrived. Work in ONE continuous flow until the report is complete.`,
].join(' ');

const leadObjective = [
  wirePreamble('workflow LEAD', { note: `${SALT}-lead-note`, board: `${SALT}-lead-board`, knowledge: `${SALT}-lead-kg` }, `board-${SALT}-lead`),
  'You coordinate the audit. After your board read, mint TWO further SCRATCHPAD_WRITE notes (kind note) with your own observations about the workflow itself (the wire lanes, the coordination). When the orchestrator\'s message tells you the three surveyors have delivered their sections, gate on an orchestrator decision BEFORE synthesizing — print exactly one DECISION_REQUEST line:',
  `DECISION_REQUEST: {"question":"The surveyors have delivered. May I synthesize the final control-surface audit now?","options":[{"id":"synthesize","label":"Synthesize now from the shared tier and sections"},{"id":"wait","label":"Hold — more evidence is coming"}],"allowFreeResponse":false,"deadlineMs":1800000}`,
  'When the answer arrives: CONTEXT_READ the knowledge tier again (re-emit with idempotencyKey',
  `${SALT}-lead-kg-2), then read the three section files in the evidence dir of this repo (docs/reference/evidence/dynamic-workflow-2026-08-03/ — cli-surface-audit.md, mcp-surface-audit.md, grammar-surface-audit.md, if present in your checkout), and write docs/reference/evidence/dynamic-workflow-2026-08-03/control-surface-audit.md: four sections (The four dialects / Cross-cutting frictions / This workflow as evidence / Recommendations), citing at least one finding per dialect and the knowledge canary phrase verbatim.`,
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `dynamic-workflow-${SALT}`),
    routes: [
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
const memberHandles = new Map();
try {
  // STEP 1 — the wave (facade verb: waves.start).
  wave = await baton.waves.start({
    members: [
      { role: 'lead', exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-03/**'], objective: leadObjective },
      { role: 'cli-surveyor', exact: { ...DIALECTS.cli.seat }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-03/**'], objective: surveyorObjective('cli', DIALECTS.cli) },
      { role: 'mcp-surveyor', exact: { ...DIALECTS.mcp.seat }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-03/**'], objective: surveyorObjective('mcp', DIALECTS.mcp) },
      { role: 'grammar-surveyor', exact: { ...DIALECTS.grammar.seat }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-03/**'], objective: surveyorObjective('grammar', DIALECTS.grammar) },
    ],
  });
  for (const role of ['lead', 'cli-surveyor', 'mcp-surveyor', 'grammar-surveyor']) {
    memberHandles.set(role, wave.runs.get(role) ?? null);
  }
  step('waves.start', { runs: Object.fromEntries([...memberHandles].map(([role, handle]) => [role, handle?.id ?? null])) });

  // STEP 2 — per-member bound boards carrying each assignment (facade verb: run.board.post —
  // the first post binds the board to the member's run, in-binding for its reads).
  for (const [roleKey, dialect] of Object.entries(DIALECTS)) {
    const handle = memberHandles.get(`${roleKey}-surveyor`);
    if (!handle?.id) continue;
    const posted = await handle._command('run.board.post', {
      runId: handle.id, board: `board-${SALT}-${roleKey}`,
      title: `workstream: ${roleKey}-surface audit`,
      detail: `Survey the ${roleKey} control-surface dialect and write ${dialect.report}. ${dialect.survey.slice(0, 120)}…`,
    }).catch((error) => ({ error: String(error?.message ?? error) }));
    step(`board.post:${roleKey}`, { result: posted?.result ?? posted?.error ?? posted?.ok ?? null });
  }
  const leadHandle = memberHandles.get('lead');
  const leadPosted = await leadHandle._command('run.board.post', {
    runId: leadHandle.id, board: `board-${SALT}-lead`,
    title: 'workstream: workflow LEAD',
    detail: 'Coordinate the audit: mint observations, gate synthesis on an orchestrator decision, then write control-surface-audit.md from the shared tier and the three sections.',
  }).catch((error) => ({ error: String(error?.message ?? error) }));
  step('board.post:lead', { result: leadPosted?.result ?? leadPosted?.error ?? leadPosted?.ok ?? null });

  // STEP 3 — the canary, one knowledge seed per member run horizon (facade verb: run.knowledge.seed).
  for (const [role, handle] of memberHandles) {
    if (!handle?.id) continue;
    const seeded = await handle._command('run.knowledge.seed', {
      runId: handle.id, type: 'Finding', grounding: 'observed',
      body: `acceptance canary: the acceptance canary phrase is ${CANARY}. Seeded by the orchestrator to prove the BD3-A read lane serves run-horizon knowledge to the ${role}.`,
    }).catch((error) => ({ error: String(error?.message ?? error) }));
    step(`knowledge.seed:${role}`, { result: seeded?.result ?? seeded?.error ?? null });
  }

  // STEPS 4-7 — the orchestration loop (all facade verbs through the member handles).
  const deadline = Date.now() + 60 * 60_000;
  const pending = new Set([...memberHandles.keys()]);
  const approved = new Set();
  const messaged = new Map();
  const elevated = new Set();
  const nudged = new Set();
  const claimed = new Set();
  let leadDecisionAnswered = false;
  let surveyorsDoneSignaled = false;
  while (Date.now() < deadline && pending.size > 0) {
    await sleep(15_000);
    for (const role of [...pending]) {
      const handle = memberHandles.get(role);
      if (!handle?.id) { pending.delete(role); continue; }
      const view = await handle.status().catch(() => null);
      const outline = view?.view ?? view ?? {};
      const phase = outline.phase ?? outline.outline?.phase ?? null;
      const actions = view?.actions ?? outline?.actions ?? [];
      // Facade plan approval (the advertised action carries the digest).
      const approveAction = Array.isArray(actions) ? actions.find((action) => action?.kind === 'approve_plan') : null;
      if (approveAction && !approved.has(role)) {
        approved.add(role);
        const approvedResult = await handle._command('run.approve', { runId: handle.id, planDigest: approveAction.planDigest }).catch((error) => ({ error: String(error?.message ?? error) }));
        step(`approve:${role}`, { result: approvedResult?.result ?? approvedResult?.error ?? 'ok' });
      }
      // Checkpoint steering through the facade (nudge once, claim once, per requestId).
      const attention = view?.attention ?? outline?.attention ?? [];
      const checkpoint = Array.isArray(attention)
        ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string')
        : null;
      if (checkpoint) {
        if (checkpoint.claim != null && !claimed.has(checkpoint.requestId)) {
          claimed.add(checkpoint.requestId);
          await handle.act('claim_turn', {}).catch(() => {});
        } else if (!nudged.has(checkpoint.requestId)) {
          nudged.add(checkpoint.requestId);
          await handle.act('nudge_turn', { message: 'Continue to completion: finish the survey and write the deliverable.' }).catch(() => {});
        }
      }
      // The lead's decision gate (facade attention + run.answer).
      const decision = Array.isArray(attention)
        ? attention.find((entry) => entry?.kind === 'answer_decision' && typeof entry?.requestId === 'string')
        : null;
      if (decision && !leadDecisionAnswered) {
        leadDecisionAnswered = true;
        const answered = await handle.answer(decision.requestId, { optionId: 'synthesize' }).catch((error) => ({ error: String(error?.message ?? error) }));
        step('answer:lead-synthesis-gate', { requestId: decision.requestId, answer: 'synthesize', result: answered?.result ?? answered?.error ?? 'ok' });
      }
      // Status query per member once live (facade verbs: message.send → receipt). #97: a member
      // still spawning throws/returns not-active — retry on later loops; only a real messageId marks sent.
      const taskRow = (view?.task ?? outline?.task ?? {});
      if (!messaged.has(role) && (phase === 'running' || taskRow?.status === 'working' || approved.has(role))) {
        const sent = await handle._command('run.message.send', {
          runId: handle.id, kind: 'query',
          body: `status check for the ${role}: reply via MESSAGE_SEND (the id is in this frame) with your progress, and print BLUE to acknowledge.`,
        }).catch((error) => ({ error: String(error?.message ?? error) }));
        if (typeof sent?.messageId === 'string') {
          messaged.set(role, sent.messageId);
          step(`message.send:${role}`, { messageId: sent.messageId });
        } else {
          step(`message.send-deferred:${role}`, { reason: sent?.result ?? sent?.error ?? 'not-ready' });
        }
      }
      // Mid-flight elevation (facade verbs: scratchpad.read → elevate). The status view carries
      // the binding at top level: view.taskId / view.workerId (verified live against the retry-3 run).
      if (!elevated.has(role) && role !== 'lead') {
        const taskId = view?.taskId ?? outline?.taskId ?? null;
        const workerId = view?.workerId ?? outline?.workerId ?? null;
        const workerScope = workerId ? `worker:${workerId}` : null;
        const slice = (taskId && workerScope)
          ? await handle._command('run.scratchpad.read', { runId: handle.id, scope: workerScope, cursor: 0 }).catch(() => null)
          : null;
        const notes = (slice?.entries ?? []).filter((entry) => entry?.kind === 'note');
        if (taskId && notes.length > 0) {
          const elevatedResult = await handle._command('run.scratchpad.elevate', {
            runId: handle.id, taskId, entryIds: notes.slice(0, 3).map((entry) => entry.entryId),
          }).catch((error) => ({ error: String(error?.message ?? error) }));
          elevated.add(role);
          step(`elevate:${role}`, { result: elevatedResult?.result ?? elevatedResult?.error ?? null, elevated: elevatedResult?.elevated?.length ?? null });
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
    // When all three surveyors are done, signal the lead to gate (facade verbs: knowledge.seed
    // pointer + message.send).
    const surveyorsDone = ['cli-surveyor', 'mcp-surveyor', 'grammar-surveyor'].every((role) => !pending.has(role));
    if (surveyorsDone && !surveyorsDoneSignaled && pending.has('lead')) {
      surveyorsDoneSignaled = true;
      await leadHandle._command('run.knowledge.seed', {
        runId: leadHandle.id, type: 'Finding', grounding: 'derived',
        body: `The three surveyors (cli, mcp, grammar) have delivered their section files and their findings were elevated to their shared tiers by the orchestrator. The synthesis gate is yours: DECISION_REQUEST when ready, then read the section files and the knowledge tier.`,
      }).catch(() => null);
      const sent = await leadHandle._command('run.message.send', {
        runId: leadHandle.id, kind: 'query',
        body: 'All three surveyors have delivered their sections and their findings are elevated. The synthesis gate is yours: DECISION_REQUEST when you are ready, exactly as your brief shows.',
      }).catch(() => null);
      step('message.send:lead-synthesis-signal', { messageId: sent?.messageId ?? null });
    }
  }
  step('loop-drained', { pending: [...pending], answered: leadDecisionAnswered, messaged: [...messaged.keys()] });

  // STEP 8 — harvest + verdict. Pins carry Baton-Task trailers, never the salt — match by
  // CONTENT: a member's report quotes the canary (and its salted idempotency keys), so probe
  // result pins then checkpoint pins for the four report files and accept content naming the
  // canary. (The #99 run.result() accessor would make this a surface call; today it's git tooling.)
  await sleep(10_000);
  const pinRefs = [
    ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ];
  const memberReports = {};
  for (const pin of pinRefs.slice(0, 16)) {
    for (const name of ['cli-surface-audit.md', 'mcp-surface-audit.md', 'grammar-surface-audit.md', 'control-surface-audit.md']) {
      if (memberReports[name]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:docs/reference/evidence/dynamic-workflow-2026-08-03/${name}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (!content.includes(CANARY) && !content.includes(SALT)) continue;
        memberReports[name] = { pin, bytes: content.length, canary: content.includes(CANARY), blue: /\bBLUE\b/u.test(content) };
        writeFileSync(resolve(EVIDENCE, name), content);
      } catch { /* not in this pin */ }
    }
  }
  const receiptsOut = {};
  for (const [role, messageId] of messaged) {
    const handle = memberHandles.get(role);
    receiptsOut[role] = (messageId && handle)
      ? await handle._command('run.message.receipt', { messageId }).catch(() => null)
      : null;
  }
  step('message.receipts', Object.fromEntries(Object.entries(receiptsOut).map(([role, receipt]) => [role, {
    delivered: receipt?.delivered ?? null, read: receipt?.read ?? null, reply: receipt?.reply?.body?.slice(0, 80) ?? null,
  }])));

  const reportsFound = Object.keys(memberReports);
  const verdict = pending.size === 0
    && reportsFound.includes('control-surface-audit.md')
    && Object.values(memberReports).some((report) => report.canary)
    && Object.values(memberReports).some((report) => report.blue)
    && leadDecisionAnswered
    ? 'DYNAMIC-WORKFLOW-OK' : 'DYNAMIC-WORKFLOW-INCOMPLETE';
  receipts.verdict = {
    verdict,
    reports: memberReports,
    leadDecisionAnswered,
    elevated: [...elevated],
    checks: {
      allMembersDrained: pending.size === 0,
      synthesisReport: reportsFound.includes('control-surface-audit.md'),
      canaryQuoted: Object.values(memberReports).some((report) => report.canary),
      blueAcknowledged: Object.values(memberReports).some((report) => report.blue),
      decisionGateAnswered: leadDecisionAnswered,
    },
  };
  persist();
  log(`verdict: ${verdict} — reports: ${reportsFound.join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'dynamic-workflow acceptance complete' }).catch(() => {});
  await baton.close().catch(() => {});
}

// THE STATIC ASSERTION (WS-01's law, self-demonstrating): the WORKFLOW CODE above must contain
// no kernel reach — no createDriver call, no direct kernel module import, no driver/coordinator/
// coordination field access, no dynamic import. Grep the workflow portion of this file (above
// this block), comment lines stripped, and record the result.
const self = readFileSync(new URL(import.meta.url), 'utf8');
const workflowCode = self.split('// THE STATIC ASSERTION')[0]
  .split('\n').filter((line) => !/^\s*\/\//u.test(line) && !/^\s*\*/u.test(line)).join('\n');
const banned = [
  { name: 'createDriver-call', pattern: /\bcreateDriver\s*\(/u },
  { name: 'kernel-module-import', pattern: /from '[^']*(coordinator|coordination-store)\.mjs'/u },
  { name: 'driver-field', pattern: /\.driver\b/u },
  { name: 'coordinator-field', pattern: /\.coordinator\b/u },
  { name: 'coordination-field', pattern: /\.coordination\b/u },
  { name: 'dynamic-import', pattern: /import\s*\(/u },
];
const violations = banned.flatMap(({ name, pattern }) => {
  const match = pattern.exec(workflowCode);
  return match ? [{ rule: name, excerpt: workflowCode.slice(Math.max(0, match.index - 40), match.index + 40) }] : [];
});
receipts.staticAssertion = { clean: violations.length === 0, violations };
persist();
log(`static assertion: ${violations.length === 0 ? 'CLEAN (zero kernel reaches)' : `VIOLATIONS: ${JSON.stringify(violations)}`}`);
log(receipts.verdict?.verdict === 'DYNAMIC-WORKFLOW-OK' && violations.length === 0 ? 'DYNAMIC-WORKFLOW-OK' : 'DYNAMIC-WORKFLOW-INCOMPLETE');
