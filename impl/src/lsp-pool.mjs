// #144 — the hub-managed LSP server pool (diagnostics tier foundation).
//
// Home of the folded contract v1.1 (docs/reference/evidence/lsp-support-2026-08-13/
// contract-fold.md): one lazily-started server per (repo, language), single-flight on
// concurrent demand, bounded by CONSTRUCTIVE caps (count/bytes/memory — never a clock,
// M2), with honest unavailability at every seam (a missing server binary is a typed
// not-ready, never a hang). The wedged trigger is the per-server OUTSTANDING-REQUEST
// ceiling (#89 row `lsp.pool.outstanding_requests`, count-derived); the only time bound
// anywhere in this module is the inherited bounded kill-wait inside
// reapOwnedProcessGroup (process-lifecycle.mjs) — a reap, not a scheduling control.
//
// Reused law (pinned green by the acceptance suite's GP rows, byte-unchanged here):
//   - the UNTRUSTED_ORIENTATION frame + the {baseTreeSha, indexEpoch, overlayDigest,
//     repoId, scopeDigest} freshness composition (coordinator.mjs _orientationFreshness)
//   - sanitizeVerifierDiagnosticText as the sanctioned repository-prose/tail sanitizer
//     (verifier-diagnostics.mjs) — no parallel redaction path is invented
//   - orientation_base_stale as the committed-move gate (atlas-index.mjs, reused)
//   - reapOwnedProcessGroup + ProcessCloseReapLatch's slot-clear-before-refusal
//     discipline (process-lifecycle.mjs)
//   - canonicalJson / compareCanonicalStrings for every ordering (locale-free, §6)
// LSP-derived evidence is EVIDENCE, never a trust-gate verdict input (D4.1) — this module
// mints no gate code and mutates no gate enum.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';

import { canonicalJson, compareCanonicalStrings } from './canonical-order.mjs';
import { processGroupAlive, reapOwnedProcessGroup } from './process-lifecycle.mjs';
import { sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';

// ── Closed vocabularies (§4 / D1.4 / D3.1 / M6 — frozen, exactly the contract's sets) ──────

export const LSP_REFUSAL_FAMILY = Object.freeze([
  'lsp_language_not_opted_in',     // D1.5/D4.4 — opt-in gate before any spawn
  'lsp_pool_capacity_exceeded',    // D1.4(a) — max concurrent servers
  'lsp_workspace_scope_violation', // D1.2/M3 — worker-worktree classifier
  'lsp_server_unavailable',        // D1.3/D4.2 — closed reason set below
  'lsp_startup_failed',            // D1.3/B2 — handshake fail; single-flight slot clears first
  'lsp_reap_unconfirmed',          // D4.2 — unreapable group, never fakes closure
  'lsp_evidence_unsanitized',      // D4.3/M6 — raw output crossed a worker seam
  'lsp_proven_zero_conflict',      // D3.4/B4 — absence-cache effective-view conflict
]);

export const LSP_REUSED_REFUSALS = Object.freeze([
  'orientation_base_stale', // atlas committed-move gate (D3.5)
  'ambiguous_symbol',       // static atlas (GT3)
  'symbol_not_found',       // static atlas (GT3)
  'context_read_invalid',   // read-port (GT4)
]);

export const LSP_SERVER_UNAVAILABLE_REASONS = Object.freeze([
  'starting', 'wedged', 'base_root_dirty', 'start_refused',
]);

export const LSP_CODE_OPS = Object.freeze([
  'code.symbol', 'code.references', 'code.hover', 'code.index_status',
]);

// OQ1: the dot→underscore projection of the op family (context.read verbs).
export const LSP_CODE_VERBS = Object.freeze(LSP_CODE_OPS.map((op) => op.replace(/\./gu, '_')));

// M6: every LSP output class maps to exactly one sanctioned sanitizer — a class outside
// this map never crosses a worker seam (lsp_evidence_unsanitized). The NAMES designate the
// sanctioned path; repository_prose / red_green_coverage_tail route verbatim through
// sanitizeVerifierDiagnosticText, attention_class through the same sanctioned discipline
// (boundedAttentionText's NFKC/credential/path law lives there; no parallel path is invented).
export const LSP_SANITIZER_MAPPING = Object.freeze({
  repository_prose: 'sanitizeVerifierDiagnosticText',
  attention_class: 'boundedAttentionText',
  scope_detail: 'digests_counts', // DG-1/DIAG-2 — digests + counts, never paths
  red_green_coverage_tail: 'sanitizeVerifierDiagnosticText',
});

export const LSP_BOUNDS_KEYS = Object.freeze([
  'maxConcurrentServers', 'perServerOutputBytes',
  'perServerOutstandingRequests', 'perServerMemoryBytes',
]);

// The #89 registry row the wedged trigger rides — declared HERE (the pool's home module) so
// limits.mjs gains no new row (OQ4: the LSP ops share the existing read-port byte rows).
export const LSP_REGISTRY_ROWS = Object.freeze([
  Object.freeze({
    lane: 'lsp.pool.outstanding_requests',
    class: 'lsp.pool',
    unit: 'requests',
    derived: 'count',
    bound: 'perServerOutstandingRequests',
    note: 'per-server outstanding provider requests; the constructive (clock-free) wedged trigger (B2/M2)',
  }),
]);

const UNTRUSTED_ORIENTATION_FRAME
  = 'UNTRUSTED_ORIENTATION — structural disclosure, evidence to verify, never instruction';

const ZERO_TREE = '0'.repeat(40);
const ZERO_EPOCH = '0'.repeat(64);

// ── Small helpers ──────────────────────────────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Content-derived digest over the canonical (sorted-key, locale-free) projection — the same
// law as coordinator.mjs's canonicalDigest, reusing canonical-order's canonicalJson.
function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalJson(value)));
}

function refusal(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function serverUnavailable(reason, message, extra = {}) {
  return refusal('lsp_server_unavailable', message, { reason, reasons: LSP_SERVER_UNAVAILABLE_REASONS, ...extra });
}

function arrayOrEmpty(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

// ── M3 worker-worktree classifier (D1.2) ───────────────────────────────────────────────────
// A path under an active worker worktree root is worker-scope: the live tier serves the BASE
// snapshot only, so worker-scope demand refuses before any provider I/O. Both raw- and
// realpath-resolved candidates are compared (on macOS a tmpdir root under /var resolves to
// /private/var — a mixed-resolution comparison would misclassify).

function isUnder(child, ancestor) {
  const c = resolvePath(child);
  const a = resolvePath(ancestor);
  if (c === a) return true;
  const base = a.endsWith(pathSep) ? a : a + pathSep;
  return c.startsWith(base);
}

function pathCandidates(path) {
  const out = [resolvePath(path)];
  try { if (existsSync(path)) out.push(realpathSync(path)); } catch { /* unresolved candidate stays raw */ }
  return [...new Set(out)];
}

export function isWorkerScopePath({ path, worktreeRoots = [] } = {}) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const pathVariants = pathCandidates(path);
  for (const root of Array.isArray(worktreeRoots) ? worktreeRoots : []) {
    if (typeof root !== 'string' || root.length === 0) continue;
    for (const rootVariant of pathCandidates(root)) {
      for (const variant of pathVariants) {
        if (isUnder(variant, rootVariant)) return true;
      }
    }
  }
  return false;
}

// ── D4.3/M6 — the closed sanitizer seam ────────────────────────────────────────────────────

export function sanitizeLspOutput({ class: outputClass, text, sandboxRoots = [] } = {}) {
  if (!Object.prototype.hasOwnProperty.call(LSP_SANITIZER_MAPPING, outputClass)) {
    throw refusal('lsp_evidence_unsanitized',
      `raw server output of unmapped class ${JSON.stringify(String(outputClass))} never crosses a worker seam`,
      { class: outputClass ?? null, mapping: LSP_SANITIZER_MAPPING });
  }
  const raw = typeof text === 'string' ? text : String(text ?? '');
  let sanitized;
  if (outputClass === 'scope_detail') {
    // DG-1/DIAG-2: scope-class detail projects as digests + counts, never paths.
    sanitized = JSON.stringify({
      contentDigest: sha256(raw),
      counts: { bytes: Buffer.byteLength(raw, 'utf8'), lines: raw.length === 0 ? 0 : raw.split('\n').length },
    });
  } else {
    sanitized = sanitizeVerifierDiagnosticText(raw, { sandboxRoots }).text;
  }
  return Object.freeze({
    text: sanitized,
    frame: UNTRUSTED_ORIENTATION_FRAME,
    class: outputClass,
    sanitizer: LSP_SANITIZER_MAPPING[outputClass],
  });
}

// ── D3.4/B4 — the effective-view absence-cache key ─────────────────────────────────────────

export function provenZeroKey({ base_epoch, overlayDigest, normalized_query } = {}) {
  return canonicalDigest({
    base_epoch: base_epoch ?? ZERO_EPOCH,
    overlayDigest: overlayDigest ?? ZERO_EPOCH,
    normalized_query: normalized_query ?? '',
  });
}

// ── D2.1/B5a — the symbol-accurate evidence projection ─────────────────────────────────────
// The worker-facing surface carries symbol NAMES + file DIGESTS; raw diagnostic paths stay
// inside the digest-only capsule (F9: the resolved name, never '').

export function projectSymbolEvidence({ diagnostics, resolve } = {}) {
  const list = arrayOrEmpty(diagnostics);
  const symbols = [];
  for (const diagnostic of list) {
    const resolved = typeof resolve === 'function' ? arrayOrEmpty(resolve(diagnostic)) : [];
    for (const symbol of resolved) {
      if (symbol && typeof symbol === 'object' && typeof symbol.name === 'string' && symbol.name.length > 0) {
        symbols.push({
          name: symbol.name,
          fileDigest: typeof symbol.fileDigest === 'string' ? symbol.fileDigest : '',
          kind: symbol.kind ?? null,
        });
      }
    }
  }
  symbols.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  const capsule = Object.freeze({
    diagnosticsDigest: canonicalDigest(list),
    diagnosticCount: list.length,
    pathCount: new Set(list.map((d) => d?.file).filter((f) => typeof f === 'string' && f.length > 0)).size,
    symbolCount: symbols.length,
  });
  return Object.freeze({ symbols: Object.freeze(symbols.map(Object.freeze)), capsule });
}

// ── D2.2/B5b — the advisory blast-radius projection ────────────────────────────────────────
// An evidence leaf: files cited by digest, marked advisory/annotation, NEVER carrying a
// coverageOfChange verdict (the referee's textual scan stays the sole gate input, GP-E).

export function computeBlastRadius({ changedLines, resolve } = {}) {
  if (!changedLines || typeof changedLines !== 'object' || Array.isArray(changedLines)) return null;
  const files = Object.keys(changedLines).sort(compareCanonicalStrings);
  if (files.length === 0) return null;
  const defines = [];
  for (const file of files) {
    if (resolve && typeof resolve.defines === 'function') {
      for (const defined of arrayOrEmpty(resolve.defines(file))) {
        if (defined !== undefined && defined !== null) defines.push(String(defined));
      }
    }
  }
  const references = [];
  if (resolve && typeof resolve.references === 'function') {
    for (const reference of arrayOrEmpty(resolve.references(files))) {
      if (reference && typeof reference === 'object') {
        references.push({
          name: typeof reference.name === 'string' ? reference.name : '',
          fileDigest: typeof reference.fileDigest === 'string' ? reference.fileDigest : '',
        });
      }
    }
  }
  defines.sort(compareCanonicalStrings);
  references.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  return Object.freeze({
    annotation: true,
    advisory: true,
    evidence: true,
    changedFiles: Object.freeze(files.map((file) => Object.freeze({
      fileDigest: sha256(file),
      lineCount: Array.isArray(changedLines[file]) ? changedLines[file].length : 0,
    }))),
    defines: Object.freeze([...new Set(defines)]),
    references: Object.freeze(references.map(Object.freeze)),
    note: 'advisory annotation only — an evidence leaf that never feeds a coverage gate (B5b)',
  });
}

// ── D2.3/B5a — the digests+counts worker reject receipt ────────────────────────────────────

export function renderWorkerRejectReceipt({ symbolEvidence } = {}) {
  const symbols = arrayOrEmpty(symbolEvidence?.symbols)
    .filter((s) => s && typeof s === 'object')
    .map((s) => Object.freeze({
      name: typeof s.name === 'string' ? s.name : '',
      fileDigest: typeof s.fileDigest === 'string' ? s.fileDigest : '',
      ...(s.kind ? { kind: s.kind } : {}),
    }));
  const capsule = symbolEvidence?.capsule && typeof symbolEvidence.capsule === 'object'
    ? symbolEvidence.capsule : {};
  const digests = {};
  for (const [key, value] of Object.entries(capsule)) {
    if (/Digest$/u.test(key) && typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) digests[key] = value;
  }
  if (Object.keys(digests).length === 0) {
    digests.symbolEvidenceDigest = canonicalDigest(symbols.map((s) => ({ name: s.name, fileDigest: s.fileDigest })));
  }
  const counts = {
    symbols: symbols.length,
    paths: Number.isFinite(capsule.pathCount) ? capsule.pathCount : 0,
    diagnostics: Number.isFinite(capsule.diagnosticCount)
      ? capsule.diagnosticCount : (Number.isFinite(capsule.pathCount) ? capsule.pathCount : 0),
  };
  return Object.freeze({
    digests: Object.freeze(digests),
    counts: Object.freeze(counts),
    symbols: Object.freeze(symbols),
    frame: UNTRUSTED_ORIENTATION_FRAME,
  });
}

// ── The pool (D1) ──────────────────────────────────────────────────────────────────────────

// Supervision registry for host-exit teardown. Servers are detached group leaders and are
// unref'd (an idle pool never pins the host event loop); this latch is the belt to the
// inherited reap's braces — the bounded reap remains the real discipline (D4.2).
const LIVE_CHILDREN = new Set();
let exitLatchWired = false;
function killLiveChildren() {
  for (const child of [...LIVE_CHILDREN]) {
    try { child.kill('SIGKILL'); } catch { /* best effort; the bounded group reap is the discipline */ }
  }
  LIVE_CHILDREN.clear();
}
function wireExitLatch() {
  if (exitLatchWired) return;
  exitLatchWired = true;
  process.once('exit', killLiveChildren);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { killLiveChildren(); process.exit(0); });
  }
}

// op → LSP method (M4 degradation targets stay the atlas rungs: code.symbol → symbol.search,
// code.references → symbol.references before search.lexical).
const OP_METHODS = Object.freeze({
  'code.symbol': 'workspace/symbol',
  'code.references': 'textDocument/references',
  'code.hover': 'textDocument/hover',
  'code.index_status': null, // a pool-local projection, never provider I/O
});

function pathToUri(path) {
  return `file://${resolvePath(path).split(pathSep).map(encodeURIComponent).join(pathSep).replace(/^%2F/u, '/')}`;
}

function gitText(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 22 });
  } catch {
    return null;
  }
}
function gitHolds(root, objectish) {
  return gitText(root, ['cat-file', '-e', objectish]) !== null;
}

export function createLspPool(config = {}) {
  const repoId = typeof config.repoId === 'string' && config.repoId ? config.repoId : 'repo-unspecified';
  const baseRoot = resolvePath(typeof config.baseRoot === 'string' && config.baseRoot ? config.baseRoot : process.cwd());
  const baseEpoch = typeof config.baseEpoch === 'string' && config.baseEpoch ? config.baseEpoch : null;
  const worktreeRoots = (Array.isArray(config.worktreeRoots) ? config.worktreeRoots : [])
    .filter((root) => typeof root === 'string' && root.length > 0);
  const languages = config.languages && typeof config.languages === 'object' ? config.languages : {};
  const indexRung = config.indexRung && typeof config.indexRung === 'object' ? config.indexRung : { available: false };

  // D1.4: the four constructive caps. When the deployment declares no bounds the defaults are
  // DERIVED, never arbitrary: one server per declared language (the pool's own construction),
  // memory from the declared per-language reservations, and no artificial output/outstanding
  // ceiling (resource availability is the natural throttle).
  const declaredLanguages = Object.values(languages).filter((l) => l && typeof l === 'object');
  const derivedDefaults = {
    maxConcurrentServers: Math.max(1, declaredLanguages.length),
    perServerOutputBytes: Number.POSITIVE_INFINITY,
    perServerOutstandingRequests: Number.POSITIVE_INFINITY,
    perServerMemoryBytes: declaredLanguages.reduce(
      (max, l) => Math.max(max, Number.isFinite(l.memory) ? l.memory : 0), 0,
    ) || Number.POSITIVE_INFINITY,
  };
  const declaredBounds = config.bounds && typeof config.bounds === 'object' ? config.bounds : {};
  const bounds = Object.freeze(Object.fromEntries(LSP_BOUNDS_KEYS.map((key) => [key,
    Number.isFinite(declaredBounds[key]) ? declaredBounds[key] : derivedDefaults[key]])));

  const scopeDigest = canonicalDigest({ repoId, worktreeRoots: [...worktreeRoots].sort(compareCanonicalStrings) });

  // Freshness composition — exactly the declared frame/order (GP-B pins the law):
  // {baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}, content-derived.
  function freshnessDigestFor(overlayDigest) {
    return canonicalDigest({
      baseTreeSha: baseEpoch ?? ZERO_TREE,
      indexEpoch: baseEpoch ?? ZERO_EPOCH,
      overlayDigest: overlayDigest ?? ZERO_EPOCH,
      repoId,
      scopeDigest,
    });
  }

  // ── Base hygiene (D3.3/B3/D3.5) — git/content-derived, never a clock ─────────────────────

  // A `git status --porcelain` entry is the overlay's territory (not deployment drift) when it
  // falls under a DECLARED worker worktree root, or when the entry is an ancestor directory of
  // one (the untracked parent `?? .baton/` exists only because the worktree does).
  function entryIsWorktreeTerritory(root, porcelainLine) {
    const quoted = porcelainLine.slice(3).trim();
    const path = (quoted.startsWith('"') && quoted.endsWith('"') ? quoted.slice(1, -1) : quoted)
      .replace(/\/$/u, '');
    if (path.length === 0) return false;
    const dirtAbs = resolvePath(root, path);
    for (const declared of worktreeRoots) {
      for (const variant of pathCandidates(declared)) {
        if (isUnder(dirtAbs, variant) || isUnder(variant, dirtAbs)) return true;
      }
    }
    return false;
  }

  function assertBaseHygiene({ baseRootOverride, baseEpochOverride } = {}) {
    const root = typeof baseRootOverride === 'string' && baseRootOverride ? resolvePath(baseRootOverride) : baseRoot;
    const epoch = typeof baseEpochOverride === 'string' && baseEpochOverride ? baseEpochOverride : baseEpoch;
    const headTree = gitText(root, ['rev-parse', '--verify', 'HEAD^{tree}']);
    if (typeof epoch === 'string' && epoch.length > 0 && headTree && headTree !== epoch) {
      // An epoch the repository still HOLDS while HEAD moved is a committed move → the reused
      // atlas gate (refuse-then-restart, OQ3). An epoch resolving to no object is externally
      // attested (the deployment's own pin) — the pool serves under it and attests it back.
      if (gitHolds(root, epoch)) {
        throw refusal('orientation_base_stale',
          'orientation base tree moved under the pinned epoch (committed move) — refuse-then-restart',
          { base_epoch: epoch, head_tree: headTree.trim(), reused: true });
      }
    }
    const porcelain = gitText(root, ['status', '--porcelain']);
    if (porcelain !== null) {
      const drift = porcelain.split('\n')
        .filter(Boolean)
        .filter((line) => !entryIsWorktreeTerritory(root, line));
      if (drift.length > 0) {
        throw serverUnavailable('base_root_dirty',
          `base root carries ${drift.length} uncommitted entr${drift.length === 1 ? 'y' : 'ies'} outside the declared worker worktree territory — never base+dirty served as fresh`,
          { baseRoot: root, driftCount: drift.length });
      }
    }
  }

  // ── Server lifecycle (D1.3/B2) ───────────────────────────────────────────────────────────

  const servers = new Map();    // compositeKey (language\0demand) → entry — the live single-flight slots
  const byLanguage = new Map(); // language → latest live entry
  const lifecycleLog = [];      // ordered {name, language, generation}
  const provenZeroCache = new Map();
  let generationCounter = 0;

  function recordEvent(name, entry) {
    lifecycleLog.push(Object.freeze({ name, language: entry.language, generation: entry.generation }));
  }

  function detachEntry(entry) {
    if (servers.get(entry.key) === entry) servers.delete(entry.key);
    if (byLanguage.get(entry.language) === entry) byLanguage.delete(entry.language);
  }

  function rejectPending(entry, error) {
    for (const waiter of entry.pending.values()) waiter.reject(error);
    entry.pending.clear();
    entry.outstanding = 0;
  }

  // The inherited bounded reap (GP-G) — the only kill discipline. An unconfirmed result
  // publishes lsp_reap_unconfirmed; closure is never faked (D4.2).
  function scheduleReap(entry, cause) {
    const pid = entry.child.pid;
    Promise.resolve()
      .then(() => reapOwnedProcessGroup(pid, {}))
      .then((reaped) => {
        if (reaped?.confirmed === true) {
          recordEvent('lifecycle.process_reaped', entry);
        } else {
          recordEvent('lifecycle.process_reap_unconfirmed', entry);
          lifecycleLog.push(Object.freeze({
            name: 'lsp_reap_unconfirmed', language: entry.language, generation: entry.generation,
            reason: reaped?.reason ?? 'probe_error', cause,
          }));
        }
      })
      .catch(() => {
        recordEvent('lifecycle.process_reap_unconfirmed', entry);
      });
  }

  // B2 slot-clear-before-refusal (the ProcessCloseReapLatch precedent, GP-G): the entry leaves
  // the single-flight map BEFORE the typed refusal is published, so the very next demand starts
  // a fresh generation — never a parked failure.
  function wedgeEntry(entry, reason) {
    if (entry.state === 'wedged' || entry.state === 'exited') return;
    entry.state = 'wedged';
    detachEntry(entry);
    recordEvent('lifecycle.process_wedged', entry);
    rejectPending(entry, serverUnavailable(reason ?? 'wedged',
      `server wedged: ${entry.outstanding} provider requests outstanding at the count-derived ceiling`,
      { language: entry.language, generation: entry.generation }));
    scheduleReap(entry, 'wedged');
  }

  function markReady(entry, result) {
    if (entry.state !== 'starting') return;
    entry.capabilities = result?.capabilities ?? {};
    entry.serverInfo = result?.serverInfo ?? {};
    writeMessage(entry, { jsonrpc: '2.0', method: 'initialized', params: {} });
    entry.state = 'ready';
    recordEvent('lifecycle.process_ready', entry);
    for (const waiter of entry.readyWaiters) waiter.resolve({ generation: entry.generation });
    entry.readyWaiters.length = 0;
  }

  function onChildExit(entry, code, signal) {
    LIVE_CHILDREN.delete(entry.child);
    const wasStarting = entry.state === 'starting';
    entry.state = 'exited';
    detachEntry(entry);
    recordEvent(wasStarting ? 'lifecycle.process_exited_before_ready' : 'lifecycle.process_exited', entry);
    if (wasStarting) {
      const failure = refusal('lsp_startup_failed',
        `LSP server exited before the initialize handshake completed (code ${code ?? 'null'}, signal ${signal ?? 'none'}) — the start slot cleared before this refusal`,
        { language: entry.language, generation: entry.generation, exitCode: code ?? null });
      for (const waiter of entry.readyWaiters) waiter.reject(failure);
      entry.readyWaiters.length = 0;
      rejectPending(entry, failure);
    } else {
      rejectPending(entry, serverUnavailable('start_refused',
        'server process exited before answering its outstanding requests',
        { language: entry.language, generation: entry.generation }));
    }
  }

  function writeMessage(entry, message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    entry.child.stdin.write(Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
      body,
    ]));
  }

  function sendRequest(entry, method, params, { countsOutstanding = true } = {}) {
    const id = entry.nextRequestId;
    entry.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject });
      if (countsOutstanding) entry.outstanding += 1;
      try {
        writeMessage(entry, { jsonrpc: '2.0', id, method, params });
      } catch (error) {
        entry.pending.delete(id);
        if (countsOutstanding) entry.outstanding -= 1;
        reject(serverUnavailable('start_refused', `failed to frame ${method} for the server: ${error?.message ?? error}`));
      }
    });
  }

  function dispatch(entry, message) {
    if (message && typeof message === 'object' && message.id !== undefined
      && (message.result !== undefined || message.error !== undefined)) {
      const waiter = entry.pending.get(message.id);
      if (!waiter) return;
      entry.pending.delete(message.id);
      if (entry.initializePending && message.id === entry.initializeId) entry.initializePending = false;
      else if (entry.outstanding > 0) entry.outstanding -= 1;
      if (message.error !== undefined) {
        waiter.reject(refusal('lsp_server_unavailable',
          `server answered ${JSON.stringify(String(message.id))} with an RPC error`,
          { reason: 'start_refused', rpcError: message.error }));
      } else {
        waiter.resolve(message.result);
      }
    }
    // Notifications from the server (window/..., $/...) are drained — never instruction.
  }

  function wireFraming(entry) {
    let buffered = Buffer.alloc(0);
    const child = entry.child;
    child.stdout.on('data', (chunk) => {
      entry.capturedOutputBytes += chunk.length;
      if (entry.capturedOutputBytes > bounds.perServerOutputBytes) {
        wedgeEntry(entry, 'wedged');
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = buffered.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/iu.exec(header);
        if (!match) break;
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffered.length < start + length) break;
        const body = buffered.subarray(start, start + length).toString('utf8');
        buffered = buffered.subarray(start + length);
        try {
          dispatch(entry, JSON.parse(body));
        } catch { /* a malformed frame is drained, never fatal */ }
      }
    });
    child.stdout.on('error', () => { /* a closed pipe never throws at the host */ });
    child.stderr.on('data', () => { /* toolchain stderr is contained, never surfaced raw */ });
    child.stderr.on('error', () => {});
    child.stdin.on('error', () => { /* EPIPE on a crashed server is the exit path's fact */ });
    // Detached + unref'd: an idle (or silently wedged) server never pins the host event loop.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      if (stream && typeof stream.unref === 'function') stream.unref();
    }
    child.on('exit', (code, signal) => onChildExit(entry, code, signal));
  }

  function spawnServerEntry(language, compositeKey) {
    const languageConfig = languages[language];
    const command = languageConfig?.server?.command;
    const args = Array.isArray(languageConfig?.server?.args) ? languageConfig.server.args : [];
    if (typeof command !== 'string' || command.length === 0) {
      // Honest unavailability: a missing server binary is a typed not-ready, never a hang.
      throw serverUnavailable('start_refused',
        `no server command declared for ${JSON.stringify(language)}`,
        { language });
    }
    wireExitLatch();
    generationCounter += 1;
    const child = spawn(command, args, {
      cwd: baseRoot,
      detached: true, // group leader: the group reap owns the whole tree (D4.2)
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    LIVE_CHILDREN.add(child);
    const entry = {
      language,
      key: compositeKey,
      generation: generationCounter,
      child,
      state: 'starting',
      capabilities: null,
      serverInfo: null,
      outstanding: 0,          // provider requests in flight (the #89 count, never a clock)
      capturedOutputBytes: 0,
      nextRequestId: 1,
      initializeId: null,
      initializePending: false,
      pending: new Map(),
      readyWaiters: [],
    };
    entry.handle = Object.freeze({
      language,
      generation: entry.generation,
      key: compositeKey,
      repoId,
      stateOf: () => entry.state,
      outstandingRequests: () => entry.outstanding,
      toString: () => `lsp-server(${repoId}/${language}#gen${entry.generation})`,
    });
    servers.set(compositeKey, entry);
    byLanguage.set(language, entry);
    // Lifecycle order: process_started is recorded BEFORE any provider I/O (R3); the
    // initialize handshake rides the same pipe everything else does.
    recordEvent('lifecycle.process_started', entry);
    wireFraming(entry);
    entry.initializePending = true;
    entry.initializeId = entry.nextRequestId;
    sendRequest(entry, 'initialize', {
      processId: process.pid,
      capabilities: {},
      rootUri: pathToUri(baseRoot),
      workspaceFolders: [{ uri: pathToUri(baseRoot), name: repoId }],
    }, { countsOutstanding: false })
      .then((result) => markReady(entry, result))
      .catch(() => { /* the exit/wedged path publishes the typed failure */ });
    return entry;
  }

  function isOptedIn(language) {
    const languageConfig = languages[language];
    return Boolean(languageConfig && typeof languageConfig.server === 'object'
      && typeof languageConfig.server.command === 'string' && languageConfig.server.command.length > 0);
  }

  function capacityRefusal(cap, actual, unit, what) {
    return refusal('lsp_pool_capacity_exceeded',
      `${what} would hold ${actual} against the ${cap}-server constructive cap`,
      { detail: Object.freeze({ cap, actual, unit }), info: Object.freeze({ cap, actual, unit }) });
  }

  function currentEntry(language, demand) {
    const compositeKey = `${language} ${typeof demand === 'string' && demand ? demand : ''}`;
    const existing = servers.get(compositeKey);
    if (existing) {
      if (existing.outstanding >= bounds.perServerOutstandingRequests) {
        wedgeEntry(existing, 'wedged');
        throw serverUnavailable('wedged',
          `server for ${JSON.stringify(language)} is at its outstanding-request ceiling (${bounds.perServerOutstandingRequests}); reaped + restarted as a new generation`,
          { language, generation: existing.generation, ceiling: bounds.perServerOutstandingRequests });
      }
      return existing;
    }
    return null;
  }

  function startEntry(language, demand) {
    if (servers.size >= bounds.maxConcurrentServers) {
      throw capacityRefusal(bounds.maxConcurrentServers, servers.size + 1, 'servers', 'the pool');
    }
    const declaredMemory = languages[language]?.memory;
    if (Number.isFinite(declaredMemory) && declaredMemory > bounds.perServerMemoryBytes) {
      throw capacityRefusal(bounds.perServerMemoryBytes, declaredMemory, 'bytes', `the ${language} server reservation`);
    }
    assertBaseHygiene();
    return spawnServerEntry(language, `${language} ${typeof demand === 'string' && demand ? demand : ''}`);
  }

  function acquire({ language, path, demand } = {}) {
    if (!isOptedIn(language)) {
      // D1.5/B1: the opt-in gate refuses BEFORE any spawn (the live tier is opt-in only).
      throw refusal('lsp_language_not_opted_in',
        `language ${JSON.stringify(String(language))} is not opted in to the live LSP tier`,
        { language: language ?? null, optedIn: Object.keys(languages).filter(isOptedIn) });
    }
    if (typeof path === 'string' && path.length > 0 && isWorkerScopePath({ path, worktreeRoots })) {
      // D1.2/M3: worker-scope demand refuses before any provider I/O.
      throw refusal('lsp_workspace_scope_violation',
        'the named path is worker-scope (an active worker worktree); the live LSP tier serves the base snapshot only',
        { language, worktreeRoots: [...worktreeRoots] });
    }
    return (currentEntry(language, demand) ?? startEntry(language, demand)).handle;
  }

  function openServer({ language, baseRoot: baseRootOverride, baseEpoch: baseEpochOverride, demand } = {}) {
    if (!isOptedIn(language)) {
      throw refusal('lsp_language_not_opted_in',
        `language ${JSON.stringify(String(language))} is not opted in to the live LSP tier`,
        { language: language ?? null });
    }
    const existing = currentEntry(language, demand);
    if (existing) return existing.handle;
    if (servers.size >= bounds.maxConcurrentServers) {
      throw capacityRefusal(bounds.maxConcurrentServers, servers.size + 1, 'servers', 'the pool');
    }
    // B3: the clean-checkout gate runs at server-open, BEFORE any generation is spawned.
    assertBaseHygiene({ baseRootOverride, baseEpochOverride });
    return spawnServerEntry(language, `${language} ${typeof demand === 'string' && demand ? demand : ''}`).handle;
  }

  function ready(language) {
    return new Promise((resolve, reject) => {
      const entry = byLanguage.get(language);
      if (!entry) {
        reject(refusal('lsp_startup_failed',
          `no live generation for ${JSON.stringify(String(language))} (never started, or the last start failed with its slot cleared)`,
          { language }));
        return;
      }
      if (entry.state === 'ready') {
        resolve({ generation: entry.generation });
        return;
      }
      if (entry.state === 'starting') {
        // Bounded, arrival-driven readiness: resolves on the initialize response, rejects on
        // exit-before-ready — event-derived, never a wall-clock hard cap (F1).
        entry.readyWaiters.push({ resolve, reject });
        return;
      }
      reject(refusal('lsp_startup_failed',
        `the current generation for ${JSON.stringify(String(language))} is ${entry.state}, not starting`,
        { language, state: entry.state }));
    });
  }

  // ── Answers (D3) ─────────────────────────────────────────────────────────────────────────

  function baseEnvelope({ language, op, overlayDigest }) {
    const provenance = Object.freeze({
      repoId,
      base_epoch: baseEpoch,
      baseTreeSha: baseEpoch ?? ZERO_TREE,
      indexEpoch: baseEpoch ?? ZERO_EPOCH,
      overlayDigest: overlayDigest ?? ZERO_EPOCH,
      overlay_applied: false,        // M5: the pool tier is base-only by construction
      staleness: 'base_snapshot_only', // a worker can degrade to the overlay rung on this attestation
      servedBy: 'live_server',
    });
    const freshness = freshnessDigestFor(overlayDigest);
    return {
      op,
      verb: op.replace(/\./gu, '_'),
      language,
      frame: UNTRUSTED_ORIENTATION_FRAME,
      freshnessDigest: freshness,
      provenance,
      orientation: Object.freeze({
        frame: UNTRUSTED_ORIENTATION_FRAME,
        freshnessDigest: freshness,
        provenance,
      }),
    };
  }

  // The envelope is a plain object carrying the sync-observable contract fields, with
  // then/catch riding the live response promise (not a native Promise — the frame is readable
  // in the same tick the demand was made).
  function thenableEnvelope(fields, promise) {
    const envelope = { ...fields };
    envelope.then = (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected);
    envelope.catch = (onRejected) => promise.catch(onRejected);
    envelope.finally = (onFinally) => promise.finally(onFinally);
    return envelope;
  }

  function degradeEnvelope(envelope, language) {
    envelope.provenance = Object.freeze({
      ...envelope.provenance,
      servedBy: indexRung.available === true ? 'static_index' : 'typed_empty',
    });
    envelope.availability = Object.freeze({ status: 'empty' });
    envelope.language_ceiling = 'honest_empty';
    envelope.result = null;
    if (indexRung.available === true) {
      // M4: the degradation ladder — the static atlas rung serves before lexical/empty.
      envelope.degradedTo = 'static_index';
    }
    return envelope;
  }

  function methodParams(op, query) {
    if (op === 'code.hover') {
      return {
        textDocument: query?.textDocument ?? { uri: query?.uri ?? 'file:///base' },
        position: query?.position ?? { line: 0, character: 0 },
      };
    }
    if (op === 'code.references') {
      return {
        textDocument: query?.textDocument ?? { uri: query?.uri ?? 'file:///base' },
        position: query?.position ?? { line: 0, character: 0 },
        context: query?.context ?? { includeDeclaration: false },
      };
    }
    return { query: typeof query?.name === 'string' ? query.name : String(query?.query ?? query?.name ?? '') };
  }

  function projectAnswer(envelope, result) {
    return Object.freeze({
      op: envelope.op,
      language: envelope.language,
      frame: UNTRUSTED_ORIENTATION_FRAME,
      freshnessDigest: envelope.freshnessDigest,
      provenance: envelope.provenance,
      result,
      // D4.3: raw server output never crosses a seam unsanitized — the worker-facing
      // projection of this answer is the framed, sanitized leaf.
      safe: sanitizeLspOutput({ class: 'repository_prose', text: JSON.stringify(result ?? null) }),
    });
  }

  function answer({ language, op = 'code.hover', query = {}, overlayDigest = null, changedLines = null } = {}) {
    const envelope = baseEnvelope({ language, op, overlayDigest });
    if (changedLines && typeof changedLines === 'object' && !Array.isArray(changedLines)) {
      // F8: the verdict-producing path CONSULTS the blast projection — it annotates the
      // answer, never the coverage gate (B5b).
      envelope.blastRadius = computeBlastRadius({
        changedLines,
        resolve: { defines: () => [], references: () => [] },
      });
    }
    if (op === 'code.index_status') {
      envelope.result = indexStatus({ language });
      envelope.indexStatus = envelope.result;
      return thenableEnvelope(envelope, Promise.resolve(projectAnswer(envelope, envelope.result)));
    }
    if (!isOptedIn(language)) {
      // Opt-in governs the LIVE tier only: an un-opted (or serverless) language degrades down
      // the ladder to the static index rung or typed-empty — honest, never a raw throw.
      return thenableEnvelope(envelope, Promise.resolve(degradeEnvelope(envelope, language)));
    }
    const method = OP_METHODS[op] ?? 'workspace/symbol';
    let entry = currentEntry(language, null);
    if (!entry) entry = startEntry(language, null);
    const request = entry.state === 'ready'
      ? sendRequest(entry, method, methodParams(op, query))
      : ready(entry.language).then(() => {
        if (byLanguage.get(entry.language) !== entry) {
          throw serverUnavailable('start_refused',
            `the generation serving ${JSON.stringify(entry.language)} changed before ${method} was sent`,
            { language: entry.language });
        }
        return sendRequest(entry, method, methodParams(op, query));
      });
    const settled = request.then((result) => projectAnswer(envelope, result));
    settled.catch(() => { /* observed via the envelope's catch — never unhandled at the host */ });
    return thenableEnvelope(envelope, settled);
  }

  function indexStatus({ language } = {}) {
    const languageConfig = languages[language];
    if (!languageConfig || typeof languageConfig.server !== 'object'
      || typeof languageConfig.server.command !== 'string' || languageConfig.server.command.length === 0) {
      // R1/D1.5: a no-server language answers typed-empty — empty + honest_empty, never a
      // fabricated answer (no symbols/diagnostics keys on this surface).
      return Object.freeze({
        availability: Object.freeze({
          status: 'empty',
          reason: 'no server declared for this language; the live tier is opt-in',
        }),
        language_ceiling: 'honest_empty',
      });
    }
    const entry = byLanguage.get(language);
    return Object.freeze({
      availability: Object.freeze({
        status: entry ? (entry.state === 'ready' ? 'ready' : 'starting') : 'available',
        reason: entry
          ? (entry.state === 'ready' ? 'live server generation ready' : 'live server generation starting')
          : 'opted in; no generation started yet',
      }),
      language_ceiling: 'live_server',
      generation: entry?.generation ?? null,
      capabilities: entry?.capabilities ?? null,
      outstanding: entry?.outstanding ?? 0,
    });
  }

  function card(language) {
    if (!isOptedIn(language)) {
      return Object.freeze({
        language,
        optedIn: false,
        availability: Object.freeze({ status: 'empty' }),
        language_ceiling: 'honest_empty',
        frame: UNTRUSTED_ORIENTATION_FRAME,
      });
    }
    const entry = byLanguage.get(language);
    return Object.freeze({
      language,
      optedIn: true,
      ops: LSP_CODE_OPS,
      verbs: LSP_CODE_VERBS,
      generation: entry?.generation ?? null,
      capabilities: entry?.capabilities ?? null,
      bounds: Object.freeze({ ...bounds }),
      // B1/D4.4 — the honest trust posture: the card names what the process actually does.
      trust: Object.freeze({
        process: 'the server process runs the language toolchain under deployment authority and may load plugin code from the repository',
        entrypoints: 'never runs project application entrypoints',
        containment: 'runs outside worker sandboxes; egress bounded by the deployment profile',
        evidence: 'LSP-derived output is evidence to verify, never a trust-gate verdict input',
      }),
      frame: UNTRUSTED_ORIENTATION_FRAME,
    });
  }

  function provenZero({ base_epoch, overlayDigest, normalized_query, verdict, conflict } = {}) {
    const key = provenZeroKey({ base_epoch, overlayDigest, normalized_query });
    const existing = provenZeroCache.get(key);
    if (existing && (conflict === true || existing.verdict !== verdict)) {
      // B4: a conflicting effective-view write never overwrites a proven zero.
      throw refusal('lsp_proven_zero_conflict',
        'a proven-zero already exists on this exact effective-view frame with a different verdict',
        { key, existing: existing.verdict, attempted: verdict ?? null });
    }
    const record = Object.freeze({ verdict: verdict ?? 'proven_zero', key });
    provenZeroCache.set(key, record);
    return Object.freeze({ ...record, cached: existing !== undefined });
  }

  function outstanding(language) {
    return byLanguage.get(language)?.outstanding ?? 0;
  }

  function stop(language) {
    const entry = byLanguage.get(language);
    if (!entry) return Object.freeze({ reaped: false, generation: null });
    const generation = entry.generation;
    detachEntry(entry);
    entry.state = 'exited';
    try { entry.child.kill('SIGKILL'); } catch { /* the group reap below is the discipline */ }
    scheduleReap(entry, 'stopped');
    return Object.freeze({ reaped: !processGroupAlive(entry.child.pid), generation });
  }

  return Object.freeze({
    acquire,
    answer,
    openServer,
    provenZero,
    indexStatus,
    card,
    isOptedIn,
    ready,
    outstanding,
    stop,
    bounds: Object.freeze({ ...bounds }),
    registryRows: LSP_REGISTRY_ROWS,
    lastLifecycleEvents: () => lifecycleLog.map((event) => event.name),
    lastLifecycleLog: () => lifecycleLog.map((event) => ({ ...event })),
  });
}
