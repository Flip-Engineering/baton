#!/usr/bin/env node
// fake-grok-acp.mjs — a scriptable stand-in for `grok agent stdio`, speaking the wire pinned in
// docs/reference/grok-build-cli.md: JSON-RPC 2.0 over NDJSON WITH the `jsonrpc` member (live-
// verified — unlike codex, which omits it), ACP methods (initialize / session/new /
// session/prompt / session/cancel / session/request_permission), and the [live]-verbatim
// initialize + auth-error frames from docs/reference/evidence/grok-0.1.216/grok-acp-probe2.jsonl.
// It is a protocol-level double, not a model simulation — test/grok-acp.test.mjs drives the real
// GrokAcpCli adapter end to end with zero model quota.
//
// The ACP-shaped difference from fake-codex-appserver.mjs, faithfully modeled: `session/prompt`
// is a LONG-LIVED REQUEST — its response ({stopReason}) IS the turn terminal; session/update
// notifications stream while it is pending; `session/cancel` is a NOTIFICATION (no id, no
// response) that resolves the pending prompt with stopReason:"cancelled".
//
// Scripting surface:
//   - env FAKE_GROK_UNAUTH=1    -> session/new fails with the [live]-verbatim -32000
//                                  "Authentication required" error (spawn-time auth gate, GA10).
//   - env FAKE_GROK_HANG=1      -> `initialize` received but NEVER answered (GA3 bounded setup).
//   - env FAKE_GROK_MALFORMED=1 -> after each prompt starts: one invalid-JSON line, one
//                                  unknown-method notification, one unknown sessionUpdate
//                                  variant, one synthetic id-less error (GA5/GA17).
//   - directives embedded in the prompt text (brief.goal or raw prompt() content):
//       FAKE:CRASH              -> the prompt request resolves with a JSON-RPC ERROR ("boom")
//       FAKE:REFUSAL            -> resolves {stopReason:"refusal"}
//       FAKE:REQUEST_PERMISSION -> emits session/request_permission (ACP options vocabulary) and
//                                  BLOCKS the turn until the client's outcome response arrives
//       FAKE:SERVER_UNKNOWN_REQUEST -> emits a server->client REQUEST for an x.ai/* method baton
//                                  does not map; the turn completes only once it is ANSWERED
//                                  (an error answer counts — anti-wedge, X3 lesson)
//       FAKE:STAY_OPEN          -> never resolves on its own; only session/cancel ends it
//       FAKE:REPORT_CWD         -> resolves after a chunk `cwd:<session/new cwd> oscwd:<process.cwd()>`
//                                  (phase10 SC1: proves both the wire-pinned and OS-level cwd)
//       (none)                  -> streams chunks + a tool_call, resolves {stopReason:"end_turn"}

import readline from 'node:readline';

// Discovery guard (phase8 R1): node's test runner discovers every .mjs under test/ — without the
// explicit sentinel this fixture would block forever on stdin and hang bare `node --test`.
if (!process.argv.includes('--serve') && !process.argv.includes('agent')) {
  process.exit(0);
}

const UNAUTH = process.env.FAKE_GROK_UNAUTH === '1';
const HANG = process.env.FAKE_GROK_HANG === '1';
const MALFORMED = process.env.FAKE_GROK_MALFORMED === '1';
const modelArgIndex = process.argv.indexOf('--model');
const MODEL = modelArgIndex >= 0 ? process.argv[modelArgIndex + 1] : 'grok-4.5-fake';

let sessionSeq = 0;
let serverReqSeq = 0;
let toolCallSeq = 0;
/** @type {string|null} */
let sessionId = null;
/** @type {string|null} phase10 SC1: the cwd received in session/new, echoed by FAKE:REPORT_CWD */
let sessCwd = null;
/** @type {{id:number|string, sessionId:string, timer:NodeJS.Timeout|null, stayOpen:boolean}|null} */
let activePrompt = null;
/** @type {{id:number, optionIds:Record<string,string>}|null} */
let pendingPermission = null;
/** @type {{id:number}|null} */
let pendingUnknownServerReq = null;

function send(obj) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
}

function update(update) {
  send({ method: 'session/update', params: { sessionId, update } });
}

function chunk(text) {
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
}

function textOf(prompt) {
  return (prompt ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Live-shaped usage _meta (probe #3/#4, 2026-07-10): every prompt resolution carries full token
 * accounting — the F1 correction's whole basis. */
function usageMeta(outputTokens) {
  return {
    sessionId, requestId: 'req-fake', promptId: 'req-fake',
    totalTokens: 100 + outputTokens, modelId: MODEL,
    inputTokens: 100, outputTokens, cachedReadTokens: 50, reasoningTokens: 0,
  };
}

function resolvePrompt(result) {
  if (!activePrompt) return;
  const { id, timer } = activePrompt;
  if (timer) clearTimeout(timer);
  activePrompt = null;
  if (result.result?.stopReason && !result.result._meta) {
    result = { result: { ...result.result, _meta: usageMeta(7) } };
  }
  send({ id, ...result });
}

function scheduleNaturalEnd(text, delayMs = 10) {
  const timer = setTimeout(() => {
    chunk(`done: ${text}`.slice(0, 200));
    resolvePrompt({ result: { stopReason: 'end_turn' } });
  }, delayMs);
  if (activePrompt) activePrompt.timer = timer;
}

function runPrompt(text) {
  if (MALFORMED) {
    process.stdout.write('{this-is-not-json,,,\n');
    send({ method: 'x.ai/bogus/unknownNotification', params: { noise: true } });
    update({ sessionUpdate: 'some_future_update_kind', payload: { noise: true } });
    // Synthetic id-less error (hazard modeling, GA5): must surface as an UNCORRELATED error
    // event, never be matched to the pending prompt, never crash the adapter.
    send({ error: { code: -32700, message: 'Parse error (synthetic id-less hazard)' } });
  }

  chunk(`received: ${text}`.slice(0, 120));
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking (fake)' } });

  if (text.includes('FAKE:CRASH')) {
    setTimeout(() => resolvePrompt({ error: { code: -32603, message: 'internal error: boom (scripted)' } }), 10);
    return;
  }

  if (text.includes('FAKE:REFUSAL')) {
    setTimeout(() => resolvePrompt({ result: { stopReason: 'refusal' } }), 10);
    return;
  }

  if (text.includes('FAKE:REQUEST_PERMISSION')) {
    setTimeout(() => {
      serverReqSeq += 1;
      toolCallSeq += 1;
      const toolCallId = `call-${toolCallSeq}`;
      pendingPermission = { id: serverReqSeq, optionIds: { allowOnce: 'allow-once', allowAlways: 'always-allow', rejectOnce: 'reject-once' } };
      // Phase-59 live Grok emitted the ordinary tool telemetry first, then re-announced the
      // same toolCallId in session/request_permission while awaiting approval. Keep this opt-in
      // so the older permission-first fixture shape remains covered independently.
      if (text.includes('FAKE:REQUEST_PERMISSION_AFTER_TOOL_CALL')) {
        update({ sessionUpdate: 'tool_call', toolCallId, title: 'write', rawInput: { filePath: '/fake/risky.txt', content: 'risky\n' } });
        update({ sessionUpdate: 'tool_call_update', toolCallId, title: 'Write `/fake/risky.txt`', status: 'in_progress' });
      }
      // LIVE-verbatim option list and toolCall shape (probe #4, grok 0.1.216 authenticated):
      // allow_always is FIRST — the adapter's kind-preference (allow -> allow_once) must not
      // naively take options[0].
      send({
        id: serverReqSeq,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: {
            toolCallId, kind: 'edit', title: 'Write `/fake/risky.txt`',
            rawInput: { variant: 'Write', filePath: '/fake/risky.txt', content: 'risky\n' },
          },
          options: [
            { optionId: 'always-allow', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
            { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'No, and tell Grok what to do differently', kind: 'reject_once' },
          ],
        },
      });
      // Nothing further until the client answers — this is the block (GA9).
    }, 10);
    return;
  }

  if (text.includes('FAKE:SERVER_UNKNOWN_REQUEST')) {
    setTimeout(() => {
      serverReqSeq += 1;
      pendingUnknownServerReq = { id: serverReqSeq };
      send({ id: serverReqSeq, method: 'x.ai/fs/read_text_file', params: { sessionId, path: '/fake/needs-client-fs' } });
    }, 10);
    return;
  }

  if (text.includes('FAKE:REPORT_CWD')) {
    setTimeout(() => {
      chunk(`cwd:${sessCwd} oscwd:${process.cwd()}`);
      resolvePrompt({ result: { stopReason: 'end_turn' } });
    }, 10);
    return;
  }

  if (text.includes('FAKE:STAY_OPEN')) {
    if (activePrompt) activePrompt.stayOpen = true;
    return; // only session/cancel resolves it
  }

  if (text.includes('FAKE:LARGE_TOOL_OUTPUT')) {
    const tcId = `call-${(toolCallSeq += 1)}`;
    update({
      sessionUpdate: 'tool_call_update', toolCallId: tcId, title: 'read huge fixture', status: 'completed',
      rawInput: { path: '/fake/huge.txt' }, rawOutput: { exit_code: 0, output: 'x'.repeat(128 * 1024) },
      content: [{ type: 'diff', path: '/fake/huge.txt', oldText: '', newText: 'x'.repeat(128 * 1024) }],
    });
    scheduleNaturalEnd(text);
    return;
  }

  // LIVE-shaped two-phase tool telemetry (probe #4): an initial tool_call, then a
  // tool_call_update carrying the completion status + diff content.
  const tcId = `call-${(toolCallSeq += 1)}`;
  update({ sessionUpdate: 'tool_call', toolCallId: tcId, title: 'write', rawInput: { filePath: '/fake/out.txt', content: 'x\n' } });
  if (text.includes('FAKE:STALE_PROGRESS_AFTER_COMPLETED')) {
    update({ sessionUpdate: 'tool_call_update', toolCallId: tcId, title: 'Write `/fake/out.txt`', status: 'in_progress' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: tcId, status: 'in_progress' });
  }
  update({
    sessionUpdate: 'tool_call_update', toolCallId: tcId, status: 'completed',
    content: [{ type: 'diff', path: '/fake/out.txt', oldText: '', newText: 'x\n' }],
  });
  if (text.includes('FAKE:STALE_PROGRESS_AFTER_COMPLETED')) {
    // Phase-59 live Grok replayed an older in-progress snapshot after completion.
    update({ sessionUpdate: 'tool_call_update', toolCallId: tcId, status: 'in_progress' });
  }
  scheduleNaturalEnd(text);
}

function handlePermissionResponse(obj) {
  const { optionIds } = pendingPermission;
  pendingPermission = null;
  const outcome = obj.result?.outcome;
  if (!activePrompt) return;
  if (!outcome || outcome.outcome === 'cancelled') {
    // Per ACP: a cancelled permission belongs to a cancelled turn.
    resolvePrompt({ result: { stopReason: 'cancelled' } });
    return;
  }
  if (outcome.optionId === optionIds.rejectOnce) {
    chunk('declined: skipping step');
    scheduleNaturalEnd('post-deny', 10);
    return;
  }
  update({ sessionUpdate: 'tool_call', toolCallId: `call-${(toolCallSeq += 1)}`, title: 'risky command (approved)', kind: 'execute', status: 'completed' });
  chunk('approved: proceeding');
  scheduleNaturalEnd('post-approval', 10);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }

  // A response FROM the client to one of our server->client requests (no `method` member).
  if (obj.method === undefined && obj.id !== undefined) {
    if (pendingPermission && obj.id === pendingPermission.id) { handlePermissionResponse(obj); return; }
    if (pendingUnknownServerReq && obj.id === pendingUnknownServerReq.id) {
      pendingUnknownServerReq = null;
      if (activePrompt) {
        chunk(`unwedged: client answered (error:${!!obj.error})`);
        scheduleNaturalEnd('post-unknown-request', 10);
      }
      return;
    }
    return; // stray/late response — ignore
  }

  switch (obj.method) {
    case 'initialize':
      if (HANG) return; // never respond — exercises the adapter's bounded setup RPCs (GA3)
      // [live]-shaped frame (docs/reference/evidence/grok-0.1.216/grok-acp-probe2.jsonl line 2).
      send({
        id: obj.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
            mcpCapabilities: { http: true, sse: true },
            _meta: { 'x.ai/fs_notify': true },
          },
          authMethods: [{ id: 'grok.com', name: 'Grok', description: 'Sign in with Grok' }],
          _meta: {
            grokShell: true,
            agentVersion: '0.1.216-fake',
            modelState: {
              currentModelId: 'grok-build',
              availableModels: [{ modelId: 'grok-build', name: 'Grok Build', _meta: { totalContextTokens: 500000, agentType: 'grok-build-plan' } }],
            },
            availableCommands: [
              { name: 'compact', description: 'Compress conversation history to save context window', input: { hint: 'optional context about what to preserve' } },
              { name: 'always-approve', description: 'Toggle always-approve mode (skip all permission prompts)', input: { hint: 'on|off' } },
            ],
            cancelRewind: true,
          },
        },
      });
      break;
    case 'session/new': {
      if (UNAUTH) {
        // [live]-verbatim auth gate (probe frame 4).
        send({ id: obj.id, error: { code: -32000, message: 'Authentication required', data: 'no auth method id provided' } });
        break;
      }
      sessionSeq += 1;
      // pid-namespaced (phase8 R2): one child per worker means a bare `sess-1` would collide
      // across workers and falsely fail the cross-worker isolation assertion.
      sessionId = `sess-${process.pid}-${sessionSeq}`;
      sessCwd = obj.params?.cwd ?? null;
      send({ id: obj.id, result: { sessionId } });
      break;
    }
    case 'session/load': {
      if (UNAUTH) {
        send({ id: obj.id, error: { code: -32000, message: 'Authentication required', data: 'no auth method id provided' } });
        break;
      }
      sessionId = obj.params?.sessionId ?? null;
      sessCwd = obj.params?.cwd ?? null;
      send({ id: obj.id, result: { sessionId } });
      break;
    }
    case 'session/prompt': {
      activePrompt = { id: obj.id, sessionId: obj.params?.sessionId, timer: null, stayOpen: false };
      setImmediate(() => runPrompt(textOf(obj.params?.prompt)));
      break;
    }
    case 'session/cancel': {
      // A NOTIFICATION (no id, nothing to respond to). Per ACP the outstanding prompt resolves
      // {stopReason:"cancelled"}; the session survives for further session/prompt calls.
      pendingPermission = null; // a cancelled turn abandons its pending permission ask
      pendingUnknownServerReq = null;
      resolvePrompt({ result: { stopReason: 'cancelled' } });
      break;
    }
    default:
      if (obj.id !== undefined) {
        // JSON-RPC standard method-not-found; grok's live unknown-method behavior is unprobed
        // (spec §4 note) — the standard shape is the honest default for the double.
        send({ id: obj.id, error: { code: -32601, message: `Method not found: ${obj.method}` } });
      }
  }
});

process.stdin.on('end', () => process.exit(0));
