// Issue #575 — the landing parse gate reads deletions as deletions.
//
// Found landing the wake union (#564/#572, priority work): the union retires a tracked test
// module, and the landing's parse gate ran `node --check` over the DELETED path — the missing
// file failed the check and every landing that deletes a module refused
// `integrate_change_invalid: the squashed change does not parse: …` with no defect in the lane.
//
// Pinned here:
//   (a) a lane whose whole change is deleting a tracked module lands — the target drops the
//       file, the publish remote advances, and the parse gate never reads the absent path;
//   (b) the gate keeps its teeth: a lane that ADDS a module which does not parse still refuses
//       `integrate_change_invalid`, naming the file.
//
// Hermetic: temp dirs, real git, no provider process, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = { actor: 'direct:issue575-root', principalId: 'issue575-root', sessionId: 'issue575-root' };
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(full, content);
}

/** The three regenerators the landing's default set runs inside the checkout; tracked on the
 * base commit exactly as this repository tracks its own. */
const REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

function regeneratorSource(artifact) {
  return "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), 'regenerated\\n');\n`;
}

/** A repository with a target branch, a lane branch whose whole change is the DELETION of one
 * tracked module, a recorded accepted contribution, and a runtime with the deployment's landing
 * authority (fixture gate runner, default regenerators). */
async function world(t, { laneKind = 'delete' } = {}) {
  const directory = rmLater(t);
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 575');
  git(repo, 'config', 'user.email', 'issue575@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  write(repo, 'impl/src/retired.module.mjs', 'export const retired = true;\n');
  for (const script of REGENERATORS) {
    const artifact = `${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`;
    write(repo, script, regeneratorSource(artifact));
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  if (laneKind === 'delete') {
    execFileSync('git', ['rm', '-q', 'impl/src/retired.module.mjs'], {
      cwd: repo, env: { ...process.env, ...QUIET_GIT_ENV },
    });
  } else {
    write(repo, 'impl/src/broken.module.mjs', 'export const broken = (=>;\n');
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `lane work (${laneKind})`);
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: {
      repoRoot: repo,
      publishRemote,
      runGates: async (dir, files) => ({ files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] }),
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the deletion lane', idempotencyKey: 'i575:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i575:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a',
    body: {
      subject: 'The lane retires its module',
      base: { observedHead, rebasedOnto: targetHead },
      commit: { sha: tip, branch: 'baton/lane-1' },
      items: [{
        id: 'retire-module', status: 'delivered', change: 'Retire the module',
        files: ['impl/src/retired.module.mjs'], test: 'node --test', evidence: 'suite green',
      }],
      verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
      carriedForward: [], needsFromOthers: [],
    },
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i575:integrate', ...args,
  }, principal);
  return { repo, runtime, integrate, publishRemote, tip };
}

const madeDirs = [];
function rmLater(t) {
  const directory = join(tmpdir(), `baton-issue575-parse-gate-${madeDirs.length + 1}-`);
  madeDirs.push(directory);
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  mkdirSync(directory, { recursive: true });
  return directory;
}

test('575-parse-a: a lane that deletes a module lands — the gate never parses the absent path', needsGit, async (t) => {
  const w = await world(t, { laneKind: 'delete' });
  const landing = await w.integrate();
  assert.ok(landing, 'the landing completes');
  let dropped = true;
  try { git(w.repo, 'cat-file', '-e', 'master:impl/src/retired.module.mjs'); dropped = false; } catch { /* gone: the deletion landed */ }
  assert.ok(dropped, 'the target ref drops the deleted module');
  const remoteHead = git(w.publishRemote, 'rev-parse', 'master');
  const localHead = git(w.repo, 'rev-parse', 'master');
  assert.equal(remoteHead, localHead, 'the landing publishes the landed ref to the shared remote');
});

test('575-parse-b: a module the lane adds that does not parse still refuses, named', needsGit, async (t) => {
  const w = await world(t, { laneKind: 'broken' });
  const error = await w.integrate().then(() => null, (thrown) => thrown);
  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_change_invalid', 'the parse gate keeps its teeth');
  assert.match(String(error.message), /broken\.module\.mjs/u, 'naming the file that does not parse');
});
