// docs/36 §9 M5 — the alias sunset. The divergence ledger retires to empty; the §4.1 banned-token
// lint (C4) is promoted to red in the canonical suite; legacy phase strings are grep-clean in the
// surface layers; run.steer is deleted as a surface alias (canonical run.send intact); GLOSSARY.md
// speaks the post-sunset vocabulary. These contracts (M5-1..M5-5) are the M5 acceptance gate; the
// behavior authority is docs/36 §4.1/§7.1/§9, not a hand table.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY as REGISTRY,
  parseBatonCli,
} from '../src/index.mjs';
import { deriveSurfaceNames } from '../src/application-semantics.mjs';
import { collectSurfaceInventory } from '../scripts/surface-audit.mjs';
import {
  CANONICAL_OPERATIONS,
  checkBannedTokens,
  checkLedgerMonotone,
  runSurfaceConformanceMain,
  validateLedger,
} from '../scripts/surface-conformance.mjs';

const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));
const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'latin1');

// The one seeded M4 behavior row — the per-deployment MCP schema mutation. M5 retires it by
// deleting the underlying mutation; the ledger row is then removable (removal-only monotone edit).
const RETIRED_M4_ROW = Object.freeze({
  surface: 'mcp',
  name: 'per-deployment MCP schema mutation (mcp-northbound.mjs:826)',
  canonical: null,
  dimension: 'behavior',
  retiresIn: 'M4',
});

// docs/36 §4.1 — the banned surface verbs (synonyms), with token normalization (R-CX-13):
// `stop_member` and `stop-member` are ONE token. The canonical tree must not contain any.
const BANNED_VERB_FIXTURES = [
  'run.show', 'run.status', 'run.inspect', 'run.act', 'run.notify', 'run.follow',
  'run.wait', 'run.progress', 'run.events', 'run.output', 'run.episode', 'run.steer',
  'baton_run_steer', 'run_steer', 'fleet_run_steer', 'baton run steer', 'run.stop-member',
  'run.stop_member', 'stop-member', 'stop_member',
];

test('M5-1: the divergence ledger is empty and the M4 retirement is pinned', () => {
  assert.deepEqual(ledger.entries, [], 'the divergence ledger retires to empty at M5');
  assert.deepEqual(validateLedger(ledger), []);
  // The underlying mutation is gone: no `mcp` behavior divergence is observed any longer.
  const inventory = collectSurfaceInventory();
  assert.deepEqual(inventory.behaviorDivergences, [], 'the per-deployment MCP schema mutation is fixed');
  // Removing exactly the retired M4 row from the pre-M5 ledger is a legal removal-only edit; a
  // re-add (an append) is refused by the monotone rule.
  const preSunset = { schemaVersion: 1, entries: [...ledger.entries, RETIRED_M4_ROW] };
  assert.deepEqual(checkLedgerMonotone(preSunset, ledger), []);
  assert.throws(() => checkLedgerMonotone(ledger, preSunset), /ledger append forbidden/u);
});

test('M5-2: the C4 banned-token lint rejects legacy synonym verbs and passes the canonical tree', () => {
  for (const fixture of BANNED_VERB_FIXTURES) {
    assert.equal(checkBannedTokens([fixture]).length, 1, `${fixture} carries a banned verb token`);
  }
  // Token normalization (R-CX-13): stop_member and stop-member are the same banned token.
  assert.equal(checkBannedTokens(['run.stop-member'])[0]?.verb, checkBannedTokens(['run.stop_member'])[0]?.verb);
  assert.equal(checkBannedTokens(['run.stop-member'])[0]?.verb, 'stop-member');
  // Canonical verbs that merely CONTAIN banned-letter runs are clean (stop ≠ stop-member).
  assert.deepEqual(checkBannedTokens(['run.member.stop', 'run.send', 'run.view', 'run.watch']), []);
  // The canonical tree — every operation key and its mechanically derived surface names — is clean.
  // MCP-W1 (mcp-packaging-decisions v1.0) DELIBERATELY names the wave progress row
  // `waves.progress` (the ordinary MCP tool is baton_waves_progress); that single verb is a
  // documented exception to the C4 ban (the run-surface 'progress' synonym stays banned).
  const canonicalNames = CANONICAL_OPERATIONS.flatMap((operation) => [
    operation.key,
    operation.names.cli,
    operation.names.web,
    operation.names.mcp,
    operation.names.embedded,
  ]).filter((name) => !/^(waves\.progress|baton waves progress|waves_progress|baton_waves_progress|waves\.progress\(\))$/u.test(name));
  assert.deepEqual(checkBannedTokens(canonicalNames), []);
  // Promoted to red in the canonical suite: the conformance main reports no banned-verb finding.
  const findings = runSurfaceConformanceMain();
  assert.deepEqual(findings.filter((finding) => finding.includes('banned surface verb')), []);
});

test('M5-3: run.steer is deleted as a surface alias and canonical run.send stays', () => {
  const send = REGISTRY.canonicalOperations.find((operation) => operation.key === 'run.send');
  assert.ok(send, 'canonical run.send is registered');
  const aliasNames = send.aliases.map((alias) => alias.name);
  for (const gone of ['run.steer', 'baton run steer', 'run_steer', 'fleet_run_steer']) {
    assert.equal(aliasNames.includes(gone), false, `run.send alias ${gone} is deleted at M5`);
  }
  // The registry cli row and the run help-topic membership are gone; the command definition is gone.
  assert.equal(REGISTRY.cli.commands.some((row) => row.id === 'run.steer'), false, 'no cli run.steer row');
  assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, 'run.steer'), false, 'no run.steer command definition');
  assert.equal(REGISTRY.aliases.operations['run.steer'], undefined);
  // Canonical run.send is intact with its own derived names at the same sites.
  assert.equal(REGISTRY.cli.commands.some((row) => row.id === 'run.send'), true, 'cli run.send row stays');
  assert.deepEqual(deriveSurfaceNames('run.send'), {
    cli: 'baton run send', mcp: 'baton_run_send', web: 'run_send', embedded: 'run.send()',
  });
  // `baton run steer` refuses with the corrective naming; `baton run send` still parses.
  assert.throws(
    () => parseBatonCli(['run', 'steer', 'run-m5', 'w-1', '--now', 'Refocus.', '--reason', 'New evidence']),
    /run send/u,
  );
  const sendCli = parseBatonCli(['run', 'send', 'run-m5', 'Refocus.', '--to', 'review', '--now']);
  assert.equal(sendCli.actionKind, 'send');
  assert.deepEqual(sendCli.inputs, { message: 'Refocus.', recipient: 'review', delivery: 'now' });
});

test('M5-4: legacy run-phase strings are grep-clean in the surface layers', () => {
  // The distinctive legacy run-phase literals (§7.1) must not appear in any surface projection file
  // (CLI, embedded client, Web bus, MCP, MCP-over-Web) — those surfaces resolve through the
  // sanctioned map in application-semantics.mjs only.
  const surfaceFiles = [
    'application-cli.mjs', 'application-client.mjs', 'web-northbound.mjs',
    'mcp-northbound.mjs', 'mcp-web-bridge.mjs',
  ];
  const legacy = [
    'awaiting_plan_approval', 'interruption_uncertain', 'work_completed',
    'selection_required', 'candidate_selected', 'planning_failed', 'start_failed',
  ];
  for (const file of surfaceFiles) {
    const text = src(file);
    for (const literal of legacy) {
      // Quoted string literals only — a backtick mention in a comment is documentation, not code.
      assert.equal(new RegExp(`['"]${literal}['"]`, 'u').test(text), false,
        `${file} still contains legacy phase literal '${literal}'`);
    }
  }
  // The named union site is canonical-only now (no legacy literal in TERMINAL_RUN_PHASES).
  const cliTerminal = /const TERMINAL_RUN_PHASES = new Set\(\[([^\]]*)\]/u.exec(src('application-cli.mjs'));
  assert.ok(cliTerminal, 'application-cli.mjs TERMINAL_RUN_PHASES is present');
  for (const literal of legacy) {
    assert.equal(cliTerminal[1].includes(literal), false, `TERMINAL_RUN_PHASES still holds ${literal}`);
  }
  // The embedded client maps phases through the canonical vocabulary.
  assert.doesNotMatch(src('application-client.mjs'), /phase === 'work_completed'/u);
});

test('M5-5: GLOSSARY.md speaks the post-sunset vocabulary', () => {
  const glossary = readFileSync(new URL('../../GLOSSARY.md', import.meta.url), 'utf8');
  assert.match(glossary, /run\.send/u, 'GLOSSARY names the canonical run.send verb');
  assert.match(glossary, /run\.view/u, 'GLOSSARY names the canonical run.view verb');
  assert.match(glossary, /run\.member/u, 'GLOSSARY names the unified member noun');
  // run.steer is recorded as deleted at the M5 sunset, never as a live command.
  assert.match(glossary, /run\.steer\b[^\n]*(?:deleted|retired|sunset)/iu, 'GLOSSARY marks run.steer deleted');
  assert.doesNotMatch(glossary, /`baton run steer`(?!\s*[^.]*deleted)/u);
});
