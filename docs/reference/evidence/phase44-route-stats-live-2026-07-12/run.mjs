#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CairnRunScorecard, MockAdapter, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
mkdirSync(OUTPUT, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'baton-phase44-route-stats-'));
const repoRoot = join(root, 'repo'); const logDir = join(root, 'log'); const artifactRoot = join(root, 'artifacts');
mkdirSync(repoRoot); execFileSync('git', ['init', '-q'], { cwd: repoRoot }); execFileSync('git', ['-c', 'user.name=Baton Live', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repoRoot });
const observedAt = '2026-07-13T11:00:00.000Z'; const now = () => Date.parse(observedAt);
const routeLearningPolicy = { mode: 'auto', halfLifeMs: 604_800_000, explorationConstant: 0.5, seedDiscount: 0.5, minSamplesForAdaptive: 1, defaultPriorSuccessRate: 0.5 };
function adapter(harness, model, family, target, content) {
  const instance = new MockAdapter({ card: { harness, version: '1' }, scenario: { outcome: 'completed', edits: [{ path: target, content }] } });
  const card = instance.card.bind(instance);
  instance.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: model, available: [model], family, acceptedPrefixes: [`${harness}-`], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'live-fixture', refreshedAt: null } });
  return instance;
}
function options() {
  return {
    repoRoot, repoId: 'repo-route-live', logDir, now, routeLearningPolicy,
    adapters: {
      alpha: adapter('fixture-alpha', 'fixture-alpha-model', 'fixture-alpha-family', 'alpha.txt', 'pass\n'),
      beta: adapter('fixture-beta', 'fixture-beta-model', 'fixture-beta-family', 'beta.txt', 'wrong\n'),
    },
    capabilityFactories: { cairn: ({ coordination, readOperational, router }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot, routeAdvisor: router, routeAdvice: { maxCandidates: 4, maxTaskTypeBytes: 64, maxRows: 4, maxBytes: 8192 } }) },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 128 * 1024,
  };
}
const brief = (target, command) => createBrief({ goal: `write ${target}`, constraints: [], pathScope: [target], definitionOfDone: `${target} verifies`, verification: { command, expectExit: 0, timeoutMs: 5000 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } });
const until = async (fn, label, timeoutMs = 5000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise((resolvePromise) => setTimeout(resolvePromise, 5)); } throw new Error(`timed out waiting for ${label}`); };
const empty = (path) => !existsSync(path) || readdirSync(path).length === 0;
let driver; let replay; let fatal = null; const checks = {}; const facts = {};
try {
  driver = createDriver(options());
  const alpha = await driver.coordinator.spawn('alpha', brief('alpha.txt', "grep -q '^pass$' alpha.txt"), { taskId: 'live-route-alpha', taskType: 'implementation', model: 'fixture-alpha-model', effort: 'low' });
  const alphaResult = await until(async () => { const result = await driver.coordinator.result(alpha.id); return result.ready ? result : null; }, 'alpha verified terminal');
  const beta = await driver.coordinator.spawn('beta', brief('beta.txt', "grep -q '^pass$' beta.txt"), { taskId: 'live-route-beta', taskType: 'implementation', model: 'fixture-beta-model', effort: 'low' });
  const betaResult = await until(async () => { const result = await driver.coordinator.result(beta.id); return result.ready ? result : null; }, 'beta verified terminal');
  const rows = driver.coordination.routeObservations(); const beforeRestart = driver.router.snapshot();
  facts.routes = rows.map((row) => ({ taskId: row.taskId, routeKey: row.routeKey, modelFamily: row.modelFamily, verifiedWin: row.verifiedWin, eventSeq: row.eventSeq })); facts.terminals = { alpha: driver.coordination.task('live-route-alpha')?.status, beta: driver.coordination.task('live-route-beta')?.status, alphaReady: alphaResult.ready, betaReady: betaResult.ready };
  checks.twoExactRoutes = rows.length === 2 && new Set(rows.map((row) => row.routeKey)).size === 2;
  checks.hubOutcomesOnly = facts.terminals.alpha === 'completed' && facts.terminals.beta === 'failed' && rows.find((row) => row.taskId === 'live-route-alpha')?.verifiedWin === true && rows.find((row) => row.taskId === 'live-route-beta')?.verifiedWin === false;
  checks.atomicGraph = driver.coordination.snapshot().knowledge.nodes.filter((node) => node.type === 'RouteStat').length === 2 && driver.coordination.snapshot().knowledge.edges.filter((edge) => edge.type === 'ObservedIn').length === 2;
  await driver.coordinator.kill(alpha.id, 'live-proof-complete'); await driver.coordinator.kill(beta.id, 'live-proof-complete'); await driver.closeAsync();
  checks.firstWriterReleased = !existsSync(join(logDir, 'coordination', 'writer.lease'));
  replay = createDriver(options()); const afterRestart = replay.router.snapshot(); const replayRows = replay.coordination.routeObservations();
  checks.restartHydratedExactly = JSON.stringify(afterRestart) === JSON.stringify(beforeRestart) && JSON.stringify(replayRows) === JSON.stringify(rows) && afterRestart.appliedTaskIds.length === 2;
  const candidates = replayRows.map((row) => ({ routeKey: row.routeKey, modelFamily: row.modelFamily, concurrencyCeiling: 1, inFlight: 0 }));
  const adviceArgs = { taskType: 'implementation', observedAt, candidates }; const routerBeforeAdvice = replay.router.snapshot();
  const advice = await replay.coordinator.invokeCapability('cairn', 'route.advice', adviceArgs, { actor: 'orchestrator', budgetTokens: 4000 }); const payload = advice.payload[0]; const routerAfterAdvice = replay.router.snapshot();
  const winner = replayRows.find((row) => row.verifiedWin); const selectedByPick = replay.router.pick({ taskType: 'implementation' }, candidates.map((candidate) => ({ modelVersion: candidate.routeKey, family: candidate.modelFamily, concurrencyCeiling: candidate.concurrencyCeiling, inFlight: candidate.inFlight })), { now: Date.parse(observedAt) });
  facts.advice = { mode: payload.effectiveMode, selectedRouteKey: payload.selectedRouteKey, rows: payload.rows.map((row) => ({ routeKey: row.routeKey, count: row.evidenceCount, rate: row.successRate, reason: row.reason })) }; facts.selectedByPick = selectedByPick;
  checks.durableEvidenceRoutes = payload.effectiveMode === 'adaptive' && payload.selectedRouteKey === winner.routeKey && selectedByPick === winner.routeKey;
  checks.adviceReadOnly = JSON.stringify(routerAfterAdvice) === JSON.stringify(routerBeforeAdvice);
  checks.noReplayDoubleCount = payload.rows.every((row) => row.evidenceCount === 1);
  await replay.closeAsync(); checks.finalWriterReleased = !existsSync(join(logDir, 'coordination', 'writer.lease'));
  checks.fullReap = empty(join(repoRoot, '.baton', 'wt')) && empty(join(repoRoot, '.baton', 'runtime')) && execFileSync('git', ['branch', '--list', 'baton/*'], { cwd: repoRoot, encoding: 'utf8' }).trim() === '';
} catch (error) {
  fatal = String(error?.stack ?? error); try { await driver?.closeAsync(); } catch {} try { await replay?.closeAsync(); } catch {}
}
const summary = { at: new Date().toISOString(), scenario: { exactRoutes: 2, restart: true, cairnAdvice: true, policy: routeLearningPolicy }, facts, checks, fatal, pass: fatal === null && Object.values(checks).every(Boolean) };
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`); rmSync(root, { recursive: true, force: true }); console.log(JSON.stringify(summary, null, 2)); if (!summary.pass) process.exitCode = 1;
