// Control-surface contract v2 CS-3 — run.debug registration (red suite).
// Authority: docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md (v2).
// Registry row (rule 3) + BatonRun.debug() + baton run debug dispatch + doc rows.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY, deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import {
  parseBatonCli, projectBatonCliResult, runBatonCli,
} from '../src/application-cli.mjs';
import {
  checkSurfaceDocs, renderCliVerbInventory, renderMcpToolInventory,
} from '../scripts/render-surface-docs.mjs';

const repoId = 'repo-run-debug-cs3';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-cs3-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

class DebugAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'cs3-run-debug-red', refreshedAt: null,
      },
    };
  }

  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function harness(t) {
  const repo = root('repo');
  const logDir = root('log');
  const adapter = new DebugAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'reports/worker.md', content: 'work\n' }],
    },
  });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 65_536, maxPlanBytes: 262_144, maxStatusBytes: 262_144,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000,
          maxOutputBytes: 65_536, requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, adapter };
}

async function startRun(baton) {
  const run = await baton.runs.start('cs3 debug fixture (marker:x)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : [])
    .find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';
  return { run, workerId, runId: run.id ?? status?.runId ?? view?.runId };
}

// ── Registry rule-3 row ─────────────────────────────────────────────────────

test('CS3-1: registry contains run.debug with the rule-3 row', () => {
  const op = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .find((entry) => entry.key === 'run.debug');
  assert.ok(op, 'run.debug must be a canonical operation');
  assert.equal(op.key, 'run.debug');
  assert.equal(op.profile, 'ordinary');
  assert.deepEqual([...op.surfaces].sort(), ['cli', 'embedded']);
  assert.equal(op.effect, 'observe');
  assert.deepEqual(op.names, deriveSurfaceNames('run.debug'));
  assert.equal(op.names.cli, 'baton run debug');
  assert.equal(op.names.embedded, 'run.debug()');
  // No web / no mcp surface — host-local only.
  assert.equal(op.surfaces.includes('web'), false);
  assert.equal(op.surfaces.includes('mcp'), false);
});

// ── Facade accessor parity with the direct port ─────────────────────────────

test('CS3-2: batonRun.debug() returns the same payload as application.debug()', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { run, workerId, runId } = await startRun(baton);
  adapter.emit({
    worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'content.message', actor: 'worker',
    payload: { text: 'cs3 accessor parity' },
  });

  const direct = await application.debug({ runId }, principal('observer'));
  assert.equal(typeof run.debug, 'function', 'BatonRun.debug() must exist');
  const viaAccessor = await run.debug();
  assert.deepEqual(viaAccessor, direct);
  assert.equal(viaAccessor.members[0].lastMessages.at(-1).text, 'cs3 accessor parity');
});

// ── CLI host-local dispatch ─────────────────────────────────────────────────

test('CS3-3: baton run debug RUN parses and dispatches host-locally', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  adapter.emit({
    worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'content.message', actor: 'worker',
    payload: { text: 'cs3 cli dispatch' },
  });

  const parsed = parseBatonCli([
    'run', 'debug', runId, '--idempotency-key', 'dbg-a',
  ]);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'run.debug');
  assert.equal(parsed.args.runId, runId);

  // Host-local client: in-process application.debug via a thin command port.
  // Not the web whitelist — run.debug has no web route (rule 3).
  const hostClient = {
    async command(name, args) {
      assert.equal(name, 'run.debug');
      return application.debug(args, principal('observer'));
    },
  };
  const result = await runBatonCli(parsed, hostClient);
  const projected = projectBatonCliResult(parsed, result);
  assert.equal(projected.schemaVersion, 1);
  assert.equal(projected.runId, runId);
  assert.ok(Array.isArray(projected.members));
  assert.equal(projected.members[0].lastMessages.at(-1).text, 'cs3 cli dispatch');
});

// ── Generated doc rows match served truth ───────────────────────────────────

test('CS3-4: CLI.md generated inventory includes run.debug; MCP does not (no mcp surface)', () => {
  const cliBlock = renderCliVerbInventory();
  assert.match(cliBlock, /`run\.debug`/u);
  assert.match(cliBlock, /`baton run debug`/u);

  const mcpBlock = renderMcpToolInventory();
  assert.equal(/`run\.debug`/u.test(mcpBlock), false,
    'run.debug has no mcp surface — must not appear in MCP inventory');

  // Committed docs must match the renderer (CS-1 harness reuse).
  assert.deepEqual(checkSurfaceDocs(), []);
});
