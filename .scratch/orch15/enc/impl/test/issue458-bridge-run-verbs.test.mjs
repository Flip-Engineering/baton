// Issue #458 — the seat-side run.* verbs and evidence.search are reachable through the bridge CLI.
//
// OBSERVED (2026-09-18, clone at 1a830bfe, reported from inside two seats): every `run.*` verb
// and `evidence.search` exited 1 with `swarm_bridge_dispatch_failed 'knowledge is not defined'` —
// a ReferenceError in `swarmBridgeMain`'s swarmId auto-fill, thrown BEFORE the request left the
// process, so no argument shape could ever reach the runtime. The `swarm.*` verbs were unaffected.
//
// The pin: driving the bridge CLI for a run.* verb, a knowledge verb and evidence.search with an
// environment that names no bridge never answers a ReferenceError — the answer is the bridge's own
// typed configuration refusal (the request got as far as the transport), and its message never
// reads "is not defined".

import test from 'node:test';
import assert from 'node:assert/strict';

import { swarmBridgeMain } from '../src/swarm-native-bridge.mjs';

const capture = () => {
  const io = { out: '', err: '' };
  return {
    io,
    streams: { out: { write: (t) => { io.out += t; } }, err: { write: (t) => { io.err += t; } } },
  };
};

for (const command of ['run.package.read', 'run.contributions.read', 'run.peers.read', 'run.knowledge.seed', 'evidence.search']) {
  test(`#458: ${command} through the bridge CLI reaches the transport — never a ReferenceError`, async () => {
    const { io, streams } = capture();
    const code = await swarmBridgeMain([command, '{}'], {}, streams);
    assert.equal(code, 1, 'no bridge is configured, so the CLI exits 1 with a typed refusal');
    const text = io.out + io.err;
    assert.doesNotMatch(text, /is not defined/, `a ReferenceError leaked to the seat: ${text.slice(0, 200)}`);
    assert.doesNotMatch(text, /swarm_bridge_dispatch_failed/, `the bridge's catch-all code answered instead of a typed refusal: ${text.slice(0, 200)}`);
  });
}
