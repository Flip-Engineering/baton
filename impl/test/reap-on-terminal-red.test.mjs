import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDriver } from '../src/index.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';

// #223 reap-on-terminal (operator-ordered, 2026-08-15): a completed work product's worktree
// is reaped PROGRAMMATICALLY at the terminal evidence event — run.adopt / run.integrate
// success. Not a bound on anything alive: the trigger IS the work's own completion.
// RED at HEAD: adopt leaves the owned worktree on disk.

const REPO = 'repo-reap-pin';
const NOW = '2026-08-15T00:00:00.000Z';
const digest64 = (value) => createHash('sha256').update(value).digest('hex');

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });

function root(prefix) { return mkdtempSync(join(tmpdir(), `baton-${prefix}-`)); }

test('REAP-ON-ADOPT: successful adoption reaps the adopted run’s owned worktree', async () => {
  const repository = root('reap-repo');
  const logDir = root('reap-log');
  try {
    execFileSync('git', ['init', '-q'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'reap@example.invalid'], { cwd: repository });
    execFileSync('git', ['config', 'user.name', 'Reap Pin'], { cwd: repository });
    writeFileSync(join(repository, 'base.txt'), 'base\n');
    execFileSync('git', ['add', 'base.txt'], { cwd: repository });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });

    const driver = createDriver({
      repoRoot: repository, repoId: REPO, logDir, now: () => Date.parse(NOW),
      adapters: { mock: new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'done', files: {} } }) },
      stopDeadlineMs: 2_000,
      watchdog: { stallMs: 60_000 },
    });

    // The worktree seam lives on the COORDINATOR (driver.coordinator), not the application.
    const removedWorktrees = [];
    driver.coordinator._worktrees = {
      remove: async (path) => { removedWorktrees.push(path); },
      releaseCapacity: () => {},
    };
    const application = new BatonApplication({
      driver, repoId: REPO,
      profiles: {
        default: {
          schemaVersion: 1,
          repoId: REPO,
          definitionOfDone: ['the artifact exists and verifies'],
          constraints: [],
          risk: 'low',
          goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
          nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
          pathScope: ['**'],
          verification: { command: 'true', expectExit: 0 },
          routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
          capabilities: ['code'],
          effects: ['repository_edit'],
          resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        },
      },
      principals: {
        planner: principal('planner'), dispatcher: principal('dispatcher'),
        observer: principal('observer'),
      },
      authorize: async () => true,
    });
    await application.ready;

    // Start a run, then complete its work via adoption.
    const runId = 'run-reap-pin-1';
    await application.start({
      intent: {
        runId, objective: 'produce one artifact', profile: 'default',
        route: { harness: 'mock', model: 'm', effort: 'low' }, scope: ['**'],
      },
    }, principal('operator')).catch(() => { /* the pin targets ADOPT; start shape may vary */ });

    const outcome = await application.adopt({
      runId, nodeKey: 'n1',
      resultSha: digest64('result'), evidenceDigest: digest64('evidence'),
      reason: 'reap pin',
    }, principal('operator')).catch((error) => error);

    if (outcome instanceof Error && outcome.code === 'application_run_not_found') {
      // The minimal fixture could not carry the run — assert the CONTRACT shape instead:
      // adoption, when it succeeds, MUST ride worktree removal. Fail loud so the pin is
      // completed properly against the real fixture in the landing commit.
      assert.fail(`adopt must succeed for the pin; got ${outcome.code}: ${outcome.message}`);
    }
    assert.ok(!(outcome instanceof Error), `adopt failed: ${outcome?.message}`);
    assert.equal(removedWorktrees.length >= 1, true,
      'adoption success reaps the owned worktree programmatically');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
});
