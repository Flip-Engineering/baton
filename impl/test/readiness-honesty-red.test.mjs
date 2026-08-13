// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-167]
// Readiness-honesty (#167) — RED-FIRST acceptance suite for the FOLDED contract v2.
//
// Binding contract: docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md (v2,
// folded against redteam-167.md and fold-167.md, this directory). Rows are named after the
// contract's acceptance IDs A1..A6 (§Acceptance) plus the pin rows that guard the behavior #167
// leaves UNCHANGED. Every capability row FAILS TODAY for the named stage and goes GREEN only on a
// contract-correct implementation; the PIN rows pass today on surfaces the contract pins as
// already-correct and must stay green after landing.
//
// The suite law (suite-foundry-2026-08-13-c/foundry-brief.md) binds this suite: red-first rows
// with a NAMED stage; hermetic mkdtemp fixtures with test.after cleanup; no network; no real
// provider spawns (probes are faked at the adapter seam); no clocks as controls (the only clock
// touches are deterministic injected epochs and bounded async settling); namespace imports for
// invented surfaces; no localeCompare; sorted-key literals only in ACTUAL code-unit order (#167's
// D2 projection is "semantic order; no byte-stability claim", so no key-order literal is
// asserted); watchdog.stallMs is an explicit 60_000 positive integer in every fixture; static
// source anchors are ORDER/EXISTENCE/byte-string only (never absolute line windows, #166); the
// suite is run twice from the repo root and both splits recorded.
//
// ── STAGE TODAY ────────────────────────────────────────────────────────────────────────────
// The honesty tier is NOT landed. `probedAt` appears NOWHERE in impl/; `verdict` exists only as
// an unrelated compactRunResult field name (application-cli.mjs:919) and in comments — never as
// the honest projection. The doctor route row's enumerable signal is still the bare static
// `state: 'ready'`; `liveness`/`occupancy` are non-enumerable siblings (dropped by JSON); the web
// card re-adds only `briefing`; `baton doctor --check` selects local-vs-remote only; the probe
// failure codes fall to GENERIC_PROVIDER_TERMINAL_GUIDANCE; a quota/capacity wire is
// indistinguishable from `probe_content_mismatch`/`provider_unreachable`; and the liveness gate
// covers only `run()`. Capability rows A1a/A1b/A1c/A2/A3/A4/A5/A6/V-stale are RED at these
// stages (V-stale: the honest verdict — absent entirely — so the lapsed-window staleness law on
// the verdict cannot hold); the eight PIN rows (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) are GREEN.
// Every PIN row has a named-stage twin: A1p→A1a/A1b/A1c, A3p→A3, A4p→A4, A5p→A5, A6p→A6,
// P-stale→V-stale, A-L→A-Lcap — the pin guards what today holds; the twin asserts the contract
// form that does not.
//
// ── INVENTED SIGNATURES (the suite-chosen seams; the contract pins behavior, not these JS
// spellings — each is the most sibling-consistent reading of the named contract surface):
//   - the enumerable `verdict` / `probedAt` fields on the doctor route row and the roster row
//     (D2 shape: verdict ∈ 'probe-verified'|'unverified'|'failed', probedAt ISO-8601|null) —
//     asserted by behavior (A1a/A1b) and by source scans over the northbound re-add sites (A1c);
//   - the web-northbound forced-probe parameter on /v1/application-card — spelled `forceProbe`
//     (a query/body signal read in the card handler), carried by BatonWebClient.doctor() and
//     requested by the `baton.mjs` doctor branch on `--check` (A2);
//   - the typed `provider_quota` refusal-code row in PROVIDER_TERMINAL_GUIDANCE with the
//     no-auto-re-probe exclusion (A3/A4);
//   - the LivenessAdapter fixture (mirrors the #47 suite's ScriptableAdapter): probe turns are
//     faked at the adapter seam by the contract's `<route>-probe ok` pin text, never real network.
//
// ── FIXTURE SAFETY ─────────────────────────────────────────────────────────────────────────
// Hermetic: every root is mkdtempSync'd under os.tmpdir() and removed in test.after; the only
// subprocess is `git init` on temp roots and the `true` verification command; no network; no real
// provider processes. The A-L fixture-lint proves each LivenessAdapter mode plants the wire it
// claims, so a vacuous pass is impossible.
//
// ── NUL DISCIPLINE ─────────────────────────────────────────────────────────────────────────
// application.mjs and coordination-store.mjs carry NUL bytes and are never read here; the source
// scans target the NUL-free inventories only (application-deployment.mjs, application-cli.mjs,
// web-northbound.mjs, mcp-northbound.mjs, wave-driver.mjs, route-liveness.mjs,
// application-semantics.mjs, impl/scripts/baton.mjs).
//
// ── VERIFIED SPLIT (run twice from the repo root; both recorded in suite-notes-167.md) ──────
//   `node --test impl/test/readiness-honesty-red.test.mjs`
//   Run 1: 17 tests — 8 pass (A1p, A3p, A4p, A5p, A6p, P-stale, A-L, A-Lcap) / 9 fail (A1a, A1b,
//          A1c, A2, A3, A4, A5, A6, V-stale red rows).
//   Run 2: 17 tests — 8 pass / 9 fail. STABLE. The 9 red rows fail at their named stage; they go
//   green only on a contract-correct implementation. The 8 pins pass today and must stay green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { createDriver, createWaveDriver } from '../src/index.mjs';
import { RouteLiveness } from '../src/route-liveness.mjs';
import { projectTypedTerminalCause } from '../src/application-semantics.mjs';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const scriptsDir = fileURLToPath(new URL('../scripts', import.meta.url));
const deploymentSource = readFileSync(join(srcDir, 'application-deployment.mjs'), 'utf8');

// ── Ground-truth constants (contract G1/G2/D2, this session's verification) ────────────────
const ROUTE = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'low' });
const ROUTE_SIBLING = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const ROUTE_CODEX = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const STATIC_SUMMARY = 'The exact route passed static deployment readiness.';
const GENERIC_SUMMARY = 'The provider route failed.';
// The closed probe-failure code class A3 must see in PROVIDER_TERMINAL_GUIDANCE.
const PROBE_CODES = Object.freeze([
  'provider_unreachable', 'probe_content_mismatch', 'probe_oversize', 'provider_quota',
]);
// The four codes already typed at HEAD (the table A3p pins as unchanged).
const EXISTING_CODES = Object.freeze([
  'authentication_required', 'authentication_refresh_required', 'wire_frame_oversize', 'provider_crashed',
]);
const TABLE_FIELDS = Object.freeze(['category', 'summary', 'remediation', 'retryable']);
// A fixed injected epoch for probe/liveness fixtures (deterministic; never the real clock).
// 2026-08-13T00:00:00.000Z.
const NOW = 1_786_579_200_000;
const PROBE_TIMEOUT_MS = 60_000;        // the deployed probe watchdog — ≤120s (G2)
const FAILURE_WINDOW_MS = 60_000;       // the re-probe cadence bound (route-liveness.mjs:17)
const GROK_WINDOW_MS = 28 * 60 * 1000;  // the observed grok credential TTL (route-liveness.mjs:13)
const VERDICTS = Object.freeze(['probe-verified', 'unverified', 'failed']);

// ── Hermetic tmp roots ─────────────────────────────────────────────────────────────────────
const dirs = [];
function tmpDir(label = 'tmp') {
  const dir = mkdtempSync(join(tmpdir(), `baton-rh167-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

async function flush(times = 30) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}
async function settle(ms = 15) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flush(40);
}

// ── The scriptable fixture adapter ──────────────────────────────────────────────────────────
// Mirrors the #47 suite's ProbeAdapter. Probe turns (the bounded liveness probe riding the real
// spawn path) are scripted by `mode`; ordinary worker spawns stay in-flight unless their
// objective carries a wire marker — '(auth-refusal)' completes the turn with invalid_grant text,
// '(quota-refusal)' with the quota/capacity wire (the A4p negative-control surface).
class LivenessAdapter {
  constructor({ route = ROUTE, mode = 'complete', credentialState = 'available', family = 'grok' } = {}) {
    this._route = route;
    this.mode = mode;
    this.calls = { spawn: [], prompt: [] };
    this.events = [];
    this._onEvent = null;
    this._credentialState = credentialState;
    this._family = family;
  }

  card() {
    return {
      harness: this._route.harness,
      version: '1.0.0',
      authPosture: 'subscription',
      concurrencyCeiling: 64,
      maxContext: 128000,
      modelSelection: {
        mode: 'exact', configuredDefault: this._route.model, available: [this._route.model],
        family: this._family, acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low', 'high'], serviceTier: null,
        provenance: 'readiness-honesty-red', refreshedAt: null,
      },
      providerCompatibility: { credentialState: this._credentialState },
      permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native' },
      decision: 'native',
      turnCompletion: 'pausable',
    };
  }

  onEvent(cb) { this._onEvent = cb; }
  emit(event) { this.events.push(event); if (this._onEvent) this._onEvent(event); }

  _emitFor(worker, kind, payload) {
    this.emit({
      worker, harness: `${this._route.harness}@1.0.0`, turnEpoch: 1, kind, actor: 'worker', payload,
    });
  }

  static isProbeText(text) {
    return /probe/i.test(String(text ?? ''));
  }

  static expectedLine(text) {
    const match = /exactly one line:?\s*[`'"]([^`'"\n]+?)[`'"]/i.exec(String(text ?? ''));
    return match?.[1] ?? `${ROUTE.model}-probe ok`;
  }

  _runProbeTurn(worker, text) {
    const line = LivenessAdapter.expectedLine(text);
    const mode = this.mode;
    // Deferred so any per-probe listener the runtime attaches after spawn/prompt still observes
    // the wire (bounded async settling, never a work clock).
    setTimeout(() => {
      if (mode === 'refuse') return; // spawn-time refusal; no wire follows
      this._emitFor(worker, 'lifecycle.spawned', {});
      if (mode === 'die') {
        this._emitFor(worker, 'lifecycle.process_closed', { code: 1 });
        return;
      }
      this._emitFor(worker, 'resource.provider_call', { callId: `probe-${worker}`, phase: 'completed' });
      if (mode === 'invalid_grant') {
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'failed', output: 'OIDC token exchange failed: invalid_grant (refresh token revoked)',
        });
        return;
      }
      if (mode === 'quota' || mode === 'quota_failed') {
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: mode === 'quota' ? 'completed' : 'failed',
          output: "HTTP 402 Payment Required: insufficient_quota — the provider's quota/capacity is exhausted",
        });
        return;
      }
      if (mode === 'wrong') {
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'completed', output: 'this is not the content-verified line',
        });
        return;
      }
      if (mode === 'noisy') {
        // The exact pin placed BEYOND the 2KiB expected-response capture bound (§4.1.2): a
        // bounded capture must never see it, so this probe must fail, never verify.
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'completed', output: `${'x'.repeat(3072)}\n${line}`,
        });
        return;
      }
      this._emitFor(worker, 'lifecycle.turn_completed', { status: 'completed', output: line });
    }, 0);
  }

  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    const text = JSON.stringify(brief ?? {});
    if (LivenessAdapter.isProbeText(text)) {
      if (this.mode === 'refuse') {
        return { ok: false, code: 'fixture_adapter_refusal', reason: 'fixture adapter refused the probe spawn' };
      }
      this._runProbeTurn(worker, text);
      return { ok: true };
    }
    const goal = String(brief?.goal ?? '');
    if (goal.includes('(auth-refusal)')) {
      setTimeout(() => {
        this._emitFor(worker, 'resource.provider_call', { callId: `turn-${worker}`, phase: 'completed' });
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'failed', output: 'provider rejected the turn: invalid_grant (refresh token revoked)',
        });
      }, 0);
    } else if (goal.includes('(quota-refusal)')) {
      setTimeout(() => {
        this._emitFor(worker, 'resource.provider_call', { callId: `turn-${worker}`, phase: 'completed' });
        this._emitFor(worker, 'lifecycle.turn_completed', {
          status: 'failed',
          output: "HTTP 402 Payment Required: insufficient_quota — the provider's quota/capacity is exhausted",
        });
      }, 0);
    }
    return { ok: true };
  }

  async prompt(worker, content, mode) {
    this.calls.prompt.push({ worker, content, mode });
    if (LivenessAdapter.isProbeText(content)) this._runProbeTurn(worker, content);
    return { ok: true };
  }

  // The coordinator's two-phase stop settles on the adapter's typed confirmation — mirror
  // MockAdapter._finalizeStop's wire so deployment.close() drains immediately.
  _confirmStop(worker, kind) {
    setTimeout(() => {
      this._emitFor(worker, kind, {
        result: {
          status: 'cancelled', progress: 0, summary: `stopped via ${kind}`,
          artifacts: { commits: [], files: [] },
          verification: { command: 'true', claimedExit: -1 },
          openQuestions: [], budgetUsed: { tokens: 0, usd: 0 },
        },
      });
    }, 0);
  }

  async interrupt(worker) { this._confirmStop(worker, 'control.interrupt_confirmed'); return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill(worker) { this._confirmStop(worker, 'kill.confirmed'); return { ok: true }; }
}

function probeInvocations(adapter) {
  return [
    ...adapter.calls.spawn.filter(({ brief }) => LivenessAdapter.isProbeText(JSON.stringify(brief ?? {}))),
    ...adapter.calls.prompt.filter(({ content }) => LivenessAdapter.isProbeText(content)),
  ];
}

// ── The deployment fixture (phase85 pattern, #47 suite shape) ───────────────────────────────
function repository() {
  const root = tmpDir('repo');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'rh167@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'RH167 fixture'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

async function openFixture({ routes = [ROUTE], adapters, extraAdvanced = {} }) {
  const repo = repository();
  const deploymentRoot = tmpDir('deployment');
  let driver = null;
  let deployment = null;
  let wiringError = null;
  try {
    deployment = await openBatonDeployment({
      repo,
      advanced: {
        deploymentRoot,
        routes,
        adapters,
        verification: { command: 'true', arguments: [] },
        capacity: {
          estimate: () => ({ bytes: 60, inodes: 5 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
        ...extraAdvanced,
      },
    }, (driverOptions) => {
      // suite law #6: an explicit stall bound (60s), never the 20-min default — a resource
      // bound on no-progress evidence, not a workflow control (stallAction stays 'escalate').
      driver = createDriver({ ...driverOptions, watchdog: { ...driverOptions.watchdog, stallMs: 60_000 } });
      return driver;
    });
  } catch (error) {
    wiringError = error;
  }
  return {
    repo, deploymentRoot, driver, deployment, wiringError,
    async close() { try { await deployment?.close(); } catch { /* teardown is best-effort */ } },
  };
}

let objectiveSeq = 0;
async function spawnWorker(deployment, route, tag = 'worker') {
  objectiveSeq += 1;
  const run = await deployment.run(`${tag} objective ${objectiveSeq}`, { exact: route });
  await run.approve();
  await settle();
  return run;
}

async function gateOutcome(deployment, route, tag = 'gated') {
  objectiveSeq += 1;
  try {
    const run = await deployment.run(`${tag} objective ${objectiveSeq}`, { exact: route });
    await run.approve();
    await settle();
    return { refused: null, run };
  } catch (error) {
    return { refused: error, run: null };
  }
}

function routeRow(readiness, route) {
  return (readiness?.routes ?? []).find((row) => row.harness === route.harness
    && row.model === route.model && row.effort === route.effort) ?? null;
}

// The §4.2.2 wave-preflight consumer, driven exactly as wave-driver.mjs drives it, with the wave
// itself stopped at the fixture boundary (the D3 refusal is asserted before any member spawn).
async function runWavePreflight(deployment, route, members = 2) {
  const facade = {
    doctor: () => deployment.doctor(),
    waves: {
      start: async () => {
        throw Object.assign(new Error('fixture stop after preflight'), { code: 'fixture_preflight_passed' });
      },
    },
  };
  const wave = createWaveDriver(facade, { preflight: true });
  const request = {
    members: Array.from({ length: members }, (_, index) => ({
      role: `member-${index}`, objective: `fixture wave member ${index}`, exact: route,
    })),
  };
  return wave.run(request).then(
    () => 'resolved',
    (error) => error?.code ?? String(error?.message ?? error),
  );
}

// ── Source-scan hygiene ─────────────────────────────────────────────────────────────────────
// Scan CODE, not comments (so an explanatory mention of `probedAt`/`forceProbe` in a comment
// does not trip an absence pin).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[\s;(=,![\]])\/\/[^\n]*/gmu, '$1');
}

// A brace-balanced method slice anchored on the method signature — an EXISTENCE/byte-string
// anchor, never an absolute line window (#166). The parameter list is skipped via paren
// balancing (so a `route = {}` default cannot truncate the slice), then the body is extracted
// from its opening brace. Returns '' when the signature is absent.
function methodSlice(source, signatureRegex) {
  const startMatch = signatureRegex.exec(source);
  if (!startMatch) return '';
  const openParen = source.indexOf('(', startMatch.index);
  if (openParen === -1) return source.slice(startMatch.index);
  let parenDepth = 0;
  let inString = null;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === inString && source[index - 1] !== '\\') inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
    if (char === '(') parenDepth += 1;
    else if (char === ')') { parenDepth -= 1; if (parenDepth === 0) { closeParen = index; break; } }
  }
  if (closeParen === -1) return source.slice(startMatch.index);
  const open = source.indexOf('{', closeParen);
  if (open === -1) return source.slice(startMatch.index);
  let depth = 0;
  inString = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === inString && source[index - 1] !== '\\') inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) return source.slice(startMatch.index, index + 1); }
  }
  return source.slice(startMatch.index);
}

// A slice between two anchors — used for the baton.mjs doctor branch (an else-if branch, not a
// method). Returns '' when `from` is absent.
function sliceBetween(source, fromRegex, toRegex) {
  const from = fromRegex.exec(source);
  if (!from) return '';
  const after = source.slice(from.index);
  const to = toRegex.exec(after);
  return to ? after.slice(0, to.index) : after;
}

// The closed honest projection (D2, semantic order — no byte-stability claim). Asserted by
// behavior in A1a/A1b; the fields are the suite-chosen enumerable spelling.
function assertHonestProjection(row, { verdict, probedAt }) {
  assert.equal(row.verdict, verdict, `verdict is ${verdict}`);
  assert.equal(row.probedAt, probedAt, 'probedAt is the recorded measurement or null');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// PIN ROWS — pass TODAY; guard behavior the contract says #167 leaves UNCHANGED.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('A1p (pin): the static substrate is unchanged — a static-ready route reads state ready with the byte-stable summary, and the liveness sibling stays non-enumerable (G1, RT-4)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const fixture = await openFixture({ routes: [ROUTE], adapters: { grok: adapter } }); // no liveness wired
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const row = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.ok(row, 'the fixture serves the route row');
    assert.equal(row.state, 'ready', 'a static-ready route reads state ready');
    assert.equal(row.summary, STATIC_SUMMARY, 'the passing row summary is byte-stable (G1)');
    assert.equal(Object.keys(row).includes('liveness'), false,
      'the liveness sibling is non-enumerable — serialized doctor output stays byte-stable (DP5)');
    assert.equal(row.liveness?.state, 'unverified',
      'a never-probed route reads the honest unverified projection — never a fabricated liveness (D2)');
  } finally {
    await fixture.close();
  }
});

test('A3p (pin): the four existing PROVIDER_TERMINAL_GUIDANCE rows each carry {category, summary, remediation, retryable} (G6, the unchanged typed vocabulary)', () => {
  const semanticsSource = readFileSync(join(srcDir, 'application-semantics.mjs'), 'utf8');
  const guidance = sliceBetween(stripComments(semanticsSource),
    /const PROVIDER_TERMINAL_GUIDANCE/u, /const GENERIC_PROVIDER_TERMINAL_GUIDANCE/u);
  assert.ok(guidance.length > 0, 'the PROVIDER_TERMINAL_GUIDANCE literal is present');
  for (const code of EXISTING_CODES) {
    const rowStart = guidance.indexOf(`${code}: {`);
    assert.ok(rowStart !== -1, `${code} has a guidance row`);
    const rowBlock = guidance.slice(rowStart, guidance.indexOf('},', rowStart) + 2);
    for (const field of TABLE_FIELDS) {
      assert.ok(rowBlock.includes(field), `the ${code} row carries ${field}`);
    }
  }
});

test('A4p (pin): a quota/capacity worker-turn death fires NO invalid_grant credential fan-out, while the landed invalid_grant class still invalidates every row sharing the credentialKey — and only those rows (fold F-1, A4 negative control)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const controlAdapter = new LivenessAdapter({ route: ROUTE_CODEX, mode: 'complete', family: 'codex' });
  const fixture = await openFixture({
    routes: [ROUTE, ROUTE_SIBLING, ROUTE_CODEX],
    adapters: { grok: adapter, codex: controlAdapter },
    extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE_SIBLING, 'a4p-sibling');
    await spawnWorker(fixture.deployment, ROUTE_CODEX, 'a4p-control');
    const before = await fixture.deployment.doctor();
    assert.equal(routeRow(before, ROUTE_SIBLING)?.liveness?.state, 'verified', 'the grok sibling is verified before the verdict');
    const controlBefore = routeRow(before, ROUTE_CODEX)?.liveness?.state;
    assert.equal(controlBefore, 'verified', 'the codex negative control is verified before the verdict');
    assert.notEqual(routeRow(before, ROUTE_SIBLING)?.liveness?.credentialKey,
      routeRow(before, ROUTE_CODEX)?.liveness?.credentialKey,
      'the control rides a DIFFERENT credential identity');

    // A real worker turn on ROUTE surfaces a quota death — the A4p negative control: NO
    // invalid_grant fan-out, so the verified sibling SURVIVES.
    objectiveSeq += 1;
    const quotaRun = await fixture.deployment.run(`a4p (quota-refusal) objective ${objectiveSeq}`, { exact: ROUTE });
    await quotaRun.approve();
    await settle(25);
    const afterQuota = await fixture.deployment.doctor();
    assert.equal(routeRow(afterQuota, ROUTE_SIBLING)?.liveness?.state, 'verified',
      'a quota/capacity death fires NO invalid_grant fan-out — the sibling survives (A4)');
    assert.equal(routeRow(afterQuota, ROUTE_CODEX)?.liveness?.state, 'verified',
      'the unrelated credential identity survives the quota death');

    // The landed class still fires: an invalid_grant worker turn invalidates the grok sibling,
    // and ONLY the grok rows — the codex control survives (fold F-1).
    objectiveSeq += 1;
    const authRun = await fixture.deployment.run(`a4p (auth-refusal) objective ${objectiveSeq}`, { exact: ROUTE });
    await authRun.approve();
    await settle(25);
    const afterAuth = await fixture.deployment.doctor();
    assert.equal(routeRow(afterAuth, ROUTE_SIBLING)?.liveness?.state, 'failed',
      'an invalid_grant worker turn invalidates every row sharing the credentialKey (F-1)');
    assert.equal(routeRow(afterAuth, ROUTE_CODEX)?.liveness?.state, 'verified',
      'the unrelated credential identity survives the invalid_grant fan-out (F-1 negative control)');
  } finally {
    await fixture.close();
  }
});

test('A5p (pin): the landed preflight still refuses a static-blocked member with wave_driver_route_unready, and matchRoute performs no route substitution (RT-5p, D3)', async () => {
  const orphan = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const absentAdapter = new LivenessAdapter({ route: orphan, mode: 'complete', credentialState: 'absent' });
  const fixture = await openFixture({ routes: [ROUTE, orphan], adapters: { grok: adapter, codex: absentAdapter } });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const outcome = await runWavePreflight(fixture.deployment, orphan, 2);
    assert.equal(outcome, 'wave_driver_route_unready',
      'a static-blocked member is refused at preflight with the typed code (the seam the tier extends)');
  } finally {
    await fixture.close();
  }
  // No substitution: matchRoute selects only the member's own route (wave-driver.mjs:161-172).
  const waveSource = stripComments(readFileSync(join(srcDir, 'wave-driver.mjs'), 'utf8'));
  const matchSlice = methodSlice(waveSource, /function matchRoute\(/u);
  for (const token of ['fallback', 'alternate', 'substitute', 'router']) {
    assert.equal(matchSlice.includes(token), false, `matchRoute performs no ${token} selection — the member's exact route is the sole authority`);
  }
});

test('A6p (pin): all five provider-spawn surfaces still consult assertRouteReady — the existing static gate is not weakened by the liveness fold (G1, A6 sibling)', () => {
  const code = stripComments(deploymentSource);
  for (const method of ['run', 'startMany', 'workflow', 'explore', 'review']) {
    const slice = methodSlice(code, new RegExp(`async ${method}\\(`, 'u'));
    assert.ok(slice.includes('assertRouteReady'), `${method}() consults assertRouteReady (the existing static gate)`);
  }
});

test('P-stale (pin): the landed staleness law — a lapsed verified window projects unverified with the recorded measurement, never stale-verified, and a never-probed route reads unverified (D2, route-liveness.mjs:366-371)', async () => {
  let nowMs = NOW;
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const liveness = new RouteLiveness({
    now: () => nowMs,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    failureWindowMs: FAILURE_WINDOW_MS,
    adapters: { grok: adapter },
  });
  const row = await liveness.ensure(ROUTE);
  assert.equal(row.state, 'verified', 'a fresh content-verified probe verifies');
  assert.equal(liveness.project(ROUTE).state, 'verified', 'within the window the projection is verified');
  nowMs = NOW + GROK_WINDOW_MS + 1;
  const lapsed = liveness.project(ROUTE);
  assert.equal(lapsed.state, 'unverified', 'a lapsed window projects unverified — never stale-verified');
  assert.equal(lapsed.verifiedAt, NOW, 'the lapsed projection reports the recorded verifiedAt from content');
  assert.equal(lapsed.expiresAt, NOW + GROK_WINDOW_MS, 'the lapsed projection reports the recorded expiresAt from content');
  const never = liveness.project(ROUTE_CODEX);
  assert.equal(never.state, 'unverified', 'a never-probed route projects unverified');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// RED ROWS — fail TODAY for the named stage; GREEN only on a contract-correct implementation.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('V-stale (stage: lapsed-window verdict): the honest verdict follows the staleness law — a lapsed verified window reads verdict unverified, NEVER stale probe-verified, with probedAt retaining the last recorded measurement (D2 staleness law, P-stale twin)', async () => {
  let nowMs = NOW;
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const fixture = await openFixture({
    routes: [ROUTE],
    adapters: { grok: adapter },
    extraAdvanced: { liveness: { now: () => nowMs, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await spawnWorker(fixture.deployment, ROUTE, 'v-stale-probe');
    // The window lapses: the recorded verifiedAt (NOW) is now GROK_WINDOW_MS + 1ms in the past.
    nowMs = NOW + GROK_WINDOW_MS + 1;
    const lapsed = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.ok(lapsed, 'the fixture serves the route row');
    assert.equal(lapsed.verdict, 'unverified',
      'stage V-stale: a lapsed verified window reads verdict unverified — never stale probe-verified (D2 staleness law)');
    assert.ok(VERDICTS.includes(lapsed.verdict), 'verdict is from the closed vocabulary');
    assert.equal(lapsed.probedAt, new Date(NOW).toISOString(),
      'probedAt retains the last recorded measurement after the window lapses — content-derived, never cleared (OQ5)');
    assert.equal(lapsed.liveness?.verifiedAt, NOW,
      'the sibling records the same content-derived verifiedAt (P-stale agreement)');
    assert.equal(lapsed.static?.state, 'ready', 'the static substrate is unchanged (G1)');
  } finally {
    await fixture.close();
  }
});

test('A1a (stage: enumerable honest projection): a static-only doctor row reads unverified with probedAt null — never self-relabeled probe-verified — and the fields survive JSON.stringify; a fresh content-verified probe reads probe-verified with probedAt = recorded verifiedAt (D2 cardinal law + wire law)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const fixture = await openFixture({
    routes: [ROUTE],
    adapters: { grok: adapter },
    extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const row = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.ok(row, 'the fixture serves the route row');
    assert.ok(typeof row.verdict === 'string',
      'stage A1a: doctor route rows carry no enumerable verdict field (D2 shape)');
    assertHonestProjection(row, { verdict: 'unverified', probedAt: null });
    assert.ok(VERDICTS.includes(row.verdict), 'verdict is from the closed vocabulary');
    assert.ok(Object.keys(row).includes('verdict'), 'verdict is enumerable (Object.keys sees it)');
    const serialized = JSON.parse(JSON.stringify(row));
    assert.equal(serialized.verdict, 'unverified', 'verdict survives the wire (serialized JSON carries it)');
    assert.equal(serialized.probedAt, null, 'probedAt survives the wire');
    assert.equal(row.static?.state, 'ready', 'the static substrate is unchanged (G1)');

    // Probe-verified: a fresh content-verified probe relabels the row, probedAt = verifiedAt.
    await spawnWorker(fixture.deployment, ROUTE, 'a1a-probe');
    const row2 = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.equal(row2.verdict, 'probe-verified', 'a fresh content-verified probe reads probe-verified');
    assert.equal(row2.probedAt, new Date(row2.liveness.verifiedAt).toISOString(),
      'probedAt is content-derived from the recorded verifiedAt (never a TTL guess)');
    assert.equal(JSON.parse(JSON.stringify(row2)).verdict, 'probe-verified', 'probe-verified survives the wire');
  } finally {
    await fixture.close();
  }
});

test('A1b (stage: roster honest projection): the fleet_roster row carries the same {verdict, probedAt} projection — the liveness class is not a private sibling (D2 shape)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  const fixture = await openFixture({
    routes: [ROUTE],
    adapters: { grok: adapter },
    extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    const roster = await fixture.deployment.fleet.roster();
    const row = (roster?.routes ?? []).find((candidate) => candidate.harness === ROUTE.harness
      && candidate.model === ROUTE.model && candidate.effort === ROUTE.effort) ?? null;
    assert.ok(row, 'the roster serves the route row');
    assert.ok(typeof row.verdict === 'string', 'stage A1b: roster rows carry no verdict field (D2)');
    assertHonestProjection(row, { verdict: 'unverified', probedAt: null });
    assert.ok(Object.keys(row).includes('verdict'), 'verdict is enumerable on the roster row');
    assert.ok(Object.keys(row).includes('probedAt'), 'probedAt is enumerable on the roster row');
  } finally {
    await fixture.close();
  }
});

test('A1c (stage: northbound re-add): the operator wire surfaces — /v1/application-card, the CLI doctor read, deployment.doctor — re-add verdict + probedAt so a JSON round-trip cannot strip them (D2 wire law, blocker 3)', async () => {
  const webCode = stripComments(readFileSync(join(srcDir, 'web-northbound.mjs'), 'utf8'));
  const cardSlice = methodSlice(webCode, /async _handleOperatorRead\(/u);
  assert.ok(cardSlice.includes('probedAt'),
    'stage A1c: the /v1/application-card handler re-adds no probedAt — the honest projection vanishes on the wire (web re-adds only briefing)');

  const cliCode = stripComments(readFileSync(join(srcDir, 'application-cli.mjs'), 'utf8'));
  const doctorSlice = methodSlice(cliCode, /async doctor\(\)/u);
  assert.ok(doctorSlice.includes('probedAt'),
    'stage A1c: BatonWebClient.doctor() re-adds no probedAt (application-cli.mjs:1961)');

  const mcpCode = stripComments(readFileSync(join(srcDir, 'mcp-northbound.mjs'), 'utf8'));
  const freshSlice = methodSlice(mcpCode, /async _freshDoctorReadiness\(\)/u);
  assert.ok(freshSlice.includes('probedAt'),
    'stage A1c: the deployment.doctor MCP result re-adds no probedAt (mcp-northbound.mjs:1804-1808)');

  // The honest fields are the doctor row's, so every re-add carries them explicitly (the D6c
  // briefing precedent) — the sibling-only form is struck.
  assert.ok(cardSlice.includes('verdict'), 'the web re-add carries verdict');
  assert.ok(doctorSlice.includes('verdict'), 'the CLI re-add carries verdict');
  assert.ok(freshSlice.includes('verdict'), 'the MCP result carries verdict');
});

test('A2 (stage: on-demand forced probe): baton doctor --check forces exactly one fresh probe per stale route through the OPERATOR path — baton.mjs → BatonWebClient.doctor() → a /v1/application-card forced-probe parameter (D1 trigger 3, blocker 2)', async () => {
  const batonSource = stripComments(readFileSync(join(scriptsDir, 'baton.mjs'), 'utf8'));
  const doctorBranch = sliceBetween(batonSource, /parsed\.kind === 'doctor'/u, /parsed\.kind === 'serve'/u);
  assert.ok(doctorBranch.includes('forceProbe'),
    'stage A2: the baton.mjs doctor branch never forces a probe — --check only selects local-vs-remote (baton.mjs:81)');

  const cliCode = stripComments(readFileSync(join(srcDir, 'application-cli.mjs'), 'utf8'));
  const doctorSlice = methodSlice(cliCode, /async doctor\(\)/u);
  assert.ok(/forceProbe/u.test(doctorSlice),
    'stage A2: BatonWebClient.doctor() accepts no forced-probe signal (application-cli.mjs:1961-1978)');

  const webCode = stripComments(readFileSync(join(srcDir, 'web-northbound.mjs'), 'utf8'));
  const cardSlice = methodSlice(webCode, /async _handleOperatorRead\(/u);
  assert.ok(cardSlice.includes('forceProbe'),
    'stage A2: /v1/application-card has no forced-probe parameter (web-northbound.mjs:1504-1513)');
});

test('A3 (stage: typed refusal vocabulary): provider_unreachable, probe_content_mismatch, probe_oversize, and provider_quota each have a PROVIDER_TERMINAL_GUIDANCE row with {category, summary, remediation, retryable} — and a probe verdict never collapses to the generic (G6, refusal vocabulary)', async () => {
  const semanticsSource = readFileSync(join(srcDir, 'application-semantics.mjs'), 'utf8');
  const guidance = sliceBetween(stripComments(semanticsSource),
    /const PROVIDER_TERMINAL_GUIDANCE/u, /const GENERIC_PROVIDER_TERMINAL_GUIDANCE/u);
  assert.ok(guidance.length > 0, 'the PROVIDER_TERMINAL_GUIDANCE literal is present');
  for (const code of PROBE_CODES) {
    const rowStart = guidance.indexOf(`${code}: {`);
    assert.ok(rowStart !== -1,
      `stage A3: the typed refusal vocabulary has no ${code} row — the probe verdict collapses to the generic (G6)`);
    const rowBlock = guidance.slice(rowStart, guidance.indexOf('},', rowStart) + 2);
    for (const field of TABLE_FIELDS) {
      assert.ok(rowBlock.includes(field), `the ${code} row carries ${field}`);
    }
  }
  // The provider_quota row excludes automatic re-probe (OQ3 decided) — operator surface only.
  const quotaRow = guidance.slice(guidance.indexOf('provider_quota: {'));
  assert.ok(/no automatic re-probe|operator surface|re-probe/u.test(quotaRow),
    'the provider_quota row excludes automatic re-probe');

  // Behavior: a probe verdict never projects through GENERIC_PROVIDER_TERMINAL_GUIDANCE.
  const projected = projectTypedTerminalCause({ terminalOutcome: { accepted: false, code: 'probe_content_mismatch' } });
  assert.ok(projected, 'the terminal-cause projection resolves');
  assert.notEqual(projected.summary, GENERIC_SUMMARY,
    'stage A3: a probe verdict collapses to the generic provider failure at the terminal-cause projection (application-semantics.mjs:2127-2130)');
  assert.equal(projected.category, 'provider_protocol', 'the probe-content-mismatch row class is provider_protocol');
});

test('A4 (stage: quota/capacity death class): a probe whose output carries the quota/capacity wire — HTTP 402 / insufficient_quota — classifies to the typed provider_quota verdict, distinct from provider_unreachable and probe_content_mismatch, and excludes the automatic re-probe cadence (D1, refusal vocabulary, OQ3)', async () => {
  // Classification separation: a completed quota turn and a failed quota turn BOTH classify
  // provider_quota — never content-mismatch or unreachable.
  for (const mode of ['quota', 'quota_failed']) {
    const adapter = new LivenessAdapter({ route: ROUTE, mode });
    const fixture = await openFixture({
      routes: [ROUTE],
      adapters: { grok: adapter },
      extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
    });
    try {
      assert.equal(fixture.wiringError, null, 'fixture must open');
      await gateOutcome(fixture.deployment, ROUTE, `a4-${mode}`);
      const row = routeRow(await fixture.deployment.doctor(), ROUTE);
      assert.equal(row?.liveness?.code, 'provider_quota',
        `stage A4: a ${mode} probe carrying the quota/capacity wire does not classify provider_quota — it collapses to probe_content_mismatch/provider_unreachable at HEAD`);
      assert.equal(row?.liveness?.state, 'failed', 'the quota death is a failed verdict');
    } finally {
      await fixture.close();
    }
  }

  // No-auto-re-probe: a quota-dead row is excluded from the automatic failureWindowMs cadence
  // (route-liveness.mjs:132-146) — operator surface only.
  const livenessCode = stripComments(readFileSync(join(srcDir, 'route-liveness.mjs'), 'utf8'));
  const ensureSlice = methodSlice(livenessCode, /async ensure\(/u);
  assert.ok(/provider_quota|quota/u.test(ensureSlice),
    'stage A4: a quota-dead route is not excluded from the automatic failureWindowMs re-probe (no provider_quota handling)');
});

test('A5 (stage: honest-projection refusal): a failed verdict refuses wave preflight with wave_driver_route_unready BEFORE any member spawn, and the driver never substitutes a route (D3)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'die' });
  const fixture = await openFixture({
    routes: [ROUTE],
    adapters: { grok: adapter },
    extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await gateOutcome(fixture.deployment, ROUTE, 'a5-dead');
    const row = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.ok(row?.verdict,
      'stage A5: doctor route rows carry no verdict field — the preflight cannot refuse on the honest projection (D3, D2 wire law)');
    assert.equal(row.verdict, 'failed', 'a failed probe reads verdict failed');
    assert.equal(row.probedAt, new Date(row.liveness.failedAt).toISOString(),
      'a failed verdict still reports when it was measured (OQ5)');

    const outcome = await runWavePreflight(fixture.deployment, ROUTE, 2);
    assert.equal(outcome, 'wave_driver_route_unready',
      'a failed verdict refuses preflight with the typed code BEFORE any member spawn');

    // No substitution: matchRoute selects only the member's own route.
    const waveSource = stripComments(readFileSync(join(srcDir, 'wave-driver.mjs'), 'utf8'));
    const matchSlice = methodSlice(waveSource, /function matchRoute\(/u);
    for (const token of ['fallback', 'alternate', 'substitute', 'router']) {
      assert.equal(matchSlice.includes(token), false, `matchRoute performs no ${token} selection — the member's exact route is the sole authority`);
    }
  } finally {
    await fixture.close();
  }
});

test('A6 (stage: spawn-gate coverage): #livenessGate is consulted on every provider-spawn surface — run, startMany, workflow, explore, review — before any real turn, exactly as assertRouteReady already is (D1 trigger 1, blocker 4)', () => {
  const code = stripComments(deploymentSource);
  for (const method of ['run', 'startMany', 'workflow', 'explore', 'review']) {
    const slice = methodSlice(code, new RegExp(`async ${method}\\(`, 'u'));
    assert.ok(slice.includes('#livenessGate'),
      `stage A6: ${method}() consults no #livenessGate — the gate covers only run() (D1, blocker 4)`);
    assert.ok(slice.includes('assertRouteReady'),
      `${method}() keeps the existing assertRouteReady consultation (the gate is additive, never a replacement)`);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// GREEN FIXTURE-LINT PIN — pass TODAY, stage-independent; proves the LivenessAdapter modes plant
// the wires they claim, so a vacuous pass is impossible.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('A-L (pin): the fixture adapter plants the conditions it claims — the complete probe emits the exact content pin, the quota modes carry the quota/capacity wire, the die mode emits no turn_completed, and the expected-line parser reads the bounded probe prompt', async () => {
  const prompt = `Reply with exactly one line: '${ROUTE.model}-probe ok'. Nothing else.`;
  assert.equal(LivenessAdapter.expectedLine(prompt), `${ROUTE.model}-probe ok`,
    'the expected-line parser reads the bounded probe prompt (D1 probe shape)');

  const complete = new LivenessAdapter({ route: ROUTE, mode: 'complete' });
  complete._runProbeTurn('probe-complete', prompt);
  await settle();
  const completeTurn = complete.events.find((event) => event.kind === 'lifecycle.turn_completed');
  assert.equal(completeTurn?.payload?.status, 'completed', 'complete mode emits a completed turn');
  assert.equal(completeTurn?.payload?.output, `${ROUTE.model}-probe ok`, 'complete mode emits the exact content pin');

  for (const mode of ['quota', 'quota_failed']) {
    const quota = new LivenessAdapter({ route: ROUTE, mode });
    quota._runProbeTurn('probe-quota', prompt);
    await settle();
    const quotaTurn = quota.events.find((event) => event.kind === 'lifecycle.turn_completed');
    assert.ok(quotaTurn, `${mode} emits a turn_completed`);
    assert.match(String(quotaTurn?.payload?.output ?? ''), /402|insufficient_quota|quota|capacity|overloaded|limit exceeded/u,
      `${mode} carries the quota/capacity wire (A4) — the classification fixture is not vacuous`);
    if (mode === 'quota') assert.equal(quotaTurn.payload.status, 'completed', 'a completed quota turn still carries the wire');
    else assert.equal(quotaTurn.payload.status, 'failed', 'a failed quota turn carries the wire');
  }

  const die = new LivenessAdapter({ route: ROUTE, mode: 'die' });
  die._runProbeTurn('probe-die', prompt);
  await settle();
  assert.equal(die.events.some((event) => event.kind === 'lifecycle.turn_completed'), false,
    'die mode never emits turn_completed (a bare lifecycle.spawned is not provider-alive)');
  assert.ok(die.events.some((event) => event.kind === 'lifecycle.process_closed'),
    'die mode emits process_closed (the probe-classification wire)');

  const wrong = new LivenessAdapter({ route: ROUTE, mode: 'wrong' });
  wrong._runProbeTurn('probe-wrong', prompt);
  await settle();
  const wrongTurn = wrong.events.find((event) => event.kind === 'lifecycle.turn_completed');
  assert.equal(wrongTurn?.payload?.status, 'completed', 'wrong mode completes with non-pin content');
  assert.notEqual(wrongTurn?.payload?.output, `${ROUTE.model}-probe ok`, 'wrong mode does not emit the pin');

  const invalidGrant = new LivenessAdapter({ route: ROUTE, mode: 'invalid_grant' });
  invalidGrant._runProbeTurn('probe-auth', prompt);
  await settle();
  const authTurn = invalidGrant.events.find((event) => event.kind === 'lifecycle.turn_completed');
  assert.match(String(authTurn?.payload?.output ?? ''), /invalid_grant|revok/u,
    'the invalid_grant mode carries the credential-death wire (A4p)');

  const noisy = new LivenessAdapter({ route: ROUTE, mode: 'noisy' });
  noisy._runProbeTurn('probe-noisy', prompt);
  await settle();
  const noisyTurn = noisy.events.find((event) => event.kind === 'lifecycle.turn_completed');
  assert.equal(noisyTurn?.payload?.status, 'completed', 'noisy mode completes with the pin placed beyond the capture bound');
  assert.ok(String(noisyTurn?.payload?.output ?? '').length > 2048,
    'noisy mode places the exact pin beyond the 2KiB capture bound (A-Lcap fixture)');
  assert.ok(String(noisyTurn?.payload?.output ?? '').includes(`${ROUTE.model}-probe ok`),
    'noisy mode does carry the pin — only the bound hides it');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// PIN-TWIN ROWS — the named-stage companions of the pins above; GREEN at HEAD, they fail a
// plausible wrong implementation at the named stage.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('A-Lcap (pin): the bounded-capture law — a probe whose exact pin sits beyond the 2KiB capture bound never verifies; it fails probe_content_mismatch through the real classification (D1 cost-honesty, G2, A-L twin)', async () => {
  const adapter = new LivenessAdapter({ route: ROUTE, mode: 'noisy' });
  const fixture = await openFixture({
    routes: [ROUTE],
    adapters: { grok: adapter },
    extraAdvanced: { liveness: { now: () => NOW, probeTimeoutMs: PROBE_TIMEOUT_MS, failureWindowMs: FAILURE_WINDOW_MS } },
  });
  try {
    assert.equal(fixture.wiringError, null, 'fixture must open');
    await gateOutcome(fixture.deployment, ROUTE, 'a-lcap-noisy');
    const row = routeRow(await fixture.deployment.doctor(), ROUTE);
    assert.ok(row, 'the fixture serves the route row');
    assert.equal(row?.liveness?.state, 'failed',
      'the bounded-capture law (A-L twin): a probe whose exact pin sits beyond the capture bound NEVER verifies — it fails through the real classification');
    assert.equal(row?.liveness?.code, 'probe_content_mismatch',
      'the failure class is the typed content-mismatch, never a fabricated verify (G2, route-liveness.mjs:237-241)');
  } finally {
    await fixture.close();
  }
});
