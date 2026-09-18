// Issue #441 lane A — the ROOT's CLI pulls the issue and the docs it cites at recruit time into
// ONE durable ContextPackage (docs/32 §3.3 REFLEX-3) and the seat's brief renders it.
//
// What this suite pins, end to end, on the REAL stack (a real CoordinationStore behind a real
// WebNorthbound, a real SwarmRuntime, the real CLI client and parser):
//
//   441a-1  the recruit spelling admits --issue N and --doc PATH…, and refuses --issue without a
//           number at the parse (no wire call is made);
//   441a-2  with an injected issue reader the recruit admits ONE package whose branches are
//           `issue:N` and the doc(s) the issue cites (plus every --doc), and attaches it to the
//           seat's run with scope worker:<seat>;
//   441a-3  the brief renders a `## Context package` section after `## Swarm situation`, naming
//           each branch, its digest, its byte size and the first slice of its text (the issue
//           title + body first), bounded by the registry row — never a literal;
//   441a-4  a recruit without --issue renders no section: today's hand-typed briefs are unchanged;
//   441a-5  a reader that cannot read the issue refuses typed, naming the issue — no package is
//           admitted and no seat joins; a --doc outside the repository refuses the same way;
//   441a-6  the branch resolver returns the issue body for the digest the brief printed, so the
//           seat (or the root) can read the package back.
//
// The deployment-side mint: a branch's content is minted through the deployment's own context CAS
// (`StatelessContextBench.admitSource` — the ONE writer that resolves the store's
// `contextReferenceRead`). This suite wires that writer exactly where the resident must wire it —
// `WebNorthbound({ contextSourceAdmit })` — so every row below exercises the production chain.
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
import { FRAME_LIMITS } from '../src/limits.mjs';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue441a';
const SWARM_ID = 's-441a';
const ISSUE = 441;
const CITED_DOC = 'docs/47-the-reading-half.md';
const EXPLICIT_DOC = 'docs/32-reflexive-orchestration.md';
const SEAT = 'lane-a';
const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue441a-${label}-`));
  roots.push(root);
  return root;
}

const ISSUE_TITLE = 'Seats cannot read the world they work in';
const ISSUE_BODY = [
  'Every lane brief today is hand-typed text because a seat cannot read the GitHub issue its',
  `brief names, the design docs the issue cites, or the work its peers landed. See ${CITED_DOC} §1`,
  'and the #433 contributions projection. Full text follows.',
  'x'.repeat(4096),
].join('\n');

function issueReader() {
  return async ({ issue }) => {
    if (issue !== ISSUE) throw Object.assign(new Error(`no issue ${issue}`), { code: 'issue_not_found' });
    return {
      number: ISSUE, title: ISSUE_TITLE, body: ISSUE_BODY, labels: ['priority:high'],
      url: `https://github.com/owner/repo/issues/${ISSUE}`,
    };
  };
}

function writeDocs(repoRoot) {
  mkdirSync(join(repoRoot, 'docs'), { recursive: true });
  writeFileSync(join(repoRoot, CITED_DOC), '# The reading half\n\nA seat reads its issue.\n');
  writeFileSync(join(repoRoot, EXPLICIT_DOC), '# Reflexive orchestration\n\nREFLEX-3 packages.\n');
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

/** The REAL stack: the coordination store whose context resolver is a real Context Bench (the
 * deployment's own CAS), the real swarm runtime, the real web bus, the real CLI client. */
function fixture(t) {
  const repoRoot = writeDocs(scratch('repo'));
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const bench = new StatelessContextBench({
    artifactRoot: join(directory, 'context'), sources: {},
    environmentDigest: '2'.repeat(64), policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const coordination = new CoordinationStore(join(directory, 'coordination'), {
    repoId: REPO_ID, deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: bench.environmentDigest,
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('context source attestation is not used here'); },
    clock: () => new Date(NOW).toISOString(),
  });
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => workers },
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
    userId: 'issue441a-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'issue441a-fixture' });
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
  return { directory, bench, coordination, web, swarmRuntime, client, repoRoot, workers };
}

async function createSwarm(coordination, runtime) {
  await runtime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue441a', idempotencyKey: 'issue441a:create',
  }, OWNER);
}

const recruitArgv = (extra = []) => [
  'swarm', 'recruit', SWARM_ID, SEAT, 'Read the issue and land its item 1.', ...extra,
];

const seatRow = (coordination) => coordination.swarm(SWARM_ID).participants[SEAT] ?? null;
const admittedPackages = (coordination) => coordination.eventsView()
  .filter((event) => event.kind === 'package.admitted');

function refusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

// ── 441a-1: the recruit spelling ────────────────────────────────────────────────────────────────

test('441a-1a: the recruit parse admits --issue N and --doc PATH… (repeatable)', () => {
  const parsed = parseBatonCli(recruitArgv(['--issue', String(ISSUE), '--doc', CITED_DOC, '--doc', EXPLICIT_DOC]));
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'swarm.recruit');
  assert.deepEqual(parsed.contextPackage, { issue: ISSUE, docs: [CITED_DOC, EXPLICIT_DOC] },
    'the root-side context request rides the parsed recruit');
  assert.equal(Object.hasOwn(parsed.args, 'issue'), false, 'the CLI flag never becomes a wire argument');
  assert.equal(Object.hasOwn(parsed.args, 'doc'), false);
});

test('441a-1b: --issue without a number refuses at the parse, naming the flag', () => {
  for (const argv of [['--issue'], ['--issue', 'not-a-number'], ['--issue', '0'], ['--issue', '-3']]) {
    const error = refusalOf(() => parseBatonCli(recruitArgv(argv)));
    assert.match(error.message, /--issue/u, 'the offending flag is named');
    assert.equal(error.detail?.field, '--issue', 'the refusal names the field');
  }
  // A recruit that names no issue parses exactly as it did before #441 — no sibling field.
  const plain = parseBatonCli(recruitArgv());
  assert.equal(Object.hasOwn(plain, 'contextPackage'), false);
});

// ── 441a-2 and 441a-6: ONE package, its branches, its attachment, its read-back ────────────────

test('441a-2: the recruit admits ONE package (issue + cited doc) and attaches it to the seat run', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);

  const parsed = parseBatonCli(recruitArgv(['--issue', String(ISSUE), '--doc', EXPLICIT_DOC]));
  await runBatonCli(parsed, f.client, { issueReader: issueReader(), contextRepoRoot: f.repoRoot });

  const seat = seatRow(f.coordination);
  assert.ok(seat, 'the seat joined');
  const attachments = f.coordination.contextPackageAttachments(seat.runId);
  assert.equal(attachments.length, 1, 'exactly ONE package is attached to the seat run');
  const [attachment] = attachments;
  assert.equal(attachment.scope, `worker:${SEAT}`, 'the attach scope is the seat');

  const record = f.coordination.contextPackage(attachment.packageDigest);
  assert.equal(record.branches.length, 3, 'the issue branch plus one branch per doc');
  const names = record.branches.map((branch) => branch.name);
  assert.ok(names.includes('issue:441'), 'the issue branch is named issue:N');
  const docBranch = names.find((name) => name.startsWith('doc:docs.47-the-reading-half.md:'));
  assert.match(docBranch ?? '', /^doc:docs\.47-the-reading-half\.md:[a-f0-9]{64}$/u,
    'the doc the issue cites is a branch naming its path and the revision it was read at');
  assert.ok(names.some((name) => name.startsWith('doc:docs.32-reflexive-orchestration.md:')),
    'the --doc path is a branch too');

  // 441a-6: the branch resolver returns the issue document (title, labels, body) the brief names.
  const resolved = f.coordination.resolveContextPackageBranch(attachment.packageDigest, 'issue:441');
  assert.equal(resolved.source.split('\n')[0], `# ${ISSUE_TITLE}`, 'the issue branch leads with the title');
  assert.ok(resolved.source.includes(ISSUE_BODY), 'the issue body rides the branch verbatim');
});

// ── 441a-3 and 441a-4: the brief section, and its absence without --issue ───────────────────────

test('441a-3: the brief renders ## Context package after ## Swarm situation, bounded by the registry row', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  // A peer already working beside this seat, so the brief really carries a `## Swarm situation`
  // section for the context package to FOLLOW (the section renders only when it has rows).
  await f.swarmRuntime.command('swarm.recruit', {
    swarmId: SWARM_ID, participantId: 'peer', objective: 'Peer lane', idempotencyKey: 'issue441a:peer',
  }, OWNER);

  const parsed = parseBatonCli(recruitArgv(['--issue', String(ISSUE)]));
  await runBatonCli(parsed, f.client, { issueReader: issueReader(), contextRepoRoot: f.repoRoot });

  const seat = seatRow(f.coordination);
  const brief = seat.brief;
  const situation = brief.indexOf('## Swarm situation');
  const section = brief.indexOf('## Context package');
  assert.ok(situation !== -1, 'the Swarm situation section renders');
  assert.ok(section !== -1, 'the Context package section renders');
  assert.ok(section > situation, 'the context package section follows the swarm situation');
  assert.match(brief.slice(section), new RegExp(ISSUE_TITLE, 'u'), 'the issue title rides the section');

  const [attachment] = f.coordination.contextPackageAttachments(seat.runId);
  const record = f.coordination.contextPackage(attachment.packageDigest);
  for (const branch of record.branches) {
    assert.ok(brief.includes(branch.name), `the section names branch ${branch.name}`);
    assert.ok(brief.includes(branch.source.digest), `the section names the digest of ${branch.name}`);
  }
  const sliceRow = FRAME_LIMITS['context_package.brief_bytes'];
  assert.ok(sliceRow && Number.isSafeInteger(sliceRow.value), 'the registry carries the brief slice row');
  const rendered = brief.length - section;
  assert.ok(rendered <= record.branches.length * (sliceRow.value + 512) + 1024,
    `the section is bounded by the registry row (${rendered} characters rendered)`);
});

test('441a-4: a recruit without --issue renders no context package section', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  const parsed = parseBatonCli(recruitArgv());
  await runBatonCli(parsed, f.client, { issueReader: issueReader(), contextRepoRoot: f.repoRoot });
  const seat = seatRow(f.coordination);
  assert.equal(seat.brief.includes('## Context package'), false, 'today\'s hand-typed briefs are unchanged');
  assert.deepEqual(f.coordination.contextPackageAttachments(seat.runId), []);
});

// ── 441a-5: the root's credential cannot read the issue ─────────────────────────────────────────

test('441a-5: a reader that cannot read the issue refuses typed before any effect', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  const parsed = parseBatonCli(recruitArgv(['--issue', String(ISSUE)]));
  const unavailable = async () => { throw new Error('gh: not logged into any GitHub hosts'); };

  await assert.rejects(
    runBatonCli(parsed, f.client, { issueReader: unavailable, contextRepoRoot: f.repoRoot }),
    (error) => {
      assert.equal(error.code, 'issue_reader_unavailable', 'the refusal is typed');
      assert.match(error.message, new RegExp(String(ISSUE), 'u'), 'the refusal names the issue');
      return true;
    },
  );
  assert.equal(seatRow(f.coordination), null, 'no seat joined on a refused issue read');
  assert.equal(admittedPackages(f.coordination).length, 0, 'no package was admitted');
});

test('441a-5b: a --doc outside the repository refuses typed, naming the path', async (t) => {
  const f = fixture(t);
  await createSwarm(f.coordination, f.swarmRuntime);
  const parsed = parseBatonCli(recruitArgv(['--issue', String(ISSUE), '--doc', '../outside.md']));
  await assert.rejects(
    runBatonCli(parsed, f.client, { issueReader: issueReader(), contextRepoRoot: f.repoRoot }),
    (error) => {
      assert.equal(error.code, 'context_doc_unreadable', 'the refusal is typed');
      assert.match(error.message, /outside\.md/u, 'the refusal names the path');
      return true;
    },
  );
  assert.equal(seatRow(f.coordination), null, 'no seat joined on an unreadable doc');
  assert.equal(admittedPackages(f.coordination).length, 0, 'no package was admitted');
});
