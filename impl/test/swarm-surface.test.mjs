// swarm-surface.test.mjs — the public swarm surface: registry rows, closed validation, the
// transport registration seam (web/CLI/MCP), and the SDK's first-class workflows through a fake
// command port. Nothing here needs root's runtime handlers: the SDK rides `commandPort()`, and the
// registration assertions drive the SAME activation the shared-registry spread performs (a merged
// definitions map), so the seam is exercised before it lands.
//
// Run: node --test impl/test/swarm-surface.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CLI_WEB_COMMANDS, batonCliHelp, parseBatonCli } from '../src/application-cli.mjs';
import { bindBatonPort } from '../src/application-client.mjs';
import { swarmApplicationToolDefinitions } from '../src/mcp-northbound.mjs';
import { canonicalAndTransportNames } from '../src/application-semantics.mjs';
import { createSwarms } from '../src/swarm-client.mjs';
import {
  SWARM_CLI_COMMANDS, SWARM_COMMAND_DEFINITIONS, SWARM_COMMAND_NAMES, SWARM_EVENT_KINDS,
  SWARM_MCP_TOOL_DEFINITIONS, SWARM_COMMAND_SCHEMAS, SWARM_CLI_HELP, swarmCliCommand,
  swarmRegisteredCommands, swarmWebAdmittedCommands, validateSwarmCommand,
} from '../src/swarm-surface.mjs';

// The registry as root will carry it: the live application definitions plus the swarm family. Every
// registration assertion runs against this map, so the tests prove what activates at the spread.
const REGISTERED = Object.freeze({ ...APPLICATION_COMMAND_DEFINITIONS, ...SWARM_COMMAND_DEFINITIONS });

// One accepted, canonical request per command. `validateSwarmCommand` must accept each of these, and
// the SDK must be able to express each of them.
const EXAMPLES = Object.freeze({
  'swarm.list': Object.freeze({}),
  'swarm.create': Object.freeze({ purpose: 'Ship the swarm surface', idempotencyKey: 'ik-create' }),
  'swarm.inspect': Object.freeze({ swarmId: 'swarm:one' }),
  'swarm.watch': Object.freeze({ swarmId: 'swarm:one', afterSeq: 4, timeoutMs: 1_000 }),
  'swarm.update': Object.freeze({
    swarmId: 'swarm:one', event: 'swarm.work_updated',
    payload: Object.freeze({ workId: 'work:1', objective: 'Investigate the parser' }),
    idempotencyKey: 'ik-update',
  }),
  'swarm.recruit': Object.freeze({
    swarmId: 'swarm:one', participantId: 'impl-a', objective: 'Implement the parser change',
    options: Object.freeze({ exact: Object.freeze({ harness: 'codex', model: 'gpt', effort: 'high' }) }),
    permissions: Object.freeze(['contribute']),
    idempotencyKey: 'ik-recruit',
  }),
  'swarm.guide': Object.freeze({
    swarmId: 'swarm:one', participantId: 'impl-a', message: 'Prefer the boring design.',
    idempotencyKey: 'ik-guide',
  }),
  'swarm.capture': Object.freeze({
    swarmId: 'swarm:one', participantId: 'impl-a', contributionId: 'contribution:1',
  }),
  'swarm.check': Object.freeze({
    swarmId: 'swarm:one', participantId: 'reviewer-a',
    contributionId: 'contribution:1', checkId: 'check:1',
  }),
  'swarm.stop': Object.freeze({
    swarmId: 'swarm:one', participantId: 'impl-a', reason: 'Assignment is finished.',
    idempotencyKey: 'ik-stop',
  }),
});

function fakePort(respond) {
  const calls = [];
  return {
    calls,
    async command(name, args) {
      calls.push({ name, args });
      return respond(name, args);
    },
  };
}

// ── the registry rows ───────────────────────────────────────────────────────────────────────────

test('every swarm command validates its canonical request and declares the transport flags', () => {
  assert.deepEqual([...SWARM_COMMAND_NAMES].sort(), Object.keys(EXAMPLES).sort(),
    'the example table must cover the closed command set exactly');
  for (const name of SWARM_COMMAND_NAMES) {
    const definition = SWARM_COMMAND_DEFINITIONS[name];
    assert.equal(validateSwarmCommand(name, EXAMPLES[name]), true, `${name} must accept its example`);
    assert.equal(definition.web, true, `${name} advertises the web lane`);
    assert.equal(definition.mcp, true, `${name} advertises the MCP lane`);
    assert.equal(definition.reconcilable, true, `${name} replays idempotently on retry`);
    assert.equal(definition.transportHidden, undefined, `${name} hides no side-channel field`);
    const classes = definition.capabilities;
    assert.ok(classes.length > 0 && classes.every((entry) => (
      ['observe', 'control', 'emergency_stop'].includes(entry)
    )), `${name} uses the existing capability classes only`);
    // Durability is expressible from the row alone: an effectful verb mints one durable effect per
    // caller key, an identity-keyed verb carries its key in the coordinates.
    assert.equal(definition.args.includes('idempotencyKey'), definition.mcpStateful,
      `${name} must require an idempotency key exactly when it is stateful`);
  }
  assert.deepEqual(SWARM_COMMAND_DEFINITIONS['swarm.list'].capabilities, ['observe']);
  assert.deepEqual(SWARM_COMMAND_DEFINITIONS['swarm.stop'].capabilities, ['emergency_stop', 'observe']);
});

test('validation refuses the closed set with typed codes and invents no byte ceiling', () => {
  const refusals = [
    ['unknown command', 'swarm.nope', {}, 'swarm_command_unavailable'],
    ['args not an object', 'swarm.list', [], 'swarm_command_invalid'],
    ['unknown field', 'swarm.inspect', { swarmId: 'swarm:one', fence: 3 }, 'swarm_command_invalid'],
    ['missing required field', 'swarm.inspect', {}, 'swarm_command_invalid'],
    ['unclosed event kind', 'swarm.update',
      { swarmId: 'swarm:one', event: 'swarm.made_up', idempotencyKey: 'ik-1' }, 'swarm_command_invalid'],
    ['negative cursor', 'swarm.watch', { swarmId: 'swarm:one', afterSeq: -1 }, 'swarm_command_invalid'],
    ['zero timeout', 'swarm.watch', { swarmId: 'swarm:one', timeoutMs: 0 }, 'swarm_command_invalid'],
    ['array payload', 'swarm.update',
      { swarmId: 'swarm:one', event: 'swarm.closed', payload: [1], idempotencyKey: 'ik-1' },
      'swarm_command_invalid'],
    ['blank text body', 'swarm.update',
      { swarmId: 'swarm:one', event: 'swarm.closed', payload: '   ', idempotencyKey: 'ik-1' },
      'swarm_command_invalid'],
    ['unshaped participant identity', 'swarm.guide',
      { swarmId: 'swarm:one', participantId: 'has space', message: 'hi', idempotencyKey: 'ik-1' },
      'swarm_command_invalid'],
    ['NUL in a prompt', 'swarm.create', { purpose: 'ok\0', idempotencyKey: 'ik-1' }, 'swarm_command_invalid'],
    ['non-object selection', 'swarm.recruit',
      { swarmId: 'swarm:one', participantId: 'impl-a', objective: 'x', options: 'fast', idempotencyKey: 'ik-1' },
      'swarm_command_invalid'],
  ];
  for (const [label, name, args, code] of refusals) {
    assert.throws(() => validateSwarmCommand(name, args), (error) => {
      assert.equal(error.code, code, `${label} must refuse with ${code}`);
      return true;
    }, label);
  }
  // Size policy belongs to the runtime's frame-limit catalog, never to this surface: an inline
  // objective past the cataloged lane is admitted (the application mints a spill artifact) and the
  // client must not silently truncate it.
  const long = 'x'.repeat(12_000);
  assert.equal(validateSwarmCommand('swarm.create',
    { purpose: long, idempotencyKey: 'ik-long' }), true);
  assert.equal(validateSwarmCommand('swarm.guide',
    { swarmId: 'swarm:one', participantId: 'impl-a', message: long, idempotencyKey: 'ik-long' }), true);
});

// ── the transport registration seam ─────────────────────────────────────────────────────────────

test('web admission derives from the shared registry spread, not from this module alone', () => {
  assert.deepEqual(swarmRegisteredCommands({}), [], 'an empty registry advertises no swarm verbs');
  assert.deepEqual(swarmRegisteredCommands(APPLICATION_COMMAND_DEFINITIONS), SWARM_COMMAND_NAMES);
  assert.deepEqual(swarmWebAdmittedCommands(APPLICATION_COMMAND_DEFINITIONS), SWARM_COMMAND_NAMES);
  assert.deepEqual([...swarmWebAdmittedCommands(REGISTERED)].sort(), [...SWARM_COMMAND_NAMES].sort(),
    'the spread admits every swarm row flagged web');
  assert.equal(CLI_WEB_COMMANDS.has('swarm.create'), true,
    'the CLI web whitelist is registration-gated with it (the closure audit reads this set)');
});

test('the CLI branch is table-driven from the family rows', () => {
  const { canonical, web } = canonicalAndTransportNames('swarm.recruit');
  assert.equal(canonical, 'swarm.recruit');
  assert.equal(web, 'swarm_recruit');
  assert.equal(SWARM_CLI_COMMANDS.length, SWARM_COMMAND_NAMES.length);
  for (const name of SWARM_COMMAND_NAMES) {
    const verb = name.slice('swarm.'.length);
    const row = swarmCliCommand(verb);
    assert.ok(row, `${verb} has a CLI row`);
    assert.equal(row.command, name);
    assert.ok(row.usage.startsWith(`baton swarm ${verb}`), `${verb} usage names its verb`);
    assert.ok(row.summary.length > 0, `${verb} documents what it does`);
    assert.ok(batonCliHelp(name).includes(row.usage), `${name} renders its own help topic`);
  }
  const recruit = swarmCliCommand('recruit');
  assert.deepEqual(recruit.positional, ['swarmId', 'participantId', 'objective']);
  assert.deepEqual(recruit.flags.map((entry) => entry.flag), ['--options', '--permissions']);
  assert.equal(swarmCliCommand('bogus'), null);
  assert.ok(batonCliHelp('swarm').includes('baton swarm watch'), 'the family topic lists every verb');
});

test('the CLI parses each swarm verb into its exact command args', () => {
  const key = 'a1b2c3d4-0000-4000-8000-000000000001';
  const parsed = (argv) => parseBatonCli([...argv, '--idempotency-key', key]);

  assert.deepEqual(parsed(['swarm', 'list']),
    { kind: 'command', name: 'swarm.list', args: {}, idempotencyKey: key });
  assert.deepEqual(parsed(['swarm', 'create', 'Ship it']),
    { kind: 'command', name: 'swarm.create', args: { purpose: 'Ship it', idempotencyKey: key }, idempotencyKey: key });
  assert.deepEqual(parsed(['swarm', 'update', 'swarm:one', 'swarm.work_updated', '--payload', '{"title":"x"}']), {
    kind: 'command', name: 'swarm.update',
    args: { swarmId: 'swarm:one', event: 'swarm.work_updated', payload: { title: 'x' }, idempotencyKey: key },
    idempotencyKey: key,
  });
  // A plain-text body is the other form the wire admits — it stays text.
  // An envelope-level key always rides; identity-keyed verbs keep their args free of it.
  assert.deepEqual(parsed(['swarm', 'update', 'swarm:one', 'swarm.context_updated', '--payload', 'shared notes']).args, {
    swarmId: 'swarm:one', event: 'swarm.context_updated', payload: 'shared notes', idempotencyKey: key,
  });
  // Identity-keyed verbs carry no key in their args (the coordinates are the key) even though the
  // envelope still carries one for the transport.
  const check = parsed(['swarm', 'check', 'swarm:one', 'reviewer-a', 'contribution:1', 'check:1']);
  assert.deepEqual(check.args, {
    swarmId: 'swarm:one', participantId: 'reviewer-a', contributionId: 'contribution:1', checkId: 'check:1',
  });
  assert.equal(check.idempotencyKey, key);
  // watch is observe-only: its args carry no caller key (the envelope still carries one).
  assert.deepEqual(parsed(['swarm', 'watch', 'swarm:one', '--after-seq', '7', '--timeout-ms', '5000']).args, {
    swarmId: 'swarm:one', afterSeq: 7, timeoutMs: 5_000,
  });
  assert.deepEqual(parsed(['swarm', 'recruit', 'swarm:one', 'impl-a', 'Implement X',
    '--options', '{"exact":{"harness":"h","model":"m","effort":"e"}}', '--permissions', '["contribute"]']).args, {
    swarmId: 'swarm:one', participantId: 'impl-a', objective: 'Implement X',
    options: { exact: { harness: 'h', model: 'm', effort: 'e' } }, permissions: ['contribute'],
    idempotencyKey: key,
  });

  // The parsed requests are exactly the requests the shared validator admits.
  for (const name of SWARM_COMMAND_NAMES) {
    const verb = name.slice('swarm.'.length);
    const row = swarmCliCommand(verb);
    const argv = ['swarm', verb, ...row.positional.map((field) => EXAMPLES[name][field])];
    const args = { ...parseBatonCli([...argv, '--idempotency-key', key]).args };
    for (const entry of row.flags) {
      if (Object.hasOwn(args, entry.field)) continue;
      args[entry.field] = EXAMPLES[name][entry.field];
    }
    assert.equal(validateSwarmCommand(name, args), true, `${name} parses into an admissible request`);
  }

  assert.throws(() => parseBatonCli(['swarm']), (error) => error.code === 'cli_command_unavailable');
  assert.throws(() => parseBatonCli(['swarm', 'bogus']), (error) => error.code === 'cli_command_unavailable');
  assert.throws(() => parseBatonCli(['swarm', 'capture', 'swarm:one', 'impl-a']), /contribution-id/u);
  assert.throws(() => parseBatonCli(['swarm', 'watch', 'swarm:one', '--timeout-ms', 'x']),
    /must be an integer/u);
  assert.throws(() => parseBatonCli(['swarm', 'recruit', 'swarm:one', 'impl-a', 'X', '--options', 'nope']),
    /--options must be JSON/u);
  // `--help` routes into the ordinary application.help lane with the swarm topic, which renders
  // through SWARM_CLI_HELP (baton.mjs dispatches parsed.name === 'application.help' to help).
  const verbHelp = parseBatonCli(['swarm', 'create', '--help']);
  assert.equal(verbHelp.name, 'application.help');
  assert.deepEqual(verbHelp.args, { topic: 'swarm.create', depth: 'outline' });
  const familyHelp = parseBatonCli(['swarm', '--help']);
  assert.equal(familyHelp.name, 'application.help');
  assert.deepEqual(familyHelp.args, { topic: 'swarm', depth: 'outline' });
  assert.ok(batonCliHelp(verbHelp.args.topic).includes('baton swarm create <PURPOSE>'));
});

test('the MCP tool table activates with the registry and follows its stateful flags', () => {
  assert.deepEqual(swarmApplicationToolDefinitions({}), [], 'no tools without a registered family');
  assert.equal(swarmApplicationToolDefinitions(APPLICATION_COMMAND_DEFINITIONS).length, SWARM_COMMAND_NAMES.length);
  const tools = swarmApplicationToolDefinitions(REGISTERED);
  assert.deepEqual(tools.map((tool) => tool.name).sort(),
    SWARM_MCP_TOOL_DEFINITIONS.map((tool) => tool.name).sort());
  assert.deepEqual(SWARM_MCP_TOOL_DEFINITIONS.map((tool) => tool.name).sort(),
    SWARM_COMMAND_NAMES.map((name) => canonicalAndTransportNames(name).mcp).sort());
  const rowsByName = new Map(SWARM_MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  for (const tool of tools) {
    const row = rowsByName.get(tool.name);
    assert.ok(row, `${tool.name} is a declared swarm tool`);
    const definition = SWARM_COMMAND_DEFINITIONS[row.command];
    const { required, properties } = tool.inputSchema;
    assert.ok(required.includes('repoId'), `${tool.name} takes the repository envelope`);
    assert.equal(required.includes('idempotencyKey'), definition.mcpStateful,
      `${tool.name} requires a caller key exactly when the verb is stateful`);
    for (const field of definition.args) {
      if (field === 'idempotencyKey') continue;
      assert.ok(Object.hasOwn(properties, field), `${tool.name} advertises ${field}`);
    }
    for (const field of Object.keys(properties)) {
      if (field === 'repoId' || field === 'idempotencyKey') continue;
      assert.ok(definition.args.includes(field), `${tool.name} advertises no undeclared field ${field}`);
    }
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.annotations.readOnlyHint, row.readOnlyHint);
    assert.equal(tool.annotations.destructiveHint, row.destructiveHint);
  }
  const list = tools.find((tool) => tool.name === 'fleet_swarm_list');
  assert.equal(list.annotations.readOnlyHint, true);
  const stop = tools.find((tool) => tool.name === 'fleet_swarm_stop');
  assert.equal(stop.annotations.destructiveHint, true);
  assert.ok(stop.inputSchema.required.includes('reason'));
  const capture = tools.find((tool) => tool.name === 'fleet_swarm_capture');
  assert.deepEqual(capture.inputSchema.required, ['repoId', 'swarmId', 'participantId', 'contributionId']);
});

// ── the SDK through a fake command port ─────────────────────────────────────────────────────────

test('orchestrator: create, recruit later, guide, and stop remain honest JSON round trips', async () => {
  const views = {
    'swarm.create': { swarmId: 'swarm:one', purpose: 'Ship it', status: 'open', participants: [], cursor: 3 },
    'swarm.inspect': { swarmId: 'swarm:one', status: 'open', participants: [], availableActions: ['swarm.recruit'], cursor: 3 },
    'swarm.recruit': { swarmId: 'swarm:one', participantId: 'impl-a', runId: 'run:1', status: 'starting', cursor: 9 },
  };
  const port = fakePort((name) => views[name] ?? {});
  const swarms = createSwarms(port);

  // An empty swarm is a legitimate first-class state: create it now, recruit when the caller knows
  // who it needs.
  const swarm = await swarms.create('Ship it', { swarmId: 'swarm:one' });
  assert.equal(swarm.id, 'swarm:one');
  assert.deepEqual(await swarm.inspect(), views['swarm.inspect']);
  assert.deepEqual(swarm.last, views['swarm.inspect']);
  assert.equal(swarm.cursor, 3);

  const recruited = await swarm.recruit('impl-a', 'Implement the parser change', {
    options: { exact: { harness: 'codex', model: 'gpt', effort: 'high' } },
    idempotencyKey: 'ik-recruit',
  });
  assert.equal(recruited.participantId, 'impl-a');
  assert.equal(port.calls[2].name, 'swarm.recruit');
  assert.deepEqual(port.calls[2].args, {
    swarmId: 'swarm:one', participantId: 'impl-a', objective: 'Implement the parser change',
    options: { exact: { harness: 'codex', model: 'gpt', effort: 'high' } }, idempotencyKey: 'ik-recruit',
  });

  // A caller-supplied key is reused verbatim (the retry the caller owns); an omitted one is minted
  // once per invocation, so two invocations are two effects and never a silent replay.
  await swarm.guide('impl-a', 'Prefer the boring design.', { idempotencyKey: 'ik-guide' });
  await swarm.guide('impl-a', 'Prefer the boring design.');
  assert.equal(port.calls[3].args.idempotencyKey, 'ik-guide');
  assert.match(port.calls[4].args.idempotencyKey, /^[0-9a-f-]{36}$/u);
  assert.notEqual(port.calls[4].args.idempotencyKey, port.calls[3].args.idempotencyKey);

  await swarm.stop('impl-a', 'Assignment is finished.', { idempotencyKey: 'ik-stop' });
  assert.deepEqual(port.calls[5].args, {
    swarmId: 'swarm:one', participantId: 'impl-a', reason: 'Assignment is finished.', idempotencyKey: 'ik-stop',
  });

  await assert.rejects(swarm.stop('impl-a', ''), (error) => error.code === 'swarm_command_invalid');
  await assert.rejects(createSwarms(port).create('   '), (error) => error.code === 'swarm_command_invalid');
  await assert.rejects(createSwarms(port).create('ok', { extra: 1 }), (error) => error.code === 'application_client_invalid');
  await assert.rejects(async () => swarms.open('swarm:one').guide('impl-a', 'x', { unexpected: true }),
    (error) => error.code === 'application_client_invalid');
  assert.throws(() => createSwarms({}), (error) => error.code === 'application_client_invalid');
  assert.equal(port.calls.length, 6, 'a refused request never reaches the port');
});

test('delegated coordinator: availableActions are the runtime\'s, and the client invents none', async () => {
  const view = {
    swarmId: 'swarm:one', purpose: 'Ship it', status: 'open',
    participants: [
      { participantId: 'coord-b', runId: 'run:2', role: 'coordinator', permissions: ['communicate'] },
      { participantId: 'impl-a', runId: 'run:1', role: 'implementer', permissions: ['contribute'] },
    ],
    groups: { 'group:api': { version: 2, actor: 'coord-b', members: ['impl-a'] } },
    work: { 'work:1': { version: 1, actor: 'coord-b', title: 'Parser' } },
    assignments: {}, context: { notes: { version: 3, actor: 'coord-b', body: 'shared' } },
    contributions: {}, reviews: {},
    caller: { participantId: 'coord-b', permissions: ['communicate'] },
    availableActions: ['swarm.inspect', 'swarm.watch', 'swarm.update', 'swarm.recruit', 'swarm.guide'],
    updates: [{ event: 'swarm.group_updated', seq: 12 }],
    cursor: 12,
  };
  const port = fakePort((name) => (name === 'swarm.inspect' ? view : { swarmId: 'swarm:one', cursor: 13 }));
  const swarm = createSwarms(port).open('swarm:one');

  const inspected = await swarm.inspect();
  assert.deepEqual(inspected.availableActions, view.availableActions);
  assert.deepEqual(inspected.caller, view.caller);
  assert.deepEqual(inspected.groups['group:api'], { version: 2, actor: 'coord-b', members: ['impl-a'] });
  assert.equal(inspected.cursor, 12);

  // Coordination is ordinary domain update: the runtime decides whether this caller may do it.
  // The payload is the store's real shape (validateSwarmEvent demands the full members array) —
  // the contract's early admission now refuses anything the store would refuse undetailed.
  await swarm.group({ groupId: 'group:api', members: ['impl-a', 'impl-b'] });
  await swarm.context({ key: 'notes', body: 'the API contract is frozen at rev 7' });
  assert.equal(port.calls[2].args.event, 'swarm.context_updated');
  assert.equal(port.calls[2].args.payload.body, 'the API contract is frozen at rev 7');
});

test('reviewer: a check observes a partial contribution and leaves the author session alone', async () => {
  const check = {
    swarmId: 'swarm:one', participantId: 'reviewer-a', contributionId: 'contribution:1', checkId: 'check:1',
    verdict: 'observed_passed', capturedSha: 'a'.repeat(40), authorStatus: 'working',
  };
  const port = fakePort((name) => (name === 'swarm.check' ? check : { swarmId: 'swarm:one' }));
  const swarm = createSwarms(port).open('swarm:one');

  const captured = await swarm.capture('impl-a', 'contribution:1');
  assert.deepEqual(port.calls[0].args, {
    swarmId: 'swarm:one', participantId: 'impl-a', contributionId: 'contribution:1',
  });
  const observed = await swarm.check('reviewer-a', 'contribution:1', 'check:1');
  // The check is returned as plain JSON — an observation about the captured revision, never a
  // "task complete" wrapper, and the author's own status is untouched by it.
  assert.deepEqual(observed, check);
  assert.equal(observed.authorStatus, 'working');
  assert.deepEqual(port.calls.map((call) => call.name), ['swarm.capture', 'swarm.check']);
  assert.ok(!port.calls.some((call) => call.name === 'swarm.stop' || call.name === 'swarm.closed'),
    'checking a contribution never stops or closes anything');
  assert.deepEqual(captured, { swarmId: 'swarm:one' });
});

test('implementer: shared context is readable and a finding is an ordinary contribution', async () => {
  const view = {
    swarmId: 'swarm:one', status: 'open',
    context: { conventions: { version: 4, actor: 'coord-b', body: 'run node --test' } },
    contributions: { 'contribution:1': { author: 'peer-a', kind: 'finding' } },
    caller: { participantId: 'impl-a', permissions: ['contribute'] },
    availableActions: ['swarm.inspect', 'swarm.capture'], cursor: 20,
  };
  const port = fakePort((name) => (name === 'swarm.inspect' ? view : { ok: true, cursor: 21 }));
  const swarm = createSwarms(port).open('swarm:one');

  const seen = await swarm.inspect();
  assert.equal(seen.context.conventions.body, 'run node --test');
  assert.deepEqual(seen.contributions['contribution:1'], { author: 'peer-a', kind: 'finding' });

  // A tentative finding is plain text — no schema, no lifecycle side effect.
  await swarm.contribute('The parser drops trailing commas; reproducing now.');
  assert.deepEqual(port.calls[1].args, {
    swarmId: 'swarm:one', event: 'swarm.contribution_recorded',
    payload: 'The parser drops trailing commas; reproducing now.',
    idempotencyKey: port.calls[1].args.idempotencyKey,
  });
  await swarm.review({ contributionId: 'contribution:1', decision: 'comment', reason: 'partial' });
  assert.equal(port.calls[2].args.event, 'swarm.contribution_reviewed');
  await swarm.leave({ participantId: 'impl-a', reason: 'done' });
  assert.equal(port.calls[3].args.event, 'swarm.participant_left');
  await swarm.close({ reason: 'scope shipped' });
  assert.equal(port.calls[4].args.event, 'swarm.closed');
  assert.deepEqual(SWARM_EVENT_KINDS, [
    'swarm.group_updated', 'swarm.work_updated', 'swarm.assignment_updated', 'swarm.context_updated',
    'swarm.contribution_recorded', 'swarm.contribution_reviewed', 'swarm.participant_left', 'swarm.closed',
  ]);
});

test('event-driven observation: watch waits past the last cursor instead of polling', async () => {
  const port = fakePort((name) => (name === 'swarm.inspect'
    ? { swarmId: 'swarm:one', cursor: 12 }
    : { swarmId: 'swarm:one', cursor: 15, updates: [{ event: 'swarm.work_updated', seq: 15 }] }));
  const swarm = createSwarms(port).open('swarm:one');

  const first = await swarm.watch({ timeoutMs: 1_000 });
  assert.deepEqual(port.calls[0].args, { swarmId: 'swarm:one', timeoutMs: 1_000 },
    'without a prior view there is no cursor to resume from');
  assert.equal(first.cursor, 15);
  assert.equal(swarm.cursor, 15, 'the handle tracks the cursor the view carried');

  await swarm.watch();
  assert.deepEqual(port.calls[1].args, { swarmId: 'swarm:one', afterSeq: 15 },
    'the next watch resumes exactly where the last view left off');
  await swarm.watch({ afterSeq: 3 });
  assert.deepEqual(port.calls[2].args, { swarmId: 'swarm:one', afterSeq: 3 },
    'an explicit cursor always wins');
  await assert.rejects(swarm.watch({ afterSeq: -1 }), (error) => error.code === 'swarm_command_invalid');
});

test('the SDK propagates the runtime refusal unchanged and rides the client port', async () => {
  let observedKey = null;
  const refusing = {
    async command(name, args) {
      observedKey = args.idempotencyKey ?? null;
      throw Object.assign(new Error('Swarm participant is not active'), { code: 'swarm_participant_inactive' });
    },
  };
  await assert.rejects(createSwarms(refusing).open('swarm:one').guide('impl-a', 'x'), (error) => {
    assert.equal(error.code, 'swarm_participant_inactive');
    return true;
  });
  assert.match(observedKey, /^[0-9a-f-]{36}$/u);

  const port = fakePort((name) => ({ name, cursor: 1 }));
  const client = bindBatonPort(port);
  assert.deepEqual(await client.swarms.list(), { name: 'swarm.list', cursor: 1 });
  const swarm = client.swarms.open('swarm:one');
  await swarm.inspect();
  assert.deepEqual(port.calls, [
    { name: 'swarm.list', args: {} },
    { name: 'swarm.inspect', args: { swarmId: 'swarm:one' } },
  ]);
});

// ── the client objective ceiling regression (4320-byte objective refused at HEAD) ───────────────

const LONG_OBJECTIVE = 'Investigate the runtime seam '.repeat(160).trim();

test('watch retains its newest cursor across contribution receipts and overlapping reads', async () => {
  const replies = [{ cursor: 10 }, { sha: 'a'.repeat(40) }, { cursor: 8 }, { cursor: 11 }];
  const calls = [];
  const swarm = createSwarms({ command: async (name, args) => {
    calls.push({ name, args }); return replies.shift();
  } }).open('swarm:cursor');
  await swarm.inspect();
  await swarm.capture('builder', 'revision');
  await swarm.inspect();
  await swarm.watch();
  assert.equal(calls.at(-1).args.afterSeq, 10);
  assert.equal(swarm.cursor, 11);
});

test('a long objective reaches the port intact and is never truncated', async () => {
  assert.ok(Buffer.byteLength(LONG_OBJECTIVE) > 4_320, 'the fixture is longer than the old client cap');
  const port = fakePort(() => ({ runId: 'run:long', schemaVersion: 1 }));
  const client = bindBatonPort(port);
  const run = await client.runs.start(LONG_OBJECTIVE);
  assert.equal(run.id, 'run:long');
  const intent = port.calls[0].args.intent;
  assert.equal(intent.objective, LONG_OBJECTIVE, 'the objective arrives byte-identical');
  assert.equal(Buffer.byteLength(intent.objective), Buffer.byteLength(LONG_OBJECTIVE));
  assert.equal(intent.resultIntent, 'change');

  await client.explore(LONG_OBJECTIVE);
  assert.equal(port.calls[1].args.intent.objective, LONG_OBJECTIVE);
  assert.equal(port.calls[1].args.intent.resultIntent, 'read_only_evidence');
  await client.workflow(LONG_OBJECTIVE, {
    team: [
      { role: 'impl', exact: { harness: 'h', model: 'm', effort: 'e' } },
      { role: 'verify', exact: { harness: 'h2', model: 'm2', effort: 'e2' } },
    ],
  });
  assert.equal(port.calls[2].args.intent.objective, LONG_OBJECTIVE);
});

test('the objective contract stays non-empty and NUL-free', async () => {
  const port = fakePort(() => ({ runId: 'run:x' }));
  const client = bindBatonPort(port);
  await assert.rejects(client.runs.start(''), /Run objective is required/u);
  await assert.rejects(client.runs.start('   \n'), /Run objective is required/u);
  await assert.rejects(client.runs.start('do it\0now'), /Run objective is required/u);
  await assert.rejects(client.explore(''), /Run objective is required/u);
  await assert.rejects(client.workflow(''), /Workflow objective is required/u);
  await assert.rejects(client.review(''), /Review objective is required/u);
  assert.deepEqual(port.calls, [], 'a refused objective never reaches the port');

  // Attaching to an existing Run accepts the same long objective it reports (the old cap also
  // refused the view's own objective on attach).
  const attachPort = fakePort(() => ({
    schemaVersion: 1, runId: 'run:long', depth: 'outline', viewDigest: 'b'.repeat(64), terminal: false,
    outline: { objective: LONG_OBJECTIVE, phase: 'working' },
  }));
  const attached = await bindBatonPort(attachPort).runs.attach('run:long');
  assert.equal(attached.objective, LONG_OBJECTIVE);
});
// ── G3: per-event payload shapes are discoverable without reading code ────────────────────────

test('the swarm.update payload schema and CLI help expose per-event payload shapes', () => {
  // MCP: the payload property itself carries the per-kind description through to the wire schema.
  const payloadDescription = SWARM_COMMAND_SCHEMAS['swarm.update'].properties.payload.description;
  assert.equal(typeof payloadDescription, 'string');
  for (const kind of SWARM_EVENT_KINDS) {
    assert.ok(payloadDescription.includes(kind), `MCP payload description names ${kind}`);
  }
  assert.match(payloadDescription, /arbitrary JSON or plain text/u);
  const tool = swarmApplicationToolDefinitions(REGISTERED).find((entry) => entry.name
    === canonicalAndTransportNames('swarm.update').mcp);
  assert.equal(tool.inputSchema.properties.payload.description, payloadDescription,
    'the wire schema carries the same description the contract declares');
  // CLI: the swarm.update help topic names every kind and its caller-supplied fields.
  const helpText = SWARM_CLI_HELP['swarm.update'].paragraphs.join('\n');
  for (const kind of SWARM_EVENT_KINDS) {
    assert.ok(helpText.includes(kind), `swarm.update help names ${kind}`);
  }
  assert.match(helpText, /groupId/u);
  assert.match(helpText, /filled in for you: swarmId, reviewerId/u);
});
