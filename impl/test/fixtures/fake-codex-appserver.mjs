#!/usr/bin/env node
// fake-codex-appserver.mjs — a scriptable stand-in for `codex app-server`, speaking the REAL
// wire protocol pinned in docs/reference/codex-app-server.md and verified against the
// generate-json-schema bundle (method names, param/response shapes, decision vocabulary).
// It is NOT a simulation of model behavior — it is a protocol-level double so
// test/codex-appserver.test.mjs can drive the real CodexAppServerCli adapter end to end with
// zero model quota. Spawned as a child by the adapter under test: `node fake-codex-appserver.mjs`.
//
// Wire format: NDJSON, one JSON object per line, `"jsonrpc"` OMITTED (matches the live-probed
// codex 0.144.0 behavior documented in the dossier). Requests: {id, method, params}. Responses:
// {id, result} | {id, error}. Notifications: {method, params} (no id).
//
// Scripting surface (all zero-quota, no vendor CLI involved):
//   - env FAKE_CODEX_BUSY=1        -> the FIRST `thread/start` fails with a real -32001
//                                     ("Shared Codex broker is busy.") busy error, then normal.
//   - env FAKE_CODEX_HANG=1        -> `initialize` is received but NEVER answered (tests the
//                                     adapter's per-request timeout / id-less-error hazard).
//   - env FAKE_CODEX_MALFORMED=1   -> after every `turn/started`, two garbage lines are written
//                                     to stdout: one invalid-JSON line and one well-formed
//                                     unknown-method notification. Both must be silently ignored.
//   - directives embedded in the first `text` UserInput of `turn/start`/`turn/steer` input
//     (baton tests put these in `brief.goal` or the raw prompt() content):
//       FAKE:CRASH                       -> turn/completed{status:"failed"}
//       FAKE:REQUEST_APPROVAL:command    -> emits item/commandExecution/requestApproval and
//                                           BLOCKS the turn until the client responds
//       FAKE:REQUEST_APPROVAL:fileChange -> same, item/fileChange/requestApproval
//       FAKE:SERVER_UNKNOWN_REQUEST      -> emits a server->client REQUEST with a method baton
//                                           does not map (anti-wedge: the adapter must ANSWER it,
//                                           an error response is fine — the turn completes only
//                                           once the response arrives)
//       FAKE:REQUEST_QUESTION            -> emits item/tool/requestUserInput and blocks
//       FAKE:STAY_OPEN                   -> the turn does NOT auto-complete; it only ends via
//                                           turn/interrupt (-> status "interrupted", thread
//                                           survives) or turn/steer (steer forces completion
//                                           shortly after, proving the steer took effect)
//       FAKE:REPORT_CWD                  -> completes with an agentMessage `cwd:<thread/start cwd>`
//                                           (phase10 SC1: proves which cwd the thread was pinned to)
//       (none of the above)              -> completes normally ~10ms later, status "completed"

import readline from 'node:readline';

// Discovery guard (phase8 cross-cluster reconciliation R1): Node's test runner discovers
// EVERY .mjs file under test/ (node 25), including this fixture, and would execute it as a
// test file — where it blocks forever reading stdin and hangs the bare `node --test` run.
// The adapter tests spawn this fixture with an explicit `--serve` sentinel (mirroring the
// real default args ['app-server']); absent both, we were swept up by discovery: exit inert.
if (!process.argv.includes('--serve') && !process.argv.includes('app-server')) {
  process.exit(0);
}

const BUSY = process.env.FAKE_CODEX_BUSY === '1';
const HANG = process.env.FAKE_CODEX_HANG === '1';
const MALFORMED = process.env.FAKE_CODEX_MALFORMED === '1';

let busyConsumed = false;
let threadSeq = 0;
let turnSeq = 0;
let serverReqSeq = 0;
/** @type {string|null} */
let threadId = null;
/** @type {string|null} phase10 SC1: the cwd received in thread/start, echoed by FAKE:REPORT_CWD */
let threadCwd = null;
/** @type {{id:string, timer:NodeJS.Timeout|null}|null} */
let activeTurn = null;
/** @type {{id:number, kind:'command'|'fileChange', turnId:string}|null} */
let pendingApproval = null;
/** @type {{id:number, turnId:string, qid:string}|null} */
let pendingQuestion = null;
/** @type {{id:number, turnId:string|null}|null} */
let pendingUnknownServerReq = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function notify(method, params) {
  send({ method, params });
}

function textOf(input) {
  return (input ?? [])
    .filter((i) => i.type === 'text')
    .map((i) => i.text)
    .join('\n');
}

function itemCompleted(turnId, item) {
  notify('item/completed', { threadId, turnId, item });
}

function itemStarted(turnId, item) {
  notify('item/started', { threadId, turnId, item });
}

function finishTurn(turnId, patch) {
  if (activeTurn && activeTurn.timer) clearTimeout(activeTurn.timer);
  notify('turn/completed', {
    threadId,
    turn: { id: turnId, status: 'completed', items: [], startedAt: Date.now(), completedAt: Date.now(), ...patch },
  });
  activeTurn = null;
}

function scheduleNaturalCompletion(turnId, text, delayMs = 10) {
  const timer = setTimeout(() => {
    itemCompleted(turnId, { id: `${turnId}-msg`, type: 'agentMessage', text: `done: ${text}`.slice(0, 200) });
    notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: { totalTokens: 42, inputTokens: 30, cachedInputTokens: 0, outputTokens: 12, reasoningOutputTokens: 0 } } });
    finishTurn(turnId, { status: 'completed', usage: { input_tokens: 30, output_tokens: 12 } });
  }, delayMs);
  if (activeTurn) activeTurn.timer = timer;
}

function runTurn(turnId, input) {
  const text = textOf(input);
  notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });

  if (MALFORMED) {
    process.stdout.write('{not-valid-json,,,\n');
    notify('bogus/unknownNotification', { whatever: true });
    // SYNTHETIC id-less error (hazard modeling, not a live-pinned behavior): a server that
    // cannot recover an id from a broken inbound line has nothing to correlate a rejection to.
    // The adapter must surface it as an uncorrelated error event and let the real pending
    // request(s) time out on their own deadline — never speculatively match it (XA5).
    send({ error: { code: -32700, message: 'Parse error (synthetic id-less hazard)' } });
  }

  itemCompleted(turnId, { id: `${turnId}-ack`, type: 'agentMessage', text: `received: ${text}`.slice(0, 200) });

  if (text.includes('FAKE:CRASH')) {
    setTimeout(() => finishTurn(turnId, { status: 'failed', error: { message: 'boom (scripted)' } }), 10);
    return;
  }

  const approvalMatch = text.match(/FAKE:REQUEST_APPROVAL:(command|fileChange)/);
  if (approvalMatch) {
    const kind = approvalMatch[1];
    setTimeout(() => {
      const itemId = `${turnId}-approval-item`;
      if (kind === 'command') {
        itemStarted(turnId, { id: itemId, type: 'commandExecution', command: 'rm -rf /tmp/fake-risky', aggregatedOutput: '', exitCode: null, status: 'in_progress' });
        serverReqSeq += 1;
        pendingApproval = { id: serverReqSeq, kind, turnId, itemId };
        send({ id: serverReqSeq, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId, startedAtMs: Date.now(), command: 'rm -rf /tmp/fake-risky', cwd: '/work', reason: 'destructive command' } });
      } else {
        itemStarted(turnId, { id: itemId, type: 'fileChange', status: 'in_progress' });
        serverReqSeq += 1;
        pendingApproval = { id: serverReqSeq, kind, turnId, itemId };
        send({ id: serverReqSeq, method: 'item/fileChange/requestApproval', params: { threadId, turnId, itemId, startedAtMs: Date.now(), reason: 'writes outside scope' } });
      }
      // No further items/turn-completion until the client answers — this is the block.
    }, 10);
    return;
  }

  if (text.includes('FAKE:REQUEST_QUESTION')) {
    setTimeout(() => {
      const itemId = `${turnId}-question-item`;
      const qid = 'q1';
      serverReqSeq += 1;
      pendingQuestion = { id: serverReqSeq, turnId, qid };
      send({ id: serverReqSeq, method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId, questions: [{ id: qid, header: 'Approach', question: 'Which approach should I take?' }] } });
    }, 10);
    return;
  }

  if (text.includes('FAKE:SERVER_UNKNOWN_REQUEST')) {
    // Fires a server->client REQUEST whose method baton does not map
    // (item/permissions/requestApproval is REAL in the 0.144.0 schema but outside the adapter's
    // mapped table). A JSON-RPC request left unanswered wedges its turn forever — the adapter
    // must reply (an error response is fine), never silently ignore. The turn completes ONLY
    // once the client's response arrives (see the client-response branch in the line handler).
    setTimeout(() => {
      serverReqSeq += 1;
      pendingUnknownServerReq = { id: serverReqSeq, turnId };
      send({ id: serverReqSeq, method: 'item/permissions/requestApproval', params: { threadId, turnId, itemId: 'perm-item-1', reason: 'unmapped-by-baton request kind' } });
    }, 10);
    return;
  }

  if (text.includes('FAKE:REPORT_CWD')) {
    setTimeout(() => {
      itemCompleted(turnId, { id: `${turnId}-cwd`, type: 'agentMessage', text: `cwd:${threadCwd}` });
      finishTurn(turnId, { status: 'completed' });
    }, 10);
    return;
  }

  if (text.includes('FAKE:STAY_OPEN')) {
    // Stays open until turn/interrupt or turn/steer arrives; no auto-completion timer.
    return;
  }

  scheduleNaturalCompletion(turnId, text);
}

function handleSteer(input) {
  if (!activeTurn) return;
  const turnId = activeTurn.id;
  const steerText = textOf(input);
  itemCompleted(turnId, { id: `${turnId}-steer`, type: 'agentMessage', text: `STEERED: ${steerText}`.slice(0, 200) });
  // Steering forces the turn to wrap up shortly after, proving the redirection took effect —
  // even a STAY_OPEN turn completes once steered (the scripted proof that steer altered output).
  scheduleNaturalCompletion(turnId, `after-steer:${steerText}`, 15);
}

function handleInterrupt(turnId) {
  if (activeTurn && activeTurn.timer) clearTimeout(activeTurn.timer);
  notify('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted', items: [], startedAt: Date.now(), completedAt: Date.now() } });
  activeTurn = null; // the THREAD survives; a later turn/start on the same threadId is honored.
}

function handleApprovalResponse(obj) {
  const { kind, turnId, itemId } = pendingApproval;
  pendingApproval = null;
  const decision = obj.result?.decision;
  if (decision === 'cancel') {
    finishTurn(turnId, { status: 'interrupted' });
    return;
  }
  const itemType = kind === 'command' ? 'commandExecution' : 'fileChange';
  if (decision === 'decline') {
    itemCompleted(turnId, { id: itemId, type: itemType, status: 'declined' });
    itemCompleted(turnId, { id: `${turnId}-declined-msg`, type: 'agentMessage', text: 'declined: skipping step' });
  } else {
    itemCompleted(turnId, { id: itemId, type: itemType, status: 'completed', exitCode: 0, aggregatedOutput: 'ok' });
    itemCompleted(turnId, { id: `${turnId}-approved-msg`, type: 'agentMessage', text: 'approved: proceeding' });
  }
  scheduleNaturalCompletion(turnId, 'post-approval', 10);
}

function handleQuestionResponse(obj) {
  const { turnId, qid } = pendingQuestion;
  pendingQuestion = null;
  const answers = obj.result?.answers ?? {};
  const answerText = (answers[qid]?.answers ?? []).join(', ');
  itemCompleted(turnId, { id: `${turnId}-answered-msg`, type: 'agentMessage', text: `answered: ${answerText}` });
  scheduleNaturalCompletion(turnId, 'post-answer', 10);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }

  // A response FROM the client to one of our server->client requests (no `method` field).
  if (obj.method === undefined && obj.id !== undefined) {
    if (pendingApproval && obj.id === pendingApproval.id) { handleApprovalResponse(obj); return; }
    if (pendingQuestion && obj.id === pendingQuestion.id) { handleQuestionResponse(obj); return; }
    if (pendingUnknownServerReq && obj.id === pendingUnknownServerReq.id) {
      // The client ANSWERED the unmapped request (an error response counts — the point is it
      // did not leave the request dangling). Reward: the blocked turn now completes.
      const { turnId } = pendingUnknownServerReq;
      pendingUnknownServerReq = null;
      if (turnId && activeTurn && activeTurn.id === turnId) {
        itemCompleted(turnId, { id: `${turnId}-unwedged-msg`, type: 'agentMessage', text: `unwedged: client answered (error:${!!obj.error})` });
        scheduleNaturalCompletion(turnId, 'post-unknown-request', 10);
      }
      return;
    }
    return; // stray/late response — ignore
  }

  switch (obj.method) {
    case 'initialize':
      if (HANG) return; // deliberately never respond — exercises the adapter's request timeout
      send({ id: obj.id, result: { userAgent: 'fake-codex-appserver/0.0.0-fake (test)', codexHome: '/fake/.codex', platformFamily: 'unix', platformOs: 'fake' } });
      break;
    case 'initialized':
      notify('remoteControl/status/changed', { status: 'disabled', serverName: 'fake-codex-appserver', installationId: 'fake-install' });
      break;
    case 'thread/start': {
      if (BUSY && !busyConsumed) {
        busyConsumed = true;
        send({ id: obj.id, error: { code: -32001, message: 'Shared Codex broker is busy.' } });
        break;
      }
      threadSeq += 1;
      // pid-namespaced (phase8 reconciliation R2): the adapter spawns ONE child per worker
      // (XA1), so a plain `thread-${threadSeq}` would collide across workers (every child
      // mints "thread-1"), falsely failing XA1's cross-worker threadId inequality assertion.
      threadId = `thread-${process.pid}-${threadSeq}`;
      threadCwd = obj.params?.cwd ?? null;
      send({
        id: obj.id,
        result: {
          thread: { id: threadId, sessionId: threadId, cwd: obj.params?.cwd ?? '/work', cliVersion: '0.144.0-fake', createdAt: Date.now(), updatedAt: Date.now(), ephemeral: true, source: 'appServer', status: { type: 'idle' }, turns: [], modelProvider: 'fake' },
          model: 'fake-model', modelProvider: 'fake', cwd: obj.params?.cwd ?? '/work',
          sandbox: obj.params?.sandbox ?? 'workspace-write', approvalPolicy: obj.params?.approvalPolicy ?? 'never',
          approvalsReviewer: 'user', instructionSources: [],
        },
      });
      break;
    }
    case 'turn/start': {
      turnSeq += 1;
      const turnId = `turn-${turnSeq}`;
      activeTurn = { id: turnId, timer: null };
      send({ id: obj.id, result: { turn: { id: turnId, status: 'inProgress', items: [], itemsView: 'full', startedAt: Date.now() } } });
      setImmediate(() => runTurn(turnId, obj.params.input));
      break;
    }
    case 'turn/steer': {
      const { expectedTurnId } = obj.params;
      if (!activeTurn || activeTurn.id !== expectedTurnId) {
        // Live-probed shape (codex 0.144.0, 2026-07-10): a stale/mismatched steer fails with an
        // ID-MATCHED -32600 carrying this exact message form — NOT the -32010 this fixture
        // previously invented.
        send({ id: obj.id, error: { code: -32600, message: `expected active turn id \`${expectedTurnId}\` but found \`${activeTurn ? activeTurn.id : '(none)'}\`` } });
        break;
      }
      send({ id: obj.id, result: { turnId: activeTurn.id } });
      handleSteer(obj.params.input);
      break;
    }
    case 'turn/interrupt': {
      send({ id: obj.id, result: {} });
      handleInterrupt(obj.params.turnId);
      break;
    }
    default:
      // Live-probed (codex 0.144.0, 2026-07-10): an unknown method gets an ID-MATCHED -32600
      // ("Invalid request: unknown variant `X`, expected one of `initialize`, ..."), not the
      // id-less error this fixture previously claimed. Id-less errors remain a modeled hazard
      // for lines the server cannot correlate — see the MALFORMED branch in runTurn.
      send({ id: obj.id, error: { code: -32600, message: `Invalid request: unknown variant \`${obj.method}\`, expected one of \`initialize\`, \`thread/start\`, \`turn/start\`` } });
  }
});

process.stdin.on('end', () => process.exit(0));
