// Issue #503 — a recruited worker's brief lists the collaboration surface by bare verb
// name only, so 21 swarm participants never reached for boards, scratchpads,
// run.knowledge.seed, evidence.search, or the REPL layer. The repair (like #310's
// contribution-contract example): the recruit brief's "bridge verbs it holds" block carries
// a one-line situated purpose per verb, derived from the ONE registry tables —
// SWARM_KNOWLEDGE_COMMANDS and SWARM_SEAT_READ_COMMANDS — never re-spelled.
//
//   503-1  a default-grant recruit's brief renders a ## Collaboration block naming every
//          knowledge verb and seat-read verb with its registry situation text.
//   503-2  no verb renders as a bare name: every verb line carries its purpose text.
//   503-3  a read-only grant omits the contribute verbs instead of teaching refused calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import {
  SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES,
} from '../src/swarm-contract.mjs';
import { SWARM_SEAT_READ_COMMANDS, SWARM_SEAT_READ_COMMAND_NAMES } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue503-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working' });
    },
    stopRun: async () => {},
  });
  return { store, runtime };
}

async function seated(f, participantId, args = {}) {
  await f.runtime.command('swarm.create',
    { swarmId: 'collab', purpose: 'Teach the collaboration verbs', idempotencyKey: 'issue503:create' }, owner)
    .catch((error) => {
      if (error?.code !== 'swarm_id_taken') throw error;
    });
  await f.runtime.command('swarm.recruit', {
    swarmId: 'collab', participantId, objective: `Work as ${participantId}.`,
    idempotencyKey: `issue503:recruit:${participantId}`, ...args,
  }, owner);
  return f.store.swarm('collab').participants[participantId];
}

const sectionOf = (brief) => {
  const start = brief.indexOf('## Collaboration');
  assert.ok(start >= 0, 'the brief renders a ## Collaboration block');
  const rest = brief.slice(start + '## Collaboration'.length);
  const next = rest.indexOf('\n## ');
  return (next < 0 ? rest : rest.slice(0, next)).trim();
};

test('503-1: the recruit brief teaches every held collaboration verb with its registry purpose', async (t) => {
  const f = fixture(t);
  const seat = await seated(f, 'worker-a');
  const section = sectionOf(seat.brief);
  for (const name of [...SWARM_KNOWLEDGE_COMMAND_NAMES, ...SWARM_SEAT_READ_COMMAND_NAMES]) {
    const table = Object.hasOwn(SWARM_KNOWLEDGE_COMMANDS, name)
      ? SWARM_KNOWLEDGE_COMMANDS : SWARM_SEAT_READ_COMMANDS;
    assert.ok(section.includes(name), `the block names ${name}`);
    assert.ok(section.includes(table[name].situation),
      `${name} carries its registry situation text, not just its name`);
  }
});

test('503-2: no verb renders as a bare name — every verb line carries purpose text', async (t) => {
  const f = fixture(t);
  const seat = await seated(f, 'worker-b');
  const section = sectionOf(seat.brief);
  for (const name of [...SWARM_KNOWLEDGE_COMMAND_NAMES, ...SWARM_SEAT_READ_COMMAND_NAMES]) {
    const line = section.split('\n').find((candidate) => candidate.includes(name));
    assert.ok(line, `the block has a line for ${name}`);
    assert.ok(line.length > `- ${name}`.length + 10,
      `${name} renders with a purpose line, not a bare name: ${JSON.stringify(line)}`);
  }
});

test('503-3: a read-only grant omits contribute verbs instead of teaching refused calls', async (t) => {
  const f = fixture(t);
  const seat = await seated(f, 'worker-c', { permissions: ['read'] });
  const section = sectionOf(seat.brief);
  for (const name of SWARM_SEAT_READ_COMMAND_NAMES) {
    assert.ok(section.includes(name), `the read grant still teaches ${name}`);
  }
  for (const name of SWARM_KNOWLEDGE_COMMAND_NAMES) {
    if (SWARM_KNOWLEDGE_COMMANDS[name].permission === 'contribute') {
      assert.ok(!section.includes(name), `the read grant omits contribute verb ${name}`);
    } else {
      assert.ok(section.includes(name), `the read grant still teaches ${name}`);
    }
  }
});
