// issue585-wake-render.test.mjs — issue #585, docs/55 S9: the human form of a wake frame.
//
// The audit's S9 finding is presentational: on the CLI a wake frame is JSON per line, and the
// human-readable form existed only inside `baton top`'s timeline. `renderWakeLine` is that form for
// the live follow legs: stderr, TTY only, composed through the ONE mark rule and the ONE wake-row
// prefix, so a class reads the same word here as in the seat brief and the root wake message.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderWakeLine, writeFollowPage } from '../src/wake-render.mjs';

const SMILE = '✦(◕‿◕)✦';

const frame = {
  schemaVersion: 1, kind: 'baton.wake', seq: 46460, ts: '2026-09-25T05:08:39.791Z',
  wakeClass: 'root_owed', swarmId: 'swarm-visual-20260925',
  participantId: 'visual-lead5', workerId: null, runId: null, actor: null,
  subject: { kind: 'participant', id: 'visual-lead5' },
  next: 'baton swarm view swarm-visual-20260925',
  observation: false, served: { commit: '67b165685045c8f579fbbaba55d1f95c0f6f30f3', behind: 0 },
};

test('a derivable wake class renders its status word, the class, the subject and the next act', () => {
  const line = renderWakeLine(frame, { tty: true });
  assert.equal(line,
    `${SMILE} ▲ needs you — #46460 root_owed participant visual-lead5 · next: baton swarm view swarm-visual-20260925`);
});

test('an event-shaped class renders without an invented status word', () => {
  const line = renderWakeLine({
    ...frame, seq: 33712, wakeClass: 'contribution_recorded',
    subject: { kind: 'contribution', id: 'contribution-abc123' }, next: null,
  }, { tty: true });
  assert.equal(line, `${SMILE} #33712 contribution_recorded contribution contribution-abc123`);
  assert.equal(line.includes('▲'), false);
});

test('the human channel is a TTY channel: a piped stderr renders nothing', () => {
  assert.equal(renderWakeLine(frame, { tty: false }), null);
  assert.equal(renderWakeLine(frame), null);
});

test('a row that is not a wake frame renders nothing', () => {
  assert.equal(renderWakeLine(null, { tty: true }), null);
  assert.equal(renderWakeLine({ kind: 'baton.wake_stream_ended', resumeFrom: 12 }, { tty: true }), null);
  assert.equal(renderWakeLine({ kind: 'baton.wake', seq: 1 }, { tty: true }), null);
  assert.equal(renderWakeLine('text', { tty: true }), null);
});

test('a frame with no subject and no next action renders the sequence and the class alone', () => {
  const line = renderWakeLine({ ...frame, subject: null, next: null }, { tty: true });
  assert.equal(line, `${SMILE} ▲ needs you — #46460 root_owed`);
});

function streams() {
  const written = { stdout: '', stderr: '' };
  return {
    written,
    stdout: { write: (text) => { written.stdout += text; } },
    stderr: { write: (text) => { written.stderr += text; } },
  };
}

test('a follow page writes the machine frame to stdout and the human line to a TTY stderr', () => {
  const io = streams();
  const wrote = writeFollowPage({
    page: frame, project: (value) => ({ machine: value.seq }), stdout: io.stdout, stderr: io.stderr, tty: true,
  });
  assert.equal(wrote, true);
  assert.equal(io.written.stdout, '{"machine":46460}\n');
  assert.equal(io.written.stderr, `${SMILE} ▲ needs you — #46460 root_owed participant visual-lead5 · next: baton swarm view swarm-visual-20260925\n`);
});

test('a piped stderr receives the machine frame alone', () => {
  const io = streams();
  const wrote = writeFollowPage({
    page: frame, project: (value) => ({ machine: value.seq }), stdout: io.stdout, stderr: io.stderr, tty: false,
  });
  assert.equal(wrote, false);
  assert.equal(io.written.stdout, '{"machine":46460}\n');
  assert.equal(io.written.stderr, '');
});

test('a page that is not a wake frame writes its machine row and nothing to stderr', () => {
  const io = streams();
  const wrote = writeFollowPage({
    page: { kind: 'baton.wake_stream_ended', resumeFrom: 12 },
    project: (value) => ({ kind: value.kind }), stdout: io.stdout, stderr: io.stderr, tty: true,
  });
  assert.equal(wrote, false);
  assert.equal(io.written.stdout, '{"kind":"baton.wake_stream_ended"}\n');
  assert.equal(io.written.stderr, '');
});
