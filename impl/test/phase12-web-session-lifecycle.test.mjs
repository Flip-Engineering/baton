import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSessionStore } from '../src/index.mjs';

const now = Date.parse('2026-07-11T12:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-session-lifecycle-'));
const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });

test('IL2/IL4: rotation is one durable event, preserves claims, and never persists credentials', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  const before = sessions.events().length;
  const next = sessions.rotate(first.sessionId, { actor: 'web:provider-user' });
  assert.equal(sessions.events().length, before + 1);
  assert.equal(sessions.events().at(-1).kind, 'session.rotated');
  assert.equal(sessions.authenticate(bearer(first.token)), null);
  assert.deepEqual(sessions.authenticate(bearer(next.token)).capabilities, ['observe']);
  const durable = readFileSync(join(directory, 'sessions.jsonl'), 'utf8');
  assert.equal(durable.includes(first.token), false);
  assert.equal(durable.includes(next.token), false);
});

test('IL2/IL6: restart refuses a rotated predecessor and accepts only its successor', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'cookie', capabilities: ['control'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  const next = sessions.rotate(first.sessionId, { actor: 'web:provider-user' });
  const restarted = new WebSessionStore(directory, { now: () => now });
  assert.equal(restarted.authenticate({ headers: { cookie: `__Host-baton_session=${first.token}` } }), null);
  assert.equal(restarted.authenticate({ headers: { cookie: `__Host-baton_session=${next.token}` } }).credentialId, next.credentialId);
  assert.equal(restarted.isPrincipalActive(sessions.authenticate({ headers: { cookie: `__Host-baton_session=${next.token}` } })), true);
});

test('IL2/IL5: failed rotation append returns no successor and leaves the predecessor active', () => {
  let fail = false;
  const sessions = new WebSessionStore(root(), {
    now: () => now,
    appendFile(path, value, options) {
      if (fail) throw new Error('disk unavailable');
      appendFileSync(path, value, options);
    },
  });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  fail = true;
  assert.throws(() => sessions.rotate(first.sessionId, { actor: 'web:provider-user' }), /disk unavailable/);
  assert.ok(sessions.authenticate(bearer(first.token)));
  assert.equal(sessions.events().filter((event) => event.kind === 'session.rotated').length, 0);
});
