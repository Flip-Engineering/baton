// Issue #408 — the deployment-wide evidence search skips the principal validation and the
// authorization gate every sibling command passes.
//
// The audit's evidence named the dispatch branch itself:
//
//     if (name === 'evidence.search') return this.evidenceSearch(args);
//
// — raw args, no principal, no `_authorize`, while every sibling branch in the same pre-gate
// block threads both. The read therefore reached the index with no principal validated and no
// authorization decision recorded, on the embedded `application.command` seam.
//
// These rows drive that embedded seam over a real driver, with the application's own
// authorization function as the observable: it records every request it decides. Rows 408-a and
// 408-b are the red-before pair — before the fix the recorder stays empty and a refusing seam
// cannot refuse the read. Rows 408-c and 408-d pin the field contract and the principal gate that
// now run beside it.
//
// Fixture pattern: issue500's git-repo + MockAdapter + one deployment profile, seeded through the
// application's own swarm runtime the way the issue-338 resident row seeds its searchable ledger.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const repoId = 'repo-issue408-gates';
const route = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const principal = (id) => Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
});

function profile() {
  return {
    schemaVersion: 1,
    repoId,
    definitionOfDone: ['deployment verification passes'],
    constraints: [],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'],
    verification,
    routes: [route],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8, maxResponseBytes: 64 * 1_024, maxScanEvents: 32,
    },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1', maxFiles: 8, maxBytes: 64 * 1_024,
      requireAdoptedResult: false, requireSemanticReview: false, requireIntegration: false,
    },
  };
}

// `seam.calls` is the observable: every authorization request the application decides, in order.
// `seam.allow` is what the seam answers — the fixture flips it to refuse one read.
async function applicationWith(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-408-gates-'));
  mkdirSync(join(root, 'export'), { recursive: true, mode: 0o700 });
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue408@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 408'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', summary: 'fixture', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(root, 'log'),
    adapters: { mock: adapter },
  });
  const seam = { calls: [], allow: true };
  const app = new BatonApplication({
    driver, repoId, profiles: { deployment: profile() },
    exportRoot: join(root, 'export'),
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async (request) => { seam.calls.push(request); return seam.allow; },
  });
  await app.ready;
  t.after(async () => {
    await app.shutdown(principal('shutdown')).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  return { app, seam, driver };
}

const searches = (seam) => seam.calls.filter((call) => call.command === 'evidence.search');

test('408-a: the embedded evidence search passes the authorization seam, and only then serves', async (t) => {
  const { app, seam, driver } = await applicationWith(t);
  const page = await app.command('evidence.search', { query: 'cursor' }, principal('observer'));
  assert.equal(searches(seam).length, 1,
    'the read asks the authorization seam exactly once — a skipped gate records nothing');
  const [request] = searches(seam);
  assert.deepEqual(request.principal, principal('observer'), 'the seam decides the caller, not a placeholder');
  assert.equal(request.runId, null, 'the deployment-wide read names no run');
  assert.equal(request.subject?.operation, 'evidence.search', 'the subject names the operation it decides');
  // The port then served the canonical page — the SAME operation the CLI and the MCP tool serve,
  // over this deployment's real ledger (its index head is the ledger head). Which rows a populated
  // ledger yields is pinned end to end by evidence-search-deployment.test.mjs.
  assert.equal(page.cursor, driver.coordination.ledgerHeadSeq(),
    'the search ran against the deployment ledger and cursored at its head');
  assert.deepEqual(page.query.query, 'cursor', 'the served page carries the normalized filters');
  assert.ok(Array.isArray(page.rows), 'the page carries its rows');
});

test('408-b: a seam that refuses the read refuses it before any row is served', async (t) => {
  const { app, seam } = await applicationWith(t);
  seam.allow = false;
  const before = searches(seam).length;
  await assert.rejects(
    () => app.command('evidence.search', { query: 'cursor' }, principal('observer')),
    (error) => {
      assert.equal(error.code, 'application_unauthorized',
        'a refused read refuses typed, never with rows');
      return true;
    });
  assert.equal(searches(seam).length, before + 1, 'the refusing read is the seam that refused it');
});

test('408-c: the embedded read refuses an unknown field with the shared typed code', async (t) => {
  const { app, seam } = await applicationWith(t);
  await assert.rejects(
    () => app.command('evidence.search', { nope: 1 }, principal('observer')),
    (error) => {
      assert.equal(error.code, 'application_evidence_search_invalid',
        'the same code the dispatch-time validator throws for this command');
      assert.equal(error.detail?.field, 'nope', 'the refusal names the offending field');
      return true;
    });
  assert.equal(searches(seam).length, 0, 'an invalid request never reaches the authorization seam');
});

test('408-d: a forged principal refuses before the seam decides', async (t) => {
  const { app, seam } = await applicationWith(t);
  await assert.rejects(
    () => app.command('evidence.search', { query: 'cursor' },
      { ...principal('observer'), orchestratorLeaseId: 'forged' }),
    (error) => {
      assert.equal(error.code, 'application_authority_invalid',
        'the principal validation gate every sibling command passes still refuses the forgery');
      return true;
    });
  assert.equal(searches(seam).length, 0, 'a forged principal never reaches the seam');
});
