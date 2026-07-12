#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtlasRepresentationCeiling } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const root = mkdtempSync(join(tmpdir(), 'baton-representation-proof-'));
const events = [];
const atlas = new AtlasRepresentationCeiling({ artifactRoot: join(root, 'artifacts'), maxArtifactBytes: 64 * 1024, record: (event) => events.push(event) });
const args = { path: 'impl/src/coordinator.mjs' };
let fatal = null; let bounded; let resumed; let reverified; const refusals = [];

try {
  bounded = await atlas.invoke('representation.ceiling', args, { budgetTokens: 1, actor: 'orchestrator' });
  resumed = await atlas.resume(bounded.refs[0], bounded.cursor, { budgetTokens: 1000 });
  reverified = await atlas.reverify(bounded, args, { budgetTokens: 1000, actor: 'policy' });
  for (const op of ['ir.build', 'ir.delta', 'tv.validate']) {
    try { await atlas.invoke(op, args, { budgetTokens: 1000 }); }
    catch (error) { refusals.push({ op, code: error.code, maximumRung: error.maximumRung, decisionId: error.decisionId }); }
  }
} catch (error) {
  fatal = String(error?.stack ?? error);
}

const artifact = bounded?.refs?.[0]?.path && existsSync(bounded.refs[0].path) ? JSON.parse(readFileSync(bounded.refs[0].path, 'utf8')) : null;
const checks = {
  noHarnessError: fatal === null,
  boundedFirstResult: bounded?.status === 'needs_resume' && bounded?.payload?.length === 0,
  realBatonPath: resumed?.payload?.[0]?.path === args.path,
  r3Ceiling: resumed?.payload?.[0]?.maximumRung === 'R3' && resumed?.payload?.[0]?.decisionId === 'phase24-js-ts-r3-ceiling',
  artifactHonest: bounded?.refs?.[0]?.kind === 'representation_policy' && !/compiler_ir|llvm|mir_module|mlir/.test(JSON.stringify({ bounded, artifact })),
  deterministicReverify: reverified?.ok === true,
  falseR4Typed: refusals.length === 3 && refusals.every((item) => item.code === 'rung_ceiling' && item.maximumRung === 'R3' && item.decisionId === 'phase24-js-ts-r3-ceiling'),
  balancedEvents: events.filter((event) => event.kind === 'capability.op.started').length === 2 && events.filter((event) => event.kind === 'capability.op.completed').length === 2,
};
rmSync(root, { recursive: true, force: true });
checks.artifactRootGone = !existsSync(root);
const summary = { at: new Date().toISOString(), repoHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), args, card: atlas.card(), bounded, resumed, reverified, refusals, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
