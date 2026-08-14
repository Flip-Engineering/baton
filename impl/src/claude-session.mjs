// claude-session.mjs — ClaudeSessionCli: a REAL Claude Code worker driven as a persistent session
// over `--input-format stream-json` / `--output-format stream-json`, instead of the one-shot
// `claude -p` child in cli-adapters.mjs. Fills the gap named in docs/22-completeness-audit.md
// §4/§6#1. Spec: spec/phase8/claude-session-adapter.md (CS1-CS19), reconciled by
// spec/phase8/RECONCILIATION.md (R3/R4/R5/R6/R11 bind this module).
//
// Conforms to the D1 session-shaped Adapter contract (assertIsAdapter in adapter.mjs):
// card/spawn/prompt/interrupt/approve/answer/kill/onEvent. Dependency-free ESM; only Node builtins.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { renderPrompt } from './cli-adapters.mjs';
import { normalizeProcessGeneration, ProcessCloseReapLatch, processStartedPayload } from './process-lifecycle.mjs';
import { usdToNanos } from './usd.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';
import { createDecisionRequest, ValidationError } from './messages.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
const CLAUDE_TOKEN_METRIC = 'anthropic_input_plus_output_tokens_excluding_cache';

// Part B / F7 (issue #16): the emulated up-channel grammar. This scans ONLY the model's own
// generated text (the `assistant` message's text content blocks) — never tool_result/quoted
// file content, which arrives as a distinct `user`-role wire message and is never routed
// through this parser. That structural separation is what makes a quoted fixture containing
// this literal string spoof-safe: it never reaches `_scanForDecisionRequest`.
const DECISION_REQUEST_GRAMMAR = /DECISION_REQUEST:\s*(\{[\s\S]*)/;
const MAX_DECISION_GRAMMAR_SCAN_BYTES = 8_192;
const SCRATCHPAD_WRITE_GRAMMAR = /SCRATCHPAD_WRITE:\s*(\{[\s\S]*)/;
const MAX_SCRATCHPAD_GRAMMAR_SCAN_BYTES = 20_480;
const CONTEXT_READ_GRAMMAR = /CONTEXT_READ:\s*(\{[\s\S]*)/;
const MAX_CONTEXT_READ_GRAMMAR_SCAN_BYTES = 20_480;
const MESSAGE_SEND_GRAMMAR = /MESSAGE_SEND:\s*(\{[\s\S]*)/;
const MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES = 20_480;
const BOARD_CLAIM_GRAMMAR = /BOARD_CLAIM:\s*(\{[\s\S]*)/;
const MAX_BOARD_CLAIM_GRAMMAR_SCAN_BYTES = 20_480;
const BOARD_REPORT_GRAMMAR = /BOARD_REPORT:\s*(\{[\s\S]*)/;
const MAX_BOARD_REPORT_GRAMMAR_SCAN_BYTES = 20_480;
const BOARD_FRAME_MARKER = /BOARD_(?:CLAIM|REPORT):/u;

/** Bracket-depth walk to the first balanced `{...}` object, bounded, string-aware. Trailing
 * prose after the JSON object (or a second, contradictory DECISION_REQUEST) never reaches the
 * parse — only the first well-formed object is a candidate (F7: first-wins, uncheckable races
 * with a second line are exactly what this bound forbids). */
function extractFirstBalancedJsonObject(text, maxBytes = MAX_DECISION_GRAMMAR_SCAN_BYTES) {
  if (Buffer.byteLength(text) > maxBytes) return null;
  const bounded = text;
  if (bounded[0] !== '{') return null;
  let depth = 0; let inString = false; let escape = false;
  for (let i = 0; i < bounded.length; i += 1) {
    const ch = bounded[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return bounded.slice(0, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

/** @returns {object|null} a normalized, closed-shape DecisionRequest, or null if the text has
 * no well-formed `DECISION_REQUEST: <json>` grammar. Malformed JSON or a schema refusal is
 * treated identically to "no grammar found" — ignored as ordinary prose, never surfaced as an
 * error and never authority-adjacent (worker text mints no control on its own).
 * Shape-only forever: the 8,192-byte scan window is the parser's resource guard; size policy
 * lives at admission with a coaching refusal, never a silent wire cap (Decision 5).
 * Exported for direct unit testing (F7); only ever called from the `assistant` text-content
 * path in this module — never on `user`/tool_result content. */
export function scanForDecisionRequest(text) {
  if (typeof text !== 'string') return null;
  const match = DECISION_REQUEST_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1]);
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  try {
    // Decision 5 (the split): the scanner validates SHAPE only — an oversize question PARSES and
    // travels to the admission seam, where the registry bound issues the typed coaching refusal.
    return createDecisionRequest(parsed, { shapeOnly: true });
  } catch (err) {
    if (err instanceof ValidationError) return null;
    throw err;
  }
}

/** Issue #33 REFLEX-1 sibling grammar. Identity is deliberately absent; Coordinator receives
 * this only on the authenticated per-worker event stream and injects worker/task/Run binding.
 * Shape-only forever: the 20,480-byte scan window is the parser's resource guard; size policy
 * lives at admission with a coaching refusal, never a silent wire cap (Decision 5). */
export function scanForScratchpadWrite(text) {
  if (typeof text !== 'string') return null;
  const match = SCRATCHPAD_WRITE_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1], MAX_SCRATCHPAD_GRAMMAR_SCAN_BYTES);
  if (!json) return null;
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'entry,expectedFence,idempotencyKey'
    || !parsed.entry || typeof parsed.entry !== 'object' || Array.isArray(parsed.entry)
    || !(parsed.expectedFence === 'current' || (Number.isSafeInteger(parsed.expectedFence) && parsed.expectedFence >= 0))
    || typeof parsed.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(parsed.idempotencyKey)) return null;
  return parsed;
}

/** BD3-A CONTEXT_READ sibling grammar (issue #75): the read port mirroring SCRATCHPAD_WRITE's
 * exact wire shape. Identity and run/scope are deliberately ABSENT — the Coordinator re-derives
 * the viewer's run server-side and the wire query carries NO runId/scope fields at all. The
 * closed-shape check here is the first line of defense; admission in the Coordinator re-checks.
 * Shape-only forever: the 20,480-byte scan window is the parser's resource guard; size policy
 * lives at admission, never a silent wire cap (Decision 5). */
export function scanForContextRead(text) {
  if (typeof text !== 'string') return null;
  const match = CONTEXT_READ_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1], MAX_CONTEXT_READ_GRAMMAR_SCAN_BYTES);
  if (!json) return null;
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'expectedFence,idempotencyKey,query'
    || !parsed.query || typeof parsed.query !== 'object' || Array.isArray(parsed.query)
    || Object.keys(parsed.query).some((key) => key === 'runId' || key === 'scope')
    || parsed.expectedFence !== 'current'
    || typeof parsed.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(parsed.idempotencyKey)) return null;
  return parsed;
}

/** Issue #86 BD3-C sibling grammar: the worker reply lane (`MESSAGE_SEND: <json>`), mirroring
 * CONTEXT_READ's exact wire shape. The frame is closed — {inReplyTo, body} ONLY: a caller-named
 * target is never surfaced (the Coordinator derives the sole target from the parent message and
 * its typed refusal governs the admitted lane, C1). Identity is absent — stream-bound, exactly
 * like the read port. inReplyTo must carry the minted shape message:<64 lowercase hex>. The body
 * is shape-checked only (non-empty string): the 20,480-byte scan window is the parser's resource
 * guard; any frame-economics policy belongs at admission with a graceful spillover path, never
 * as a silent wire cap (campaign law — constructive surfaces, not walls). */
export function scanForMessageSend(text) {
  if (typeof text !== 'string') return null;
  const match = MESSAGE_SEND_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1], MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES);
  if (!json) return null;
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'body,inReplyTo'
    || typeof parsed.inReplyTo !== 'string'
    || !/^message:[a-f0-9]{64}$/u.test(parsed.inReplyTo)
    || typeof parsed.body !== 'string' || parsed.body.length === 0) return null;
  return parsed;
}

/** Epic #78 Decision 1 sibling grammar (issue #78): the worker claim frame. The frame is closed
 * — {grantId, itemId, expectedBoardFence, idempotencyKey} ONLY. Identity/scope fields (workerId,
 * owner, ownerTask, actor, taskId, runId, waveId, board, boardRunId, sessionAuthority) are
 * rejected before any state lookup; the Coordinator derives worker/task/Run from the
 * authenticated per-worker event stream. A second frame in one scan window rejects the whole
 * scan — never first-wins (A1-1). grantId/itemId are non-empty strings (the hub resolves them
 * against its own grant/item indexes at admission); expectedBoardFence is a non-negative safe
 * integer; idempotencyKey follows the scratchpad lane's exact shape. Shape-only per the #86
 * campaign law — no content caps at the wire: the 20,480-byte scan window is the parser's
 * resource guard; any size policy belongs at admission, never a silent wire cap. */
export function scanForBoardClaim(text) {
  if (typeof text !== 'string') return null;
  const match = BOARD_CLAIM_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1], MAX_BOARD_CLAIM_GRAMMAR_SCAN_BYTES);
  if (!json) return null;
  // A second (possibly contradictory) frame after the first balanced object rejects the whole
  // scan — the closed discipline is "one frame per scan window", never first-wins.
  if (BOARD_FRAME_MARKER.test(match[1].slice(json.length))) return null;
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'expectedBoardFence,grantId,idempotencyKey,itemId'
    || typeof parsed.grantId !== 'string' || parsed.grantId.length === 0
    || typeof parsed.itemId !== 'string' || parsed.itemId.length === 0
    || !Number.isSafeInteger(parsed.expectedBoardFence) || parsed.expectedBoardFence < 0
    || typeof parsed.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(parsed.idempotencyKey)) return null;
  return parsed;
}

/** Epic #78 Decision 1/4 sibling grammar (issue #78): the worker report frame. Closed —
 * {grantId, itemId, itemVersion, itemDigest, expectedClaimVersion, body, idempotencyKey} ONLY.
 * Same identity-field rejection and second-frame discipline as scanForBoardClaim; the historical
 * (itemVersion, itemDigest) binding and the expectedClaimVersion CAS arrive on the wire and the
 * admission seam proves them against the active claim (Decision 4). Shape-only forever: the
 * 20,480-byte scan window is the parser's resource guard; size policy lives at admission with a
 * coaching refusal, never a silent wire cap (Decision 5's named rung edit). */
export function scanForBoardReport(text) {
  if (typeof text !== 'string') return null;
  const match = BOARD_REPORT_GRAMMAR.exec(text);
  if (!match) return null;
  const json = extractFirstBalancedJsonObject(match[1], MAX_BOARD_REPORT_GRAMMAR_SCAN_BYTES);
  if (!json) return null;
  if (BOARD_FRAME_MARKER.test(match[1].slice(json.length))) return null;
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'body,expectedClaimVersion,grantId,idempotencyKey,itemDigest,itemId,itemVersion'
    || typeof parsed.grantId !== 'string' || parsed.grantId.length === 0
    || typeof parsed.itemId !== 'string' || parsed.itemId.length === 0
    || !Number.isSafeInteger(parsed.itemVersion) || parsed.itemVersion <= 0
    || typeof parsed.itemDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.itemDigest)
    || !Number.isSafeInteger(parsed.expectedClaimVersion) || parsed.expectedClaimVersion <= 0
    || typeof parsed.body !== 'string' || parsed.body.length === 0
    || typeof parsed.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(parsed.idempotencyKey)) return null;
  return parsed;
}

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function safeUsageTokenTotal(usage) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return null;
  const total = input + output;
  return Number.isSafeInteger(total) ? total : null;
}

function resultUsage(obj, counterId) {
  const tokenTotal = safeUsageTokenTotal(obj?.usage);
  const tokensReported = Number.isSafeInteger(tokenTotal);
  const usdReported = usdToNanos(obj?.total_cost_usd) !== null;
  return {
    reported: tokensReported || usdReported,
    payload: {
      source: 'result', accounting: 'delta',
      ...(tokensReported ? { tokens: tokenTotal } : {}),
      ...(usdReported ? { usd: obj.total_cost_usd } : {}),
      ...((tokensReported || usdReported) ? { counterId, tokenMetric: tokensReported ? CLAUDE_TOKEN_METRIC : null } : {}),
    },
    seal: {
      tokens: tokensReported ? 'reported' : 'unavailable',
      usd: usdReported ? 'reported' : 'unavailable',
      counterId: (tokensReported || usdReported) ? counterId : null,
      tokenMetric: tokensReported ? CLAUDE_TOKEN_METRIC : null,
    },
  };
}

const CREDENTIAL_MAX_BYTES = 16 * 1024;
const KIMI_MODEL = 'kimi-k3[1m]';
const KIMI_BASE_URL = 'https://api.moonshot.ai/anthropic';
const KIMI_PROVIDER_ENV = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
]);

function credentialError(providerLabel, code) {
  return Object.assign(new Error(`${providerLabel}: ${code}`), { code });
}

function jsonPointerSegments(pointer, providerLabel) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer.length > 512) {
    throw credentialError(providerLabel, 'credential_pointer_invalid');
  }
  const segments = pointer.slice(1).split('/').map((segment) => {
    if (/~(?![01])/u.test(segment)) throw credentialError(providerLabel, 'credential_pointer_invalid');
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
  });
  if (segments.length === 0 || segments.length > 8 || segments.some((segment) => !segment || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw credentialError(providerLabel, 'credential_pointer_invalid');
  }
  return segments;
}

/** Load one bounded local credential without including its path, pointer, or value in diagnostics. */
export function loadProviderCredentialFile(path, {
  providerLabel = 'Provider', jsonPointer = '/env/ANTHROPIC_AUTH_TOKEN',
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  forbiddenRoots = [],
} = {}) {
  if (typeof path !== 'string' || path.length === 0) throw credentialError(providerLabel, 'credential_path_required');
  if (!Array.isArray(forbiddenRoots)) throw credentialError(providerLabel, 'credential_path_forbidden');
  const lexicalPath = resolve(path);
  for (const root of forbiddenRoots) {
    if (typeof root !== 'string' || root.length === 0) throw credentialError(providerLabel, 'credential_path_forbidden');
    const rel = relative(resolve(root), lexicalPath);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw credentialError(providerLabel, 'credential_path_forbidden');
    }
  }
  let before;
  try { before = lstatSync(path); } catch { throw credentialError(providerLabel, 'credential_file_missing'); }
  if (before.isSymbolicLink()) throw credentialError(providerLabel, 'credential_file_symlink');
  if (!before.isFile()) throw credentialError(providerLabel, 'credential_file_not_regular');
  if (ownerUid !== null && Number.isInteger(before.uid) && before.uid !== ownerUid) {
    throw credentialError(providerLabel, 'credential_file_owner');
  }
  if ((before.mode & 0o077) !== 0) throw credentialError(providerLabel, 'credential_file_permissions');
  if (before.size <= 0 || before.size > CREDENTIAL_MAX_BYTES) throw credentialError(providerLabel, 'credential_file_size');
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { throw credentialError(providerLabel, 'credential_file_unavailable'); }
  let text;
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) {
      throw credentialError(providerLabel, 'credential_file_changed');
    }
    if (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid) {
      throw credentialError(providerLabel, 'credential_file_owner');
    }
    if ((stat.mode & 0o077) !== 0) throw credentialError(providerLabel, 'credential_file_permissions');
    if (stat.size <= 0 || stat.size > CREDENTIAL_MAX_BYTES) throw credentialError(providerLabel, 'credential_file_size');
    let actualPath;
    try { actualPath = realpathSync(path); } catch { throw credentialError(providerLabel, 'credential_file_changed'); }
    for (const root of forbiddenRoots) {
      let actualRoot;
      try { actualRoot = realpathSync(root); } catch { throw credentialError(providerLabel, 'credential_path_forbidden'); }
      const rel = relative(actualRoot, actualPath);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        throw credentialError(providerLabel, 'credential_path_forbidden');
      }
    }
    try { text = readFileSync(descriptor, 'utf8').trim(); }
    catch { throw credentialError(providerLabel, 'credential_file_unavailable'); }
    const after = fstatSync(descriptor);
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size
      || after.uid !== stat.uid || after.mode !== stat.mode || after.mtimeMs !== stat.mtimeMs
      || after.ctimeMs !== stat.ctimeMs) throw credentialError(providerLabel, 'credential_file_changed');
  } finally { closeSync(descriptor); }
  if (!text || text.includes('\0')) throw credentialError(providerLabel, 'credential_token_invalid');
  if (!text.startsWith('{')) {
    if (/\s/u.test(text)) throw credentialError(providerLabel, 'credential_token_invalid');
    return text;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw credentialError(providerLabel, 'credential_json_malformed'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw credentialError(providerLabel, 'credential_json_malformed');
  let token = parsed;
  for (const segment of jsonPointerSegments(jsonPointer, providerLabel)) {
    if (token === null || typeof token !== 'object' || Array.isArray(token) || !Object.hasOwn(token, segment)) {
      token = undefined;
      break;
    }
    token = token[segment];
  }
  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    throw credentialError(providerLabel, token === undefined ? 'credential_pointer_missing' : 'credential_token_invalid');
  }
  return token;
}

/** Compatibility projection for the older GLM-specific loader contract. */
export function loadGlmAuthTokenFile(path, { jsonPointer = '/env/ANTHROPIC_AUTH_TOKEN', ownerUid } = {}) {
  try {
    return loadProviderCredentialFile(path, { providerLabel: 'GLM', jsonPointer, ownerUid });
  } catch (error) {
    const code = error?.code === 'credential_file_permissions'
      ? 'credential_file_permissions'
      : ['credential_file_missing', 'credential_file_unavailable'].includes(error?.code)
        ? 'credential_file_unavailable' : 'credential_file_invalid';
    throw credentialError('GLM', code);
  }
}

function observedClaudeVersion(cmd, probe) {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.includes('\0')) return 'unavailable';
  try {
    const source = String((probe ?? execFileSync)(cmd, ['--version'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
    }));
    return /(\d+\.\d+\.\d+)/u.exec(source)?.[1] ?? 'unavailable';
  } catch { return 'unavailable'; }
}

function validInjectedToken(token, providerLabel) {
  if (typeof token !== 'string' || token.length === 0 || /\s/u.test(token)) {
    throw credentialError(providerLabel, 'credential_token_invalid');
  }
  return token;
}

// ---------------------------------------------------------------------------
// buildClaudeSessionArgs — pure function (no process spawned), CS1.
// ---------------------------------------------------------------------------

export function buildClaudeSessionArgs({ approvals = false, sessionId, forkSession = false, model, effort, permissionMode } = {}) {
  // stream-json "only works with --print"; --verbose is required alongside it (CS1/§1).
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  // Unattended workers default to bypassing routine approval choreography while Baton's private
  // Claude settings retain the worktree sandbox. Interactive approval mode must remain ask-capable:
  // Claude never invokes its permission callback under bypassPermissions.
  const resolvedPermissionMode = permissionMode === undefined
    ? (approvals ? 'acceptEdits' : 'bypassPermissions')
    : permissionMode;
  if (approvals && resolvedPermissionMode === 'bypassPermissions') {
    throw new TypeError('Claude approval callbacks cannot be combined with bypassPermissions');
  }
  if (resolvedPermissionMode != null) args.push('--permission-mode', resolvedPermissionMode);
  if (approvals) args.push('--permission-prompt-tool', 'stdio'); // magic value per the Agent SDK source (§0)
  if (sessionId) args.push('--resume', sessionId);
  if (forkSession) args.push('--fork-session');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

// ---------------------------------------------------------------------------
// makeResult — same WorkerResult shape cli-adapters.mjs's makeResult() produces, for downstream
// (referee/story) consistency (CS5/§4b). Not trusted from the wire — the hub re-runs verification.
// ---------------------------------------------------------------------------

function makeResult(status, summary, usage, usd, failureCode = null, authenticationSummary = null) {
  const tokens = safeUsageTokenTotal(usage);
  const exactUsd = usdToNanos(usd) === null ? null : usd;
  return {
    status,
    summary: failureCode === 'authentication_refresh_required'
      ? (authenticationSummary ?? 'Provider authentication requires refresh.') : (summary ?? '').slice(0, 500),
    artifacts: { commits: [], files: [] },
    verification: { command: null, claimedExit: null },
    openQuestions: [],
    budgetUsed: { tokens: tokens ?? 0, usd: exactUsd ?? 0 },
    ...(failureCode ? { failure: { code: failureCode } } : {}),
  };
}

function claudeResultFailureCode(obj) {
  if (obj?.is_error !== true || typeof obj.result !== 'string') return null;
  const message = obj.result.trim();
  return message === 'authentication_error'
    || /^Not logged in\s*[·:.-]?\s*Please run (?:\/login|claude auth login)\.?$/iu.test(message)
    // The REAL terminal auth shape, receipted live 2026-08-01 (env-token-only runtime, revoked
    // access token): {"is_error":true, "result":"Failed to authenticate. API Error: 401 OAuth
    // access token has been revoked.", "api_error_status":401} — the vendor does NOT refresh in
    // --print mode; it fails the call with this exact result (R11V-2's verification step).
    || /^Failed to authenticate\. API Error: 401\b/u.test(message)
    ? 'authentication_refresh_required' : null;
}

// ---------------------------------------------------------------------------
// ClaudeSessionCli
// ---------------------------------------------------------------------------

export class ClaudeSessionCli {
  /** @param {{cmd,args,env,harness,version,ceiling,maxContext,approvals,sessionId,killGraceMs,model}} opts */
  constructor(opts = {}) {
    const maxWireFrameBytes = opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    if (!Number.isSafeInteger(maxWireFrameBytes) || maxWireFrameBytes <= 0) throw new TypeError('maxWireFrameBytes must be a positive safe integer');
    const approvals = opts.approvals ?? false;
    const permissionMode = opts.permissionMode === undefined
      ? (approvals ? 'acceptEdits' : 'bypassPermissions')
      : opts.permissionMode;
    if (approvals && permissionMode === 'bypassPermissions') {
      throw new TypeError('ClaudeSessionCli: approvals:true cannot use bypassPermissions');
    }
    this._cfg = {
      cmd: opts.cmd ?? 'claude',
      args: opts.args ?? [],
      env: opts.env ?? {},
      harness: opts.harness ?? 'claude-code',
      version: opts.version ?? observedClaudeVersion(opts.cmd ?? 'claude', opts.versionProbe),
      ceiling: opts.ceiling ?? 4,
      maxContext: opts.maxContext ?? 200000,
      approvals,
      sessionId: opts.sessionId,
      killGraceMs: opts.killGraceMs ?? 5000,
      model: opts.model,
      permissionMode,
      maxWireFrameBytes,
      authenticationProbe: opts.authenticationProbe ?? spawnSync,
      providerSecrets: Object.freeze((opts.providerSecrets ?? []).filter((value) => typeof value === 'string' && value.length > 0)),
      providerSecretsProbe: opts.providerSecretsProbe,
      credentialController: opts.credentialController,
      authenticationSummary: opts.authenticationSummary,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
    };
    /** @type {Map<string, object>} worker -> session */
    this._sessions = new Map();
    /** SC12: worker -> synchronous reservation held across worktreeReady. */
    this._pendingSpawns = new Map();
    this._cb = null;
  }

  authenticationReadiness({ env } = {}) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return Object.freeze({
        state: 'blocked', code: 'authentication_probe_unavailable',
        credentialState: 'unavailable', summary: 'Projected Claude authentication could not be verified.',
      });
    }
    let result;
    try {
      result = this._cfg.authenticationProbe(this._cfg.cmd, ['auth', 'status', '--json'], {
        encoding: 'utf8', env: { ...env, ...this._cfg.env },
        stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
        maxBuffer: 64 * 1024, killSignal: 'SIGKILL',
      });
    } catch {
      return Object.freeze({
        state: 'blocked', code: 'authentication_probe_unavailable',
        credentialState: 'unavailable', summary: 'Projected Claude authentication could not be verified.',
      });
    }
    const stdout = typeof result === 'string' ? result : result?.stdout;
    let status;
    try {
      status = typeof stdout === 'string' && Buffer.byteLength(stdout) <= 64 * 1024
        ? JSON.parse(stdout) : null;
    } catch { status = null; }
    if (status?.loggedIn === true && (typeof result === 'string' || result?.status === 0)) {
      return Object.freeze({
        state: 'ready', credentialState: 'verified',
        summary: 'Projected Claude authentication was verified in the private worker runtime.',
      });
    }
    if (status?.loggedIn === false) {
      return Object.freeze({
        state: 'blocked', code: 'authentication_refresh_required',
        credentialState: 'refresh_required',
        summary: 'Claude authentication is not usable in the private worker runtime. Refresh or provision projected authentication, then reopen Baton.',
      });
    }
    return Object.freeze({
      state: 'blocked', code: 'authentication_probe_invalid',
      credentialState: 'invalid', summary: 'Projected Claude authentication returned invalid readiness data.',
    });
  }

  card() {
    const autonomy = this._cfg.permissionMode === 'bypassPermissions' ? 'unattended' : 'interactive';
    return {
      harness: this._cfg.harness,
      version: this._cfg.version,
      authPosture: 'subscription',
      concurrencyCeiling: this._cfg.ceiling,
      maxContext: this._cfg.maxContext,
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: CLAUDE_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: this._cfg.maxWireFrameBytes,
      },
      modelSelection: {
        mode: 'exact',
        configuredDefault: this._cfg.model ?? null,
        available: null,
        family: 'claude',
        acceptedPrefixes: ['claude-'],
        acceptedAliases: ['sonnet', 'opus', 'haiku'],
        reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
        serviceTier: null,
        provenance: 'adapter-configuration',
        refreshedAt: null,
      },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      isolation: {
        configHome: 'driver-scoped', environment: 'driver-scoped', filesystem: 'unverified',
        osSandbox: 'unverified', network: 'uncontrolled', credentialProjection: 'explicit',
      },
      permissions: {
        mode: this._cfg.permissionMode ?? 'external', sandbox: 'unverified',
        boundary: 'Full same-UID host access by default; filesystem and network containment are unverified',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: [autonomy], default: autonomy, perTask: false,
          observation: 'launch', mechanisms: [`permission-mode-${this._cfg.permissionMode}`],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'launch', mechanisms: ['claude-unsandboxed-permissions'],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      // Issue #31 §2.1(1): this harness holds its session open across a completed turn, so a
      // finished turn is a checkpoint the orchestrator may steer from, not an implicit claim.
      // Absent on every other card, which reads as 'claim' — the byte-identical legacy path.
      // Inherited unmodified by GlmSessionCli/KimiSessionCli through their `{...base}` spread.
      turnCompletion: 'pausable',
      verbs: {
        spawn: 'native',
        prompt: 'native',
        steer: 'native', // E2: mid-turn stream-json injection is real — the running turn absorbs it
        interrupt: 'native',
        approve: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        answer: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        kill: 'native',
        pause: 'unsupported', // R3: canonical 8-verb card vocabulary; Claude has no pause primitive
      },
      // Part B (issue #16): no native wire elicitation carries typed options — the request is
      // parsed from untrusted worker prose and the answer rides a plain user-turn continuation.
      // Always 'emulated', never 'native' (D1: no silent emulation).
      decision: this._cfg.approvals ? 'emulated' : 'unsupported',
    };
  }

  onEvent(cb) { this._cb = cb; }

  /** Resolve one complete provider route immediately before child creation. */
  _prepareProviderRoute({ model, effort, env }) {
    return { model, effort, env };
  }

  /** Provider-specialized init validation; the base Claude route accepts its native observation. */
  _validateProviderReady({ modelRequested, modelObserved }) {
    void modelRequested;
    void modelObserved;
  }

  _emitPendingStop(worker, kind) {
    const pending = this._pendingSpawns.get(worker);
    if (!pending || pending.cancelled) return false;
    pending.cancelled = true;
    this._pendingSpawns.delete(worker);
    if (this._cb) {
      this._cb({
        worker, harness: this._cfg.harness, turnEpoch: 0,
        actor: 'worker', kind, payload: { phase: 'spawn', usageSeal: unavailableUsageSeal() },
      });
    }
    return true;
  }

  _actorFor(kind) {
    void kind;
    return 'worker';
  }

  /** CS16: once a session-terminal kind fires, no further event is EVER emitted for that worker. */
  _emit(session, kind, payload) {
    if (session.deadEmitted && !['lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed', 'kill.confirmed'].includes(kind)) return;
    const evt = {
      worker: session.worker,
      harness: this._cfg.harness,
      turnEpoch: session.turnEpoch ?? 0,
      actor: this._actorFor(kind),
      kind,
      payload,
    };
    if (this._cb) this._cb(evt);
    if (kind === 'lifecycle.exited' || kind === 'lifecycle.crashed' || kind === 'kill.confirmed') {
      session.deadEmitted = true;
    }
  }

  // ---------------------------------------------------------------------------
  // spawn — CS2/CS3/CS4
  // ---------------------------------------------------------------------------

  async spawn(worker, brief, opts = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && (!existing.deadEmitted || (existing.processClose && !existing.processClose.confirmed))) || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    if (opts.attachOnly === true && opts.session?.mode !== 'resume') {
      return {
        ok: false,
        code: 'attach_only_requires_resume',
        reason: 'attach-only is an internal native-resume primitive',
      };
    }
    const pending = { cancelled: false };
    this._pendingSpawns.set(worker, pending);
    try {
    // SC1: one spawn contract — the coordinator dispatches {worktreeReady}; direct callers may
    // pass a ready opts.worktree. Resolve BEFORE the child exists; refuse when neither yields a
    // path — a session must never start in an unspecified cwd (G1: silent wrong-cwd).
    let cwd = opts.worktree;
    if (!cwd && opts.worktreeReady) {
      try {
        const r = await opts.worktreeReady;
        if (r && r.path) cwd = r.path;
      } catch { /* fall through to the refusal below */ }
    }
    if (pending.cancelled || opts.signal?.aborted) return { ok: false, reason: 'spawn cancelled before child creation', cancelled: true };
    if (!cwd) return { ok: false, reason: 'spawn requires a worktree (opts.worktree, or opts.worktreeReady resolving {path})' };

    // Issue #11 v3 spawn-TTL gate: refresh before child creation, then project the cache's
    // current access token into this spawn. No known-dead token reaches a provider process.
    let credentialEnv = null;
    if (this._cfg.credentialController) {
      try {
        await this._cfg.credentialController.ensureFresh();
        credentialEnv = this._cfg.credentialController.projectionEnv();
      } catch (error) {
        return {
          ok: false, code: error?.code ?? 'authentication_refresh_required',
          reason: this._cfg.authenticationSummary?.(error?.code ?? 'authentication_refresh_required')
            ?? String(error?.message ?? error),
        };
      }
    }

    let route;
    try {
      route = this._prepareProviderRoute({
        model: opts.model ?? this._cfg.model,
        effort: opts.reasoningEffort,
        env: opts.replaceEnv
          ? { ...(opts.env ?? {}), ...(this._cfg.env ?? {}), ...(credentialEnv ?? {}) }
          : { ...process.env, ...(this._cfg.env ?? {}), ...(opts.env ?? {}), ...(credentialEnv ?? {}) },
      });
    } catch (error) {
      return { ok: false, code: error?.code ?? 'provider_route_invalid', reason: String(error?.message ?? 'provider route invalid') };
    }
    const argv = [
      ...(this._cfg.args ?? []),
      ...buildClaudeSessionArgs({
        approvals: this._cfg.approvals,
        sessionId: opts.session?.id ?? this._cfg.sessionId,
        forkSession: opts.session?.mode === 'fork',
        model: route.model,
        effort: route.effort,
        permissionMode: this._cfg.permissionMode,
      }),
    ];
    let workerPolicyObserved = null;
    if (opts.workerPolicy) {
      try {
        workerPolicyObserved = attestWorkerPolicyObservation(opts.workerPolicy, {
          autonomy: this._cfg.permissionMode === 'bypassPermissions' ? 'unattended' : 'interactive',
          access: 'full',
        });
      } catch (error) {
        return { ok: false, code: error?.code, reason: String(error?.message ?? error) };
      }
    }

    const processGeneration = normalizeProcessGeneration(opts.processGeneration);
    let child;
    try {
      child = spawn(this._cfg.cmd, argv, {
        cwd,
        env: route.env,
        detached: true, // own process group, so interrupt/kill can signal the whole tree
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { ok: false, reason: `spawn failed: ${err.message}` };
    }

    const session = {
      worker,
      child,
      pid: child.pid,
      processGeneration,
      processClosedEmitted: false,
      processClosePending: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      timeoutFailure: null,
      processFailure: null,
      buf: '',
      discardingFrame: null, // issue #28: session-scoped latch for oversized tool_result discard
      stderrCanaryTail: '',
      spawnedEmitted: false,
      sessionIdWire: null,
      turnInFlight: false,
      discardNextResult: false, // CS11
      pendingInterrupt: null,
      turnEpoch: 0,
      reqSeq: 0,
      providerCallSeq: 0,
      deadEmitted: false,
      terminal: false, // set once the child process itself has exited
      stopping: false,
      killTimer: null,
      pendingControlRequests: new Map(), // wire request_id (WE sent) -> resolve(responseObj)
      // adapter-minted requestId -> {wireId, input?, toolUseID?} (R4 + erratum E3: approve()
      // must echo the request's own input and tool_use_id back on an allow)
      wireToAdapterId: new Map(),
      modelRequested: route.model ?? null,
      modelObserved: null,
      workerPolicyObserved,
      pendingBrief: opts.attachOnly === true ? null : renderPrompt(brief),
      bootstrapTurnPending: false,
      retryCount: 0,
      lastTurnText: null,
      spawnSpec: Object.freeze({ argv: Object.freeze([...argv]), cwd, env: Object.freeze({ ...route.env }) }),
    };
    session.processClose = Number.isSafeInteger(session.pid) && session.pid > 0 ? new ProcessCloseReapLatch({
      generation: session.processGeneration,
      pid: session.pid,
      timeoutMs: session.processReapTimeoutMs,
      reap: this._cfg.reapOwnedProcessGroup,
      onProcessClosed: (payload) => {
        session.processClosedEmitted = true;
        this._emit(session, 'lifecycle.process_closed', payload);
      },
      onReapUnconfirmed: (payload) => this._emit(session, 'lifecycle.process_reap_unconfirmed', payload),
      onStopConfirmed: (kind, payload) => {
        session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
        this._emit(session, kind, payload);
      },
    }) : null;
    this._sessions.set(worker, session);
    // #163 law: the wall-time fate clock is GONE — a member's fate rests on evidence only
    // (process exit; quiescence-derived wave completion). opts.timeoutMs is accepted for
    // back-compat and deliberately ignored for fate.

    this._attachChild(session, child);

    const processStarted = processStartedPayload(session.processGeneration, session.pid);
    if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
    if (session.workerPolicyObserved) {
      this._emit(session, 'worker_policy.observed', {
        processGeneration: session.processGeneration, pid: session.pid, processGroupId: session.pid,
        workerPolicyObserved: session.workerPolicyObserved,
      });
      if (session.stopping || session.terminal) {
        return { ok: false, code: 'provider_ready_refused', reason: 'launch worker policy was rejected by coordinator policy' };
      }
    }

    // Claude Code 2.1.211 does not emit its system/init frame until stream-json receives the first
    // user frame. Bootstrap the admitted Brief now, then keep every provider result private until
    // init validates the requested model and lifecycle.spawned is durable. Older CLIs that emit
    // init eagerly remain compatible because stdout callbacks cannot interleave this stack.
    if (session.pendingBrief !== null) {
      const pendingBrief = session.pendingBrief;
      session.pendingBrief = null;
      session.turnInFlight = true;
      session.turnEpoch = 1;
      session.bootstrapTurnPending = true;
      session.lastTurnText = pendingBrief;
      this._write(session, {
        type: 'user', message: { role: 'user', content: [{ type: 'text', text: pendingBrief }] },
      });
    }

    return { ok: true, ...(opts.attachOnly === true ? { attached: true } : {}) };
    } finally {
      if (this._pendingSpawns.get(worker) === pending) this._pendingSpawns.delete(worker);
    }
  }

  // ---------------------------------------------------------------------------
  // Wire I/O
  // ---------------------------------------------------------------------------

  _write(session, obj) {
    if (session.terminal) return;
    try { session.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* pipe race, process already gone */ }
  }

  /**
   * CS4 as amended by erratum E2: lifecycle.turn_started (and a turnEpoch bump) are emitted only
   * when this frame BEGINS a turn. A frame written while a turn is already in flight is absorbed
   * by that RUNNING turn at its next boundary (live-observed wire semantics) — fabricating a
   * second turn_started for it would corrupt the one-start/one-terminal accounting.
   */
  _writeUserFrame(session, text) {
    if (session.terminal) return;
    const beginsTurn = !session.turnInFlight;
    session.turnInFlight = true;
    if (beginsTurn) {
      session.turnEpoch = (session.turnEpoch ?? 0) + 1;
      session.lastTurnText = text;
      session.retryCount = 0;
    }
    this._write(session, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    if (beginsTurn) this._emit(session, 'lifecycle.turn_started', {});
  }

  /**
   * Issue #28: first ≤256 bytes of a frame. Used only to classify tool_result degradation
   * candidates — never to retain content.
   */
  _wireFrameHead(text) {
    const buf = Buffer.from(String(text ?? ''), 'utf8');
    return buf.subarray(0, Math.min(256, buf.length)).toString('utf8');
  }

  /** tool_result wire frames are `user` frames whose head carries a tool_result content block. */
  _isToolResultFrameHead(text) {
    const head = this._wireFrameHead(text);
    return head.includes('"type":"user"') && head.includes('"tool_result"');
  }

  _parseToolUseIdFromHead(text) {
    const head = this._wireFrameHead(text);
    const match = head.match(/"tool_use_id"\s*:\s*"([^"]+)"/u);
    return match ? match[1] : null;
  }

  _emitFrameDegraded(session, frameBytes, toolUseId) {
    if (session.terminal) return;
    this._emit(session, 'wire.frame_degraded', {
      frameBytes,
      ceilingBytes: this._cfg.maxWireFrameBytes,
      toolUseId: toolUseId ?? null,
    });
  }

  /**
   * Issue #28 discard latch: once an oversized tool_result head is recognized, every byte
   * through the terminating newline is dropped (counted exactly). A frame larger than 2× the
   * ceiling cannot re-trigger on its own tail.
   * @returns {string} any remainder after the discarded frame (may be empty)
   */
  _consumeDiscardLatch(session, data) {
    const nl = data.indexOf('\n');
    if (nl === -1) {
      session.discardingFrame.bytesSeen += Buffer.byteLength(data, 'utf8');
      return '';
    }
    session.discardingFrame.bytesSeen += Buffer.byteLength(data.slice(0, nl + 1), 'utf8');
    const frameBytes = session.discardingFrame.bytesSeen;
    const toolUseId = session.discardingFrame.toolUseId ?? null;
    session.discardingFrame = null;
    this._emitFrameDegraded(session, frameBytes, toolUseId);
    return data.slice(nl + 1);
  }

  _onData(session, chunk) {
    let data = String(chunk);
    // Active discard latch — drop through the terminating newline before normal framing.
    if (session.discardingFrame) {
      data = this._consumeDiscardLatch(session, data);
      if (!data) return;
    }

    session.buf += data;
    let nl;
    while ((nl = session.buf.indexOf('\n')) !== -1) {
      const line = session.buf.slice(0, nl);
      session.buf = session.buf.slice(nl + 1);
      // Rule 4: provider-secret check runs before degradation (ordering preserved).
      if (this._containsProviderSecret(line)) {
        this._providerSecretFailure(session);
        return;
      }
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (lineBytes > this._cfg.maxWireFrameBytes) {
        // Completed-line ingestion site: degrade tool_result, else honest kill.
        if (this._isToolResultFrameHead(line)) {
          this._emitFrameDegraded(session, lineBytes + 1, this._parseToolUseIdFromHead(line));
          continue;
        }
        this._wireFrameFailure(session);
        return;
      }
      if (!line.trim()) continue;
      if (session.terminal) continue; // CS16
      let obj;
      try { obj = JSON.parse(line); } catch { continue; } // tolerant NDJSON reader, like the real CLI
      if (this._containsProviderSecret(obj)) {
        this._providerSecretFailure(session);
        return;
      }
      this._handleWireObject(session, obj);
      if (session.processFailure) {
        session.buf = '';
        return;
      }
    }
    // Partial-buffer ingestion site — secret check first, then size (else-if preserved).
    if (!session.terminal && this._containsProviderSecret(session.buf)) this._providerSecretFailure(session);
    else if (!session.terminal && Buffer.byteLength(session.buf, 'utf8') > this._cfg.maxWireFrameBytes) {
      if (this._isToolResultFrameHead(session.buf)) {
        session.discardingFrame = {
          bytesSeen: Buffer.byteLength(session.buf, 'utf8'),
          toolUseId: this._parseToolUseIdFromHead(session.buf),
        };
        session.buf = '';
      } else {
        this._wireFrameFailure(session);
      }
    }
  }

  _containsProviderSecret(value) {
    // Defense in depth on provider EGRESS only. Worker ingress is enforced separately by the
    // env-only RuntimeIsolation projection and absence of credentialFiles.claude.
    const dynamic = typeof this._cfg.providerSecretsProbe === 'function'
      ? this._cfg.providerSecretsProbe() : [];
    const secrets = [...this._cfg.providerSecrets, ...(Array.isArray(dynamic) ? dynamic : [])]
      .filter((secret) => typeof secret === 'string' && secret.length > 0);
    if (typeof value === 'string') return secrets.some((secret) => value.includes(secret));
    if (Array.isArray(value)) return value.some((item) => this._containsProviderSecret(item));
    if (value && typeof value === 'object') return Object.values(value).some((item) => this._containsProviderSecret(item));
    return false;
  }

  _providerSecretFailure(session) {
    if (session.terminal || session.processFailure) return;
    session.buf = '';
    session.discardingFrame = null;
    session.processFailure = {
      error: 'provider output contained protected credential material',
      code: 'provider_output_secret',
      phase: 'wire',
      usageSeal: unavailableUsageSeal(),
    };
    this._signal(session, 'SIGKILL');
  }

  _onStderr(session, chunk) {
    const dynamic = typeof this._cfg.providerSecretsProbe === 'function'
      ? this._cfg.providerSecretsProbe() : [];
    const secrets = [...this._cfg.providerSecrets, ...(Array.isArray(dynamic) ? dynamic : [])]
      .filter((secret) => typeof secret === 'string' && secret.length > 0);
    if (session.terminal || secrets.length === 0) return;
    const candidate = `${session.stderrCanaryTail}${String(chunk)}`;
    if (this._containsProviderSecret(candidate)) {
      session.stderrCanaryTail = '';
      this._providerSecretFailure(session);
      return;
    }
    const maxSecretBytes = Math.max(...secrets.map((secret) => Buffer.byteLength(secret, 'utf8')));
    session.stderrCanaryTail = candidate.slice(-Math.max(0, maxSecretBytes - 1));
  }

  _wireFrameFailure(session) {
    if (session.terminal || session.processFailure) return;
    session.buf = '';
    session.discardingFrame = null;
    session.processFailure = {
      error: 'provider wire frame exceeded configured byte ceiling',
      code: 'wire_frame_oversize',
      phase: 'wire',
      usageSeal: unavailableUsageSeal(),
    };
    this._signal(session, 'SIGKILL');
  }

  _handleWireObject(session, obj) {
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && session.retryAwaitingInit) {
          try {
            this._validateProviderReady({ modelRequested: session.modelRequested, modelObserved: obj.model ?? null });
          } catch (error) {
            session.processFailure = {
              error: String(error?.message ?? 'provider initialization invalid'),
              code: error?.code ?? 'provider_init_invalid', phase: 'provider_init',
              usageSeal: unavailableUsageSeal(),
            };
            this._signal(session, 'SIGKILL');
            return;
          }
          session.retryAwaitingInit = false;
          session.sessionIdWire = obj.session_id;
          session.modelObserved = obj.model ?? null;
          this._write(session, {
            type: 'user', message: { role: 'user', content: [{ type: 'text', text: session.lastTurnText }] },
          });
          return;
        }
        if (obj.subtype === 'init' && !session.spawnedEmitted) {
          try {
            this._validateProviderReady({ modelRequested: session.modelRequested, modelObserved: obj.model ?? null });
          } catch (error) {
            if (!session.processFailure) {
              session.processFailure = {
                error: String(error?.message ?? 'provider initialization invalid'),
                code: error?.code ?? 'provider_init_invalid',
                phase: 'provider_init',
                usageSeal: unavailableUsageSeal(),
              };
              this._signal(session, 'SIGKILL');
            }
            return;
          }
          // CS3: lifecycle.spawned carries the WIRE session_id, never a client-generated one.
          session.spawnedEmitted = true;
          session.sessionIdWire = obj.session_id;
          session.modelObserved = obj.model ?? null;
          this._emit(session, 'lifecycle.spawned', {
            sessionId: obj.session_id, pid: session.pid,
            processGeneration: session.processGeneration,
            modelRequested: session.modelRequested, modelObserved: session.modelObserved,
            ...(session.workerPolicyObserved ? { workerPolicyObserved: session.workerPolicyObserved } : {}),
          });
          if (!session.stopping && !session.terminal && session.bootstrapTurnPending) {
            session.bootstrapTurnPending = false;
            this._emit(session, 'lifecycle.turn_started', {});
          } else if (!session.stopping && !session.terminal && session.pendingBrief !== null) {
            const pendingBrief = session.pendingBrief;
            session.pendingBrief = null;
            this._writeUserFrame(session, pendingBrief);
          }
        }
        return;
      case 'assistant': {
        const content = obj.message?.content ?? [];
        const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('');
        const tools = content.filter((c) => c.type === 'tool_use');
        if (!text && tools.length === 0) return;
        session.providerCallSeq += 1;
        const providerCallId = String(obj.message?.id ?? obj.uuid ?? `claude:${session.turnEpoch}:${session.providerCallSeq}`);
        this._emit(session, 'resource.provider_call', { callId: providerCallId, phase: 'completed' });
        if (text) this._emit(session, 'content.message', { text });
        tools.forEach((tool, index) => this._emit(session, 'content.tool_call', {
          callId: String(tool.id ?? `${providerCallId}:tool:${index + 1}`),
          phase: 'requested',
          name: tool.name,
          input: tool.input,
        }));
        // Part B / F7: admit at most one live emulated decision request per session — a second
        // (possibly contradictory) DECISION_REQUEST line is ignored as prose while one is
        // already pending; the worker can always re-ask once it settles.
        if (text && !session.pendingDecisionRequestId) {
          const request = scanForDecisionRequest(text);
          if (request) {
            session.decisionSeq = (session.decisionSeq ?? 0) + 1;
            const requestId = `${session.worker}:decision:${session.decisionSeq}`;
            session.pendingDecisionRequestId = requestId;
            this._emit(session, 'decision.requested', { requestId, request });
          }
        }
        if (text) {
          const request = scanForScratchpadWrite(text);
          if (request) this._emit(session, 'scratchpad.write', request);
        }
        if (text) {
          const readRequest = scanForContextRead(text);
          if (readRequest) this._emit(session, 'context.read', readRequest);
        }
        if (text) {
          const messageFrame = scanForMessageSend(text);
          if (messageFrame) this._emit(session, 'message.send', messageFrame);
        }
        if (text) {
          const claimFrame = scanForBoardClaim(text);
          if (claimFrame) this._emit(session, 'board.claim', claimFrame);
        }
        if (text) {
          const reportFrame = scanForBoardReport(text);
          if (reportFrame) this._emit(session, 'board.report', reportFrame);
        }
        return;
      }
      case 'result':
        this._handleResult(session, obj);
        return;
      case 'control_request':
        this._handleIncomingControlRequest(session, obj);
        return;
      case 'control_response':
        this._handleIncomingControlResponse(session, obj);
        return;
      default:
        return; // user (tool results), rate_limit_event, deltas — not surfaced
    }
  }

  _handleResult(session, obj) {
    session.turnInFlight = false;
    const usage = resultUsage(obj, `claude:${session.worker}:${session.turnEpoch}`);
    if (usage.reported) {
      this._emit(session, 'resource.tokens', {
        ...usage.payload,
        usage: obj.usage ?? null,
        pid: session.pid,
        modelRequested: session.modelRequested,
        modelObserved: session.modelObserved,
      });
    }
    if (session.discardNextResult) {
      // CS11: a result frame for the just-interrupted turn is discarded — never surfaced as
      // lifecycle.turn_completed. Single-terminal-per-turn: control.interrupt_confirmed IS the terminal.
      session.discardNextResult = false;
      if (session.pendingInterrupt) {
        session.pendingInterrupt.resultSeen = true;
        session.pendingInterrupt.usageSeal = usage.seal;
        this._maybeConfirmInterrupt(session);
      }
      return;
    }
    const status = obj.is_error ? 'failed' : 'completed';
    const failureCode = claudeResultFailureCode(obj);
    if (failureCode === 'authentication_refresh_required'
      && this._cfg.credentialController && session.retryCount === 0 && session.lastTurnText) {
      session.retryCount = 1;
      session.turnInFlight = true;
      void this._retryAfterAuthenticationRefresh(session, obj);
      return;
    }
    this._emit(session, 'lifecycle.turn_completed', {
      result: makeResult(
        status, obj.result, obj.usage, obj.total_cost_usd, failureCode,
        failureCode ? this._cfg.authenticationSummary?.(failureCode) : null,
      ),
      usageSeal: usage.seal,
      pid: session.pid,
      modelRequested: session.modelRequested,
      modelObserved: session.modelObserved,
    });
  }

  _attachChild(session, child) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (session.child === child) this._onData(session, chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (session.child === child) this._onStderr(session, chunk);
    });
    child.on('close', (code, signal) => {
      if (session.child === child) void this._onClose(session, code, signal);
    });
    child.on('error', (error) => {
      if (session.child === child) this._onSpawnError(session, error);
    });
  }

  _newProcessCloseLatch(session) {
    return Number.isSafeInteger(session.pid) && session.pid > 0 ? new ProcessCloseReapLatch({
      generation: session.processGeneration,
      pid: session.pid,
      timeoutMs: session.processReapTimeoutMs,
      reap: this._cfg.reapOwnedProcessGroup,
      onProcessClosed: (payload) => {
        session.processClosedEmitted = true;
        this._emit(session, 'lifecycle.process_closed', payload);
      },
      onReapUnconfirmed: (payload) => this._emit(session, 'lifecycle.process_reap_unconfirmed', payload),
      onStopConfirmed: (kind, payload) => {
        session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
        this._emit(session, kind, payload);
      },
    }) : null;
  }

  async _retryAfterAuthenticationRefresh(session, failedResult) {
    try {
      await this._cfg.credentialController.refresh();
      if (session.terminal || session.stopping) return;
      const oldChild = session.child;
      const oldPid = session.pid;
      const env = {
        ...session.spawnSpec.env,
        ...this._cfg.credentialController.projectionEnv(),
      };
      const child = spawn(this._cfg.cmd, session.spawnSpec.argv, {
        cwd: session.spawnSpec.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      session.child = child;
      session.pid = child.pid;
      session.buf = '';
      session.stderrCanaryTail = '';
      session.processClosePending = false;
      session.processClosedEmitted = false;
      session.retryAwaitingInit = true;
      session.spawnSpec = Object.freeze({ ...session.spawnSpec, env: Object.freeze({ ...env }) });
      session.processClose = this._newProcessCloseLatch(session);
      this._attachChild(session, child);
      try { process.kill(-oldPid, 'SIGKILL'); } catch { try { oldChild.kill('SIGKILL'); } catch {} }
    } catch (error) {
      session.turnInFlight = false;
      const failureCode = error?.code === 'authentication_required'
        ? 'authentication_required' : 'authentication_refresh_required';
      this._emit(session, 'lifecycle.turn_completed', {
        result: makeResult(
          'failed', failedResult.result, failedResult.usage, failedResult.total_cost_usd,
          failureCode, this._cfg.authenticationSummary?.(failureCode),
        ),
        usageSeal: unavailableUsageSeal(), pid: session.pid,
        modelRequested: session.modelRequested, modelObserved: session.modelObserved,
      });
    }
  }

  /** A can_use_tool / elicitation control_request FROM the wire, addressed TO us. */
  _handleIncomingControlRequest(session, obj) {
    const req = obj.request ?? {};
    const wireId = obj.request_id;
    if (req.subtype === 'can_use_tool') {
      // R4: requestId must be unique ACROSS WORKERS within one adapter instance — namespace it,
      // keeping the raw wire id internal for constructing the control_response. E3: the request's
      // own input and tool_use_id are retained — the CLI honors an allow ONLY when the response
      // echoes updatedInput and toolUseID (a bare allow is silently re-asked; live-caught).
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, { wireId, input: req.input, toolUseID: req.tool_use_id });
      this._emit(session, 'approval.requested', {
        requestId, toolName: req.tool_name, input: req.input, toolUseID: req.tool_use_id,
      });
      return;
    }
    if (req.subtype === 'elicitation') {
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, { wireId });
      this._emit(session, 'question.asked', { requestId, question: req.message });
      return;
    }
    // Unsupported subtype: reply with a benign error rather than leaving the CLI hanging on it.
    this._write(session, {
      type: 'control_response',
      response: { subtype: 'error', request_id: wireId, error: `unsupported control_request subtype ${req.subtype}` },
    });
  }

  /** A control_response matching a control_request WE sent (currently: interrupt only). */
  _handleIncomingControlResponse(session, obj) {
    const wireId = obj.response?.request_id;
    const resolve = session.pendingControlRequests.get(wireId);
    if (resolve) {
      session.pendingControlRequests.delete(wireId);
      resolve(obj.response);
    }
  }

  _nextWireRequestId(session) {
    session.reqSeq = (session.reqSeq ?? 0) + 1;
    return `ir_${session.reqSeq}`;
  }

  /**
   * Sends the exact interrupt control_request frame (§0/CS9) and returns a promise that resolves
   * with the matching control_response. If a turn is in flight, marks its eventual result for
   * discard (CS11) — this is set BEFORE the wire round trip so it's armed regardless of ordering.
   */
  _sendInterrupt(session) {
    const inFlight = session.turnInFlight;
    if (inFlight) session.discardNextResult = true;
    session.pendingInterrupt = {
      wireConfirmed: false,
      resultSeen: !inFlight,
      usageSeal: unavailableUsageSeal(),
      emitted: false,
    };
    const wireId = this._nextWireRequestId(session);
    this._emit(session, 'control.interrupt_requested', {});
    const confirmed = new Promise((resolve) => { session.pendingControlRequests.set(wireId, resolve); });
    this._write(session, { type: 'control_request', request_id: wireId, request: { subtype: 'interrupt' } });
    return confirmed;
  }

  _maybeConfirmInterrupt(session) {
    const pending = session.pendingInterrupt;
    if (!pending || pending.emitted || !pending.wireConfirmed || !pending.resultSeen || session.terminal) return;
    pending.emitted = true;
    if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
    this._emit(session, 'control.interrupt_confirmed', {
      sessionId: session.sessionIdWire,
      transportOpen: true,
      usageSeal: pending.usageSeal,
    });
    session.pendingInterrupt = null;
  }

  // ---------------------------------------------------------------------------
  // prompt — CS6/CS7/CS8
  // ---------------------------------------------------------------------------

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, notSent: true, reason: `unknown or terminal worker ${worker}` };

    if (mode === 'steer') {
      // CS8 as amended by erratum E2 (live-proven 2026-07-10): steer is NATIVE. A user frame
      // written mid-turn is consumed by the RUNNING turn at its next tool boundary — the turn
      // redirects without an interrupt round-trip, without aborting the in-flight tool call,
      // and without a phantom control.interrupt_confirmed that could satisfy a racing stop-
      // waiter. (An orchestrator that wants IMMEDIATE redirection — aborting the current tool
      // call — composes interrupt() + prompt() explicitly; that is a stop, not a steer.)
      // When no turn is in flight the same frame simply begins the next turn: wire truth.
      this._emit(session, 'control.steer', { midTurn: session.turnInFlight });
      this._writeUserFrame(session, content);
      return { ok: true };
    }

    // CS7 as amended by E2: 'turn' and 'nudge' are wire-identical for Claude — a plain `user`
    // frame. Sent while idle it begins the next turn; sent mid-turn the running turn absorbs
    // it (nudge semantics are therefore genuinely native here). Never silently emulated (CS19).
    this._writeUserFrame(session, content);
    return { ok: true };
  }

  /** Internal recovery dispatch that preserves the ordinary-spawn Brief dialect. */
  async promptBrief(worker, brief) {
    return this.prompt(worker, renderPrompt(brief), 'turn');
  }

  // ---------------------------------------------------------------------------
  // interrupt — CS9/CS10/CS11
  // ---------------------------------------------------------------------------

  async interrupt(worker) {
    if (this._emitPendingStop(worker, 'control.interrupt_confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: true }; // D9: interrupt always resolves
    const confirmed = this._sendInterrupt(session);
    confirmed.then(() => {
      if (session.terminal) return;
      if (session.pendingInterrupt) session.pendingInterrupt.wireConfirmed = true;
      this._maybeConfirmInterrupt(session);
    });
    return { ok: true }; // native — a real control-plane primitive, not a signal (CS9)
  }

  // ---------------------------------------------------------------------------
  // approve / answer — CS12/CS13/CS18
  // ---------------------------------------------------------------------------

  async approve(worker, requestId, decision, payload) {
    if (!this._cfg.approvals) {
      // CS18: no --permission-prompt-tool flag was ever passed; nothing to reply to.
      return { ok: false, reason: 'approve() unsupported: constructed with approvals:false' };
    }
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, reason: `unknown or terminal worker ${worker}` };
    const entry = session.wireToAdapterId.get(requestId);
    if (!entry) return { ok: false, reason: `no pending approval for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);
    const { wireId, input, toolUseID } = entry;

    // E3: mirror the Agent SDK's reference client exactly — every PermissionResult goes out
    // with the request's toolUseID, and an allow ALWAYS carries updatedInput (falling back to
    // the request's own input). Live-caught: {behavior:'allow'} alone is silently re-asked by
    // the CLI (fresh request_id) and the turn wedges.
    let permission;
    let emulated;
    if (decision === 'allow') {
      permission = { behavior: 'allow', updatedInput: payload?.updatedInput ?? input, toolUseID };
    } else if (decision === 'cancel') {
      // The wire's PermissionResult union has no native 'cancel' — closest achievable mapping,
      // flagged as emulated (D1 "no silent emulation").
      permission = { behavior: 'deny', message: payload?.message ?? 'cancelled by baton', interrupt: true, toolUseID };
      emulated = true;
    } else {
      permission = { behavior: 'deny', message: payload?.message ?? 'denied by baton', toolUseID };
    }

    this._write(session, { type: 'control_response', response: { subtype: 'success', request_id: wireId, response: permission } });
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    return emulated ? { ok: true, emulated: true } : { ok: true };
  }

  async answer(worker, requestId, reply = {}) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, reason: `unknown or terminal worker ${worker}` };

    if (session.pendingDecisionRequestId === requestId) {
      // Part B / F3(c): honest emulated mapping. There is no native wire frame for a typed
      // decision answer — the CLI's elicitation channel is unrelated to this grammar-parsed
      // request — so delivery is a plain user-turn continuation carrying the closed
      // DECISION_ANSWER grammar, always flagged `emulated` (D1: no silent emulation).
      // Checked BEFORE the approvals gate: a plain user-turn write needs no approval
      // authority, and the deployment constructs this adapter with approvals:false
      // (application-deployment.mjs builtInAdapters) — gating delivery on it refused every
      // live settlement and parked the gated worker forever (issue #30, w-145).
      session.pendingDecisionRequestId = null;
      if (reply?.expired === true) return { ok: true, emulated: true };
      const answerJson = reply.optionId != null
        ? JSON.stringify({ optionId: reply.optionId }) : JSON.stringify({ text: reply.text });
      this._writeUserFrame(session, `DECISION_ANSWER: ${answerJson}`);
      return { ok: true, emulated: true };
    }

    if (!this._cfg.approvals) {
      return { ok: false, reason: 'answer() unsupported: constructed with approvals:false' };
    }

    const entry = session.wireToAdapterId.get(requestId);
    if (!entry) return { ok: false, reason: `no pending question for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);
    const { wireId } = entry;

    const { text, decision } = reply;
    const action = decision ?? (text !== undefined ? 'accept' : 'decline');
    const response = { action, content: text !== undefined ? { value: text } : undefined };

    this._write(session, { type: 'control_response', response: { subtype: 'success', request_id: wireId, response } });
    this._emit(session, 'question.answered', { requestId, text, decision });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // kill — CS14
  // ---------------------------------------------------------------------------

  _signal(session, sig) {
    try { process.kill(-session.pid, sig); } catch { try { session.child.kill(sig); } catch { /* already gone */ } }
  }

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session && this._emitPendingStop(worker, 'kill.confirmed')) return { ok: true };
    if (!session) return { ok: true }; // D9: kill always resolves
    if (!session.processClose || session.processClose.confirmed) return { ok: true, terminal: true };
    if (!session.stopping) {
      session.stopping = true;
      this._emit(session, 'kill.requested', {});
      if (!session.terminal) this._signal(session, 'SIGTERM');
      // killGraceMs derivation: same SIGTERM->SIGKILL window the Agent SDK's own
      // ProcessTransport.close() uses (§1) — not an arbitrary number, and constructor-injectable.
      if (!session.terminal) {
        session.killTimer = setTimeout(() => {
          if (!session.terminal) this._signal(session, 'SIGKILL');
        }, this._cfg.killGraceMs);
      }
    }
    const terminalCause = session.timeoutFailure ? 'timeout' : session.processFailure ? 'process_error' : null;
    void session.processClose.authorizeStop('kill.confirmed', {
      signal: session.processClose.closeFact?.signal ?? 'SIGKILL',
      ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal(),
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Process lifecycle — CS16/CS17
  // ---------------------------------------------------------------------------

  async _onClose(session, code, signal) {
    if (session.terminal || session.processClosePending) return;
    session.processClosePending = true;
    if (session.killTimer) clearTimeout(session.killTimer);
    if (session.wallTimer) clearTimeout(session.wallTimer);
    if (!session.processClose) { session.terminal = true; return; }
    const wasStopping = session.stopping === true;
    const timeoutFailure = session.timeoutFailure;
    const processFailure = session.processFailure;
    const closeDerived = () => {
      if (timeoutFailure) {
        this._emit(session, 'lifecycle.crashed', timeoutFailure);
      } else if (processFailure) {
        this._emit(session, 'lifecycle.crashed', processFailure);
      } else if (!wasStopping && (session.turnInFlight || code !== 0)) {
        this._emit(session, 'lifecycle.crashed', { error: `exited ${code}${signal ? ` (${signal})` : ''}`, usageSeal: unavailableUsageSeal() });
      }
    };
    if (wasStopping) {
      const terminalCause = timeoutFailure ? 'timeout' : processFailure ? 'process_error' : null;
      session.processClose.authorizeStop('kill.confirmed', {
        signal, ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal(),
      });
    }
    session.terminal = true;
    await session.processClose.close(code, signal, session.spawnedEmitted, closeDerived);
  }

  _onSpawnError(session, err) {
    if (session.terminal) return;
    if (Number.isSafeInteger(session.pid) && session.pid > 0) {
      if (session.processFailure) return;
      session.processFailure = { error: String(err?.message ?? err), phase: 'process_error', usageSeal: unavailableUsageSeal() };
      this._signal(session, 'SIGKILL');
      return;
    }
    session.terminal = true;
    if (session.killTimer) clearTimeout(session.killTimer);
    if (session.wallTimer) clearTimeout(session.wallTimer);
    this._emit(session, 'lifecycle.crashed', { error: String(err?.message ?? err), usageSeal: unavailableUsageSeal() });
  }

  _onWallTimeout(session, timeoutMs) {
    if (session.terminal || session.deadEmitted || session.stopping) return;
    session.timeoutFailure = {
      error: `session wall-time budget exceeded (${timeoutMs}ms)`,
      phase: 'timeout',
      usageSeal: unavailableUsageSeal(),
    };
    this._signal(session, 'SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// GlmSessionCli — SC6 (spec/phase10/system-completion.md)
// ---------------------------------------------------------------------------

/**
 * The GLM session tier IS Claude Code driving GLM through Z.ai's Anthropic-compatible endpoint
 * (the officially supported path; there is no separate GLM session binary) — the proven one-shot
 * ZCodeCli env pattern (cli-adapters.mjs) lifted onto the session adapter, so every session verb
 * (mid-turn steer, interrupt, approvals) is inherited, not re-implemented.
 *
 * Credentials resolve `opts.authToken ?? authTokenFile ?? Z_AI_API_KEY ?? ZHIPU_API_KEY` at construction; absence
 * is NOT a constructor error — the credential boundary is live-smoke's gate, presence-checked
 * only, values never printed/logged/committed. Ceiling defaults to 1 (derived: Z.ai Pro ≈ one
 * in-flight session, same derivation as ZCodeCli) and stays configurable.
 *
 * card() adds `nonRefuserFor` — the explicit capability tag SC7's routing selects on, so
 * domain-sensitive work reaches the capable-non-refuser tier deterministically, never by
 * operator folklore.
 */
export class GlmSessionCli extends ClaudeSessionCli {
  constructor(opts = {}) {
    const token = opts.authToken ?? (opts.authTokenFile ? loadGlmAuthTokenFile(opts.authTokenFile, { jsonPointer: opts.authTokenJsonPointer }) : undefined) ?? process.env.Z_AI_API_KEY ?? process.env.ZHIPU_API_KEY;
    const validatedToken = token === undefined ? undefined : validInjectedToken(token, 'GLM');
    const observedVersion = opts.version === undefined
      ? observedClaudeVersion(opts.cmd ?? 'claude', opts.versionProbe)
      : null;
    super({
      ...opts,
      harness: opts.harness ?? 'glm-via-claude-session',
      version: opts.version ?? (observedVersion === 'unavailable'
        ? 'unavailable' : `claude-code-${observedVersion}+zai-anthropic`),
      ceiling: opts.ceiling ?? 1,
      env: {
        ANTHROPIC_BASE_URL: opts.baseUrl ?? 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: validatedToken ?? '',
        ...(opts.model ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model, ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model } : {}),
        ...opts.env,
      },
      providerSecrets: validatedToken ? [validatedToken] : [],
    });
    this._glmCredentialState = validatedToken ? 'available' : 'absent';
    this._nonRefuserFor = opts.nonRefuserFor ?? ['ml-ai-inference-training', 'cybersecurity'];
  }

  _validateProviderReady({ modelRequested, modelObserved }) {
    if (modelRequested !== null && modelRequested !== undefined
      && modelObserved !== modelRequested) {
      throw credentialError('GLM', 'model_mismatch');
    }
  }

  card() {
    const base = super.card();
    return {
      ...base,
      authPosture: 'api_key',
      modelSelection: {
        ...base.modelSelection,
        family: 'glm',
        acceptedPrefixes: ['glm-'],
        acceptedAliases: [],
        provenance: 'adapter-configuration+zai-model-mapping',
      },
      providerCompatibility: {
        provider: 'zai', transport: 'anthropic-compatible', credential: 'api_key',
        credentialState: this._glmCredentialState,
        nativeEffortObservation: 'unavailable',
      },
      nonRefuserFor: [...this._nonRefuserFor],
    };
  }
}

// ---------------------------------------------------------------------------
// KimiSessionCli — Phase 71 Kimi K3 through the Claude Code session harness
// ---------------------------------------------------------------------------

export class KimiSessionCli extends ClaudeSessionCli {
  constructor(opts = {}) {
    if (opts.harness !== undefined && opts.harness !== 'claude-code') {
      throw credentialError('Kimi', 'harness_identity_immutable');
    }
    const token = opts.authToken ?? (opts.authTokenFile
      ? loadProviderCredentialFile(opts.authTokenFile, {
        providerLabel: 'Kimi', jsonPointer: opts.authTokenJsonPointer ?? '/env/ANTHROPIC_AUTH_TOKEN',
        forbiddenRoots: opts.credentialForbiddenRoots ?? (opts.repoRoot ? [opts.repoRoot] : []),
      })
      : undefined);
    const validatedToken = token === undefined ? undefined : validInjectedToken(token, 'Kimi');
    super({
      ...opts,
      harness: 'claude-code',
      version: opts.version ?? observedClaudeVersion(opts.cmd ?? 'claude', opts.versionProbe),
      ceiling: opts.ceiling ?? 1,
      maxContext: opts.maxContext ?? 1_048_576,
      model: KIMI_MODEL,
      env: opts.env ?? {},
      providerSecrets: validatedToken ? [validatedToken] : [],
    });
    this._kimiToken = validatedToken;
  }

  _prepareProviderRoute({ model, effort, env }) {
    if (model !== KIMI_MODEL) throw credentialError('Kimi', 'model_unsupported');
    if (effort === undefined || effort === null || effort === '') throw credentialError('Kimi', 'effort_required');
    if (effort !== 'max') throw credentialError('Kimi', 'effort_unsupported');
    if (!this._kimiToken) throw credentialError('Kimi', 'credential_missing');
    const closed = { ...env };
    for (const key of Object.keys(closed)) {
      if (key.startsWith('ANTHROPIC_') || KIMI_PROVIDER_ENV.includes(key)
        || /^(AWS_|GOOGLE_|GCLOUD_|CLOUD_ML_|AZURE_|FOUNDRY_|ZAI_|Z_AI_|MOONSHOT_)/u.test(key)) delete closed[key];
    }
    Object.assign(closed, {
      ANTHROPIC_BASE_URL: KIMI_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: this._kimiToken,
      ANTHROPIC_MODEL: KIMI_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: KIMI_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: KIMI_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: KIMI_MODEL,
      ANTHROPIC_DEFAULT_FABLE_MODEL: KIMI_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: KIMI_MODEL,
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1048576',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
    });
    return { model: KIMI_MODEL, effort: 'max', env: closed };
  }

  _validateProviderReady({ modelRequested, modelObserved }) {
    if (modelRequested !== KIMI_MODEL || modelObserved !== KIMI_MODEL) {
      throw credentialError('Kimi', 'model_mismatch');
    }
  }

  card() {
    const base = super.card();
    return {
      ...base,
      authPosture: 'api_key',
      modelSelection: {
        ...base.modelSelection,
        configuredDefault: KIMI_MODEL,
        available: [KIMI_MODEL],
        family: 'kimi',
        acceptedPrefixes: [],
        acceptedAliases: [],
        reasoningEffort: ['max'],
        effortRequired: true,
        provenance: 'adapter-configuration+moonshot-anthropic-compatibility',
      },
      providerCompatibility: {
        provider: 'moonshot', transport: 'anthropic-compatible', credential: 'api_key',
        credentialState: this._kimiToken ? 'available' : 'absent',
        toolSearch: 'unsupported', nativeEffortObservation: 'unavailable',
      },
    };
  }
}
