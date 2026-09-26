import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as brand from '../src/brand.mjs';
import { flipAnnounce, flipFace, flipHumanLine, flipLine, flipStatus, flipStatusPrefix, flipStatusTable } from '../src/brand.mjs';

const SMILE = '✦(◕‿◕)✦';
const THINKING = '✦(◕﹏◕)◦';
const CLOSED = ['ready', 'working', 'needs you', 'refused', 'stalled', 'idle', 'draining', 'done'];

test('Flip is brand identity only: the pose vocabulary and derivation are deleted', () => {
  // The exported pose vocabulary is gone.
  assert.equal('FLIP_POSES' in brand, false);
  // The one mark stands; any other pose name refuses typed.
  assert.equal(flipFace(), SMILE);
  assert.equal(flipFace('smile'), SMILE);
  assert.throws(() => flipFace('thinking'), (error) => error.code === 'brand_pose_invalid');
  assert.throws(() => flipFace('attentive'), (error) => error.code === 'brand_pose_invalid');
  // flipLine carries no pose option: no call shape can summon a second face.
  assert.equal(flipLine('baton — reflexive multi-agent orchestration'),
    `${SMILE} baton — reflexive multi-agent orchestration`);
  assert.equal(flipLine('x', { pose: 'thinking' }).includes(THINKING), false);
  assert.equal(flipLine('x').includes(THINKING), false);
});

test('ONE function derives the closed status set from the projection classes', () => {
  // Real projection classes land on the intended closed rows — all eight reachable.
  const derivation = {
    hosted: 'ready', ready: 'ready', published: 'ready',
    working: 'working', running: 'working',
    attention: 'needs you', paused: 'needs you', blocked: 'needs you', selection_required: 'needs you',
    refused: 'refused', failed: 'refused', denied: 'refused', dead: 'refused', exited: 'refused',
    stalled: 'stalled', watchdog: 'stalled',
    idle: 'idle', unbound: 'idle',
    draining: 'draining', stopping: 'draining', signal: 'draining',
    done: 'done', completed: 'done', work_completed: 'done', closed: 'done', cancelled: 'done', left: 'done',
  };
  const derived = new Set(Object.keys(derivation).map((klass) => flipStatus(klass).status));
  for (const word of CLOSED) assert.ok(derived.has(word), `closed status ${word} is unreachable`);
  assert.equal(flipStatus('hosted').status, 'ready');
  assert.equal(flipStatus('working').status, 'working');
  assert.equal(flipStatus('paused').status, 'needs you');
  assert.equal(flipStatus('dead').status, 'refused');
  assert.equal(flipStatus('watchdog').status, 'stalled');
  assert.equal(flipStatus('unbound').status, 'idle');
  assert.equal(flipStatus('signal').status, 'draining');
  assert.equal(flipStatus('closed').status, 'done');
  // docs/56 D1: the wake classes that name a lifecycle state of their subject derive too, so a
  // seat reading a wake row and an operator reading the stderr channel see one vocabulary. The
  // canonical run phases that hold work for a person join them (issue #585 follow-up: the desk and
  // the terminal frame both read a run's phase through this table).
  const wakeDerivation = {
    capacity_pressure: 'needs you',
    reroute_proposed: 'needs you', root_owed: 'needs you',
    contribution_integrated: 'done', resident_lifecycle: 'ready',
    incarnation_changed: 'ready', queued: 'idle', open: 'ready',
    awaiting_approval: 'needs you', awaiting_selection: 'needs you',
    awaiting_plan_approval: 'needs you',
  };
  for (const [klass, word] of Object.entries(wakeDerivation)) {
    assert.equal(flipStatus(klass)?.status, word, `wake class ${klass} derives ${word}`);
  }
  // An event is not a state: the classes that only report activity gain no status word.
  for (const klass of ['contribution_recorded', 'reviewed', 'recruited', 'assigned', 'work_updated',
    'coupling_updated', 'context_updated', 'guidance_delivered', 'knowledge', 'note', 'checkpoint']) {
    assert.equal(flipStatus(klass), null, `event class ${klass} must not derive a status`);
  }
  // The honesty law: a class with no derivable status does not exist — never invented.
  assert.equal(flipStatus('definitely-not-a-projection-class'), null);
  assert.equal(flipStatus(undefined), null);
  assert.equal(flipStatus(null), null);
  // The row shape: glyph + closed word.
  const status = flipStatus('working');
  assert.equal(status.word, 'working');
  assert.equal(typeof status.glyph, 'string');
  assert.equal(status.text, `${status.glyph} working`);
});

test('the status channel is a TTY channel: silent when stderr is piped', () => {
  // Piped: the bare text only — no mark, no status glyph, no status word prefix.
  const piped = flipAnnounce('hosted', 'baton serve: {"state":"hosted"}', { tty: false });
  assert.equal(piped, 'baton serve: {"state":"hosted"}');
  assert.equal(piped.includes(SMILE), false);
  // TTY: mark + status word + text.
  const tty = flipAnnounce('hosted', 'baton serve: {}', { tty: true });
  assert.ok(tty.startsWith(`${SMILE} ● ready — baton serve: {}`), tty);
  // An undervivable class renders the mark and text with no invented status.
  const unknown = flipAnnounce('mystery-class', 'baton serve: {}', { tty: true });
  assert.equal(unknown, `${SMILE} baton serve: {}`);
});

test('the CLI stderr keeps its refusal text but never emits persona when piped', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'baton.mjs');
  const run = spawnSync(process.execPath, [script, 'definitely-not-a-baton-verb'], { encoding: 'utf8' });
  assert.ok([1, 2].includes(run.status), `exit ${run.status}: ${run.stderr}`);
  // stdout stays machine-clean.
  assert.equal(run.stdout, '');
  // The typed refusal survives on stderr...
  assert.match(run.stderr, /baton: [a-z_]+:/u);
  // ...with no mark, no status glyph, and no status word prefix.
  assert.equal(run.stderr.includes(SMILE), false);
  assert.equal(run.stderr.includes('✗'), false);
  assert.equal(run.stderr.includes('refused —'), false);
});

test('the piped stderr of `baton help` is silent; stdout keeps the help text', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'baton.mjs');
  const run = spawnSync(process.execPath, [script, 'help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /baton/u);
  // The brand line is pure chrome: silent when piped.
  assert.equal(run.stderr.includes(SMILE), false);
  assert.equal(run.stderr, '');
});

test('ONE rule for the mark: flipHumanLine composes a human line, flipStatusPrefix a wake prefix', () => {
  // The mark rides human-facing text, with the derived status word when the class carries one.
  assert.equal(flipHumanLine('baton · overview · run:x'), `${SMILE} baton · overview · run:x`);
  assert.equal(flipHumanLine('root owed: review_owed in swarm-x', { statusClass: 'root_owed' }),
    `${SMILE} ▲ needs you — root owed: review_owed in swarm-x`);
  // An underivable class renders the text with no invented status word.
  assert.equal(flipHumanLine('x', { statusClass: 'contribution_recorded' }), `${SMILE} x`);
  // The wake-row prefix is the same derivation, spelled once.
  assert.equal(flipStatusPrefix('root_owed'), '▲ needs you — ');
  assert.equal(flipStatusPrefix('contribution_recorded'), '');
  assert.equal(flipStatusPrefix(null), '');
  // flipAnnounce keeps its TTY gate and reads the same composer.
  assert.equal(flipAnnounce('root_owed', 'text', { tty: false }), 'text');
  assert.equal(flipAnnounce('root_owed', 'text', { tty: true }), `${SMILE} ▲ needs you — text`);
});

test('the one derivation is served as data for a renderer that runs elsewhere', () => {
  const table = flipStatusTable();
  // The projection is plain data: no color, no escape bytes, the same closed set and the same rows.
  assert.equal(JSON.stringify(table).includes('\u001b'), false);
  for (const word of CLOSED) {
    assert.equal(table.rows[word].word, word);
    assert.equal(typeof table.rows[word].glyph, 'string');
    assert.equal(table.rows[word].text, undefined);
  }
  for (const [klass, status] of Object.entries(table.derivation)) {
    assert.equal(table.rows[status] === undefined, false, `${klass} maps onto a served row`);
    assert.equal(status, flipStatus(klass).status, `${klass} derives identically through the projection`);
  }
});
