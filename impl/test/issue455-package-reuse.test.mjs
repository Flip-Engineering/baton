// Issue #455 — a ContextPackage is content-addressed, so a second admission of the SAME digest is
// the same package, not a conflict: `swarm recruit --issue N` must REUSE the admitted package and
// attach it to the new run, instead of refusing `context_package_conflict` at the door.
//
// What this suite pins, on the REAL stack (a real CoordinationStore behind a real WebNorthbound, a
// real SwarmRuntime, the real CLI client and parser, and the deployment's own Context CAS writer):
//
//   455-a1  two recruits naming the same `--issue N` on one deployment admit ONE package and land
//           TWO attachments — both briefs render `## Context package` with the same digest;
//   455-a2  the admit receipt for an already-admitted digest answers the existing record
//           (`result: 'reused'`, `reused: true`, the ORIGINAL admittedEvent) and appends nothing;
//   455-b   a `--resume-from` successor of a provider-fault-settled seat recruited with the same
//           `--issue` succeeds and its brief carries the package (#442's own remedy);
//   455-c   a changed issue body is a different package: a NEW digest is admitted, the older run
//           keeps the older package (the replay rule is unchanged);
//   455-d   replay parity: reuse wrote no event, and a store reopened on the same ledger reads the
//           same package record and the same attachments.
//
// The issue reader is the stub the root's credential would be (the #441 fixture's contract: answer
// `{number, title, body, labels, url}`), and the coordinator's provider-fault death seam is a stub
// answering the exact record shape `Coordinator._mintProviderFaultDeath` records — so the fault the
// runtime folds in 455-b is the runtime's own observation, never a hand-written membership row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { StatelessContextBench } from '../src/context-program.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue455';
const SWARM_ID = 's-455';
const ISSUE = 455;
const CITED_DOC = 'docs/47-the-reading-half.md';
const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue455-${label}-`));
  roots.push(root);
  return root;
}

const ISSUE_TITLE = 'A second recruit on one issue is refused at the door';
const ISSUE_BODY = [
  'A content-addressed package must be reused and attached, not refused as a duplicate: every',
  `second lane on one issue is refused. See ${CITED_DOC} §6 and the #441 receipt.`,
].join('\n');
const ISSUE_BODY_AMENDED = `${ISSUE_BODY}\n\nThe root amended this body after the first admission.\n`;

/** The root credential's contract, stubbed: one issue, its body read from mutable state so the
 * 455-c row can amend it between two recruits (a reader that changed is exactly what the root's
 * gh answers when the issue text moved). */
function issueReader(state) {
  return async ({ issue }) => {
    if (issue !== ISSUE) throw Object.assign(new Error(`no issue ${issue}`), { code: 'issue_not_found' });
    return {
      number: ISSUE, title: ISSUE_TITLE, body: state.body, labels: ['bug', 'priority:high'],
      url: `https://github.com/owner/repo/issues/${ISSUE}`,
    };
  };
}

function writeDocs(repoRoot) {
  mkdirSync(join(repoRoot, 'docs'), { recursive: true });
  writeFileSync(join(repoRoot, CITED_DOC), '# The reading half\n\nA seat reads its issue.\n');
  return repoRoot;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {} }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}

/** The store options BOTH the live store and the replayed one are opened with (455-d), so a
 * reopened ledger folds the same package through the same authority. */
function storeOptions(directory, bench) {
  return {
    repoId: REPO_ID, deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: bench.environmentDigest,
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('context source attestation is not used here'); },
    clock: () => new Date(NOW).toISOString(),
  };
}

/** The REAL stack, plus the two seams this issue judges: the root's issue reader and the
 * coordinator's provider-fault death record. */
function fixture(t) {
  const repoRoot = writeDocs(scratch('repo'));
  const directory = scratch('web');
  const coordinationDir = join(directory, 'coordination');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const bench = new StatelessContextBench({
    artifactRoot: join(directory, 'context'), sources: {},
    environmentDigest: '2'.repeat(64), policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const coordination = new CoordinationStore(coordinationDir, storeOptions(directory, bench));
  const workers = [];
  // The coordinator's own death seam (Coordinator.providerFaultDeathFor / _mintProviderFaultDeath):
  // a fixture host answers it from this map, exactly as the real coordinator answers from its own.
  const faultDeaths = new Map();
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: {
      list: () => workers,
      providerFaultDeathFor: (workerId) => faultDeaths.get(workerId) ?? null,
    },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => {},
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, sessionPrincipal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
        principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
      }, context);
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
    // The deployment's ONE context-CAS writer (the resident's own wiring point).
    contextSourceAdmit: (value) => bench.admitSource(value),
  });
  const issued = sessions.issue({
    userId: 'issue455-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'issue455-fixture' });
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      const response = await send(web, {
        method: init.method ?? 'GET', path: `${parsed.pathname}${parsed.search}`,
        body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers ?? {},
      });
      return {
        ok: response.status >= 200 && response.status < 300, status: response.status,
        text: async () => response.rawBody ?? '',
      };
    },
    clock: () => NOW, sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  });
  return {
    directory, coordinationDir, bench, coordination, web, swarmRuntime, client, repoRoot, workers,
    faultDeaths, issueState: { body: ISSUE_BODY },
  };
}

async function createSwarm(coordination, runtime) {
  await runtime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue455', idempotencyKey: 'issue455:create',
  }, OWNER);
}

/** The recruit the root runs: the CLI's own spelling, the real parser, the real client. */
const recruit = (f, seat, extra = []) => runBatonCli(
  parseBatonCli(['swarm', 'recruit', SWARM_ID, seat, 'Land the item this issue names.', ...extra]),
  f.client, { issueReader: issueReader(f.issueState), contextRepoRoot: f.repoRoot },
);

const seatRow = (coordination, seat) => coordination.swarm(SWARM_ID).participants[seat] ?? null;
const admittedEvents = (coordination) => coordination.eventsView()
  .filter((event) => event.kind === 'package.admitted');
const attachedEvents = (coordination) => coordination.eventsView()
  .filter((event) => event.kind === 'package.attached');

/** The normalize input of an admitted package, read back off its own admission event: the exact
 * bytes a second admit of the same package carries — the strongest form of "the same package". */
function admittedFields(event) {
  return {
    schemaVersion: event.payload.schemaVersion, kind: event.payload.kind,
    branches: event.payload.branches, provenance: event.payload.provenance,
    policyDigest: event.payload.policyDigest,
  };
}

// ── 455-a1: two recruits, one issue, ONE package, two attachments ───────────────────────────────

test('455-a1: two recruits naming the same --issue admit ONE package and attach it to both runs', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);

  await recruit(f, 'lane-a', ['--issue', String(ISSUE)]);
  const first = seatRow(f.coordination, 'lane-a');
  assert.ok(first, 'the first seat joined');
  const [firstAttachment] = f.coordination.contextPackageAttachments(first.runId);
  assert.ok(firstAttachment, 'the package is attached to the first seat run');
  assert.equal(firstAttachment.scope, 'worker:lane-a');

  // RED BEFORE #455: this recruit refused `context_package_conflict: duplicate context package
  // <digest>` at the web port (HTTP 409), so the second seat never reached the runtime.
  await recruit(f, 'lane-b', ['--issue', String(ISSUE)]);
  const second = seatRow(f.coordination, 'lane-b');
  assert.ok(second, 'the second seat joined on the same issue');

  const admitted = admittedEvents(f.coordination);
  assert.equal(admitted.length, 1, 'ONE package is admitted however many lanes read it');
  const digest = admitted[0].payload.packageDigest;

  const secondAttachments = f.coordination.contextPackageAttachments(second.runId);
  assert.equal(secondAttachments.length, 1, 'the second run carries its own attachment');
  assert.equal(secondAttachments[0].packageDigest, digest, 'both runs carry the SAME package');
  assert.equal(secondAttachments[0].scope, 'worker:lane-b');
  assert.equal(firstAttachment.packageDigest, digest);

  for (const [seat, row] of [['lane-a', first], ['lane-b', second]]) {
    assert.match(row.brief, /## Context package/u, `the ${seat} brief renders the package section`);
    assert.ok(row.brief.includes(digest), `the ${seat} brief names the package digest`);
    assert.match(row.brief, new RegExp(ISSUE_TITLE, 'u'), `the ${seat} brief carries the issue text`);
  }
});

// ── 455-a2: the admit receipt ───────────────────────────────────────────────────────────────────

test('455-a2: a re-admit of an admitted digest answers the existing record and appends nothing', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  await recruit(f, 'lane-a', ['--issue', String(ISSUE)]);

  const [admission] = admittedEvents(f.coordination);
  const first = f.coordination.contextPackage(admission.payload.packageDigest);
  const eventsBefore = f.coordination.eventsView().length;

  const again = f.coordination.admitContextPackage(admittedFields(admission), { actor: 'root', key: 'issue455:re-admit' });

  assert.equal(again.result, 'reused', 'the receipt names the reuse');
  assert.equal(again.reused, true, 'the receipt says the package was reused');
  assert.equal(again.package.packageDigest, first.packageDigest, 'the same package');
  assert.equal(again.package.admittedEvent, first.admittedEvent, 'the ORIGINAL admission is named');
  assert.equal(again.event.seq, first.admittedEvent, 'the receipt event is that admission, not a new one');
  assert.equal(f.coordination.eventsView().length, eventsBefore, 'a reuse appends no event');
  assert.equal(admittedEvents(f.coordination).length, 1, 'still exactly ONE package.admitted row');
});

// ── 455-b: the #442 remedy — a fault-settled seat's successor keeps its issue ────────────────────

test('455-b: --resume-from a provider-fault-settled seat reuses the package and briefs its successor', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  await recruit(f, 'glm-455', ['--issue', String(ISSUE)]);

  const predecessor = seatRow(f.coordination, 'glm-455');
  const binding = predecessor.bindings.at(-1);
  assert.ok(binding, 'the predecessor is bound to its worker');
  // The coordinator's death seam: the record shape `_mintProviderFaultDeath` stores, verbatim
  // (the route is the exact route the fault is a fact about — the fault row requires one).
  const route = Object.freeze({ harness: 'mock', model: 'mock-1', effort: 'low' });
  f.faultDeaths.set(binding.workerId, {
    workerId: binding.workerId, taskId: binding.taskId, runId: predecessor.runId, seq: 7,
    at: '2026-09-18T12:00:00.000Z', code: 'provider_quota', route, resetAt: null,
    resetAtText: null, snapshotSha: null, retainedWorktree: null,
  });

  const [firstAttachment] = f.coordination.contextPackageAttachments(predecessor.runId);
  assert.ok(firstAttachment, 'the first seat carries the package before the fault');

  // RED BEFORE #455: the identical package was refused as a duplicate, so the fault-settled lane
  // could not be resumed with the issue it was recruited for (#442's own remedy, blocked).
  // Issue #572: the resume is the whole recovery — the package attach and the composed brief land
  // in the recruit that performs it, with no continuation question to answer.
  await recruit(f, 'glm-455b', ['--issue', String(ISSUE), '--resume-from', 'glm-455']);
  const settled = seatRow(f.coordination, 'glm-455');
  assert.equal(settled.status, 'left', 'the runtime folded the provider fault onto the predecessor');
  assert.equal(settled.leftReason, 'provider_fault');

  const successor = seatRow(f.coordination, 'glm-455b');
  assert.ok(successor, 'the successor joined');
  assert.equal(successor.resumeFrom, 'glm-455', 'the successor names its predecessor');
  assert.match(successor.brief, /## Context package/u, 'the successor brief carries the package section');
  assert.ok(successor.brief.includes(firstAttachment.packageDigest),
    'the successor brief names the same package the predecessor read');

  const [successorAttachment] = f.coordination.contextPackageAttachments(successor.runId);
  assert.ok(successorAttachment, 'the package is attached to the successor run');
  assert.equal(successorAttachment.packageDigest, firstAttachment.packageDigest);
  assert.equal(admittedEvents(f.coordination).length, 1, 'the successor admits no second package');
});

// ── 455-c: a changed issue body is a different package ───────────────────────────────────────────

test('455-c: a changed issue body admits a NEW package and leaves the older run on the older one', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  await recruit(f, 'lane-a', ['--issue', String(ISSUE)]);
  const older = seatRow(f.coordination, 'lane-a');
  const [olderAttachment] = f.coordination.contextPackageAttachments(older.runId);

  f.issueState.body = ISSUE_BODY_AMENDED;
  await recruit(f, 'lane-b', ['--issue', String(ISSUE)]);

  const amended = admittedEvents(f.coordination);
  assert.equal(amended.length, 2, 'the amended body admits a second package');
  const digests = amended.map((event) => event.payload.packageDigest);
  assert.notEqual(digests[0], digests[1], 'a changed body is a different digest');

  const newer = seatRow(f.coordination, 'lane-b');
  const [newerAttachment] = f.coordination.contextPackageAttachments(newer.runId);
  assert.equal(newerAttachment.packageDigest, digests[1], 'the newest seat reads the newest package');
  assert.equal(olderAttachment.packageDigest, digests[0], 'the older run keeps the older package');
  assert.equal(f.coordination.contextPackageAttachments(older.runId)[0].packageDigest, digests[0]);
  assert.ok(newer.brief.includes('amended this body'), 'the newer brief carries the newer text');
  assert.equal(older.brief.includes('amended this body'), false, 'the older brief is unchanged');

  // RED BEFORE #455: this third recruit refused the AMENDED package as a duplicate too. Reuse is
  // per-digest — the newer world is one package however many lanes read it.
  await recruit(f, 'lane-c', ['--issue', String(ISSUE)]);
  const third = seatRow(f.coordination, 'lane-c');
  assert.ok(third, 'a third lane on the amended issue joins');
  const [thirdAttachment] = f.coordination.contextPackageAttachments(third.runId);
  assert.equal(thirdAttachment.packageDigest, digests[1], 'the third lane reads the amended package');
  assert.equal(admittedEvents(f.coordination).length, 2, 'the amended package is reused, not re-admitted');
  assert.ok(third.brief.includes(digests[1]), 'the third brief names the amended digest');
});

// ── 455-d: replay parity — reuse is not a second admission ───────────────────────────────────────

test('455-d: reuse writes no event and a replayed ledger reads the same record and attachments', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  await recruit(f, 'lane-a', ['--issue', String(ISSUE)]);
  await recruit(f, 'lane-b', ['--issue', String(ISSUE)]);

  const ledger = f.coordination.eventsView();
  assert.equal(ledger.filter((event) => event.kind === 'package.admitted').length, 1,
    'reuse never writes a second admission');
  const attaches = attachedEvents(f.coordination);
  assert.equal(attaches.length, 2, 'one attachment row per run, both naming the one package');

  const [admission] = admittedEvents(f.coordination);
  const digest = admission.payload.packageDigest;
  const live = f.coordination.contextPackage(digest);

  const replayed = new CoordinationStore(f.coordinationDir, storeOptions(f.directory, f.bench));
  assert.equal(replayed.eventsView().length, ledger.length, 'the ledger replays byte for byte');
  assert.deepEqual(replayed.contextPackage(digest), live, 'the replayed package record is identical');
  assert.equal(replayed.contextPackage(digest).admittedEvent, live.admittedEvent,
    'replay binds the package to the SAME admission');
  for (const seat of ['lane-a', 'lane-b']) {
    const row = seatRow(f.coordination, seat);
    assert.deepEqual(
      replayed.contextPackageAttachments(row.runId).map((attachment) => attachment.packageDigest),
      [digest],
      `the replayed ledger carries ${seat}'s attachment`,
    );
  }
});
