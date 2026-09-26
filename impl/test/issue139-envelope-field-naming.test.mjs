// Issue #139 — a web envelope refusal names the FIELD it refused, never the class.
//
// The witnessed failure: a `/v1/commands` envelope cost a source dive to learn, because the
// validator answered the class (`invalid_command / unknown_top_level_field`) and never the
// offender; the required-field branch collapsed four fields into one sentence
// ("command identity, idempotencyKey, repoId, and origin are required"), so an operator could not
// tell WHICH field was wrong. #160 R4 fixed the unknown-field arms (W1/W2 name the key); this file
// pins the remaining branch, which is the only closed-shape validator in the tree that still named
// its class: the bridge names every missing field (#43 AX R1/R2, swarm-native-bridge.test.mjs:399)
// and so do the seat-read validators (issue441b-seat-read-verbs.test.mjs:333).
//
// Rows:
//   139a  an absent required field is refused naming that field, and the code stays
//         `invalid_command` (the W8-1/phase12 pin: a route-shape refusal keeps that code);
//   139b  every refused required field is named in ONE refusal, not just the first;
//   139c  a read-only command needs no idempotencyKey, and a keyed command without one is refused
//         naming that field (the #344 rule the branch implements, now legible);
//   139d  a present-but-malformed field is named as INVALID, and a client-supplied value — a 60 KB
//         marker — is never echoed back (#160 R4, the PKG-1 value law);
//   139e  at the wire the refusal crosses as 400 `invalid_command` carrying the field, so a reader
//         of the body learns the offender without opening the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore, WebNorthbound, validateWebCommandEnvelope } from '../src/index.mjs';

const REPO_ID = 'repo-139';
const ORIGIN = 'https://control.example.test';
const envelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-139',
  idempotencyKey: 'retry-139',
  command: 'spawn',
  args: {},
  repoId: REPO_ID,
  origin: ORIGIN,
  ...overrides,
});
const principal = () => ({
  userId: 'user-139', sessionId: 'session-139', credentialId: 'cred-139', authMethod: 'cookie',
  csrfToken: 'csrf-139', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control'], repoIds: [REPO_ID],
});
const context = () => ({
  principal: principal(), origin: ORIGIN, csrfToken: 'csrf-139',
  remoteAddress: '127.0.0.1', transport: 'https',
});

test('139a: an absent required field is refused by name, and the code stays invalid_command', () => {
  for (const field of ['commandId', 'command', 'repoId', 'origin']) {
    const refusal = validateWebCommandEnvelope(envelope({ [field]: undefined }));
    assert.equal(refusal.code, 'invalid_command',
      'the route-shape code is unchanged (W8-1/phase12 pins the code, this issue fixes the message)');
    assert.equal(refusal.field, field, `the refusal names the field the caller has to fix: ${field}`);
    assert.equal(refusal.message, `missing required field: ${field}`);
  }
});

test('139b: every refused required field is named in ONE refusal', () => {
  const refusal = validateWebCommandEnvelope(envelope({ commandId: undefined, repoId: undefined, origin: undefined }));
  assert.equal(refusal.field, 'commandId', 'the first field in the envelope\'s declared order heads the refusal');
  assert.equal(refusal.message,
    'missing required field: commandId; missing required field: repoId; missing required field: origin',
    'a caller repairs every offender from one answer, not one per round trip');
});

test('139c: a read-only command needs no idempotencyKey, and a keyed command without one is named', () => {
  assert.equal(validateWebCommandEnvelope(envelope({ command: 'capabilities', idempotencyKey: undefined })), null,
    'a read-only verb carries no key by design (#344), so its absence is not a field refusal');
  const refusal = validateWebCommandEnvelope(envelope({ command: 'spawn', idempotencyKey: undefined }));
  assert.equal(refusal.code, 'invalid_command');
  assert.equal(refusal.field, 'idempotencyKey');
  assert.equal(refusal.message, 'missing required field: idempotencyKey',
    'the keyed verb says which field the mutation is missing');
});

test('139d: a malformed field is named invalid, and no submitted value is ever echoed', () => {
  const refusal = validateWebCommandEnvelope(envelope({ commandId: 'bad id!' }));
  assert.equal(refusal.field, 'commandId');
  assert.equal(refusal.message, 'invalid required field: commandId', 'present but malformed reads as invalid');
  const marker = `credential-shaped-marker-${'x'.repeat(60_000)}`;
  const markerRefusal = validateWebCommandEnvelope(envelope({ commandId: marker }));
  assert.equal(markerRefusal.field, 'commandId', 'the field NAME crosses; the value it carried does not');
  assert.equal(markerRefusal.message, 'invalid required field: commandId');
  assert.equal(JSON.stringify(markerRefusal).includes(marker), false,
    'a client-supplied value never crosses back on the refusal (#160 R4; the PKG-1 value law)');
});

test('139e: at the wire the refusal crosses as 400 invalid_command carrying the field', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue139-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => '2026-09-26T00:00:00.000Z' }),
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => Date.parse('2026-09-26T00:00:00.000Z'),
  });
  const response = await web.execute(context(), envelope({ repoId: undefined }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_command');
  assert.equal(response.body.error.field, 'repoId', 'the body carries the offender, not only the class');
  assert.equal(response.body.error.message, 'missing required field: repoId');
});
