// Issue #441 red-before skeleton (stage: design-not-landed): the reading half — a recruited
// seat reads its issue, the docs the issue cites, the work its peers landed, and its peers
// now — as specified by docs/47-the-reading-half.md §1–§5.
//
// Every row asserts the behaviour docs/47 specifies against the CURRENT runtime and is expected
// RED: `--issue`/`--doc` are not in the recruit argv vocabulary (today the parse refuses
// closed-set), `options.contextPackage` attaches nothing, no `## Context package` section
// composes, and the three read verbs (`run.package.read`, `swarm.contributions.read`,
// `swarm.peers.read`) are not in the seat verb set (today each refuses
// swarm_command_unavailable). Each row's message names what the implementer must land. When a
// row goes green its expected-red manifest entry is stale and is retired with the landing
// (docs/44).
//
// Manifest plan (docs/44 rule 5): these rows list with reason #441. The manifest
// (impl/scripts/expected-red-tests.json) is outside this design lane's path scope; listing the
// rows is the implementing lane's first act, named in docs/47 §8.
//
// Fixture: the light SwarmRuntime harness (the swarm-runtime.test.mjs pattern, as
// issue423-claims-and-peers-red.test.mjs uses it) plus the CLI parse for the --issue spelling.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue441-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
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
  return { store, runtime, workers, call, seatCall, recruit };
}

test('#441 RED (stage: design-not-landed): (a) recruit --issue N parses, admits ONE package with an issue branch, and attaches it to the seat', async (t) => {
  // The CLI half: --issue joins the recruit row's closed argv vocabulary (#431) and parses to
  // the recruit args. Today the parse refuses closed-set — land the flag and its usage row.
  const parsed = parseBatonCli(['--idempotency-key', 'k', 'swarm', 'recruit', 'baton', 'seat-1', 'the objective', '--issue', '441']);
  assert.equal(parsed.args.issue, 441,
    'land --issue N on the recruit spelling (docs/47 §4.1): the closed argv admits it and the args carry the issue number');
  // The runtime half: the recruit's options name the issue; the root's reader is wired on the
  // runtime like situationGit (never through the bridge args — options stay JSON). The recruit
  // admits ONE ContextPackage (branches issue:441 + each cited doc) and attaches it to the
  // seat's run with scope worker:<seat> — the package.attached row IS the durable record
  // (docs/47 §1.1–1.2).
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  const recruited = await f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
    options: { issue: 441 } });
  assert.ok(recruited.contextPackage?.digest,
    'land the recruit args→attach seam (docs/47 §1.2): the recruit answer names the admitted package digest');
  const attachments = f.store.eventsView().filter((event) => event.kind === 'package.attached'
    && event.payload?.scope === 'worker:seat-1');
  assert.equal(attachments.length, 1,
    'land ONE package.attached row with scope worker:<seat> — never a second channel (docs/47 §1.2)');
});

test('#441 RED (stage: design-not-landed): (b) the recruit brief renders the package branches with digests and the issue title', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  const recruited = await f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
    options: { issue: 441 } });
  const brief = recruited.brief ?? '';
  assert.match(brief, /## Context package/u,
    'land the ## Context package section after ## Swarm situation (docs/47 §2 row 4)');
  assert.match(brief, /issue:441/u, 'the section names each branch (docs/47 §2)');
  assert.match(brief, /the reading half/u,
    'the section renders the first context_package.brief_bytes of the issue branch — title first (docs/47 §2)');
});

test('#441 RED (stage: design-not-landed): (c) a seat reads the package back through the bridge by digest', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  await f.recruit('seat-1');
  const seat = principal('w-1');
  const answer = await f.seatCall('run.package.read', { packageDigest: '0'.repeat(64) }, seat);
  assert.ok(answer?.branches || answer?.branch,
    'land run.package.read (docs/47 §3): the attached package\'s branch list, or one branch\'s text, through the ONE projection MCP\'s baton_package_read serves');
  // An unattached digest refuses typed — the attach rows are the scope check (docs/47 §3).
  await assert.rejects(
    f.seatCall('run.package.read', { packageDigest: 'f'.repeat(64) }, seat),
    (error) => ['package_not_attached_to_run', 'context_package_not_found'].includes(error?.code),
    'land the typed refusals: package_not_attached_to_run / context_package_not_found (docs/47 §3)');
});

test('#441 RED (stage: design-not-landed): (d) contributions read serves the fold — accepted rows since a seq, no ledger scan on the read path', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  await f.recruit('seat-1');
  const seat = principal('w-1');
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
  const answer = await f.seatCall('swarm.contributions.read', { since: 0 }, seat);
  f.store.eventsView = eventsView;
  const rows = answer?.contributions ?? [];
  assert.ok(rows.some((row) => row.contributionId === 'c-1'),
    'land swarm.contributions.read (docs/47 §3): the fold\'s contribution rows since the seq, in ledger order');
  assert.equal(ledgerReads, 0,
    'the read derives from the fold — zero ledger scans on the read path (docs/46 §7, docs/47 §3)');
});

test('#441 RED (stage: design-not-landed): (e) a seat\'s claim on an out-of-scope file is a claim row, not a handover', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  await f.recruit('seat-1');
  const seat = principal('w-1');
  const claimed = await f.call('update', { event: 'swarm.claim_updated',
    payload: { claimId: 'c-441', paths: ['impl/src/coordination-store.mjs'] } }, seat);
  assert.equal(claimed.receipt?.event?.kind, 'swarm.claim_updated',
    'land the claim spelling for out-of-scope need (docs/47 §5; the mechanism is docs/45 §2, #423): one durable row, never a needsFromOthers handover');
});

test('#441 RED (stage: design-not-landed): (f) the root\'s reader refusing (no credential) refuses the recruit naming the issue, and no seat joins', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The reading half (#441)' });
  // No issueReader is wired on this runtime (the authority the CLI injects, like situationGit):
  // an --issue recruit MUST refuse issue_reader_unavailable naming N, pre-effect.
  await assert.rejects(
    f.call('recruit', { participantId: 'seat-1', objective: 'Deliver #441',
      options: { issue: 441 } }),
    (error) => error?.code === 'issue_reader_unavailable' && String(error?.message ?? '').includes('441'),
    'land issue_reader_unavailable {issue, reason} typed pre-effect (docs/47 §4.3): the refusal names the issue and no package is admitted');
  const view = await f.call('view');
  assert.equal(view.participants?.length ?? 0, 0,
    'a refused reader joins nobody — the recruit is refused before any membership write (docs/47 §4.3)');
});
