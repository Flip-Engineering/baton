import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBatonTopCli, runBatonTop } from '../src/baton-top.mjs';

function output() {
  return {
    isTTY: false, columns: 100, value: '',
    write(chunk) { this.value += String(chunk); return true; },
  };
}

const SNAPSHOT = {
  doctor: {
    ok: true,
    value: {
      ready: true,
      deployment: { deploymentId: 'dep:1' },
      application: { resident: { deploymentId: 'dep:1', incarnation: 'inc:1', transport: 'local', startedAt: 't0' } },
    },
  },
  run: {
    ok: true,
    value: {
      runId: 'run:a', phase: 'working', objective: 'Observe the family', narrative: 'One worker is active.',
      workstreams: [],
      attention: [{ id: 'request:1', requestId: 'request:1', runId: 'run:a', kind: 'approval', requiredAction: 'answer', prompt: 'Allow?' }],
    },
  },
};

/** A client stub serving the snapshot seam and the swarm family slices, recording calls. */
function familyClient() {
  const calls = [];
  return {
    calls,
    async surfaceSnapshot(args) { calls.push(['surfaceSnapshot', args]); return SNAPSHOT; },
    async command(name, args) {
      calls.push([name, args]);
      if (name === 'swarm.list') {
        return [{ swarmId: 'swarm:s1', purpose: 'ship the row', status: 'open' }];
      }
      if (name === 'swarm.view' && args.swarmId === 'swarm:s1' && args.projection === 'participants') {
        return {
          swarmId: 'swarm:s1', status: 'open', seq: 7, ts: '2026-09-14T00:00:07Z', cursor: 41,
          participants: [
            { participantId: 'flip1', role: 'pilot', status: 'active', seq: 5, ts: '2026-09-14T00:00:05Z', runId: 'run:a', runtime: { state: 'working', turn: 'running' } },
            { participantId: 'flip2', role: 'coder', status: 'active', seq: 6, ts: '2026-09-14T00:00:06Z', runtime: { state: 'paused', turn: 'paused' } },
          ],
        };
      }
      if (name === 'swarm.view' && args.swarmId === 'swarm:s1' && args.projection === 'attention') {
        return {
          swarmId: 'swarm:s1',
          attention: [{ kind: 'coupling_writer_gone', participantId: 'flip2', next: { event: 'swarm.coupling_updated', action: 'release' } }],
        };
      }
      throw Object.assign(new Error(`unknown command ${name}`), { code: 'cli_command_unavailable' });
    },
  };
}

/** The wake-stream module double: the same contract shape impl/src/wake-stream.mjs exports. */
function wakeDouble(frames) {
  const opens = [];
  const table = [
    { wakeClass: 'attention', scope: 'deployment', terminal: true, next: 'baton run answer {runId} {requestId} --text TEXT', summary: 'a question, approval, or decision was asked, answered, or expired' },
    { wakeClass: 'contribution_recorded', scope: 'swarm', terminal: true, next: 'baton swarm check {swarmId} {participantId} {contributionId} CHECK_ID', summary: 'a contribution landed and waits for an independent check' },
  ];
  const module = {
    WAKE_CLASS_TABLE: table,
    openWakeStream(options) {
      opens.push(options);
      for (const frame of frames) options.onFrame(frame, String(frame.seq));
      return Promise.resolve({ status: 'open' });
    },
  };
  return { module, opens };
}

const FRAMES = [
  {
    schemaVersion: 1, kind: 'baton.wake', seq: 41, ts: '2026-09-14T00:00:41Z', wakeClass: 'attention',
    swarmId: 'swarm:s1', participantId: 'flip2', runId: 'run:a', actor: 'worker:flip2',
    subject: { kind: 'request', id: 'request:9' }, next: 'baton run answer run:a request:9 --text TEXT',
  },
  {
    schemaVersion: 1, kind: 'baton.wake', seq: 40, ts: '2026-09-14T00:00:40Z', wakeClass: 'contribution_recorded',
    swarmId: 'swarm:s1', participantId: 'flip1',
    subject: { kind: 'contribution', id: 'contribution:c1' }, next: null,
  },
];

test('baton top overview carries the resident, the swarm family, and attention with the next action', async () => {
  const stdout = output();
  const client = familyClient();
  const result = await runBatonTop(parseBatonTopCli(['top', 'run:a', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
  });
  assert.equal(result.run.runId, 'run:a');
  const text = stdout.value;
  // Resident row.
  assert.match(text, /Resident/u);
  assert.match(text, /dep:1  inc:1  local/u);
  // Swarm family rows with state and last wake.
  assert.match(text, /Swarm family/u);
  assert.match(text, /swarm:s1  open  ship the row  last wake #7/u);
  // Participants under their swarm, with the closed status words and last wake.
  assert.match(text, /flip1  pilot  ◐ working  last wake #5/u);
  assert.match(text, /flip2  coder  ▲ needs you  last wake #6/u);
  // The run attention row names the next action verbatim.
  assert.match(text, /→ baton run answer run:a request:1/u);
  // The family attention row carries its swarm coordinate and the row's own next.
  assert.match(text, /swarm:s1 .*coupling_writer_gone/u);
  assert.match(text, /→ baton swarm update swarm:s1 swarm\.coupling_updated \(release\)/u);
  // The seat status row derives from the same closed set (attention first).
  assert.match(text, /Status  ▲ needs you/u);
  // Non-TTY output is one stable frame with no ANSI.
  assert.equal(stdout.value.includes('\u001b'), false);
  // The family read is bounded: one list read, two slice reads per swarm.
  const listCalls = client.calls.filter(([name]) => name === 'swarm.list');
  assert.equal(listCalls.length, 1);
});

test('the fleet graph shows participants under their swarms', async () => {
  const stdout = output();
  const client = familyClient();
  await runBatonTop(parseBatonTopCli(['top', 'run:a', '--view', 'topology', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
  });
  const text = stdout.value;
  const swarmLine = text.indexOf('swarm:s1');
  const participantLine = text.indexOf('flip1', swarmLine);
  assert.ok(swarmLine >= 0, 'swarm node missing from the fleet graph');
  assert.ok(participantLine > swarmLine, 'participant not rendered under its swarm');
  assert.match(text, /swarm:s1 member flip1/u);
  assert.match(text, /flip1 runs run:a/u);
});

test('the timeline consumes the wake stream through ONE attachment, classified by the wake class table', async () => {
  const stdout = output();
  const client = familyClient();
  const double = wakeDouble(FRAMES);
  const result = await runBatonTop(parseBatonTopCli(['top', 'run:a', '--view', 'timeline', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
    connection: { baseUrl: 'https://baton.local', token: 'token-for-the-seat', origin: null },
    wakes: double.module,
  });
  // ONE attachment per resident — never one per frame.
  assert.equal(double.opens.length, 1);
  assert.equal(double.opens[0].token, 'token-for-the-seat');
  // The frames land classified: class, subject, terminal, and the table's next action.
  const text = stdout.value;
  assert.match(text, /Wake stream/u);
  assert.match(text, /#41  attention  request:9  terminal/u);
  assert.match(text, /→ baton run answer run:a request:9 --text TEXT/u);
  assert.match(text, /#40  contribution_recorded  contribution:c1  terminal/u);
  assert.match(text, /→ baton swarm check \{swarmId\} \{participantId\} \{contributionId\} CHECK_ID/u);
  // The run event tail keeps its provenance rendering.
  assert.match(text, /Run events/u);
  // The seat closes its attachment: the abort signal fires.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(double.opens[0].signal.aborted, true);
  assert.equal(result.run.runId, 'run:a');
});

test('without a wake module or connection the timeline degrades honestly', async () => {
  const stdout = output();
  const client = familyClient();
  await runBatonTop(parseBatonTopCli(['top', 'run:a', '--view', 'timeline', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
  });
  assert.match(stdout.value, /wake stream not attached/u);
});

test('a resident that serves no swarm family renders the named unavailability', async () => {
  const stdout = output();
  const client = {
    async surfaceSnapshot() { return SNAPSHOT; },
    async command(name) {
      throw Object.assign(new Error(`${name} is not served here`), { code: 'cli_command_unavailable' });
    },
  };
  await runBatonTop(parseBatonTopCli(['top', 'run:a', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
  });
  assert.match(stdout.value, /swarm family unavailable: cli_command_unavailable/u);
});
