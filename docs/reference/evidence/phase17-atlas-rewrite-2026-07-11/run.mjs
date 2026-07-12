#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasStructuralRewrite } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'baton-atlas-rewrite-live-'));
const path = 'impl/src/atlas-rewrite.mjs';
const before = readFileSync(join(REPO, path));
const events = [];
const atlas = new AtlasStructuralRewrite({
  artifactRoot: artifacts,
  maxSourceBytes: 1024 * 1024,
  maxArtifactBytes: 4 * 1024 * 1024,
  record: (event) => events.push(event),
});
const ctx = { root: REPO, budgetTokens: 100_000, actor: 'orchestrator' };
let search; let rewrite; let reverified; let fatal = null;
try {
  search = await atlas.invoke('search.structural', { path, pattern: 'sha($A)' }, ctx);
  rewrite = await atlas.invoke('rewrite.structural', { path, pattern: 'sha($A)', replacement: 'digest($A)' }, ctx);
  reverified = await atlas.reverify(rewrite, { path, pattern: 'sha($A)', replacement: 'digest($A)' }, ctx);
} catch (error) { fatal = String(error?.stack ?? error); }
const proposedRef = rewrite?.refs.find((ref) => ref.kind === 'proposed_source');
const proposed = proposedRef ? readFileSync(proposedRef.path, 'utf8') : '';
const after = readFileSync(join(REPO, path));
const checks = {
  noError: fatal === null,
  realMatches: (search?.payload.length ?? 0) > 0,
  proposalEditsEveryMatch: rewrite?.payload.length === search?.payload.length,
  proposedSourceChanged: proposed.includes('digest(') && proposedRef?.digest === rewrite?.provenance.outputDigest,
  sourceUnchanged: before.equals(after),
  reverified: reverified?.ok === true,
  auditPairs: events.filter((event) => event.kind === 'capability.op.started').length === 3
    && events.filter((event) => event.kind === 'capability.op.completed').length === 3,
};
const summary = { at: new Date().toISOString(), path, search: search ? { status: search.status, summary: search.summary, provenance: search.provenance } : null, rewrite: rewrite ? { status: rewrite.status, summary: rewrite.summary, provenance: rewrite.provenance } : null, reverified, checks, fatal, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(artifacts, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
