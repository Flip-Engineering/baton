// Issue #441 conformance pins (docs/44): the reading half — a recruited seat reads its issue, the
// docs the issue cites, the work its peers landed, and its peers now — as specified by
// docs/47-the-reading-half.md §1–§5.
//
// This file was the wave-13 red-before skeleton (`stage: design-not-landed`). All four #441 lanes
// landed (A: `recruit --issue` → ONE ContextPackage + the brief's `## Context package`; B: the
// three `run.*` seat read verbs; C: ONE contributions derivation + `## Swarm situation`; D: claims
// instead of handovers), so every row below was reconciled against the LANDED spellings:
//
//   • the recruit's context leg parses to `parsed.contextPackage` — NOT `parsed.args`. The ROOT
//     reads the issue (the worker holds no credential, #347); the package digest is the only thing
//     that travels, on `options.contextPackage`, and the runtime attaches it (docs/47 §4.1).
//   • `run.package.read` answers a package the caller's run carries: the fixture admits and the
//     recruit attaches FIRST, then the seat reads by digest and by branch name; an unattached
//     digest refuses `package_not_attached_to_run` (the attach rows are the scope check, §3).
//   • `run.contributions.read` answers `rows` (the #441b spelling), each row carrying its files
//     and the review state the ONE derivation derives — and still scans no ledger (§3).
//   • `issue_reader_unavailable` is the APPLICATION layer's refusal: the reader lives in
//     application-cli.mjs (`admitRecruitContextPackage`, reached through `runBatonCli`), never in
//     swarm-runtime.mjs. The runtime is handed a digest, so the refusal is asserted where the
//     reader lives; the runtime's own half (a digest this deployment never admitted) refuses
//     `swarm_command_invalid · unadmitted-package` before any seat joins.
//
// Every row here therefore asserts landed truth and is expected GREEN: the manifest
// (impl/scripts/expected-red-tests.json) carries this file in `converged` with reason #441 and no
// row — a fully-green red-first file keeps its suffix as the record of the contract it pinned
// (suite-verdict.mjs `converged`; docs/44 rule 3). A new red row added here re-enters `rows` in
// the same change (docs/44 rule 5).
//
// Fixture: the light SwarmRuntime harness (the swarm-runtime.test.mjs pattern, as
// issue423-claims-and-peers.test.mjs uses it) with the deployment's own context resolver wired
// (the reflex3-packages-red.test.mjs shape), plus the CLI parse for the `--issue` spelling and
// `runBatonCli` for the application layer's own refusal.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const policy = DEFAULT_CONTEXT_PROGRAM_POLICY;

// The issue branch's content: what the root's CLI admits from `gh issue view` (docs/47 §1.1). The
// first line is the title the brief's `## Context package` section renders.
const ISSUE_TITLE = 'Seats cannot read the world they work in';
const ISSUE_DOCUMENT = Object.freeze([ISSUE_TITLE, '', 'Issue 441 (#441) — the reading half.']);

const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const digestOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** One branch whose content the resolver holds as a context SOURCE ref: `{name, digest, bytes}` is
 * what the digest read projects, and the source value is what both the brief's section and the
 * branch read resolve. The issue branch the root admits is a source, never an artifact — only the
 * source side carries the prose the brief renders (swarm-runtime.mjs `_recruitContextPackageBriefSection`). */
function sourceBranch(name, resolver, content) {
  const contentDigest = digestOf(content);
  const ref = `ctx:sha256:${contentDigest}`;
  resolver.sources.set(ref, content);
  return {
    name, artifact: null, valueRef: null, schema: null,
    source: { kind: 'context_source', ref, digest: contentDigest,
      mediaType: 'application/vnd.baton.context-value+json', itemCount: content.length },
  };
}

const packageFields = (branches) => ({
  schemaVersion: 1, kind: 'baton.context_package', branches,
  provenance: { runId: 'run-root', principalId: 'owner' },
  policyDigest: policy.policyDigest,
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue441-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // The deployment's content resolver: each branch ref resolves exactly once at admission and every
  // read revalidates through it (the reflex3-packages-red.test.mjs shape).
  const resolver = { sources: new Map(), artifacts: new Map() };
  const store = new CoordinationStore(join(directory, 'coordination'), {
    repoId: 'repo-issue441', deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: policy,
    contextEnvironmentDigest: '2'.repeat(64), contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => {
      const fromSource = reference.kind === 'context_source';
      const key = fromSource ? reference.ref : reference.handle;
      const table = fromSource ? resolver.sources : resolver.artifacts;
      if (!table.has(key)) {
        throw Object.assign(new Error('context package content is unavailable'),
          { code: 'context_artifact_unavailable' });
      }
      return table.get(key);
    },
    contextSourceAttest: () => { throw new Error('this fixture attests no context source'); },
    clock: () => '2026-09-18T00:00:00.000Z',
  });
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    workspaceAttachment: () => null,
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, participantId: request.participantId, status: 'working',
        vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  // A seat's bridge verb reaches the runtime as the verb's own name (the #318 knowledge-verb
  // pattern), with the caller's participant identity bound from its token — never caller-chosen.
  const seatCall = (verb, args = {}, caller) => runtime.command(verb, { swarmId: 'baton', ...args }, caller);
  const recruit = (participantId, extra = {}) => call('recruit',
    { participantId, objective: `Continue working as ${participantId}`, ...extra });
  // The root's own admission (the CLI's `package.admit` port, wired here to the store directly):
  // ONE package whose only branch is the issue the recruit named.
  const admitIssuePackage = () => store.admitContextPackage(
    packageFields([sourceBranch('issue:441', resolver, ISSUE_DOCUMENT)]),
    { actor: 'owner', key: `admit-issue:${++key}` }).package.packageDigest;
  const participant = (participantId) => store.swarm('baton').participants[participantId] ?? null;
  // The worker identity that bound the seat: the ONE resolution `_memberOf` makes, read from the
  // durable join rather than guessed, so a fixture that recruited a peer first stays honest.
  const seatPrincipal = (participantId) => {
    const runId = participant(participantId).runId;
    return principal(workers.find((row) => row.runId === runId).id);
  };
  return { store, runtime, workers, call, seatCall, recruit, admitIssuePackage, participant, seatPrincipal };
}

const recruitArgv = (extra = []) => [
  '--idempotency-key', 'k', 'swarm', 'recruit', 'baton', 'seat-1', 'Deliver #441', ...extra,
];

test('#441 (a) recruit --issue N parses into the recruit\'s context leg, admits ONE package with an issue branch, and attaches it to the seat', async (t) => {
  // The CLI half: `--issue`/`--doc` are the ROOT's own reading — the closed argv of #431 admits
  // them, the parse carries them on the recruit's context leg, and they are NEVER wire arguments
  // (the seat reads the admitted package, not the root's credential; docs/47 §4.1).
  const parsed = parseBatonCli(recruitArgv(['--issue', '441']));
  assert.equal(parsed.contextPackage?.issue, 441,
    'land --issue N on the recruit spelling (docs/47 §4.1): the closed argv admits it and the parse carries the issue number');
  assert.deepEqual(parsed.contextPackage.docs, [], 'the leg carries the docs it was given, none here');
  assert.equal(parsed.args.issue, undefined,
    'the issue number is the root\'s own leg, never a wire argument the runtime would have to know');
  // The runtime half: the root admits ONE ContextPackage and recruits with its digest; the
  // runtime attaches that ONE package to the seat's run with scope `worker:<seat>` — the
  // package.attached row IS the durable record (docs/47 §1.1–1.2).
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  const digest = f.admitIssuePackage();
  const admitted = f.store.contextPackage(digest);
  assert.deepEqual(admitted.branches.map((branch) => branch.name), ['issue:441'],
    'the root admits ONE package whose branch is the issue it read');
  await f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
    options: { contextPackage: { digest } } });
  const attachments = f.store.eventsView().filter((event) => event.kind === 'package.attached'
    && event.payload?.scope === 'worker:seat-1');
  assert.equal(attachments.length, 1,
    'land ONE package.attached row with scope worker:<seat> — never a second channel (docs/47 §1.2)');
  assert.equal(attachments[0].payload.packageDigest, digest, 'the attached package is the admitted one');
  assert.equal(attachments[0].payload.runId, f.participant('seat-1').runId,
    'the attachment binds the seat\'s own run — the scope every later read is judged against');
  // The runtime judges only what it can see: a digest this deployment never admitted refuses typed
  // BEFORE any membership is written, so no seat joins on a package nobody holds.
  await assert.rejects(
    f.call('recruit', { participantId: 'seat-2', objective: 'Deliver #441',
      options: { contextPackage: { digest: 'f'.repeat(64) } } }),
    (error) => error?.code === 'swarm_command_invalid'
      && error?.detail?.rule === 'unadmitted-package'
      && error?.detail?.digest === 'f'.repeat(64),
    'land the pre-effect refusal of an unadmitted digest (docs/47 §4.1) — naming the field and the digest');
  assert.equal(f.participant('seat-2'), null, 'a refused package joins nobody');
});

test('#441 (b) the recruit brief renders the package branches with digests and the issue title', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  // A peer already working beside this seat, so the brief really carries the `## Swarm situation`
  // section the context package must FOLLOW (the section renders only when it has rows).
  await f.recruit('peer');
  const digest = f.admitIssuePackage();
  await f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
    options: { contextPackage: { digest } } });
  const brief = f.participant('seat-1').brief ?? '';
  const situation = brief.indexOf('## Swarm situation');
  const section = brief.indexOf('## Context package');
  assert.ok(situation !== -1, 'the Swarm situation section renders');
  assert.ok(section !== -1, 'land the ## Context package section (docs/47 §2 row 4)');
  assert.ok(section > situation, 'the section follows ## Swarm situation');
  const rendered = brief.slice(section);
  assert.match(rendered, /issue:441/u, 'the section names each branch (docs/47 §2)');
  assert.ok(rendered.includes(digestOf(ISSUE_DOCUMENT)),
    'the section names the branch digest the seat reads by');
  assert.ok(rendered.includes(digest), 'the section names the package digest it was admitted under');
  assert.match(rendered, new RegExp(ISSUE_TITLE, 'u'),
    'the section renders the first context_package.brief_bytes of the issue branch — title first (docs/47 §2)');
});

test('#441 (c) a seat reads the package the recruit attached back through the bridge by digest', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  // The attach-then-read sequence (docs/47 §3): the recruit attaches the admitted package to the
  // seat's run, and the seat reads THAT package — its branch list, then one branch's text through
  // the ONE projection MCP's baton_package_read serves.
  const digest = f.admitIssuePackage();
  await f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
    options: { contextPackage: { digest } } });
  const seat = f.seatPrincipal('seat-1');
  const list = await f.seatCall('run.package.read', { packageDigest: digest }, seat);
  assert.equal(list.packageDigest, digest);
  assert.deepEqual(list.branches, [{ name: 'issue:441', kind: 'source',
    digest: digestOf(ISSUE_DOCUMENT), bytes: null }],
    'the branch list is the manifest the store admitted: name, ref kind, digest');
  assert.equal(list.provenance.principalId, 'owner', 'provenance derives from the admission, never a self-cited field');
  const branch = await f.seatCall('run.package.read', { packageDigest: digest, branchName: 'issue:441' }, seat);
  assert.equal(branch.branch.name, 'issue:441');
  assert.equal(branch.branch.provenance, 'untrusted',
    'branch content is untrusted input to every reader — the projection marks it (docs/32 §3.3 Part D)');
  assert.match(branch.branch.source, new RegExp(ISSUE_TITLE, 'u'), 'the branch read resolves the issue text');
  // An unattached digest refuses typed — the attach rows are the scope check (docs/47 §3).
  await assert.rejects(
    f.seatCall('run.package.read', { packageDigest: 'f'.repeat(64) }, seat),
    (error) => error?.code === 'package_not_attached_to_run'
      && error?.detail?.participantId === 'seat-1',
    'land the typed scope refusal: package_not_attached_to_run (docs/47 §3)');
  // A branch the attached package does not carry names itself rather than answering empty.
  await assert.rejects(
    f.seatCall('run.package.read', { packageDigest: digest, branchName: 'doc:absent' }, seat),
    (error) => error?.code === 'swarm_context_package_branch_not_found',
    'land the typed branch refusal (docs/47 §3)');
});

test('#441 (d) contributions read serves the fold — accepted rows since a seq, no ledger scan on the read path', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  await f.recruit('seat-1');
  const seat = f.seatPrincipal('seat-1');
  // A valid contract body (the #310/#371 shape the validator admits), so the row the read verb
  // must serve actually records.
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { participantId: 'seat-1', contributionId: 'c-1', body: {
      subject: 'landed work',
      base: { observedHead: 'a'.repeat(40), rebasedOnto: 'a'.repeat(40) },
      commit: null,
      items: [{ id: 'work-1', status: 'delivered', change: 'landed work', files: ['impl/src/x.mjs'],
        test: 'node --test impl/test/x.test.mjs', evidence: 'green' }],
      verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
      carriedForward: [], needsFromOthers: [],
    } } }, seat);
  // The spy row (docs/46 §7): a read NEVER scans the ledger — the answer derives from the
  // fold. eventsView is the ledger's read seam; the verb must not call it.
  let ledgerReads = 0;
  const eventsView = f.store.eventsView.bind(f.store);
  f.store.eventsView = (...args) => { ledgerReads += 1; return eventsView(...args); };
  let answer;
  try {
    answer = await f.seatCall('run.contributions.read', { since: 0 }, seat);
  } finally {
    delete f.store.eventsView;
  }
  const rows = answer?.rows ?? [];
  const row = rows.find((candidate) => candidate.contributionId === 'c-1');
  assert.ok(row, 'land run.contributions.read (docs/47 §3): the fold\'s contribution rows since the seq, in ledger order');
  assert.equal(row.summary, 'landed work', 'the row carries the contract subject the project derives');
  assert.deepEqual(row.files, ['impl/src/x.mjs'], 'the row carries the files its items name');
  assert.equal(row.reviewState, 'unreviewed', 'the review state is derived from the review rows, never stored');
  assert.equal(row.decision, null, 'no review row settled it yet — recorded absence, never a guess');
  assert.equal(ledgerReads, 0,
    'the read derives from the fold — zero ledger scans on the read path (docs/46 §7, docs/47 §3)');
});

test('#441 (e) a seat\'s claim on an out-of-scope file is a claim row, not a handover', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  await f.recruit('seat-1');
  const seat = f.seatPrincipal('seat-1');
  const claimed = await f.call('update', { event: 'swarm.claim_updated',
    payload: { claimId: 'c-441', paths: ['impl/src/coordination-store.mjs'] } }, seat);
  assert.equal(claimed.receipt?.event?.kind, 'swarm.claim_updated',
    'land the claim spelling for out-of-scope need (docs/47 §5; the mechanism is docs/45 §2, #423): one durable row, never a needsFromOthers handover');
});

test('#441 (f) the ROOT\'s reader refusing (no credential) refuses the recruit naming the issue, and no seat joins', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  const parsed = parseBatonCli(recruitArgv(['--issue', '441']));
  // `issue_reader_unavailable` is the APPLICATION layer's refusal (docs/47 §4.3): the reader lives
  // in the root's CLI process — the only place a `gh` credential exists — and the recruit never
  // reaches the wire. The client records every command it is asked to send, so "pre-effect" is
  // measured, not assumed.
  const sent = [];
  const client = { command: async (name, args, idempotencyKey) => {
    sent.push(name);
    return f.runtime.command(name, { ...args, idempotencyKey }, owner);
  } };
  const unavailable = async () => { throw new Error('gh: not logged into any GitHub hosts'); };
  await assert.rejects(
    runBatonCli(parsed, client, { issueReader: unavailable, contextRepoRoot: process.cwd() }),
    (error) => {
      assert.equal(error?.code, 'issue_reader_unavailable', 'the refusal is typed');
      assert.match(String(error?.message ?? ''), /441/u, 'the refusal names the issue');
      return true;
    },
    'land issue_reader_unavailable {issue, reason} typed pre-effect (docs/47 §4.3)');
  assert.deepEqual(sent, [], 'pre-effect: no package was admitted and no recruit crossed the wire');
  assert.equal(f.participant('seat-1'), null, 'a refused reader joins nobody');
  assert.equal(f.store.eventsView().filter((event) => event.kind === 'package.admitted').length, 0,
    'no package is admitted from an unreadable issue');
});
