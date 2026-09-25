#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasStructuralDelta, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = realpathSync(resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const OWNER_ROOT = realpathSync(resolve(process.env.BATON_EVIDENCE_OWNER_ROOT ?? ''));
const IMPLEMENTATION_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
const BEFORE_SHA = execFileSync('git', ['rev-parse', `${IMPLEMENTATION_SHA}^`], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
const tree = (commit) => execFileSync('git', ['rev-parse', `${commit}^{tree}`], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const beforeRoot = join(OWNER_ROOT, 'before');
const afterRoot = join(OWNER_ROOT, 'after');
const logDir = join(OWNER_ROOT, 'log');
const sourceArtifacts = join(OWNER_ROOT, 'source-artifacts');
const receipts = join(OWNER_ROOT, 'receipts');
const summaryPath = join(OUTPUT, 'representation-summary.json');
const policy = Object.freeze({
  schemaVersion: 1, repoId: 'baton-phase61-self', maxArgumentBytes: 64 * 1024,
  maxSourceRefs: 8, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2,
  maxReceiptBytes: 64 * 1024, maxGraphBatchBytes: 256 * 1024,
  maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024,
});
const environment = Object.freeze({
  schemaVersion: 1, kind: 'tree_delta', repoId: 'baton-phase61-self',
  beforeTreeSha: tree(BEFORE_SHA), beforeOverlayDigest: sha('no-overlay'),
  afterTreeSha: tree(IMPLEMENTATION_SHA), afterOverlayDigest: sha('no-overlay'),
});

if (!process.env.BATON_EVIDENCE_OWNER_ROOT) throw new Error('owned evidence root required');
mkdirSync(OUTPUT, { recursive: true });
rmSync(summaryPath, { force: true });

let driver = null;
let produced = null;
let checked = null;
let durable = null;
let fatal = null;
let driverClosed = false;
let worktreesRemoved = false;

try {
  execFileSync('git', ['worktree', 'add', '--detach', beforeRoot, BEFORE_SHA], { cwd: SOURCE_REPO, stdio: 'pipe' });
  execFileSync('git', ['worktree', 'add', '--detach', afterRoot, IMPLEMENTATION_SHA], { cwd: SOURCE_REPO, stdio: 'pipe' });
  const structural = new AtlasStructuralDelta({ artifactRoot: sourceArtifacts });
  driver = createDriver({
    repoRoot: afterRoot, repoId: 'baton-phase61-self', logDir, adapters: {},
    capabilities: { 'atlas-structural': structural },
    capabilityContexts: { 'atlas-structural': { beforeRoot, afterRoot } },
    representationProduction: {
      policy, artifactRoot: receipts,
      authorize: async ({ actor, repoId }) => actor === 'orchestrator:phase61-self' && repoId === policy.repoId,
      resolveEnvironment: async () => environment,
    },
    maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes: 1024 * 1024,
  });
  driver.coordination.createTask({ id: 'phase61-self-representation', deps: [], reservedWorkerId: 'phase61-self-worker' }, { actor: 'orchestrator:phase61-self', key: 'phase61:self:task' });
  driver.coordination.claimTask('phase61-self-representation', 'phase61-self-worker', 1, { actor: 'orchestrator:phase61-self', key: 'phase61:self:claim' });
  const args = {
    producerKind: 'structural_delta', taskId: 'phase61-self-representation',
    sourceArgs: { beforePath: 'impl/src/atlas-representation-review.mjs', afterPath: 'impl/src/atlas-representation-review.mjs', language: 'javascript' },
  };
  const context = { actor: 'orchestrator:phase61-self', repoId: policy.repoId, idempotencyKey: 'phase61:self:produce', budgetTokens: 48_000 };
  produced = await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, context);
  checked = await driver.coordinator.reverifyCapability('atlas-representation-producer', 'representation.produce', produced, args, { ...context, idempotencyKey: 'phase61:self:reverify' });
  durable = driver.coordination.representationProduction(produced.payload[0].identityDigest);
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  if (driver) {
    try { driverClosed = driver.close() === true; }
    catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
  }
  try {
    for (const root of [beforeRoot, afterRoot]) {
      const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: SOURCE_REPO, encoding: 'utf8' }).includes(root);
      if (listed) execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: SOURCE_REPO, stdio: 'pipe' });
      else rmSync(root, { recursive: true, force: true });
    }
    execFileSync('git', ['worktree', 'prune'], { cwd: SOURCE_REPO, stdio: 'pipe' });
    worktreesRemoved = [beforeRoot, afterRoot].every((root) => !existsSync(root))
      && !execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: SOURCE_REPO, encoding: 'utf8' }).includes(OWNER_ROOT);
  } catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
}

for (const path of [logDir, sourceArtifacts, receipts]) rmSync(path, { recursive: true, force: true });
const ownerRootEmpty = readdirSync(OWNER_ROOT).length === 0;
const edges = durable?.edges?.map((edge) => edge.type).sort() ?? [];
const authorityDenied = produced?.payload?.[0]?.authority
  && Object.values(produced.payload[0].authority).every((value) => value === false)
  && produced?.provenance?.policyAuthoringAuthority === false;
const pass = fatal === null && driverClosed && worktreesRemoved && ownerRootEmpty
  && produced?.status === 'ok' && produced?.payload?.[0]?.rung === 'R1'
  && produced?.payload?.[0]?.grounding === 'derived' && checked?.status === 'ok'
  && checked?.payload?.[0]?.ok === true && authorityDenied
  && JSON.stringify(edges) === JSON.stringify(['DerivedFrom', 'ObservedIn', 'ProducedBy']);
const summary = {
  at: new Date().toISOString(), implementationSha: IMPLEMENTATION_SHA, beforeSha: BEFORE_SHA,
  target: 'impl/src/atlas-representation-review.mjs', producerKind: 'structural_delta',
  result: produced ? {
    status: produced.status, rung: produced.payload?.[0]?.rung ?? null,
    representationType: produced.payload?.[0]?.representationType ?? null,
    grounding: produced.payload?.[0]?.grounding ?? null,
    identityDigest: produced.payload?.[0]?.identityDigest ?? null,
    sourceArtifactDigest: produced.payload?.[0]?.sourceArtifactDigest ?? null,
    receiptDigest: produced.payload?.[0]?.receiptDigest ?? null,
  } : null,
  reverify: checked ? { status: checked.status, ok: checked.payload?.[0]?.ok ?? false, graphProjectionDigest: checked.payload?.[0]?.graphProjectionDigest ?? null } : null,
  graphEdges: edges, authorityDenied: Boolean(authorityDenied), driverClosed, worktreesRemoved,
  ownerRootEmpty, fatal, pass,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!pass) process.exitCode = 1;
