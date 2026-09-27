// Issue #483 — a bounded `swarm.watch` HELD across the resident's stop crossed the web layer as
// 503 `temporarily_unavailable`. The resident's own fallthrough narration named it:
//   `baton-web dispatch fallthrough: command 'swarm_watch' raised the unmapped refusal code
//    'coordination_wait_aborted' and crossed as 503 temporarily_unavailable; map the code …`
// The store mints `coordination_wait_aborted` from `waitAfter` (its abort path) when the runtime
// holding the wait is closed — which is what a stop does to the swarm service. The code was in no
// refusal set, so the ONE class of caller that must learn the incarnation is leaving (a watcher) was
// told to `retry once` against a process that was gone.
//
// What this file pins, over the REAL served transport (a real `openBatonDeployment`, a real
// publication the client discovers, real ledger rows) — every await bounded and named (docs/42 §8):
//   (b) a bounded `swarm.watch` held across an ordinary stop crosses `coordination_wait_aborted`
//       as 409, with `detail.reason: 'resident_stopping'` and the cursor the caller re-arms from —
//       never the transient 503 row;
//   (c) the store's wait-abort code is a row of the ONE refusal set, raised by the runtime, and the
//       CLI renders a remedy for every reason the store can mint;
//   (e) the departure fold itself: a stop's own acts are the departure, a resident that starts over
//       a stopped ledger (the rows replayed at open are history) reads none.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { openBatonWebConnection } from '../src/mcp-web-bridge.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';
import { memberSource } from './seam-member-source.mjs';

// The red-before HEAD has no rendering leg: the rows below show their own red then, instead of the
// file failing to link before any of them runs.
let swarmWatchRefusalBlock = null;
try { ({ swarmWatchRefusalBlock } = await import('../src/application-cli.mjs')); } catch { /* red-before */ }

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const SWARM_ID = 's-issue483';
// The fixture's bounds, all shrunk to the test's own scale: the watch timeout,
// the bounded watch's own deadline (far past every fixture event), and the largest bound any await
// in this file may take.
const WATCH_TIMEOUT_MS = 60_000;
const SETTLE_MS = 20_000;
const OWNER_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fixture await that names what it abandoned (docs/42 §8): a bound miss is a fixture fact, never
 * read as the deployment's refusal. */
async function bounded(promise, { timeoutMs = SETTLE_MS, label = 'the deployment leg' } = {}) {
  let timer = null;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve('expired'), timeoutMs); });
  try {
    const raced = await Promise.race([promise.then((value) => ({ value }), (error) => ({ error })), expired]);
    if (raced === 'expired') throw new Error(`fixture_wait_unsettled: ${label} within ${timeoutMs}ms`);
    if (raced.error !== undefined) throw raced.error;
    return raced.value;
  } finally { clearTimeout(timer); }
}
async function until(probe, { timeoutMs = SETTLE_MS, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`fixture_wait_unsettled: ${label} within ${timeoutMs}ms`);
    await sleep(10);
  }
}

// docs/42 §7: a served host's socket is the ONE path the kernel bounds (103 bytes of `sun_path`), so
// the fixture mints the socket root directly under the short system root — never under the ambient
// TMPDIR a parallel gate hands the file (65..69 bytes, which the resident's own validator refuses).
const socketRoot = mkdtempSync(join(tmpdir(), 'bt483-'));
const roots = [socketRoot];
process.env.TMPDIR = socketRoot;
test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The issue306a world: a real repository with two commits, and the deployment/home/config roots. */
function world(label) {
  const root = mkdtempSync(join(socketRoot, `w-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue483@example.invalid', GIT_COMMITTER_EMAIL: 'issue483@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue483', GIT_COMMITTER_NAME: 'Issue483' });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'second commit\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  return {
    root, repo, home, configRoot, deploymentRoot, base, git,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
  };
}

/** The exact adapter card the ordinary resident self-check requires (the issue306a fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue483 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue483-watch-abort', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));

/** One open deployment over the fixture world — the test owns the driver, so the served transport
 * and the store are the fixture's own. */
async function resident(t, f) {
  let driver = null;
  const deployment = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home, webDrainMs: 500, sessionTtlMs: 60_000,
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await bounded(deployment.close(), { label: 'the fixture close' }); } catch { /* already closed */ } });
  return { deployment, driver };
}

/** The served transport, reached the way every client reaches a local resident: the publication it
 * wrote under this fixture's own config root. */
async function served(f) {
  return openBatonWebConnection({
    cwd: f.repo, env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home }, home: f.home,
    ownerUid: OWNER_UID, pollMs: 25, commandTimeoutMs: SETTLE_MS,
  });
}

/** The store's armed `waitAfter` waits — THE fact "the bounded watch is blocked in the store's own
 * wait", not still travelling to it. The store is this lane's own file, and the read is what makes
 * the staging deterministic (a request still in flight would pin a different row). It asserts nothing
 * on its own. */
const armedWaits = (driver) => driver.coordination._appendWaiters.size;

/** The bounded read of a held watch: the watch either answers (the row must fail loudly) or refuses
 * with its error; a watch that does neither inside the bound is a fixture_wait_unsettled. */
async function refusalOf(pending, { timeoutMs = SETTLE_MS, label = 'the held watch' } = {}) {
  let timer = null;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve('expired'), timeoutMs); });
  try {
    const raced = await Promise.race([
      pending.then((value) => ({ answered: value }), (error) => ({ error })),
      expired,
    ]);
    if (raced === 'expired') throw new Error(`fixture_wait_unsettled: ${label} within ${timeoutMs}ms`);
    return raced;
  } finally { clearTimeout(timer); }
}

/** The refusal the served transport answered with, asserted to be the #483 shape: the code, the
 * 409 class, the reason and the cursor. Returns its `detail` for the row's own assertions. */
function assertWatchAbortRefusal(outcome, { reason, afterSeq }) {
  assert.equal(outcome.answered, undefined,
    `the held watch must REFUSE, never answer a view: ${JSON.stringify(outcome.answered)?.slice(0, 200)}`);
  const error = outcome.error;
  assert.notEqual(error?.code, 'temporarily_unavailable',
    'the resident used to answer 503 "retry once" here — the exact gap the fallthrough narration named');
  assert.equal(error?.code, 'coordination_wait_aborted', `the store\'s own code crosses as itself: ${error?.message}`);
  assert.equal(error?.status, 409, 'a state the caller must observe, never a transport fault');
  assert.equal(error?.detail?.retryable, false, 'a typed refusal is never retryable');
  assert.notEqual(error?.detail?.message, 'command dispatch failed', 'the refusal keeps its own message');
  const detail = error?.detail?.detail;
  assert.ok(detail !== null && typeof detail === 'object',
    `the refusal carries the deployment's own detail: ${JSON.stringify(error?.detail ?? null)}`);
  assert.equal(detail.reason, reason, 'the reason is the closed-set member the departure minted');
  assert.equal(detail.afterSeq, afterSeq, 'and the caller\'s own cursor, carried so it can re-arm without remembering it');
  return detail;
}

// ── (b) the served transport: a held watch across an ordinary stop ───────────────────────────────

test('#483 (b): the same watch across an ordinary stop names resident_stopping',
  { timeout: 120_000 }, async (t) => {
    const f = world('stop');
    const { deployment, driver } = await resident(t, f);
    await bounded(deployment.host(), { label: 'the resident host open' });
    const opened = await served(f);
    const client = opened.client;

    await client.command('swarm.create', { swarmId: SWARM_ID, purpose: 'issue483 stop watch', idempotencyKey: 'issue483b:create' }, 'issue483b:create');
    const view = await client.command('swarm.view', { swarmId: SWARM_ID }, 'issue483b:view');
    const cursor = view.cursor;

    const pending = client.command('swarm.watch',
      { swarmId: SWARM_ID, afterSeq: cursor, timeoutMs: WATCH_TIMEOUT_MS }, 'issue483b:watch');
    pending.catch(() => { /* the row reads it through `refusalOf` */ });
    await until(() => armedWaits(driver) > 0, { label: 'the bounded watch to reach the store own wait' });

    const closed = await bounded(deployment.close(), { label: 'the ordinary stop' });
    assert.equal(closed.state, 'closed', `the stop converged: ${JSON.stringify(closed)}`);

    const outcome = await refusalOf(pending, { label: 'the held watch to be refused' });
    assertWatchAbortRefusal(outcome, { reason: 'resident_stopping', afterSeq: cursor });
    assert.match(String(outcome.error.message), /stopping/u, 'the message says the resident is stopping');
  });

// ── (c) the derivation pin: the store's mint, the closed reasons, the runtime's raiser ───────────

/** Comments are prose, not code: every `//` run to end of line and every `/* … *​/` block is blanked
 * to spaces CHARACTER BY CHARACTER, so an apostrophe in a TRAILING comment (the #473 helper's line
 * regex misses those) or a `//` inside a string (a URL) can never shift the brace walk below.
 * Lengths AND newlines are preserved, so offsets and line numbers stay exact. */
function blankComments(rawSource) {
  const out = rawSource.split('');
  for (let at = 0; at < rawSource.length; at += 1) {
    const character = rawSource[at];
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      for (at += 1; at < rawSource.length && rawSource[at] !== quote; at += 1) {
        if (rawSource[at] === '\\') at += 1;
      }
      continue;
    }
    if (character === '/' && rawSource[at + 1] === '/') {
      for (; at < rawSource.length && rawSource[at] !== '\n'; at += 1) out[at] = ' ';
      continue;
    }
    if (character === '/' && rawSource[at + 1] === '*') {
      for (; at < rawSource.length; at += 1) {
        out[at] = ' ';
        if (rawSource[at] === '*' && rawSource[at + 1] === '/') { out[at + 1] = ' '; at += 1; break; }
      }
    }
  }
  return out.join('');
}
/** One declaration's own source, from its declaration line to the brace closing its body — the
 * same walk the #473 pin uses, extended to the module-level functions this file also scans
 * (`classMember` for a two-space class member, `moduleFunction` for a top-level `function`, with or
 * without `export`). Null when the declaration is gone — the caller asserts, so a rename fails the
 * pin instead of silently shrinking it. */
function declarationSource(rawSource, pattern) {
  const cleaned = blankComments(rawSource);
  const match = pattern.exec(cleaned);
  if (match === null) return null;
  let depth = 0;
  let at = match.index + match[0].length - 1;
  for (; at < cleaned.length; at += 1) {
    const character = cleaned[at];
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      for (at += 1; at < cleaned.length && cleaned[at] !== quote; at += 1) {
        if (cleaned[at] === '\\') at += 1;
      }
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') { depth -= 1; if (depth === 0) break; }
  }
  const open = cleaned.indexOf('{', at);
  depth = 0;
  for (let cursor = open; cursor < cleaned.length; cursor += 1) {
    const character = cleaned[cursor];
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      for (cursor += 1; cursor < cleaned.length && cleaned[cursor] !== quote; cursor += 1) {
        if (cleaned[cursor] === '\\') cursor += 1;
      }
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') { depth -= 1; if (depth === 0) return rawSource.slice(match.index, cursor + 1); }
  }
  return null;
}
const classMember = (rawSource, name) =>
  declarationSource(rawSource, new RegExp(`^  (?:async )?${name}\\(`, 'mu'));
const moduleFunction = (rawSource, name) =>
  declarationSource(rawSource, new RegExp(`^(?:export )?function ${name}\\(`, 'mu'));
/** Every `refuse(message, code, …)` call's literal code in one module source — the #430 scanner in
 * miniature: the raiser is read from the code, never from a claim about it. */
function raisedCodes(rawSource) {
  const codes = new Set();
  for (const match of blankComments(rawSource).matchAll(/refuse\([^;\n]*?,\s*'([a-z][a-z0-9_]*)'/gu)) codes.add(match[1]);
  return codes;
}

const runtimeSource = readFileSync(new URL('../src/swarm-runtime.mjs', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../src/application-cli.mjs', import.meta.url), 'utf8');

test('#483 (c): the store\'s wait-abort code is a row of the ONE refusal set, raised by the runtime, and every reason it mints is rendered', () => {
  // Issue #259 slice 7 moved waitAfter out of coordination-store.mjs into
  // coordination-ledger-writes.mjs; memberSource resolves it wherever the seam inventory says it
  // now lives, so a future move needs no matching edit here.
  const waitAfter = memberSource('waitAfter');
  assert.ok(waitAfter !== null && waitAfter.length > 0,
    'the store\'s wait the bounded watch holds is still a named member of one of STORE_MODULE_FILES (a rename must update this pin)');
  const abortCodes = [...new Set([...waitAfter.matchAll(/code: '([a-z][a-z0-9_]*)'/gu)].map((match) => match[1]))].sort();
  assert.deepEqual(abortCodes, ['coordination_wait_aborted'],
    `the store's wait-abort vocabulary is exactly this one code; a new code here must be classified in SWARM_REFUSAL_CODES and in the #473 pin's own table: ${JSON.stringify(abortCodes)}`);

  const row = SWARM_REFUSAL_CODES[abortCodes[0]];
  assert.ok(row !== undefined, `${abortCodes[0]} is a row of the swarm family's ONE closed refusal set`);
  assert.equal(row.status, 409, 'a departure is a state the caller must observe, never a transport fault');
  assert.deepEqual([...row.raisedBy].sort(), ['runtime'],
    'the runtime is the raiser: the store mints the bare error, the runtime carries it to the web layer typed');
  assert.ok(raisedCodes(runtimeSource).has(abortCodes[0]),
    'and the runtime really calls refuse() with it — the raisedBy claim is read from the code, never asserted');

  // The reasons the store can mint, read from its own fold. Also moved out of
  // coordination-store.mjs (into coordination-ledger.mjs, issue #259 slice 4); memberSource
  // resolves it the same way as waitAfter above.
  const fold = memberSource('_foldIncarnationLifecycle');
  assert.ok(fold !== null && fold.length > 0,
    'the store folds the deployment\'s own host.* rows (the departure the wait crosses with)');
  const minted = new Set([...fold.matchAll(/reason: '([a-z_]+)'/gu)].map((match) => match[1]));
  assert.deepEqual([...minted].sort(), ['resident_stopping'],
    `the store mints exactly this reason: ${JSON.stringify([...minted])}`);

  // The reasons the CLI renders, read from its own block — and the runtime's own third reason.
  const block = moduleFunction(cliSource, 'swarmWatchRefusalBlock');
  assert.ok(block !== null && block.length > 0, 'the CLI declares the watch-abort rendering (#483 item 1)');
  const rendered = new Set([...block.matchAll(/reason === '([a-z_]+)'/gu)].map((match) => match[1]));
  for (const reason of minted) {
    assert.ok(rendered.has(reason), `${reason} is a reason the CLI renders a remedy for`);
  }
  assert.ok(runtimeSource.includes("'store_closed'"),
    'the runtime mints store_closed for a wait torn down with no live departure on the ledger');
  assert.ok(rendered.has('store_closed'), 'and the CLI renders a remedy for it too');
  assert.deepEqual([...rendered].sort(), ['resident_stopping', 'store_closed'],
    `the rendered set is the closed crossing vocabulary: ${JSON.stringify([...rendered])}`);
});

// ── (e) the departure is the LIVE incarnation's own — the rows the fold reads, one at a time ─────

test('#483 (e): the store folds the deployment\'s own host rows, and only a LIVE stop is this incarnation\'s departure', () => {
  const root = mkdtempSync(join(socketRoot, 'w-replay-'));
  const clock = () => new Date().toISOString();
  roots.push(root);
  const first = new CoordinationStore(root, { clock });
  assert.equal(first.incarnationDeparture(), null, 'a store with no host rows has no departure');
  first.recordDriver('host.stop_requested', { trigger: 'operation_completed' },
    { actor: 'deployment:repo-issue483:resident', key: 'e1' });
  assert.deepEqual(first.incarnationDeparture(), { reason: 'resident_stopping' },
    'an ordinary stop\'s first act is the departure — before the transport the watch rides ever closes');
  first.recordDriver('host.stopped', { state: 'stopped' },
    { actor: 'deployment:repo-issue483:resident', key: 'e2' });
  assert.deepEqual(first.incarnationDeparture(), { reason: 'resident_stopping' },
    'the release re-states the same stop');
  first.releaseWriterLease({ requireOwned: true });

  // The next incarnation over the SAME ledger is not the one that stopped: the rows it replays at
  // open are history, so its watches are never refused for a predecessor's stop.
  const next = new CoordinationStore(root, { clock });
  let nextKey = 0;
  const nextHost = (kind, payload) => next.recordDriver(kind, payload, {
    actor: 'deployment:repo-issue483:resident', key: `e-next-${nextKey += 1}`,
  });
  assert.equal(next.incarnationDeparture(), null,
    'a resident that starts over a stopped ledger serves its swarms normally');
  nextHost('host.stop_waiting', { on: 'worker', ids: ['w-1'] });
  assert.deepEqual(next.incarnationDeparture(), { reason: 'resident_stopping' },
    'the stop\'s own named wait is the departure too');
  next.releaseWriterLease({ requireOwned: true });
});
