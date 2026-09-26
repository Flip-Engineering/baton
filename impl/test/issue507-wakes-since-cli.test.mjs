// Issue #507 — the deployment wake stream had no bounded read on the CLI. `wakesSince` existed on
// the CLI's own web client (the transport the MCP `baton_wakes_since` tool rides), but nothing bound
// it to a verb: `baton deployment watch` without `--follow` refused `cli_command_unavailable` with
// the message `a bounded read is baton_wakes_since over MCP` — a remedy the CLI itself could not
// reach, so an operator outside an MCP session had no cheap poll and silently missed wakes.
// The verb exists now:
//   baton deployment wakes-since [--since SEQ] [--wake-class CLASS,...]
//     [--swarm SWARM_ID,...] [--participant PARTICIPANT_ID,...]
// These rows drive it through the real CLI entry against a real resident over the owner-only
// socket, and pin the refusals the fix replaced:
//   507-a — the stream vocabulary parses into the bounded read, the closed argv and the
//           unknown-class refusal hold, and the two deployment refusals name this verb (pre-fix
//           they named only `baton deployment watch --follow` and the MCP tool).
//   507-b — one bounded page over the real transport: wake frames only, the cursor named for
//           continuation, fewer bytes than the same swarm's full view, and a resume from the
//           named cursor that repeats nothing.
//   507-c — the argv reaches discovery: the refusal is about the connection, never
//           `cli_command_unavailable` (the pre-fix answer to this exact argv).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openBaton, MockAdapter } from '../src/index.mjs';
import { CLI_TOP_LEVEL_VERBS, batonCliHelp, parseBatonCli } from '../src/application-cli.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'bt507-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue507@example.invalid', GIT_COMMITTER_EMAIL: 'issue507@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 507', GIT_COMMITTER_NAME: 'Issue 507' });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue 507 fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'issue507', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t) {
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'bt507-deployment-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'bt507-config-'));
  const home = mkdtempSync(join(tmpdir(), 'bt507-home-'));
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: { deploymentRoot, adapters: { codex: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] }, resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 } },
    env, home,
  };
}

/** `baton …`, exactly as an operator runs it: the real CLI entry in its own process, over this
 * checkout's scripts, in the fixture's repository with the fixture's environment. The spawn is
 * async because the resident this file hosts runs in THIS process — a blocking spawn would stop the
 * event loop that answers the child's own request. */
function runBaton(args, { repo, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: repo, env: { ...process.env, HOME: env.HOME ?? env.home, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const bound = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`baton ${args.join(' ')} did not exit; stderr=${stderr.slice(-4_096)}`));
    }, 120_000);
    child.once('error', (error) => { clearTimeout(bound); reject(error); });
    child.once('close', (code) => {
      clearTimeout(bound);
      if (code !== 0) {
        reject(new Error(`baton ${args.join(' ')} exited ${code}; stderr=${stderr.slice(-4_096)}`));
        return;
      }
      resolve(Object.freeze({ stdout, json: JSON.parse(stdout) }));
    });
  });
}

async function untilPaused(swarm) {
  for (;;) {
    const view = await swarm.view();
    if (view.participants[0]?.runtime?.turn === 'paused') return view;
    await swarm.watch({ timeoutMs: 100 });
  }
}

test('507-a: the verb parses the stream vocabulary, and the deployment refusals name it', () => {
  const parsed = parseBatonCli(['deployment', 'wakes-since', '--since', '7',
    '--wake-class', 'dead,contribution_recorded', '--swarm', 'swarm-a', '--participant', 'seat-a']);
  assert.equal(parsed.kind, 'wake_page');
  assert.equal(parsed.since, 7);
  assert.deepEqual(parsed.kinds, ['contribution_recorded', 'dead'], 'the class list is the closed set\'s own names');
  assert.deepEqual(parsed.swarms, ['swarm-a']);
  assert.deepEqual(parsed.participants, ['seat-a']);
  // The MCP parameter names and the issue's `--after` are the same axes.
  const alias = parseBatonCli(['deployment', 'wakes-since', '--kinds', 'dead', '--swarms', 'swarm-b',
    '--participants', 'seat-b', '--after', '9']);
  assert.equal(alias.since, 9);
  assert.deepEqual(alias.kinds, ['dead']);
  assert.deepEqual(alias.swarms, ['swarm-b']);
  assert.deepEqual(alias.participants, ['seat-b']);
  assert.equal(parseBatonCli(['deployment', 'wakes-since']).since, null, 'no cursor reads from the deployment head');

  // The closed argv (#431 shape) names the admitted flags, never eating a typo as a value.
  assert.throws(() => parseBatonCli(['deployment', 'wakes-since', '--kind', 'dead']),
    (error) => error.code === 'cli_invalid' && error.message.includes('--kind is not an admitted flag')
      && error.message.includes('--wake-class'), 'an unknown flag refuses naming the admitted set');
  // The stream's own filter parser is the one that judges the values.
  assert.throws(() => parseBatonCli(['deployment', 'wakes-since', '--wake-class', 'nope']),
    (error) => error.code === 'invalid_wake_filter' && error.message.includes('unknown wake class'));
  assert.throws(() => parseBatonCli(['deployment', 'wakes-since', '--since', '-1']),
    (error) => error.code === 'invalid_wake_filter');
  assert.throws(() => parseBatonCli(['deployment', 'wakes-since', '--since', '7', '--after', '8']),
    (error) => error.code === 'cli_invalid' && error.message.includes('one cursor'));

  // The remedy #507 reported: `deployment watch` without --follow pointed at MCP alone. It now
  // names the verb this CLI serves.
  assert.throws(() => parseBatonCli(['deployment', 'watch']), (error) => (
    error.code === 'cli_command_unavailable'
    && error.message.includes('baton deployment wakes-since')
    && !error.message.includes('over MCP')
  ), 'the bounded-read remedy is a CLI verb');
  assert.throws(() => parseBatonCli(['deployment', 'bogus']), (error) => (
    error.code === 'cli_command_unavailable' && error.message.includes('wakes-since')
  ), 'the wrong-verb refusal names the bounded read too');

  // The taught side: `baton --help`'s deployment row and the deployment help topic both carry it.
  const row = CLI_TOP_LEVEL_VERBS.find((entry) => entry.token === 'deployment');
  assert.match(row.verb, /wakes-since/u, 'the top-level listing (baton --help) names the verb');
  assert.match(row.summary, /wakes-since/u);
  const help = batonCliHelp('deployment.watch');
  assert.match(help, /baton deployment wakes-since \[--since SEQ\]/u, 'the deployment help teaches the usage line');
  assert.match(help, /continuationCursor/u, 'the help names the field the caller resumes from');
  assert.match(batonCliHelp('deployment'), /baton deployment wakes-since \[--since SEQ\]/u,
    'the family topic an operator types (baton help deployment) teaches the bounded read too');
});

test('507-b: one bounded page of wake frames over the real socket, cheaper than the swarm view', { timeout: 240_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* the fixture's own teardown */ } });
  await owner.host();
  const swarm = await owner.swarms.create('Bounded wake poll (#507)');
  // The cursor is taken before the recruit, so the page carries the rows the recruit and the
  // seat's first turn wrote.
  const before = await swarm.view();
  await swarm.recruit('worker', 'Stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });
  await untilPaused(swarm);
  /** One `baton …` read through the fixture resident. */
  const read = async (args) => (await runBaton(args, { repo, env: configured.env })).json;

  const page = await read(['deployment', 'wakes-since', '--since', String(before.cursor)]);
  assert.equal(page.kind, 'baton.wake_page', 'the answer is the stream\'s own bounded page kind');
  assert.equal(page.schemaVersion, 1);
  assert.ok(Array.isArray(page.frames) && page.frames.length > 0, 'the page carries the rows after the cursor');
  for (const frame of page.frames) {
    assert.equal(frame.kind, 'baton.wake', 'every row is a wake frame');
    assert.ok(Number.isSafeInteger(frame.seq) && frame.seq > before.cursor, 'a frame is after the cursor');
    assert.ok(typeof frame.wakeClass === 'string' && frame.wakeClass.length > 0, 'a frame names its wake class');
  }
  const paused = page.frames.find((frame) => frame.wakeClass === 'paused');
  assert.ok(paused, 'the page carries the class the seat\'s turn pause wrote');
  assert.equal(paused.participantId, 'worker', 'the frame names the participant the wake is about');
  assert.ok(Number.isSafeInteger(page.cursor) && page.cursor >= before.cursor, 'the page names the deployment cursor');
  assert.equal(page.continuationCursor, String(page.cursor), 'the continuation cursor is the page cursor');
  // The page is a page of frames: no participant, admission or deployment detail rides it.
  assert.deepEqual(Object.keys(page).sort(),
    ['continuationCursor', 'cursor', 'frames', 'kind', 'lagged', 'schemaVersion', 'swarms']);

  // The contrast the cheap poll exists for: the same deployment's full swarm view is larger and
  // carries the families this page has none of.
  const view = await read(['swarm', 'view', swarm.id]);
  assert.ok(Array.isArray(view.participants) && view.participants.length > 0, 'the swarm view carries the roster');
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < Buffer.byteLength(JSON.stringify(view)),
    `the wake page (${Buffer.byteLength(JSON.stringify(page))} B) is fewer bytes than the swarm view (${Buffer.byteLength(JSON.stringify(view))} B)`);

  // Resume from the named cursor: no gap, no duplicate.
  const rest = await read(['deployment', 'wakes-since', '--since', page.continuationCursor]);
  const delivered = new Set(page.frames.map((frame) => frame.seq));
  for (const frame of rest.frames) {
    assert.ok(frame.seq > page.cursor, 'a resumed page carries only rows after the cursor it named');
    assert.equal(delivered.has(frame.seq), false, 'a resumed page repeats nothing');
  }

  // The filter reaches the resident: the class axis selects, and an axis the deployment never
  // wrote answers an empty page rather than every row.
  const filtered = await read(['deployment', 'wakes-since', '--since', '0', '--wake-class', 'paused',
    '--participant', 'worker']);
  assert.ok(filtered.frames.length > 0, 'the class filter admits the pause row');
  for (const frame of filtered.frames) {
    assert.equal(frame.wakeClass, 'paused');
    assert.equal(frame.participantId, 'worker');
  }
  const empty = await read(['deployment', 'wakes-since', '--since', '0', '--wake-class', 'closed']);
  assert.deepEqual(empty.frames, [], 'a class this deployment never wrote answers no frames');
});

test('507-c: the argv reaches discovery — never the pre-fix unavailable-verb refusal', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'bt507-home-'));
  const checkout = mkdtempSync(join(tmpdir(), 'bt507-outside-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [SCRIPT, 'deployment', 'wakes-since', '--since', '0'], {
    cwd: checkout, env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    encoding: 'utf8', timeout: 60_000,
  });
  assert.notEqual(child.status, 0, 'there is no resident to read');
  assert.doesNotMatch(`${child.stderr}`, /cli_command_unavailable/u,
    'the verb is admitted: pre-fix this argv refused `deployment requires the watch or reincarnate verb`');
  assert.match(`${child.stderr}`, /baton: cli_config_invalid:/u, 'the refusal is about the connection');
});
