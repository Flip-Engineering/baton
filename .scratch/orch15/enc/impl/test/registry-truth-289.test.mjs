/*
 * registry-truth-289.test.mjs — issue #289 (registry truth lane) verification suite.
 *
 * One test per delivered contract, written to fail at HEAD and pass after the lane:
 *   U-I3/U-E3  the canonical table refuses a duplicate key at construction; run.scratchpad.append
 *              is ONE row (the merged contract).
 *   U-N5       every application command's declared arguments resolve inside its canonical
 *              operation's declared field set (asserted at construction in application.mjs).
 *   U-N1/U-N2  every registry row claiming a surface resolves to a name that surface serves, and
 *              the doc renderer fails (rather than hides) a declared-but-undispatchable row.
 *   U-E6       run.scratchpad.append is dispatchable by the CLI client (no advertised-but-refused
 *              tool) and the canonical spellings resolve to their bus transports.
 *   U-G4/G5    the registry's own taught examples compile, and run.attention.list (a ghost) is
 *              gone with baton_decision_list aliased to the real decision.list operation.
 *   U-E8/U-F15 an unknown `baton run <verb>` in the verb position never starts a Run: typos are
 *              refused with the canonical verb set + the nearest suggestion, and a Run identifier
 *              in the second position makes the refusal name the VERB.
 *   U-E5/G9/I7 the pre-filled action.do envelope is accepted by act() for every action kind, and
 *              the caller-scoped actions ride every inspection depth.
 *   U-E10/I9   the run list and the attention/child pages are bounded by the deployment byte
 *              ceiling with a continuation, never by a row count.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLICATION_COMMAND_DEFINITIONS, actionDoInputs, normalizeActionInputs } from '../src/application.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY, buildCanonicalOperationTable, canonicalOperationFields,
  canonicalOperationForCommand,
} from '../src/application-semantics.mjs';
import {
  CLI_WEB_COMMANDS, cliBusCommand, cliDispatchCommandNames, cliDispatches, parseBatonCli,
} from '../src/application-cli.mjs';
import {
  canonicalSurfaceResolutionFindings, formatSurfaceResolutionFinding, resolveOperationSurfaces,
} from '../src/surface-resolution.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { servedCliOrdinaryKeys } from '../scripts/render-surface-docs.mjs';

const IMPL = fileURLToPath(new URL('../', import.meta.url));
const operationOf = (key) => APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .find((operation) => operation.key === key);
const sourceOf = (name) => readFileSync(`${IMPL}src/${name}`, 'utf8');

// ── U-I3 / U-E3 — the duplicate key is a construction failure, and append is ONE row ───────────

test('U-I3/U-E3: a repeated canonical key fails at construction; run.scratchpad.append is one row', () => {
  assert.throws(
    () => buildCanonicalOperationTable([['a.b', {}], ['a.b', {}]]),
    (error) => error instanceof TypeError && /duplicate canonical operation key: a\.b/u.test(error.message),
    'stage[duplicate-key-refused] the canonical table must refuse a repeated key at construction',
  );
  const rows = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => operation.key === 'run.scratchpad.append');
  assert.equal(rows.length, 1, 'stage[append-single-row] run.scratchpad.append is declared exactly once');
  const row = rows[0];
  assert.deepEqual([...row.surfaces], ['embedded', 'mcp', 'cli', 'web'], 'stage[append-surfaces]');
  assert.deepEqual([...row.capabilities], ['control', 'observe'], 'stage[append-capabilities]');
  assert.deepEqual([...row.inputSchema.required], ['runId', 'scope', 'body'],
    'stage[append-required] the shipped normalizer requires the body, so the advertised schema does too');
  assert.ok(row.inputSchema.properties.body.oneOf, 'stage[append-body-shape] the JSON body form is the merged one');
});

// ── U-N5 — the command table's arguments live inside the canonical operation ───────────────────

test('U-N5: every application command resolves to a canonical operation that carries all its arguments', () => {
  const findings = [];
  for (const [name, definition] of Object.entries(APPLICATION_COMMAND_DEFINITIONS)) {
    const operation = canonicalOperationForCommand(name);
    if (!operation) { findings.push(`${name} has no canonical operation`); continue; }
    const declared = new Set(canonicalOperationFields(operation));
    const extra = definition.args.filter((field) => !declared.has(field));
    if (extra.length > 0) findings.push(`${name} declares ${extra.join(', ')} outside ${operation.key}`);
  }
  assert.deepEqual(findings, [], `stage[command-args-inside-registry] ${findings.join(' | ')}`);
});

// ── U-N1 / U-N2 — surface claims resolve; the doc renderer fails on a lie ──────────────────────

test('U-N1: every canonical row claiming a surface resolves to a served name', () => {
  const findings = canonicalSurfaceResolutionFindings();
  assert.deepEqual(findings.map(formatSurfaceResolutionFinding), [],
    'stage[surface-resolution] no registry row may claim a surface it cannot resolve');
});

test('U-N1/U-N2: the resolver reports a declared-but-undispatchable row (the doc renderer throws)', () => {
  const bogus = {
    key: 'hypothetical.ghost',
    surfaces: ['cli', 'mcp', 'web'],
    example: 'baton hypothetical ghost RUN_ID',
    names: { cli: 'baton hypothetical ghost', mcp: 'baton_hypothetical_ghost', web: 'hypothetical_ghost' },
  };
  const resolution = resolveOperationSurfaces(bogus);
  assert.equal(resolution.findings.length, 3,
    'stage[ghost-reported] a row claiming three unserved surfaces must report three findings');
  assert.deepEqual(resolution.findings.map((finding) => finding.surface).sort(), ['cli', 'mcp', 'web']);
  for (const finding of resolution.findings) {
    const line = formatSurfaceResolutionFinding(finding);
    assert.match(line, /hypothetical\.ghost/u, 'stage[finding-names-row] every finding names the row');
    assert.match(line, /claims the (cli|mcp|web) surface/u, 'stage[finding-names-surface]');
  }
  // And the shipped renderer is green over the real registry (it would throw otherwise).
  assert.ok(servedCliOrdinaryKeys().length > 0, 'stage[doc-renderer-green] the CLI inventory renders');
});

// ── U-E6 / U-G4 / U-G5 — advertised-but-refused is gone; the taught examples compile ───────────

test('U-E6: run.scratchpad.append is dispatchable by the CLI client and admitted by the web bus', () => {
  const dispatch = new Set(cliDispatchCommandNames());
  assert.ok(cliDispatches('run.scratchpad.append'),
    'stage[append-dispatchable] the client must dispatch the transport the MCP bridge advertises');
  const admitted = new Set(webAdmittedCommandNames());
  for (const spelling of ['run_scratchpad_append', 'run.scratchpad.append']) {
    assert.ok(admitted.has(spelling), `stage[append-web-admitted] the web bus admits ${spelling}`);
  }
  // A canonical spelling resolves to a transport the resident admits under either spelling.
  assert.ok(cliDispatches(cliBusCommand('run.watch')),
    'stage[watch-dispatchable] the canonical watch spelling is dispatchable');
  assert.ok(admitted.has(cliBusCommand('run.watch').replaceAll('.', '_')),
    'stage[watch-transport-admitted] its wire transport is admitted by the web bus');
  for (const name of CLI_WEB_COMMANDS) {
    assert.ok(dispatch.has(name), `stage[card-inside-dispatch] ${name} is inside the derived dispatch authority`);
  }
});

test('U-G5/G4: every CLI-claiming row compiles its taught example; the attention ghost is gone', () => {
  const failures = [];
  for (const operation of APPLICATION_SEMANTIC_REGISTRY.canonicalOperations) {
    if (!operation.surfaces.includes('cli')) continue;
    const resolution = resolveOperationSurfaces(operation);
    if (resolution.findings.some((finding) => finding.surface === 'cli')) {
      failures.push(`${operation.key}: ${operation.example}`);
    }
  }
  assert.deepEqual(failures, [], `stage[taught-examples-compile] ${failures.join(' | ')}`);
  const parsed = parseBatonCli(
    ['run', 'scratchpad', 'append', 'run:1', '--scope', 'shared', '--kind', 'note', '--body', 'probe'],
  );
  assert.equal(parsed.name, 'run.scratchpad.append', 'stage[append-example-compiles] the taught append spelling compiles');
  assert.equal(operationOf('run.attention.list'), undefined,
    'stage[attention-ghost-gone] the superseded run.attention.list row is deleted');
  const aliases = APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
    .filter((alias) => alias.name === 'baton_decision_list');
  assert.deepEqual(aliases.map((alias) => alias.canonical), ['decision.list'],
    'stage[decision-alias] baton_decision_list names the operation it actually dispatches');
});

// ── U-E8 / U-F15 — an unknown run verb never starts a Run ──────────────────────────────────────

test('U-E8/U-F15: unknown run verbs refuse with the canonical set, and a Run id makes it name the verb', () => {
  const refusal = (argv) => {
    try { return { parsed: parseBatonCli(argv) }; }
    catch (error) { return { error }; }
  };
  // A typo of a CANONICAL spelling the parser rewrites first (`view`) is still caught.
  const typo = refusal(['run', 'viwe', 'run:1']);
  assert.ok(typo.error, 'stage[canonical-typo-refused] run viwe must not start a Run');
  assert.equal(typo.error.code, 'cli_command_unavailable', 'stage[canonical-typo-code]');
  assert.match(typo.error.message, /did you mean 'run view'/u, 'stage[canonical-typo-suggestion]');
  assert.match(typo.error.message, /run start/u, 'stage[canonical-typo-escape] the refusal names the start form');
  // A verb-shaped token followed by a Run identifier names the VERB, never the identifier.
  const named = refusal(['run', 'cancel', 'run:1']);
  assert.ok(named.error, 'stage[verb-position-refused] run cancel run:1 must not start a Run');
  assert.equal(named.error.code, 'cli_command_unavailable', 'stage[verb-position-code]');
  assert.match(named.error.message, /unknown run verb cancel/u, 'stage[verb-position-names-verb]');
  assert.ok(!/unexpected argument run:1/u.test(named.error.message),
    'stage[verb-position-not-the-id] the refusal must not blame the Run id');
  assert.match(named.error.message, /expected /u, 'stage[verb-position-enumerates] the canonical verb set is enumerated');
  // Objectives stay objectives: a bare unknown word is the documented start form.
  const objective = parseBatonCli(['run', 'deploy']);
  assert.equal(objective.name, 'run.start', 'stage[objective-first] run deploy still starts a Run');
  assert.equal(objective.args.intent.objective, 'deploy', 'stage[objective-first-verbatim]');
  const member = refusal(['run', 'member']);
  assert.match(member.error.message, /expected run member view, send, stop, or interrupt/u,
    'stage[member-prefix] the bare member noun teaches its subverbs');
});

// ── U-E5 / U-I7 — the pre-filled action.do envelope is accepted for every kind ─────────────────

test('U-E5: the minted action.do envelope is accepted by act() for every action kind', () => {
  const kinds = Object.keys(APPLICATION_SEMANTIC_REGISTRY.actions);
  assert.ok(kinds.length > 20, 'stage[action-kinds] the registry declares its action kinds');
  const target = { requestId: 'req-1', pauseId: 'pause-1', planDigest: 'a'.repeat(64) };
  const failures = [];
  for (const kind of kinds) {
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
    const envelope = actionDoInputs(kind, target, definition.inputSchema);
    try {
      normalizeActionInputs({ kind, target }, envelope);
    } catch (error) {
      failures.push(`${kind}: ${error.code} ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], `stage[do-envelope-accepted] ${failures.join(' | ')}`);
});

test('U-E5: a server-derived identity that does not name the advertised target refuses by field', () => {
  assert.throws(
    () => normalizeActionInputs(
      { kind: 'answer_question', target: { requestId: 'req-2' } },
      { requestId: 'req-1', response: { text: 'hello' } },
    ),
    (error) => error.code === 'application_action_input_invalid' && error.detail?.field === 'requestId',
    'stage[request-id-verified] a mismatched requestId refuses naming the field',
  );
  const merged = normalizeActionInputs(
    { kind: 'answer_question', target: { requestId: 'req-1' } },
    { requestId: 'req-1', response: { text: 'hello' } },
  );
  assert.deepEqual(merged, { text: 'hello' },
    'stage[response-unwrapped] the response payload becomes the action inputs');
  const turn = normalizeActionInputs(
    { kind: 'nudge_turn', target: { pauseId: 'pause-1' } },
    { requestId: 'pause-1', response: { kind: 'continue' } },
  );
  assert.deepEqual(turn, {}, 'stage[turn-response-kind] the turn response kind is the envelope, not an input');
});

// ── U-G9 — actions ride every inspection depth ────────────────────────────────────────────────

test('U-G9: the caller-scoped actions are attached at every inspection depth', () => {
  const source = sourceOf('application.mjs');
  const inspect = source.slice(source.indexOf('async inspect(rawRequest'));
  const region = inspect.slice(0, inspect.indexOf('async help(rawRequest'));
  assert.match(region, /const callerActions = this\._semanticActions\(/u,
    'stage[actions-computed-once] the caller-scoped actions are computed once per inspection');
  const attachments = [...region.matchAll(/\.\.\.base, actions: callerActions,/gu)].length;
  assert.ok(attachments >= 6,
    `stage[actions-every-depth] every non-outline envelope carries the actions (found ${attachments}, need >= 6)`);
  assert.match(region, /actions: semanticActions,/u, 'stage[outline-actions] the outline keeps its own projection');
});

// ── U-E10 / U-I9 — byte-derived pages, no count ceilings ────────────────────────────────────────

test('U-E10/I9: the list and child pages derive from the byte ceiling and carry a continuation', async () => {
  const { byteBoundedPage } = await import('../src/application.mjs');
  const rows = Array.from({ length: 65 }, (_, index) => ({ id: `run:${index}`, objective: 'x'.repeat(200) }));
  const rowBytes = Buffer.byteLength(JSON.stringify(rows[0])) + 1;
  const first = byteBoundedPage(rows, rowBytes * 8);
  assert.equal(first.page.length, 8, 'stage[page-by-bytes] the page is as large as the byte budget allows');
  assert.equal(first.nextOffset, 8, 'stage[page-cursor] the page names where the next one starts');
  const second = byteBoundedPage(rows.slice(first.nextOffset), rowBytes * 8);
  assert.equal(second.page[0].id, 'run:8', 'stage[second-page] the cursor resumes the list');
  const whole = byteBoundedPage(rows, rowBytes * 100);
  assert.equal(whole.nextOffset, null, 'stage[whole-page] a page that fits the budget names no continuation');
  const source = sourceOf('application.mjs');
  for (const retired of ['MAX_RUN_LIST_ITEMS', 'MAX_RUN_VIEW_WORKERS', 'MAX_CONTINUATION_PAGES']) {
    assert.ok(!source.includes(retired), `stage[ceiling-retired] ${retired} is gone from application.mjs`);
  }
  assert.ok(!sourceOf('application-cli.mjs').includes('MAX_CONTINUATION_PAGES'),
    'stage[cli-ceiling-retired] the CLI drains on the server cursor, not a page count');
  const definition = APPLICATION_COMMAND_DEFINITIONS['runs.list'];
  assert.ok(definition.args.includes('continuationCursor'),
    'stage[list-accepts-cursor] the run list accepts the cursor its own continuation names');
});
