// Issue #585 stage 3, design D3 (docs/56): `baton statusline` — the Claude Code status-line
// command. The harness runs it on every redraw, so the tests pin three things: the line it
// derives (what the root is owed leads it), the ONE bounded read behind that line (`swarm.list`,
// then one `attention` slice per swarm), and the honesty rule — a resident that cannot be read
// prints nothing at all, stdout untouched and exit 0.
//
// No live resident is involved: the client is a stub whose calls are recorded, so the "cheapest
// read" claim is checked as an exact command sequence rather than described.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BATON_STATUSLINE_CLI_ROOT, BATON_STATUSLINE_HELP, parseBatonStatuslineCli,
  projectStatusline, resolveStatuslineConnection, runBatonStatusline,
} from '../src/baton-statusline.mjs';
import { MAX_FAMILY_SWARMS } from '../src/swarm-family.mjs';
import { projectSwarmView } from '../src/swarm-contract.mjs';

const SWARM_ID = 'swarm-visual-20260925';
// The served commit the audit's captures carry, at the length the resident publishes (40 hex).
const SERVED_COMMIT = '67b16568c0ffee1234567890abcdef1234567890';

// The frame the verb reads is a `swarm.view` answer under the `attention` projection: the slice
// keeps the attention rows and the frame's own facts beside them.
const FRAME_FACT_KEYS = Object.freeze(['swarmId', 'status', 'attention', 'deployment']);

function sink() {
  return {
    value: '',
    write(chunk) { this.value += String(chunk); return true; },
  };
}

/** A resident-shaped stub: `list` answers `swarm.list`, `views` maps a swarmId to its frame (an
 * Error refuses that one read) and every call is recorded. */
function stubResident({ list = [], views = {}, listError = null } = {}) {
  const calls = [];
  return {
    calls,
    async command(name, args) {
      calls.push([name, args]);
      if (name === 'swarm.list') {
        if (listError !== null) throw listError;
        return list;
      }
      if (name === 'swarm.view') {
        const answer = views[args.swarmId];
        if (answer instanceof Error) throw answer;
        if (answer === undefined) {
          throw Object.assign(new Error(`${args.swarmId} is not readable`), { code: 'swarm_not_found' });
        }
        return answer;
      }
      throw Object.assign(new Error(`${name} is not served by this stub`), { code: 'cli_command_unavailable' });
    },
  };
}

function frame({ status = 'open', attention = [], served = { commit: SERVED_COMMIT, behind: 0 } } = {}) {
  return { swarmId: SWARM_ID, status, deployment: { served }, attention };
}

function unavailable(message) {
  return Object.assign(new Error(message), { code: 'cli_command_unavailable' });
}

test('the parser never swallows another verb, and refuses anything but --help', () => {
  for (const argv of [['run', 'view'], ['top'], ['statuslines'], [], null]) {
    assert.equal(parseBatonStatuslineCli(argv), null, `${JSON.stringify(argv)} is not this verb`);
  }
  assert.deepEqual(parseBatonStatuslineCli(['statusline']), { kind: 'statusline' });
  assert.equal(parseBatonStatuslineCli(['statusline', '--help']).kind, 'statusline_help');
  assert.equal(parseBatonStatuslineCli(['statusline', '-h']).kind, 'statusline_help');
  for (const argv of [['statusline', '--bogus'], ['statusline', 'extra'], ['statusline', '--help', 'extra']]) {
    assert.throws(() => parseBatonStatuslineCli(argv), (error) => {
      assert.equal(error.code, 'cli_invalid');
      // the #431 shape: the offending token, the admitted set and the usage line, all three.
      assert.match(error.message, /unexpected argument/u);
      assert.match(error.message, /admitted arguments: --help, -h/u);
      assert.match(error.message, /usage: baton statusline \[--help\]/u);
      assert.equal(error.detail.rule, 'closed-set');
      assert.deepEqual(error.detail.admitted, ['--help', '-h']);
      assert.equal(error.detail.usage, 'baton statusline [--help]');
      return true;
    });
  }
});

test('the help carries the usage and the settings stanza the operator pastes', () => {
  assert.match(BATON_STATUSLINE_HELP, /Usage:\n {2}baton statusline\n/u);
  assert.ok(BATON_STATUSLINE_HELP.includes(
    '{"statusLine": {"type": "command", "command": "baton statusline"}}',
  ), 'the Claude Code settings stanza is rendered for the operator to paste');
  assert.match(BATON_STATUSLINE_HELP, /Baton never writes it/u);
});

test('root-owed rows lead the line, with the attention count and the served commit', async () => {
  const stdout = sink();
  const client = stubResident({
    list: [{ swarmId: SWARM_ID, purpose: 'Visual surfaces', status: 'open' }],
    views: {
      [SWARM_ID]: frame({
        attention: [
          { kind: 'root_wake_undelivered', owed: 'review_owed', participantId: 'visual-lead5' },
          { kind: 'root_wake_undelivered', owed: 'needs_root', participantId: 'visual-lead5' },
          { kind: 'unreviewed_contribution', participantId: 'd3' },
        ],
      }),
    },
  });
  const result = await runBatonStatusline({ client, stdout });
  assert.deepEqual(result, { printed: true });
  assert.equal(stdout.value,
    '✦(◕‿◕)✦ ▲ needs you — 2 owed to the root · 3 attention · served 67b16568 (+0)\n');
  assert.equal(stdout.value.includes('\u001b'), false, 'the captured line carries no ANSI');
  assert.deepEqual(client.calls, [
    ['swarm.list', {}],
    ['swarm.view', { swarmId: SWARM_ID, projection: 'attention' }],
  ], 'ONE read: the family list, then one attention slice per swarm — no roster, no runs, no second pass');
});

test('a readable swarm with no attention says so, and derives the status from the frame', async () => {
  const stdout = sink();
  const client = stubResident({
    list: [{ swarmId: SWARM_ID, status: 'open' }],
    views: { [SWARM_ID]: frame({ attention: [] }) },
  });
  assert.deepEqual(await runBatonStatusline({ client, stdout }), { printed: true });
  assert.equal(stdout.value,
    '✦(◕‿◕)✦ ● ready — nothing owed to the root · served 67b16568 (+0)\n');
});

test('an underivable status class renders no status word — never an invented one', () => {
  assert.equal(projectStatusline({
    swarms: [{ swarmId: SWARM_ID, frame: frame({ status: 'mysterious', attention: [], served: null }) }],
  }).line, '✦(◕‿◕)✦ nothing owed to the root');
  assert.equal(projectStatusline({ swarms: [] }).line, '', 'no readable frame derives nothing');
  assert.equal(projectStatusline().line, '', 'the read is optional');
  assert.equal(projectStatusline({
    swarms: [{ swarmId: SWARM_ID, frame: { swarmId: SWARM_ID, status: null, attention: [], deployment: null } }],
  }).line, '✦(◕‿◕)✦ nothing owed to the root', 'a served fact the deployment never carried is omitted, not faked');
  assert.equal(projectStatusline({
    swarms: [{ swarmId: SWARM_ID, frame: frame({ attention: [], served: { commit: SERVED_COMMIT, behind: null } }) }],
  }).line, '✦(◕‿◕)✦ ● ready — nothing owed to the root · served 67b16568',
  'an uncounted drift is omitted rather than rendered as (+0)');
});

test('the attention count sums across swarms while the served commit is the first frame\'s', () => {
  const second = 'swarm-visual-second';
  const { line } = projectStatusline({
    swarms: [
      { swarmId: SWARM_ID, frame: frame({ attention: [{ kind: 'root_wake_undelivered', owed: 'turn_reported' }] }) },
      { swarmId: second, frame: { swarmId: second, status: 'open', deployment: { served: { commit: 'ffffffff', behind: 3 } }, attention: [{ kind: 'unreviewed_contribution' }] } },
    ],
  });
  assert.equal(line, '✦(◕‿◕)✦ ▲ needs you — 1 owed to the root · 2 attention · served 67b16568 (+0)');
});

test('a refused swarm.list prints nothing and leaves stdout untouched', async () => {
  const stdout = sink();
  const client = stubResident({ listError: unavailable('no resident serves this directory') });
  assert.deepEqual(await runBatonStatusline({ client, stdout }), { printed: false });
  assert.equal(stdout.value, '');
  assert.equal(client.calls.length, 1, 'the refusal ends the read: no view is attempted');
});

test('a refused swarm.view prints nothing', async () => {
  const stdout = sink();
  const client = stubResident({
    list: [{ swarmId: SWARM_ID, status: 'open' }],
    views: { [SWARM_ID]: unavailable('the slice refused') },
  });
  assert.deepEqual(await runBatonStatusline({ client, stdout }), { printed: false });
  assert.equal(stdout.value, '');
});

test('a refused view is skipped while the readable swarms still derive the line', async () => {
  const readable = 'swarm-visual-readable';
  const stdout = sink();
  const client = stubResident({
    list: [{ swarmId: readable, status: 'open' }, { swarmId: SWARM_ID, status: 'open' }],
    views: {
      [readable]: { swarmId: readable, status: 'open', deployment: {}, attention: [] },
      [SWARM_ID]: unavailable('the slice refused'),
    },
  });
  assert.deepEqual(await runBatonStatusline({ client, stdout }), { printed: true });
  assert.equal(stdout.value, '✦(◕‿◕)✦ ● ready — nothing owed to the root\n');
});

test('no client, no swarms and an unknown command all print nothing without throwing', async () => {
  const stdout = sink();
  assert.deepEqual(await runBatonStatusline({ client: null, stdout }), { printed: false });
  assert.deepEqual(await runBatonStatusline({ client: stubResident(), stdout }), { printed: false });
  assert.deepEqual(await runBatonStatusline({ client: {}, stdout }), { printed: false });
  const unserved = { async command() { throw unavailable('unknown command'); } };
  assert.deepEqual(await runBatonStatusline({ client: unserved, stdout }), { printed: false });
  assert.equal(stdout.value, '');
});

test('the read is bounded by the family cap, whatever the resident lists', async () => {
  const rows = Array.from({ length: MAX_FAMILY_SWARMS + 8 }, (_, index) => ({ swarmId: `swarm-${index}` }));
  const client = stubResident({
    list: rows,
    views: Object.fromEntries(rows.map((row) => [row.swarmId, { swarmId: row.swarmId, attention: [] }])),
  });
  await runBatonStatusline({ client, stdout: sink() });
  assert.equal(client.calls.filter(([name]) => name === 'swarm.view').length, MAX_FAMILY_SWARMS);
});

// ── the another-checkout fallback ───────────────────────────────────────────────────────────────
//
// A session running outside the CLI's own checkout (a /tmp shell, a worktree of the same
// repository) has to read the resident serving the checkout `baton` was installed from. The
// resolver behind that is pinned here with a stub, so the retry is proved without a live profile.

test('the resolver retries once from this CLI\'s own checkout and answers its connection', () => {
  const connection = Object.freeze({ baseUrl: 'http://127.0.0.1:1/', origin: 'https://baton.local', repoId: 'repo-test', token: 'token' });
  const calls = [];
  const discover = (options) => {
    calls.push(options);
    if (options.cwd !== '/install/impl') throw Object.assign(new Error('no resident here'), { code: 'repository_unavailable' });
    return connection;
  };
  assert.equal(resolveStatuslineConnection({ discover, cliRoot: '/install/impl' }), connection);
  assert.deepEqual(calls, [{}, { cwd: '/install/impl' }], 'the caller\'s own directory first, the CLI checkout once after');
});

test('the resolver answers null — never an error — when neither root resolves a resident', () => {
  const calls = [];
  const discover = (options) => {
    calls.push(options);
    throw Object.assign(new Error('no resident'), { code: 'repository_unavailable' });
  };
  assert.equal(resolveStatuslineConnection({ discover, cliRoot: '/install/impl' }), null);
  assert.deepEqual(calls, [{}, { cwd: '/install/impl' }]);
  assert.equal(resolveStatuslineConnection({ discover: null }), null, 'no discovery to run');
  const answers = (options) => { calls.push(options); return { repoId: 'repo-here' }; };
  assert.deepEqual(resolveStatuslineConnection({ discover: answers, cliRoot: '/install/impl' }),
    { repoId: 'repo-here' });
  assert.deepEqual(calls.at(-1), {}, 'a resolvable caller directory needs no retry');
});

test('the CLI root the resolver falls back to is this repository\'s impl/ directory', () => {
  assert.equal(BATON_STATUSLINE_CLI_ROOT, resolve(fileURLToPath(new URL('..', import.meta.url))));
  assert.equal(BATON_STATUSLINE_CLI_ROOT, resolve(fileURLToPath(new URL('../scripts/..', import.meta.url))));
});

test('the attention projection carries the frame facts the line derives', () => {
  // The verb reads `swarm.view` under `attention`, and the runtime's own slicer is what answers
  // it: the attention rows ride the slice and the frame's own facts — swarmId, status, the
  // deployment block the served commit comes from — ride every projection.
  const view = {
    swarmId: SWARM_ID, purpose: 'Visual surfaces', status: 'open', cursor: 42,
    deployment: { served: { commit: SERVED_COMMIT, behind: 0 } },
    attention: [{ kind: 'root_wake_undelivered', owed: 'review_owed' }],
    participants: [{ participantId: 'visual-lead5' }],
  };
  const projected = projectSwarmView(view, 'attention');
  for (const key of FRAME_FACT_KEYS) assert.ok(key in projected, `${key} rides the attention slice`);
  assert.deepEqual(projected.attention, view.attention);
  assert.equal(projected.participants, undefined, 'the roster is not part of this read');
  assert.equal(projectStatusline({ swarms: [{ swarmId: SWARM_ID, frame: projected }] }).line,
    '✦(◕‿◕)✦ ▲ needs you — 1 owed to the root · 1 attention · served 67b16568 (+0)');
});
