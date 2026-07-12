#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtlasBehaviorFingerprint } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const root = mkdtempSync(join(tmpdir(), 'baton-behavior-proof-'));
const sandboxes = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('baton-behavior-sandbox-')));
const beforeSandboxes = sandboxes(); const events = [];
const atlas = new AtlasBehaviorFingerprint({ artifactRoot: join(root, 'artifacts'), maxSourceBytes: 64 * 1024, maxCorpusCases: 16, maxInputBytes: 16 * 1024, maxOutputBytes: 64 * 1024, maxArtifactBytes: 128 * 1024, timeoutMs: 1000, record: (event) => events.push(event) });
const args = { path: 'impl/src/route-tuple.mjs', exportName: 'routeTupleKey', corpus: [{ harness: 'codex', version: '1' }, { harness: 'grok', version: '2' }] };
let fatal = null; let bounded; let resumed; let reverified; let compared;
try {
  bounded = await atlas.invoke('behavior.fingerprint', args, { root: REPO, budgetTokens: 1, actor: 'orchestrator' });
  resumed = await atlas.resume(bounded.refs[0], bounded.cursor, { budgetTokens: 1000 });
  reverified = await atlas.reverify(bounded, args, { root: REPO, budgetTokens: 1000, actor: 'policy' });
  compared = await atlas.invoke('behavior.compare', { beforePath: args.path, afterPath: args.path, exportName: args.exportName, corpus: args.corpus }, { beforeRoot: REPO, afterRoot: REPO, budgetTokens: 1000, actor: 'orchestrator' });
} catch (error) {
  fatal = String(error?.stack ?? error);
}
const afterSandboxes = sandboxes();
const checks = {
  noHarnessError: fatal === null,
  boundedFirstResult: bounded?.status === 'needs_resume' && bounded?.payload?.length === 0,
  realBatonExport: resumed?.payload?.length === 2 && resumed.payload.every((item) => item.kind === 'return' && typeof item.value === 'string'),
  deterministicReverify: reverified?.ok === true,
  selfComparisonAgrees: compared?.payload?.[0]?.agree === true && compared?.payload?.[0]?.divergences?.length === 0,
  claimLanguageHonest: bounded?.provenance?.meaning === 'observed_pinned_corpus_not_semantic_equivalence' && compared?.provenance?.meaning === 'observed_corpus_agreement_not_semantic_equivalence',
  sandboxPolicyPinned: bounded?.provenance?.sandbox?.network === 'denied' && bounded?.provenance?.sandbox?.fsWrite === 'denied',
  balancedEvents: events.filter((event) => event.kind === 'capability.op.started').length === 3 && events.filter((event) => event.kind === 'capability.op.completed').length === 3,
  noSandboxResidue: [...afterSandboxes].every((name) => beforeSandboxes.has(name)),
};
rmSync(root, { recursive: true, force: true }); checks.artifactRootGone = !existsSync(root);
const summary = { at: new Date().toISOString(), repoHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), args, card: atlas.card(), bounded, resumed, reverified, compared, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(OUTPUT, { recursive: true }); writeFileSync(join(OUTPUT, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n'); writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2)); if (!summary.pass) process.exitCode = 1;
