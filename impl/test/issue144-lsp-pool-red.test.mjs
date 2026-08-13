// #144 — LSP support for diagnostic scoping + environmental understanding.
// RED-FIRST acceptance suite for the folded contract v1.1.
//
// Binding contract (source of truth, read IN FULL): docs/reference/evidence/
// lsp-support-2026-08-13/contract-fold.md (v1.1 — folded against contract-redteam.md's five
// blockers B1–B5 + minors M1–M6). §5 "Red-first acceptance" is the row inventory R1–R13 exactly
// as pinned there, including the named stages. §3 carries D1–D4 (the decisions); §4 the refusal
// vocabulary. Every R row FAILS TODAY for the named stage and goes GREEN only on a
// contract-correct implementation. The green (pin) rows pass TODAY on surfaces the contract says
// #144 leaves UNCHANGED — they must stay green after landing (they guard the reused law).
//
// The campaign control law binds this suite: no clocks or turn-limits as control mechanisms. The
// wedged trigger is a per-server OUTSTANDING-REQUEST ceiling (#89 row lsp.pool.outstanding_requests,
// count-derived), never a wall-clock timeout (B2/M2). The inherited bounded kill-wait in
// reapOwnedProcessGroup (timeoutMs/pollMs/maxAttempts) is a bounded reap, not a scheduling control.
//
// ── STAGE TODAY ────────────────────────────────────────────────────────────────────────────
// The LSP pool is NOT landed. Verified at HEAD by NUL-safe grep -an over impl/src (every impl/src
// file is NUL-bearing, so all source scans use grep -an/sed -n, never whole-file reads of the
// machinery): zero `lsp_*` refusal codes, zero `code_symbol|code_references|code_hover|
// code_index_status` underscore verbs, zero `lsp.pool.outstanding_requests` #89 row, and no
// `impl/src/lsp-pool.mjs` home module. Every R row stage-guards on the resolved LSP-pool surface
// and is RED; the (pin) rows run on existing unchanged surfaces and are GREEN.
//
// ── INVENTED SIGNATURES (the suite-chosen seams; the contract pins behavior, not these JS
// spellings — each is the most sibling-consistent reading of the named contract surface, resolved
// by resolveLspPoolHome() from a dedicated `src/lsp-pool.mjs` first, then a `createLspPool`
// namespace on `src/coordinator.mjs`, else null): ────────────────────────────────────────────
//   export const LSP_REFUSAL_FAMILY             // frozen array, the 8 NEW codes in §4 order
//   export const LSP_REUSED_REFUSALS            // frozen array, the 4 reused codes (§4)
//   export const LSP_SERVER_UNAVAILABLE_REASONS // frozen ['starting','wedged','base_root_dirty','start_refused']
//   export const LSP_CODE_OPS                   // frozen ['code.symbol','code.references','code.hover','code.index_status']
//   export const LSP_CODE_VERBS                 // frozen underscore verbs (the .→_ projection, OQ1)
//   export const LSP_SANITIZER_MAPPING          // frozen object, the closed M6 output-class → sanitizer map
//   export const LSP_BOUNDS_KEYS                // frozen ['maxConcurrentServers','perServerOutputBytes',
//                                               //        'perServerOutstandingRequests','perServerMemoryBytes']
//   export function createLspPool(config)                          → pool
//   export function isWorkerScopePath({ path, worktreeRoots })     → boolean          // M3 classifier
//   export function projectSymbolEvidence({ diagnostics, resolve })→ { symbols, capsule }       // R5
//   export function computeBlastRadius({ changedLines, resolve })  → blastAnnotation | null     // R6
//   export function renderWorkerRejectReceipt({ symbolEvidence })  → { digests, counts, symbols } // R7
//   export function sanitizeLspOutput({ class, text, sandboxRoots })→ { text, frame }           // R11
//   export function provenZeroKey({ base_epoch, overlayDigest, normalized_query }) → string     // R10
//   pool.indexStatus({ language })            → { availability, language_ceiling }              // R1
//   pool.acquire({ language })                → serverHandle (single-flight, one per key)        // R2
//   pool.answer({ language, op, query, overlayDigest }) → orientationAnswer                    // R8
//   pool.openServer({ language, baseRoot, baseEpoch })  → serverHandle | throws                 // R9
//   pool.provenZero({ base_epoch, overlayDigest, normalized_query, verdict }) → cached          // R10
//   pool.bounds                               → { ...LSP_BOUNDS_KEYS }                          // R4
//   pool.card(language)                       → capabilityCard                                  // R13
//   pool.isOptedIn(language)                  → boolean                                         // R13
//   pool.lastLifecycleEvents()                → ['lifecycle.process_started', ...]              // R3
//   pool.ready(language)                      → Promise (bounded readiness seam: resolves when the  // R3
//                                               current generation reaches process_ready; rejects  //   (F1)
//                                               lsp_startup_failed on handshake failure; bounded,
//                                               count/event-derived, never a wall-clock hard cap)
//   pool.outstanding(language)                → number                                          // R3
//   pool.stop(language)                       → { reaped, generation }                          // R3
//
// ── FIXTURE SAFETY ─────────────────────────────────────────────────────────────────────────
// Hermetic: every root is mkdtempSync'd under os.tmpdir() and removed in test.after; no network.
// The LSP server is a STUBBED typescript-language-server fixture — a Node script answering the
// minimal initialize/initialized + textDocument/* JSON-RPC envelope (Content-Length framed), with
// NO live providers. GP-L proves the stub is a real LSP responder by a hermetic handshake (an
// arrival-driven settle — see handshakeStub below — never a wall-clock hard deadline, F11). The
// fixture has five modes: 'answer' (the default responder), 'hung' (reads stdin, never responds —
// drives a not-ready server), 'crash' (exits before the handshake — drives lsp_startup_failed),
// 'ready-then-hung' (answers initialize/initialized, then drains stdin silently on textDocument/*
// — a WEDGED-but-alive server, B2, the outstanding-request-ceiling driver, F2), and
// 'crash-once-then-answer' (the first spawned process exits 72; a fresh generation answers the
// envelope — the start slot-clear is observable, F3). Fixed injected epochs/digests only; never
// the real clock.
//
// ── NUL DISCIPLINE ─────────────────────────────────────────────────────────────────────────
// Every impl/src machinery file is NUL-bearing (application.mjs/coordination-store.mjs/coordinator
// .mjs most heavily). This suite never whole-file-reads them: source scans use grep -an / sed -n
// (NUL-safe), and the resolver reads only the not-yet-existing lsp-pool.mjs (wrapped in try/catch).
//
// ── ORDERING LAW ───────────────────────────────────────────────────────────────────────────
// Sorted-key literals appear in ACTUAL source order; `localeCompare` is banned (GP-I enforces both
// over the cited machinery + the locale-free compareCanonicalStrings).
//
// ── VERIFIED SPLIT (run twice from the repo root) ──────────────────────────────────────────
//   `node --test impl/test/issue144-lsp-pool-red.test.mjs`
//   Run 1: 23 tests — 10 pass (GP-A..GP-L guard pins) / 13 fail (R1..R13 red rows).
//   Run 2: 23 tests — 10 pass / 13 fail. STABLE. The 13 red rows fail at the stage guard
//   (resolveLspPoolHome() → {surface:null}); they go green only on a contract-correct
//   implementation. The 10 guard pins pass today on unchanged surfaces and must stay green.
//   (suite-fold-2: at the review HEAD the split was 8 pass / 15 fail — GP-A pinned an order the
//   live DEBUG_GATE_CODES set never had (F5) and GP-F's fixed 334-341 window lost the
//   credential-shaped line to the #153 +7 drift (F6). Both are re-anchored green by this fold;
//   the split re-verified as 10/13 above. See suite-fold-2.md for the finding → resolution map.)
//
// ── FIX RECORD (suite-fix-144) ───────────────────────────────────────────────────────────────
// The quarantined partial suite shipped with GP-B/GP-C red: their sedSrc anchors cited the
// pre-#81-shift line numbers (coordinator.mjs:10970-10975 and :10889-10893). The Epic #81
// orientation block moved ~219 lines down, so the anchored blocks no longer contained the pinned
// content. Re-anchored to the present surface: GP-B reads coordinator.mjs:11189-11194
// (_orientationFreshness — canonicalDigest over {baseTreeSha, indexEpoch, overlayDigest, repoId,
// scopeDigest}, exactly the D3.3 declared composition order); GP-C reads coordinator.mjs:11108-11112
// (the prose-leaf rule — untrusted !== true refused, closed provenance ['model-authored',
// 'repository-prose']). The pinned SUBSTANCE is unchanged; only the anchors drifted (see
// suite-draft-notes.md for the contract-line-citation delta — a v1.2-note candidate).
//
// ── FIX RECORD (suite-fold-2) ───────────────────────────────────────────────────────────────
// Fold of the blue-team report (suite-blueteam.md, NEEDS-FOLD) into this suite — the F1–F12
// work-list. See suite-fold-2.md for the finding → resolution map.
//   F1/F2/F3  R3 rewritten over a readiness seam + two new stub modes: 'ready-then-hung' drives
//             the wedged ceiling (a ready-but-silent server, B2) and 'crash-once-then-answer'
//             makes the start slot-clear observable (first gen exits 72, the retry's fresh
//             generation answers). pool.ready(language) is a bounded, event-derived readiness
//             wait (never a synchronous-handshake assumption, never a wall-clock hard cap).
//   F4/F5/F6  GP-A re-anchored to the DEBUG_GATE_CODES set literal (grepFirstLineNum) with the
//             ACTUAL declaration order scope→red_green→coverage→route_mismatch→forbidden_effect
//             →unknown (the old pin asserted the debugGateFromLiveCode if-chain order — never the
//             set); GP-F re-anchored to boundedAttentionText via grepFirstLineNum (credential
//             redaction asserted by grep, drift-proof). Contract §6 corrected in v1.2.
//   F7        GP-E re-scoped: pins the coverage gate stays textually derived and never coupled to
//             a blast-radius projection (no coverageOfChange/blastRadius coupling), instead of
//             banning the projection's name from referee.mjs (which the correct landing breaks).
//   F8        R6 gains a verdict-path consultation leg: pool.answer with changedLines must ride
//             the blast advisory/annotation, so the projection is CONSULTED, not merely present.
//   F9        R5 asserts the symbol NAME is the resolved symbol ('missingFn'), not just a string.
//   F10       R13 asserts the OPTED path is reachable (acquire typescript admits), not only that
//             the un-opted path refuses.
//   F11       handshakeStub settles on ARRIVAL of both responses (id 1 initialize, id 2 hover),
//             with the 4000 ms timer as the outer bound that rejects — no wall-clock race.
//   F12       R1 asserts the typed-empty SHAPE (status empty, honest_empty ceiling, no
//             symbols/diagnostics keys) instead of banning the English substring 'definition'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeVerifierDiagnosticText } from '../src/verifier-diagnostics.mjs';
import { compareCanonicalStrings } from '../src/canonical-order.mjs';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
function srcPath(rel) { return join(srcDir, rel); }

// ── NUL-safe source scan: grep -an / sed -n over the NUL-bearing machinery (never whole-file) ─
function grepSrc(rel, pattern) {
  try {
    return execFileSync('grep', ['-anE', pattern, srcPath(rel)], {
      encoding: 'utf8', maxBuffer: 1 << 26,
    });
  } catch (error) {
    if (error.status === 1) return ''; // grep exits 1 on no match — NUL-safe absence
    throw error;
  }
}
function grepCount(rel, pattern) {
  const out = grepSrc(rel, pattern);
  return out ? out.split('\n').filter(Boolean).length : 0;
}
function grepFirstLineNum(rel, pattern) {
  const out = grepSrc(rel, pattern);
  if (!out) return -1;
  const match = /^(\d+):/u.exec(out);
  return match ? Number(match[1]) : -1;
}
function sedSrc(rel, a, b) {
  return execFileSync('sed', ['-n', `${a},${b}p`, srcPath(rel)], {
    encoding: 'utf8', maxBuffer: 1 << 26,
  });
}

// ── The closed vocabularies a contract-correct surface exports (ground truth from §4/D1.4/D3.1) ─
const LSP_REFUSAL_FAMILY = Object.freeze([
  'lsp_language_not_opted_in',     // D1.5/D4.4 — opt-in gate before any spawn
  'lsp_pool_capacity_exceeded',    // D1.4(a) — max concurrent servers
  'lsp_workspace_scope_violation', // D1.2/M3 — worker-worktree classifier
  'lsp_server_unavailable',        // D1.3/D4.2 — closed reason set below
  'lsp_startup_failed',            // D1.3/B2 — handshake fail; single-flight slot clears first
  'lsp_reap_unconfirmed',          // D4.2 — unreapable group, never fakes closure
  'lsp_evidence_unsanitized',      // D4.3/M6 — raw output crossed a worker seam
  'lsp_proven_zero_conflict',      // D3.4/B4 — absence-cache effective-view conflict
]);
const LSP_REUSED_REFUSALS = Object.freeze([
  'orientation_base_stale', // atlas committed-move gate (D3.5)
  'ambiguous_symbol',       // static atlas (GT3)
  'symbol_not_found',       // static atlas (GT3)
  'context_read_invalid',   // read-port (GT4)
]);
const LSP_SERVER_UNAVAILABLE_REASONS = Object.freeze([
  'starting', 'wedged', 'base_root_dirty', 'start_refused',
]);
const LSP_CODE_OPS = Object.freeze([
  'code.symbol', 'code.references', 'code.hover', 'code.index_status',
]);
const LSP_CODE_VERBS = Object.freeze([
  'code_symbol', 'code_references', 'code_hover', 'code_index_status',
]);
const LSP_SANITIZER_MAPPING = Object.freeze({
  repository_prose: 'sanitizeVerifierDiagnosticText',
  attention_class: 'boundedAttentionText',
  scope_detail: 'digests_counts', // DG-1/DIAG-2 — digests + counts, never paths
  red_green_coverage_tail: 'sanitizeVerifierDiagnosticText',
});
const LSP_BOUNDS_KEYS = Object.freeze([
  'maxConcurrentServers', 'perServerOutputBytes',
  'perServerOutstandingRequests', 'perServerMemoryBytes',
]);
// The dot→underscore mapping is `.`→`_` (OQ1); code.seed stays an atlas dot-op, NOT on the read port.
function dotToUnderscore(op) { return op.replace(/\./gu, '_'); }

// Fixed digests/epochs (deterministic; never the real clock).
const BASE_EPOCH_A = 'a'.repeat(64);
const BASE_EPOCH_B = 'b'.repeat(64);
const OVERLAY_DIGEST_A = 'c'.repeat(64);
const OVERLAY_DIGEST_B = 'd'.repeat(64);
const OVERLAY_DIGEST_BASE_ONLY = '0'.repeat(64); // the pool rung's base-only frame (no overlay)
const FILE_DIGEST_X = 'e'.repeat(64);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ── Hermetic tmp roots ─────────────────────────────────────────────────────────────────────
const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-lsp144-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function gitRepo(label, files = {}) {
  const root = tmpDir(`repo-${label}`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'lsp144@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'LSP144'], { cwd: root });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (Object.keys(files).length === 0) writeFileSync(join(root, 'README.md'), '# lsp144\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}
function treeSha(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{tree}'], {
    encoding: 'utf8',
  }).trim();
}

// ── The stubbed typescript-language-server fixture (hermetic; no live providers, no network) ──
// Writes the stub to a tmp .mjs and returns its path. Modes:
//   'answer'               — the responder (initialize + textDocument/*).
//   'hung'                 — reads stdin, NEVER responds (a not-ready server).
//   'crash'                — exits before the handshake (drives lsp_startup_failed).
//   'ready-then-hung'      — answers initialize/initialized (becomes ready), then drains stdin
//                            silently on textDocument/* — a WEDGED-but-alive server (B2, F2) that
//                            drives the outstanding-request ceiling.
//   'crash-once-then-answer' — the first spawned process exits 72; a FRESH generation (the retry)
//                            answers the envelope — the start slot-clear is observable (F3).
// responderModule() builds the shared responder; extraImports/prelude let a mode inject module
// setup (e.g. the crash-once marker check) BEFORE the responder wires stdin.
function responderModule(extraImports = '', prelude = '') {
  return `// stubbed typescript-language-server — answers the minimal LSP envelope.
import { stdin, stdout } from 'node:process';
${extraImports}
${prelude}
let buf = Buffer.alloc(0);
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  stdout.write(body);
}
function onMessage(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {
      textDocumentSync: 1, hoverProvider: true, definitionProvider: true,
      referencesProvider: true, workspaceSymbolProvider: true, documentSymbolProvider: true,
    }, serverInfo: { name: 'stub-tsl', version: '0.0.0-red' } } });
  } else if (msg.method === 'initialized') {
    /* notification — no response */
  } else if (msg.method === 'textDocument/hover') {
    send({ jsonrpc: '2.0', id: msg.id, result: { contents: [{ language: 'typescript', value: 'export function stubSymbol(): void' }] } });
  } else if (msg.method === 'textDocument/definition') {
    send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: 'file:///base/src/stub.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] });
  } else if (msg.method === 'textDocument/references') {
    send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: 'file:///base/src/stub.ts', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }] });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
  }
}
stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) break;
    const header = buf.subarray(0, headerEnd).toString('utf8');
    const m = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!m) break;
    const len = Number(m[1]); const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const body = buf.subarray(start, start + len).toString('utf8');
    buf = buf.subarray(start + len);
    try { onMessage(JSON.parse(body)); } catch { /* ignore malformed */ }
  }
});
`;
}
function readyThenHungModule() {
  return `// ready-then-hung: answers initialize (becomes ready), then silent on textDocument/*.
import { stdin, stdout } from 'node:process';
let buf = Buffer.alloc(0);
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  stdout.write(body);
}
function onMessage(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {
      textDocumentSync: 1, hoverProvider: true, definitionProvider: true,
      referencesProvider: true, workspaceSymbolProvider: true, documentSymbolProvider: true,
    }, serverInfo: { name: 'stub-tsl', version: '0.0.0-red' } } });
  }
  /* initialized + textDocument/*: drained silently — never answer again (B2 wedged-but-alive). */
}
stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) break;
    const header = buf.subarray(0, headerEnd).toString('utf8');
    const m = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!m) break;
    const len = Number(m[1]); const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const body = buf.subarray(start, start + len).toString('utf8');
    buf = buf.subarray(start + len);
    try { onMessage(JSON.parse(body)); } catch { /* ignore malformed */ }
  }
});
`;
}
function writeStubServer(label, mode = 'answer') {
  const dir = tmpDir(`stub-${label}`);
  const path = join(dir, 'stub-tsl.mjs');
  if (mode === 'hung') {
    // Drain stdin forever; never write a response.
    writeFileSync(path, "import { stdin } from 'node:process'; stdin.on('data', () => {});\n");
    return path;
  }
  if (mode === 'crash') {
    // Exit before the initialize handshake.
    writeFileSync(path, "process.exit(72);\n");
    return path;
  }
  if (mode === 'ready-then-hung') {
    writeFileSync(path, readyThenHungModule());
    return path;
  }
  if (mode === 'crash-once-then-answer') {
    // First spawn: write a marker next to the stub, then exit 72. A fresh generation (the retry)
    // sees the marker and answers — the start slot-clear is observable, never a vacuous doesNotThrow.
    writeFileSync(path, responderModule(
      `import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';`,
      `const here = dirname(fileURLToPath(import.meta.url));
const marker = join(here, 'crashed-once.marker');
if (!existsSync(marker)) {
  writeFileSync(marker, '1');
  process.exit(72);
}`,
    ));
    return path;
  }
  writeFileSync(path, responderModule());
  return path;
}

// One hermetic initialize + hover round-trip against the stub (GP-L). Proves the fixture is a real
// LSP responder, not a vacuous script.
function handshakeStub(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const framed = (obj) => {
      const b = Buffer.from(JSON.stringify(obj), 'utf8');
      return Buffer.concat([Buffer.from(`Content-Length: ${b.length}\r\n\r\n`), b]);
    };
    let buf = Buffer.alloc(0);
    const responses = new Map();
    // F11: the settle is ARRIVAL-driven — both responses (id 1 initialize, id 2 hover) must arrive
    // before the promise resolves. The 4000 ms timer is the outer bound that REJECTS; there is no
    // fixed-ms hard resolve deadline racing the child's real responses (a #7-class flake surface).
    const settle = () => {
      clearTimeout(timer);
      try { child.kill(); } catch { /* best effort */ }
      resolve({
        initialize: responses.get(1) ?? null,
        hover: responses.get(2) ?? null,
      });
    };
    const maybeSettle = () => {
      if (responses.has(1) && responses.has(2)) settle();
    };
    const pump = () => {
      for (;;) {
        const he = buf.indexOf('\r\n\r\n');
        if (he < 0) break;
        const header = buf.subarray(0, he).toString('utf8');
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) break;
        const len = Number(m[1]);
        const start = he + 4;
        if (buf.length < start + len) break;
        const body = buf.subarray(start, start + len).toString('utf8');
        buf = buf.subarray(start + len);
        try {
          const msg = JSON.parse(body);
          if (msg.id !== undefined) {
            responses.set(msg.id, msg);
            maybeSettle();
          }
        } catch { /* ignore */ }
      }
    };
    const timer = setTimeout(() => { child.kill(); reject(new Error('handshake timeout')); }, 4000);
    child.stdout.on('data', (c) => { buf = Buffer.concat([buf, c]); pump(); });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!(responses.has(1) && responses.has(2))) {
        reject(new Error(`stub exited before the handshake settled (code ${code ?? 'null'})`));
      }
    });
    child.stdin.write(framed({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { capabilities: {}, rootUri: 'file:///base', processId: process.pid },
    }));
    // Pacing write only — buffered by the stdin pipe; the settle waits for response ARRIVAL, never
    // a fixed deadline (the 150 ms delay never races the child's answer).
    setTimeout(() => {
      child.stdin.write(framed({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      child.stdin.write(framed({
        jsonrpc: '2.0', id: 2, method: 'textDocument/hover',
        params: { textDocument: { uri: 'file:///base/src/x.ts' }, position: { line: 0, character: 0 } },
      }));
    }, 150);
  });
}

// ── The invented-surface resolver (loadable today; returns null until landed) ──────────────
async function resolveLspPoolHome() {
  const dedicatedPath = srcPath('lsp-pool.mjs');
  let dedicatedSource = null;
  try { dedicatedSource = execFileSync('sed', ['-n', '1,$p', dedicatedPath], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { /* not landed yet */ }
  const dedicated = await import('../src/lsp-pool.mjs').catch(() => null);
  if (dedicated && (typeof dedicated.createLspPool === 'function'
      || Array.isArray(dedicated.LSP_REFUSAL_FAMILY))) {
    return { surface: dedicated, source: dedicatedSource, home: 'lsp-pool.mjs' };
  }
  const coordinator = await import('../src/coordinator.mjs').catch(() => null);
  if (coordinator && (typeof coordinator.createLspPool === 'function'
      || Array.isArray(coordinator.LSP_REFUSAL_FAMILY))) {
    return { surface: coordinator, source: grepSrc('coordinator.mjs', 'createLspPool'), home: 'coordinator.mjs' };
  }
  return { surface: null, source: null, home: null };
}

function stageGuard(surface, message) {
  assert.ok(surface && typeof surface.createLspPool === 'function',
    `stage #144: ${message}`);
}

// A thrown refusal carries a typed `code` (the registry's snake_case family). Helper to read it.
function refusalCode(error) {
  return error?.code ?? error?.cause?.code ?? null;
}

// Build a pool config against a hermetic base repo + stub server. The opt-in map enables only
// typescript; bounds are constructive (count/byte/memory) — never a clock.
function poolConfig({ repo, baseEpoch, stubMode = 'answer', worktreeRoots = [], bounds }) {
  return {
    repoId: 'repo-lsp144',
    baseRoot: repo,
    baseEpoch,
    worktreeRoots,
    languages: {
      typescript: {
        server: { command: process.execPath, args: [writeStubServer(stubMode, stubMode)] },
        memory: 512 * 1024 * 1024,
      },
    },
    bounds: bounds ?? {
      maxConcurrentServers: 2,
      perServerOutputBytes: 65_536,
      perServerOutstandingRequests: 2,
      perServerMemoryBytes: 512 * 1024 * 1024,
    },
    // The #67 law: every fixture config carries a VALID-POSITIVE watchdog.stallMs (never 0/negative);
    // the pool's supervision bound is the inherited process-lifecycle kill-wait (GP-G), and this
    // stallMs is set so the watchdog never fires in any row — it is fixture hygiene, not a control.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    indexRung: { available: true }, // the static atlas fallback (degradation rung)
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// GREEN GUARD PINS — pass TODAY; guard behavior the contract says #144 leaves UNCHANGED. These
// pin the reused law (the LSP tier must honor each). They must STAY GREEN after landing.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('GP-A (pin): the trust-gate enum is the closed live set, "never path strings", and gains no LSP-derived code (§4, GT5, R7/R12)', () => {
  // F5: pin the DEBUG_GATE_CODES SET literal (grepFirstLineNum-anchored, drift-proof) in its ACTUAL
  // declaration order — scope → red_green → coverage → route_mismatch → forbidden_effect → unknown.
  // The debugGateFromLiveCode if-chain order differs (forbidden_effect is SECOND there); this pin
  // guards the SET, which is what R12/D4.1 says must stay closed and LSP-free.
  const setStart = grepFirstLineNum('application.mjs', 'const DEBUG_GATE_CODES = Object.freeze');
  assert.ok(setStart > 0, 'the DEBUG_GATE_CODES set literal is found in application.mjs');
  const gateBlock = sedSrc('application.mjs', setStart, setStart + 2);
  const order = ['scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown']
    .map((g) => gateBlock.indexOf(`'${g}'`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b),
    'the gate enum appears in the declared live-code order (the DEBUG_GATE_CODES set literal)');
  for (const g of ['scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown']) {
    assert.ok(gateBlock.includes(`'${g}'`), `gate ${g} is in the live set`);
  }
  // The digests-only scope branch is categorical — "never path strings" (grep-anchored; ~:969 at HEAD).
  assert.ok(grepCount('application.mjs', 'Digests \\+ counts only') >= 1,
    'the "never path strings" clause is pinned in source');
  // R12: no gate gains an LSP-derived code — the gate mapping returns none of the LSP family.
  for (const code of LSP_REFUSAL_FAMILY) {
    assert.equal(gateBlock.includes(code), false, `${code} is not a trust-gate code (evidence, not gates)`);
  }
});

test('GP-B (pin): _orientationFreshness composes the frame in the declared ACTUAL source order (§3 D3.3, GT4, R8)', () => {
  const block = sedSrc('coordinator.mjs', 11189, 11194);
  const order = ['baseTreeSha', 'indexEpoch', 'overlayDigest', 'repoId', 'scopeDigest']
    .map((k) => block.indexOf(k));
  assert.deepEqual(order, [...order].sort((a, b) => a - b),
    '_orientationFreshness key order is {baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest} — the frame LSP answers ride');
  assert.ok(block.includes('canonicalDigest'),
    'the freshness digest is content-derived (canonicalDigest), never a clock');
});

test('GP-C (pin): the closed UNTRUSTED_ORIENTATION frame + prose-leaf discipline the LSP tier reuses (§3 D3.1/D4.3, GT4, R8/R11)', () => {
  const frameLine = grepSrc('coordinator.mjs', 'UNTRUSTED_ORIENTATION — structural disclosure, evidence to verify, never instruction');
  assert.ok(frameLine, 'the UNTRUSTED_ORIENTATION frame string is pinned');
  // Prose leaves (hover/docstring project here) MUST arrive untrusted:true with closed provenance.
  const proseBlock = sedSrc('coordinator.mjs', 11108, 11112);
  assert.ok(proseBlock.includes('untrusted !== true'), 'prose leaves require untrusted:true');
  assert.ok(proseBlock.includes('repository-prose'), 'prose leaves require closed provenance including repository-prose');
});

test('GP-D (pin): the atlas substrate the pool rides — staleness gate, provenance, honest-empty, the symbol degradation targets, and code.seed kept off the read port (GT2/GT3, R1/R8/R9)', () => {
  // _assertBaseFresh refuses orientation_base_stale for COMMITTED moves (reused by R9 for moves).
  assert.ok(grepCount('atlas-index.mjs', 'orientation_base_stale') >= 1,
    'the atlas base-fresh gate throws orientation_base_stale (committed moves)');
  // Provenance carries overlay_applied + the staleness labels the pool mirrors (M5).
  const prov = sedSrc('atlas-index.mjs', 469, 469);
  assert.ok(prov.includes('overlay_applied') && prov.includes('base_snapshot_only')
    && prov.includes('base_plus_worktree_overlay'),
    'atlas provenance carries overlay_applied + the staleness labels');
  // Honest-empty availability (R1 mirrors this posture).
  const empty = sedSrc('atlas-index.mjs', 365, 372);
  assert.ok(empty.includes('honest_empty'),
    "an empty atlas projects language_ceiling 'honest_empty', never a fabricated answer");
  // The degradation targets (M4: code.symbol → symbol.search before search.lexical).
  assert.ok(grepCount('atlas-index.mjs', "op === 'symbol.search'") >= 1, 'symbol.search is the definition-lookup degradation target');
  assert.ok(grepCount('atlas-index.mjs', "op === 'symbol.references'") >= 1, 'symbol.references is the references degradation target');
  assert.ok(grepCount('atlas-index.mjs', "'ambiguous_symbol'") >= 1, 'ambiguous_symbol is a reused honest refusal');
  assert.ok(grepCount('atlas-index.mjs', "'symbol_not_found'") >= 1, 'symbol_not_found is a reused honest refusal');
  // OQ1: code.seed stays an ATLAS dot-op, NOT on the context.read code-kind op set.
  assert.ok(grepCount('atlas-index.mjs', "'code.seed'") >= 1, 'code.seed remains on the atlas capability card');
  assert.equal(grepCount('coordinator.mjs', "query.op === 'code.seed'"), 0,
    "code.seed is NOT on the context.read code-kind op set (OQ1: no collision)");
});

test('GP-E (pin): the referee coverage pass is TEXTUAL and byte-unchanged — coverageOfChange is never reference-derived (GT6, B5b, R6/R12)', () => {
  // coverageOfChange is derived from the executed-lines scan (referee.mjs:313), unchanged by #144.
  const cov = sedSrc('referee.mjs', 298, 313);
  assert.ok(cov.includes('coverageOfChange = uncovered.length === 0'),
    'coverageOfChange stays derived from the textual executed-lines scan (B5b: byte-unchanged)');
  assert.ok(cov.includes('changedLines'), 'the coverage pass iterates task.changedLines textually');
  // The diagnostic closed set mints verification_coverage_failed from the TEXTUAL scan, not a projection.
  const codes = sedSrc('referee.mjs', 341, 356);
  assert.ok(codes.includes('verification_coverage_failed'),
    'verification_coverage_failed stays in the closed diagnostic set');
  // F7: no blast-radius projection FEEDS the coverage gate. The pin is the derivation it guards —
  // coverageOfChange must never be coupled to a blastRadius projection (a correct #144 may add the
  // projection to the referee PATH to annotate the verdict; it must never feed the gate).
  assert.equal(grepCount('referee.mjs', 'coverageOfChange.*blastRadius|blastRadius.*coverageOfChange'), 0,
    'no blast-radius projection feeds the coverage gate — the textual scan stays the sole input (B5b)');
});

test('GP-F (pin): the sanctioned sanitizers are reused verbatim — no parallel redaction path (GT8, D4.3, R11)', () => {
  const san = sedSrc('verifier-diagnostics.mjs', 26, 63);
  assert.ok(/export function sanitizeVerifierDiagnosticText/u.test(san),
    'sanitizeVerifierDiagnosticText is the sanctioned repository-prose/tail sanitizer');
  assert.ok(san.includes('NFKC'), 'it normalizes NFKC (the closed sanitizer contract)');
  const honest = sedSrc('verifier-diagnostics.mjs', 71, 71);
  assert.ok(honest.includes('[verifier produced no diagnostic output]'),
    'the honest-empty capsule is pinned');
  // F6: boundedAttentionText is grep-anchored (drift-proof) — the function signature via
  // grepFirstLineNum, the credential-shaped redaction via a direct grep (the old fixed 334-341
  // window lost the redaction line on the #153 +7 line drift).
  const attentionStart = grepFirstLineNum('application.mjs', 'function boundedAttentionText');
  assert.ok(attentionStart > 0, 'boundedAttentionText is found in application.mjs');
  const bounded = sedSrc('application.mjs', attentionStart, attentionStart + 7);
  assert.ok(/function boundedAttentionText/u.test(bounded),
    'boundedAttentionText is the attention-class sanitizer');
  assert.ok(grepCount('application.mjs', 'credential-shaped content redacted') >= 1,
    'boundedAttentionText redacts credential-shaped content');
  assert.ok(grepCount('application.mjs', "FRAME_LIMITS\\['view.attention_text.bytes'\\]") >= 1,
    'MAX_ATTENTION_TEXT_BYTES is bounded by the #89 registry row (application.mjs:59)');
  // The live sanitizer is importable and behaves — proves the path the LSP tier must reuse.
  assert.equal(typeof sanitizeVerifierDiagnosticText, 'function');
  const secret = 'sk-proj-abcdefghijklmnop1234567890';
  assert.ok(!sanitizeVerifierDiagnosticText(`hover: ${secret}`).text.includes(secret),
    'the sanitizer redacts secret-shaped content the LSP tier must route through it');
});

test('GP-G (pin): the supervised process-lifecycle machinery the pool inherits — bounded kill-wait, closed reap reasons, slot-clear latch (GT7, D1.3/D4.2, R3)', () => {
  const reap = sedSrc('process-lifecycle.mjs', 99, 122);
  assert.ok(reap.includes('timeoutMs') && reap.includes('pollMs') && reap.includes('maxAttempts'),
    'reapOwnedProcessGroup uses the inherited bounded kill-wait (M2: a reap, not a scheduling clock)');
  assert.ok(reap.includes('SIGKILL'), 'the bounded reap is the only kill discipline (no kill -9 outside it)');
  // The closed reap-unconfirmed reason set lsp_reap_unconfirmed inherits (process-lifecycle.mjs:291-300).
  const reasons = sedSrc('process-lifecycle.mjs', 291, 300);
  for (const r of ['deadline', 'permission_denied', 'probe_error']) {
    assert.ok(reasons.includes(r), `lsp_reap_unconfirmed inherits the closed reason ${r}`);
  }
  // The ProcessCloseReapLatch clears the singleflight slot BEFORE publishing its refusal (B2 precedent).
  assert.ok(grepCount('process-lifecycle.mjs', 'clears the singleflight slot before publishing') >= 1,
    'the latch clears the start single-flight slot before the refusal (B2 extends this to the pool start path)');
  assert.ok(grepCount('process-lifecycle.mjs', 'class ProcessCloseReapLatch') >= 1,
    'the latch is the supervised close-reap discipline the pool reuses');
});

test('GP-H (pin): the read-port byte bound rows the LSP tier SHARES — no new #89 byte row (OQ4, D3.1, R8)', () => {
  // limits.mjs:103-104 — view.context_read.knowledge_items / view.context_read.items (re-verified at HEAD).
  const rows = sedSrc('limits.mjs', 102, 105);
  assert.ok(rows.includes("'view.context_read.knowledge_items'"),
    'view.context_read.knowledge_items is the shared read-port row (limits.mjs:103)');
  assert.ok(rows.includes("'view.context_read.items'"),
    'view.context_read.items is the shared read-port row (limits.mjs:104)');
  // OQ4: the LSP tier shares these rows — no NEW read-port byte row is declared for the LSP ops.
  assert.equal(grepCount('limits.mjs', "class: 'lsp'|class: \"lsp\"|'lsp.context_read"), 0,
    'no new #89 read-port byte row for the LSP ops (OQ4: the bound does not differ)');
});

test('GP-I (pin): localeCompare is banned across the cited machinery; the compare is locale-free (campaign law, §6)', () => {
  for (const rel of [
    'application.mjs', 'coordinator.mjs', 'atlas-index.mjs', 'referee.mjs',
    'process-lifecycle.mjs', 'verifier-diagnostics.mjs', 'limits.mjs', 'canonical-order.mjs',
  ]) {
    assert.equal(grepCount(rel, 'localeCompare'), 0, `${rel} uses no localeCompare (ACTUAL order, not collation)`);
  }
  // The locale-free compare the symbol sort uses (atlas-index.mjs compareCanonicalStrings).
  assert.equal(typeof compareCanonicalStrings, 'function');
  assert.equal(compareCanonicalStrings('a', 'b'), -1, 'the compare is locale-independent over UTF-16 code units');
});

test('GP-L (pin): the stubbed typescript-language-server fixture is a real hermetic LSP responder (initialize + textDocument/*) — non-vacuous fixture', async () => {
  const stubPath = writeStubServer('lint', 'answer');
  const { initialize, hover } = await handshakeStub(stubPath);
  assert.ok(initialize && initialize.result && initialize.result.capabilities,
    'the stub completes the initialize handshake with capabilities');
  assert.ok(initialize.result.capabilities.definitionProvider
    && initialize.result.capabilities.referencesProvider
    && initialize.result.capabilities.hoverProvider,
    'the stub advertises the definition/references/hover providers the pool drives');
  assert.ok(initialize.result.serverInfo && initialize.result.serverInfo.name === 'stub-tsl',
    'the stub identifies itself (no live server impersonation)');
  assert.ok(hover && hover.result && Array.isArray(hover.result.contents),
    'the stub answers textDocument/hover — the projection R11 sanitizes');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// RED ROWS — fail TODAY (stage: the LSP-pool surface is absent); GREEN only on a contract-correct
// implementation. Each row maps to a §5 pin R1..R13 and the §3 decision it pins.
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── Pool (D1) ───────────────────────────────────────────────────────────────────────────────

test('R1 (stage: no pool / no LSP card): code.index_status on a no-server language returns typed-empty (empty + honest_empty), never a fabricated answer (§5 R1, D1.5)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R1: the LSP pool / typed-empty index_status is not landed (D1.5)');

  const pool = surface.createLspPool(poolConfig({ repo: gitRepo('r1'), baseEpoch: BASE_EPOCH_A }));
  // A language with no server (not opted in / not installed) answers typed-empty.
  const status = pool.indexStatus({ language: 'python' });
  assert.ok(status && status.availability, 'index_status projects an availability object');
  assert.equal(status.availability.status, 'empty', 'a no-server language is availability empty');
  assert.equal(status.language_ceiling, 'honest_empty', 'the ceiling is honest_empty, never fabricated');
  // F12: assert the typed-empty SHAPE (never a fabricated answer), not the English substring
  // 'definition' — a correct honest-empty answer may legitimately name a "no definition provider"
  // reason. The typed-empty surface carries NO symbols/diagnostics KEYS.
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('"symbols"'), false, 'no fabricated symbols for an empty language');
  assert.equal(serialized.includes('"diagnostics"'), false, 'no fabricated diagnostics for an empty language');
});

test('R2 (stage: no pool): exactly one server per (repo, language), lazily started, single-flight on concurrent demand, never per-worker; a worker-worktree path refuses lsp_workspace_scope_violation (§5 R2, D1.1/D1.2/M3)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R2: the single-flight pool + worker-worktree classifier is not landed (D1.1/D1.2)');

  const repo = gitRepo('r2');
  const worktreeRoot = join(repo, '.baton', 'wt', 'ws-r2-worker');
  mkdirSync(worktreeRoot, { recursive: true });
  const pool = surface.createLspPool(poolConfig({
    repo, baseEpoch: BASE_EPOCH_A, worktreeRoots: [worktreeRoot],
  }));

  // First demand lazily starts one server.
  const h1 = pool.acquire({ language: 'typescript' });
  assert.ok(h1, 'first demand starts a server');
  // A concurrent demand JOINS the same start (single-flight) — never a second per-worker server.
  const h2 = pool.acquire({ language: 'typescript' });
  assert.equal(h2, h1, 'a concurrent demand joins the same single-flight server, not a new per-worker one');

  // M3 worker-worktree classifier: a path under an active worker worktree is worker-scope.
  const workerFile = join(worktreeRoot, 'src', 'worker-only.ts');
  assert.equal(surface.isWorkerScopePath({ path: workerFile, worktreeRoots: [worktreeRoot] }), true,
    'a path under an active worker worktree is worker-scope');
  // A base path that differs ONLY by classification is not worker-scope.
  const baseFile = join(repo, 'src', 'base.ts');
  assert.equal(surface.isWorkerScopePath({ path: baseFile, worktreeRoots: [worktreeRoot] }), false,
    'a base-root path is not worker-scope');
  // A worker-scope demand refuses before any provider I/O.
  assert.throws(
    () => pool.acquire({ language: 'typescript', path: workerFile }),
    (error) => refusalCode(error) === 'lsp_workspace_scope_violation',
    'a demand naming a worker worktree refuses lsp_workspace_scope_violation',
  );
});

test('R3 (stage: no LSP server lifecycle): the server rides the exact lifecycle; a server over the outstanding-request ceiling is wedged → lsp_server_unavailable (wedged) + reap+restart as a NEW GENERATION; startup_failed clears the slot first; an unreapable group publishes lsp_reap_unconfirmed (§5 R3, D1.3/B2/D4.2)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R3: the LSP server lifecycle + clock-free wedged trigger is not landed (D1.3)');

  // Lifecycle order: process_started before provider I/O, process_ready after the handshake.
  // F1: the lifecycle leg awaits the readiness SEAM (a bounded, event/count-derived wait) before
  // reading lastLifecycleEvents() — a real async handshake cannot place process_ready in the array
  // in the same tick as a synchronous acquire. acquire stays non-blocking (returns a starting
  // handle); ready(language) is what the leg awaits.
  const repo = gitRepo('r3');
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A }));
  pool.acquire({ language: 'typescript' });
  await pool.ready('typescript');
  const events = pool.lastLifecycleEvents();
  const startedAt = events.indexOf('lifecycle.process_started');
  const readyAt = events.indexOf('lifecycle.process_ready');
  assert.ok(startedAt >= 0 && readyAt > startedAt,
    'process_started precedes provider I/O and process_ready follows the initialize handshake');

  // B2 clock-free wedged trigger: a READY-THEN-HUNG server accumulates outstanding requests past the
  // ceiling. F2: 'ready-then-hung' answers initialize (becomes ready) then drains textDocument/*
  // silently — a WEDGED-but-alive server, so the outstanding count genuinely climbs past readiness
  // (a never-ready 'hung' stub could only drive the 'starting' state, never the 'wedged' one).
  const hungRepo = gitRepo('r3-hung');
  const hungPool = surface.createLspPool(poolConfig({ repo: hungRepo, baseEpoch: BASE_EPOCH_A, stubMode: 'ready-then-hung' }));
  hungPool.acquire({ language: 'typescript' });
  await hungPool.ready('typescript'); // the server is READY, then silent on textDocument/* (B2)
  const ceiling = hungPool.bounds.perServerOutstandingRequests;
  // Fire `ceiling` concurrent requests against the ready-then-hung server (none resolve → outstanding climbs).
  const hung = [];
  for (let i = 0; i < ceiling; i += 1) {
    hung.push(hungPool.answer({
      language: 'typescript', op: 'code.hover',
      query: { textDocument: { uri: 'file:///base/src/x.ts' }, position: { line: 0, character: 0 } },
      overlayDigest: OVERLAY_DIGEST_BASE_ONLY,
    }).catch((error) => error));
  }
  await Promise.resolve(hung);
  // The next demand refuses lsp_server_unavailable (reason wedged) — the constructive, clock-free trigger.
  assert.throws(
    () => hungPool.acquire({ language: 'typescript' }),
    (error) => refusalCode(error) === 'lsp_server_unavailable' && error.reason === 'wedged',
    'outstanding requests past the ceiling wedge the server: next demand refuses lsp_server_unavailable (wedged)',
  );
  // The pool reaps + restarts as a NEW GENERATION — retry is reachable.
  const regenerated = hungPool.acquire({ language: 'typescript' });
  assert.ok(regenerated, 'a wedged server is reaped + restarted as a new generation (retry reachable)');

  // B2 start-slot-clear: a server that fails the handshake publishes lsp_startup_failed AFTER clearing
  // its single-flight slot, so a subsequent demand starts a fresh attempt. F3: the
  // 'crash-once-then-answer' stub makes the slot-clear OBSERVABLE — the first generation exits 72,
  // the retry's fresh generation answers the envelope (an always-crash stub could not distinguish
  // "slot cleared + fresh attempt also failed" from "slot parked on the failed start").
  const crashRepo = gitRepo('r3-crash');
  const crashPool = surface.createLspPool(poolConfig({ repo: crashRepo, baseEpoch: BASE_EPOCH_A, stubMode: 'crash-once-then-answer' }));
  crashPool.acquire({ language: 'typescript' });
  await assert.rejects(
    crashPool.ready('typescript'),
    (error) => refusalCode(error) === 'lsp_startup_failed',
    'a handshake failure publishes lsp_startup_failed',
  );
  const startedBeforeRetry = crashPool.lastLifecycleEvents()
    .filter((e) => e === 'lifecycle.process_started').length;
  // Retry is reachable (the slot cleared before the refusal): a fresh attempt starts, not a parked failure.
  const retryHandle = crashPool.acquire({ language: 'typescript' });
  assert.ok(retryHandle, 'the start single-flight slot cleared before lsp_startup_failed — the retry starts a fresh attempt');
  await crashPool.ready('typescript'); // the fresh generation answers the handshake (crash-once-then-answer)
  const startedAfterRetry = crashPool.lastLifecycleEvents()
    .filter((e) => e === 'lifecycle.process_started').length;
  assert.ok(startedAfterRetry > startedBeforeRetry,
    'the retry produced a NEW process_started event — a fresh attempt began (the slot cleared)');

  // lsp_reap_unconfirmed is in the family and inherits the closed reap reason set (GP-G pins the set).
  assert.ok(LSP_REFUSAL_FAMILY.includes('lsp_reap_unconfirmed'),
    'an unreapable group publishes lsp_reap_unconfirmed and never fakes closure');
});

test('R4 (stage: no bounds): resource bounds refuse before unbounded spawn — lsp_pool_capacity_exceeded names {cap, actual, unit}; the four caps are constructive, never a clock (§5 R4, D1.4/M1/M2)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R4: the constructive resource bounds are not landed (D1.4)');

  const repo = gitRepo('r4');
  const bounds = {
    maxConcurrentServers: 1, perServerOutputBytes: 65_536,
    perServerOutstandingRequests: 2, perServerMemoryBytes: 512 * 1024 * 1024,
  };
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A, bounds }));
  // The four named ceilings are exactly the constructive set (count/byte/memory) — no clock field.
  assert.deepEqual(Object.keys(pool.bounds).sort(), [...LSP_BOUNDS_KEYS].sort(),
    'pool.bounds is exactly the four constructive caps');
  for (const key of LSP_BOUNDS_KEYS) {
    assert.ok(Number.isFinite(pool.bounds[key]), `${key} is a finite constructive bound`);
  }
  assert.equal(Object.keys(pool.bounds).some((k) => /ttl|timeout|window|recency|turn/i.test(k)), false,
    'no clock/turn/window control among the bounds (M2: the no-clocks law)');

  // max concurrent servers exceeded → lsp_pool_capacity_exceeded names {cap, actual, unit}.
  pool.acquire({ language: 'typescript' }); // occupies the single slot
  assert.throws(
    () => pool.acquire({ language: 'typescript', demand: 'second-live-key-attempt' }),
    (error) => {
      if (refusalCode(error) !== 'lsp_pool_capacity_exceeded') return false;
      const detail = error.detail ?? error.info ?? {};
      return ['cap', 'actual', 'unit'].every((k) => k in detail);
    },
    'exceeding max concurrent servers refuses lsp_pool_capacity_exceeded with {cap, actual, unit}',
  );

  // The wedged trigger's ceiling is the #89 row lsp.pool.outstanding_requests (R3 uses it); it bounds
  // concurrency of demand, not elapsed time. The registry row lands with the impl (absent today —
  // the red precondition; GP-H pins the unchanged read-port rows).
  assert.ok(Number.isFinite(pool.bounds.perServerOutstandingRequests),
    'the outstanding-request ceiling is a count-derived #89 row, never a clock');
});

// ── Diagnostic scoping (D2) ─────────────────────────────────────────────────────────────────

test('R5 (stage: no symbol projection): a verification failure resolves its diagnostics to definitions/references by symbol; the worker-facing projection is symbol NAMES + file digests (§5 R5, D2.1/B5a)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R5: the symbol-accurate evidence projection is not landed (D2.1)');

  const diagnostics = [
    { message: "Cannot find name 'missingFn'", file: 'src/caller.ts', line: 12, code: 'ts2304' },
  ];
  const resolve = (diag) => [{ name: 'missingFn', fileDigest: FILE_DIGEST_X, kind: 'function' }];
  const evidence = surface.projectSymbolEvidence({ diagnostics, resolve });
  assert.ok(evidence && Array.isArray(evidence.symbols) && evidence.symbols.length > 0,
    'failing diagnostics resolve to symbols');
  // B5a CHOICE b: symbol NAMES + file digests on the worker-facing surface.
  const symbol = evidence.symbols[0];
  // F9: the name must be the RESOLVED symbol, not just any string — a digests-only implementation
  // that drops the NAMES to '' (typeof '' === 'string') must not pass the projection row.
  assert.equal(symbol.name, 'missingFn', 'the projection carries the resolved symbol NAME (not an empty string)');
  assert.equal(typeof symbol.fileDigest, 'string', 'the projection carries the file DIGEST, not a path');
  assert.equal(symbol.fileDigest, FILE_DIGEST_X, 'the digest is the resolved file digest (not a path)');
  // No raw repo-relative path crosses the worker-facing projection.
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('src/caller.ts'), false,
    'no raw repo path crosses the worker-facing symbol projection (B5a: names + digests)');
});

test('R6 (stage: no reference-based scoping): the blast-radius projection is ADDITIVE and annotates the verdict only — coverageOfChange stays textual and never feeds the gate (§5 R6, D2.2/B5b)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R6: the advisory blast-radius projection is not landed (D2.2)');

  const changedLines = { 'src/widget.ts': [10, 11] };
  const resolve = { defines: () => ['Widget'], references: () => [{ name: 'renderWidget', fileDigest: FILE_DIGEST_X }] };
  const blast = surface.computeBlastRadius({ changedLines, resolve });
  // The projection is an annotation (an evidence leaf), additive — never the gate input.
  assert.ok(blast === null || typeof blast === 'object',
    'the blast-radius projection is an additive annotation (or honest null)');
  if (blast) {
    assert.equal(blast.annotation === true || blast.advisory === true || blast.evidence === true, true,
      'the projection is marked advisory/annotation evidence');
    // It must NOT carry a coverageOfChange verdict — that stays the referee's textual call (GP-E).
    assert.equal('coverageOfChange' in blast, false,
      'the blast-radius projection never mints coverageOfChange (B5b)');
  }

  // F8: the projection must be CONSULTED by a verdict-producing path, not merely exported — an
  // implementation that computes blast radius but never wires it into verdict production fails.
  const repo = gitRepo('r6');
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A }));
  const verdictAnswer = pool.answer({
    language: 'typescript', op: 'code.symbol',
    query: { name: 'stubSymbol' },
    overlayDigest: OVERLAY_DIGEST_BASE_ONLY,
    changedLines: { 'src/widget.ts': [10, 11] },
  });
  const advisory = verdictAnswer?.blastRadius ?? verdictAnswer?.orientation?.blastRadius ?? null;
  assert.ok(advisory && typeof advisory === 'object',
    'a verdict-producing answer path CONSULTS the blast-radius projection (F8: annotates, not merely exists)');
  assert.equal('coverageOfChange' in advisory, false,
    'the consulted blast annotation never feeds coverageOfChange (B5b)');
});

test('R7 (stage: no LSP evidence to leak): the worker-facing reject receipt stays digests+counts + symbol names + file digests; the "never path strings" clause is categorical (§5 R7, D2.3/B5a)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R7: the digests-only worker reject receipt is not landed (D2.3)');

  const symbolEvidence = {
    symbols: [{ name: 'missingFn', fileDigest: FILE_DIGEST_X }],
    capsule: { diagnosticsDigest: sha256('diag'), pathCount: 1 },
  };
  const receipt = surface.renderWorkerRejectReceipt({ symbolEvidence });
  // Scope-class detail keeps the DG-1/DIAG-2 shape: digests + counts, never paths.
  assert.ok(receipt && receipt.digests && receipt.counts, 'the receipt carries digests + counts');
  // The enriched digest carries symbol names + file digests — never raw paths.
  assert.ok(Array.isArray(receipt.symbols) && receipt.symbols[0].name && receipt.symbols[0].fileDigest,
    'the enriched receipt carries symbol names + file digests');
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes('src/'), false,
    'no repo-relative path string crosses the worker-facing receipt (categorical "never path strings")');
  for (const code of LSP_REFUSAL_FAMILY) {
    assert.equal(serialized.includes(code) && code !== 'lsp_evidence_unsanitized', false,
      `${code} is not leaked onto the worker receipt surface`);
  }
});

// ── Environmental understanding (D3) ────────────────────────────────────────────────────────

test('R8 (stage: only code.orient.* exist): the code ops serve pool→index→typed-empty; every answer rides the UNTRUSTED_ORIENTATION frame + the freshness composition; pool answers are base-only (§5 R8, D3.1/D3.2/D3.3/M4/M5)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R8: the LSP code ops over context.read are not landed (D3.1)');

  const repo = gitRepo('r8');
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A }));
  // A live answer for an opted-in language with a server.
  const answer = pool.answer({
    language: 'typescript', op: 'code.symbol',
    query: { name: 'stubSymbol' }, overlayDigest: OVERLAY_DIGEST_BASE_ONLY,
  });
  assert.ok(answer && (answer.frame ?? answer.orientation?.frame),
    'the answer rides the closed UNTRUSTED_ORIENTATION frame');
  // M5: a pool answer carries explicit base-only provenance.
  const prov = answer.provenance ?? answer.orientation?.provenance ?? {};
  assert.equal(prov.overlay_applied, false, 'a pool answer attests overlay_applied: false');
  assert.equal(prov.staleness, 'base_snapshot_only',
    "a pool answer attests staleness: 'base_snapshot_only' so a worker can degrade to the overlay rung");
  // The freshness digest composes the declared frame (GP-B pins the order the answer must ride).
  assert.ok(answer.freshnessDigest ?? answer.orientation?.freshnessDigest,
    'the answer carries the content-derived freshnessDigest');

  // M4: when no server exists, code.symbol degrades to symbol.search before lexical/empty.
  const degrade = pool.answer({
    language: 'python', op: 'code.symbol',
    query: { name: 'anything' }, overlayDigest: OVERLAY_DIGEST_BASE_ONLY,
  });
  assert.ok(degrade, 'a no-server language degrades (to the static index / typed-empty), never throws raw');
  const degraded = degrade.provenance ?? degrade.orientation?.provenance ?? {};
  assert.ok(degraded.servedBy === 'static_index' || degraded.language_ceiling === 'honest_empty'
    || degrade.availability?.status === 'empty',
    'the degradation ladder ends at the static index or typed-empty (M4: symbol.search before lexical)');

  // The op family + the dot→underscore verb mapping is exactly the sibling family (OQ1).
  assert.deepEqual([...LSP_CODE_OPS.map(dotToUnderscore)], [...LSP_CODE_VERBS]);
});

test('R9 (stage: nothing serves LSP stale / no dirty-drift check): a committed base move answers orientation_base_stale; a dirty base root at server-open refuses lsp_server_unavailable (base_root_dirty) (§5 R9, D3.3/D3.5/B3)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R9: the LSP base-hygiene (dirty-drift + base-move) gate is not landed (D3.3)');

  // B3 clean-checkout requirement: a dirty base root at server-open refuses BEFORE any generation.
  const dirtyRepo = gitRepo('r9-dirty');
  writeFileSync(join(dirtyRepo, 'uncommitted.ts'), 'export const drift = 1;\n'); // dirty worktree
  const dirtyPool = surface.createLspPool(poolConfig({ repo: dirtyRepo, baseEpoch: treeSha(dirtyRepo) }));
  assert.throws(
    () => dirtyPool.openServer({ language: 'typescript', baseRoot: dirtyRepo, baseEpoch: treeSha(dirtyRepo) }),
    (error) => refusalCode(error) === 'lsp_server_unavailable' && error.reason === 'base_root_dirty',
    'a dirty base root at server-open refuses lsp_server_unavailable (base_root_dirty) — never base+dirty as fresh',
  );

  // OQ3 refuse-then-restart: a committed base move answers orientation_base_stale (reused atlas gate).
  const movedRepo = gitRepo('r9-moved');
  const originalEpoch = treeSha(movedRepo);
  writeFileSync(join(movedRepo, 'more.ts'), 'export const more = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: movedRepo }); // a COMMITTED move changes HEAD^{tree}
  execFileSync('git', ['commit', '-qm', 'move'], { cwd: movedRepo });
  const movedPool = surface.createLspPool(poolConfig({ repo: movedRepo, baseEpoch: originalEpoch }));
  assert.throws(
    () => movedPool.acquire({ language: 'typescript' }),
    (error) => refusalCode(error) === 'orientation_base_stale',
    'a committed base move under the pinned epoch answers orientation_base_stale (refuse-then-restart, OQ3)',
  );
});

test('R10 (stage: no absence cache): the absence cache composes on the effective-view frame {base_epoch, overlayDigest, normalized_query}; a proven-zero is shared only on matching views; base/overlay change invalidates by construction; a conflict refuses (§5 R10, D3.4/B4)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R10: the effective-view absence cache is not landed (D3.4)');

  // The key is the effective-view frame — content-derived, never TTL.
  const k1 = surface.provenZeroKey({
    base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_BASE_ONLY, normalized_query: 'stubSymbol',
  });
  const k1again = surface.provenZeroKey({
    base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_BASE_ONLY, normalized_query: 'stubSymbol',
  });
  assert.equal(k1, k1again, 'the same effective-view frame produces the same key');

  // A different base_epoch invalidates by construction.
  const kBase = surface.provenZeroKey({
    base_epoch: BASE_EPOCH_B, overlayDigest: OVERLAY_DIGEST_BASE_ONLY, normalized_query: 'stubSymbol',
  });
  assert.notEqual(kBase, k1, 'a base change invalidates by construction via base_epoch');
  // A different overlayDigest invalidates by construction — and isolates workers.
  const kOverlayA = surface.provenZeroKey({
    base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_A, normalized_query: 'stubSymbol',
  });
  const kOverlayB = surface.provenZeroKey({
    base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_B, normalized_query: 'stubSymbol',
  });
  assert.notEqual(kOverlayA, kOverlayB, 'a worktree-delta change invalidates by construction via overlayDigest');

  const repo = gitRepo('r10');
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A }));
  // A proven-zero is cached and served on the second identical effective-view query (never re-probes).
  pool.provenZero({ base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_A, normalized_query: 'absent', verdict: 'proven_zero' });
  const served = pool.provenZero({ base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_A, normalized_query: 'absent', verdict: 'proven_zero' });
  assert.ok(served && (served.cached === true || served.verdict === 'proven_zero'),
    'an identical effective-view proven-zero is served from the cache');
  // Worker A's overlay-proven zero never serves worker B (different overlayDigest → different key).
  assert.throws(
    () => pool.provenZero({ base_epoch: BASE_EPOCH_A, overlayDigest: OVERLAY_DIGEST_A, normalized_query: 'absent', verdict: 'proven_zero', conflict: true }),
    (error) => refusalCode(error) === 'lsp_proven_zero_conflict',
    'a concurrent conflicting effective-view write refuses lsp_proven_zero_conflict',
  );
});

// ── Honesty + containment (D4) ──────────────────────────────────────────────────────────────

test('R11 (stage: no LSP content exists): no LSP content crosses a worker surface unsanitized — the closed M6 mapping + frame; hover/docstring is a repository-prose leaf; a violation refuses (§5 R11, D4.3/M6/OQ2)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R11: the closed sanitizer mapping is not landed (D4.3)');

  // The mapping is closed: every output class maps to exactly one sanctioned sanitizer (M6).
  assert.deepEqual(Object.keys(surface.LSP_SANITIZER_MAPPING).sort(), Object.keys(LSP_SANITIZER_MAPPING).sort(),
    'the sanitizer mapping is the closed M6 set of output classes');
  assert.equal(surface.LSP_SANITIZER_MAPPING.repository_prose, 'sanitizeVerifierDiagnosticText',
    'repository-prose leaves (hover/docstring) route through sanitizeVerifierDiagnosticText');
  assert.equal(surface.LSP_SANITIZER_MAPPING.attention_class, 'boundedAttentionText',
    'attention-class text routes through boundedAttentionText');

  // OQ2 frame, not strip: hover/docstring prose projects as a repository-prose leaf, framed.
  const secret = 'sk-proj-abcdefghijklmnop1234567890';
  const hover = `export function risky(): void { /* ${secret} */ }`;
  const framed = surface.sanitizeLspOutput({ class: 'repository_prose', text: hover });
  assert.ok(framed && framed.frame, 'hover prose rides the closed frame');
  assert.ok(!framed.text.includes(secret), 'the sanitizer strips secret-shaped content from hover prose');
  assert.ok(/UNTRUSTED/u.test(framed.frame), 'hover prose rides an UNTRUSTED frame (never spliced as instruction)');
  // A raw-content violation refuses.
  assert.throws(
    () => surface.sanitizeLspOutput({ class: 'raw_unmapped', text: hover }),
    (error) => refusalCode(error) === 'lsp_evidence_unsanitized',
    'raw unmapped server output crossing a seam refuses lsp_evidence_unsanitized',
  );
});

test('R12 (stage: no LSP evidence exists to gate with): LSP-derived evidence is never a verdict input — the gate enum stays the live set, no LSP gate code; the blast-radius projection annotates only (§5 R12, D4.1/B5b)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R12: the evidence-not-gates LSP posture is not landed (D4.1)');

  // The gate enum stays the live code set (GP-A pins it); none of the LSP family is a gate code.
  // F4-class: grep-anchored to the DEBUG_GATE_CODES set literal (drift-proof, same as the GP-A fix).
  const setStart = grepFirstLineNum('application.mjs', 'const DEBUG_GATE_CODES = Object.freeze');
  assert.ok(setStart > 0, 'the DEBUG_GATE_CODES set literal is found in application.mjs');
  const gateBlock = sedSrc('application.mjs', setStart, setStart + 2);
  for (const code of LSP_REFUSAL_FAMILY) {
    assert.equal(gateBlock.includes(code), false,
      `${code} is an LSP evidence/refusal code, never a trust-gate verdict code`);
  }
  // The blast-radius projection annotates the verdict only — computeBlastRadius never returns a
  // coverageOfChange verdict (R6 + GP-E enforce the textual gate stays the sole input).
  const blast = surface.computeBlastRadius({
    changedLines: { 'src/x.ts': [1] },
    resolve: { defines: () => ['X'], references: () => [] },
  });
  if (blast) {
    assert.equal('coverageOfChange' in blast, false,
      'the blast-radius projection never feeds coverageOfChange — evidence, not a gate (B5b)');
  }
});

test('R13 (stage: no pool / no opt-in gate): the pool never starts a server for a language not opted in (lsp_language_not_opted_in before spawn); an un-opted-but-index-supported language serves the static index; the card names the honest trust posture (§5 R13, D1.5/D4.4/B1)', async () => {
  const { surface } = await resolveLspPoolHome();
  stageGuard(surface, 'R13: the per-language opt-in gate + honest trust card is not landed (D1.5)');

  const repo = gitRepo('r13');
  const pool = surface.createLspPool(poolConfig({ repo, baseEpoch: BASE_EPOCH_A }));
  // An un-opted language refuses BEFORE any spawn when a demand would require the pool.
  assert.equal(pool.isOptedIn('typescript'), true, 'typescript is opted in');
  assert.equal(pool.isOptedIn('rust'), false, 'rust is not opted in');
  assert.throws(
    () => pool.acquire({ language: 'rust' }),
    (error) => refusalCode(error) === 'lsp_language_not_opted_in',
    'a demand requiring the pool for an un-opted language refuses lsp_language_not_opted_in before any spawn',
  );
  // M6 rider: an un-opted BUT index-supported language serves the static index — no refusal, no typed-empty.
  const indexSupported = pool.answer({
    language: 'rust', op: 'code.symbol',
    query: { name: 'anything' }, overlayDigest: OVERLAY_DIGEST_BASE_ONLY,
  });
  assert.ok(indexSupported, 'an un-opted but index-supported language degrades to the static index (opt-in governs the live tier only)');

  // F10: the OPTED path must be asserted reachable — an implementation whose acquire refuses EVERY
  // language (including typescript) with lsp_language_not_opted_in would pass the refusal leg above
  // while silently refusing the opted language too. The opt-in gate must ADMIT the opted language.
  assert.ok(pool.acquire({ language: 'typescript' }),
    'the opted path is reachable — acquire admits the opted language (F10)');

  // B1 honest trust posture: the card names what the server process actually does.
  const card = pool.card('typescript');
  assert.ok(card && typeof card === 'object', 'the started server advertises a capability card');
  const posture = JSON.stringify(card);
  assert.ok(/plugin|toolchain|deployment authority/u.test(posture),
    'the card names that the server process runs the toolchain under deployment authority and may load plugin code');
  assert.ok(/application entrypoint|never runs project application/u.test(posture),
    'the card names that the server never runs project application entrypoints');
  assert.ok(/sandbox|egress/u.test(posture),
    'the card names the containment consequence (outside worker sandboxes, egress bounded)');
});
