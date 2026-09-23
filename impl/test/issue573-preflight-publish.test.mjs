// Issue #573 — a landing learned that it cannot publish only AFTER the whole derived gate run:
// the push is the last step, so an environment that holds no credential for the declared remote
// (the hermetic landing git environment reads no global git config, so an HTTPS declaration fails
// with `fatal: could not read Username`) spent the entire gate run and then reported only the git
// tail. The fix: a cheap pre-flight of the declared remote BEFORE the gate run — one `git
// ls-remote` in the same hermetic environment the push will use — that refuses typed and
// immediately, naming which of the two failed: the destination does not exist or cannot be
// reached (`integrate_publish_unreachable`), or this environment cannot authenticate to it
// (`integrate_publish_unauthenticated`).
//
// Every row below runs on a REAL temporary repository with a REAL lane branch, following the
// issue558 fixture conventions, and pins the two pre-flight refusals:
//
//   (a) a declared remote whose destination does not exist refuses `integrate_publish_unreachable`
//       before any gate file runs;
//   (b) a declared remote that answers but cannot authenticate this environment refuses
//       `integrate_publish_unauthenticated` before any gate file runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

/**
 * The read-authorized/write-refused remote, hosted in a CHILD process (the landing's git steps run
 * synchronously on this process, so a server sharing its event loop could never answer): fetch is
 * served by the REAL `git upload-pack --stateless-rpc` against a real bare repository, while every
 * receive-pack request is answered 401. A remote like this is the half an ls-remote pre-flight
 * cannot catch: reads fully succeed, and only the push learns the environment holds no credential.
 */
const writeDeniedServer = (bare) => spawn(process.execPath, ['-e', [
  'const { createServer } = require(\'node:http\');',
  'const { spawnSync } = require(\'node:child_process\');',
  `const bare = ${JSON.stringify(bare)};`,
  'const server = createServer((request, response) => {',
  '  const url = request.url ?? \'\';',
  '  const chunks = [];',
  '  request.on(\'data\', (chunk) => chunks.push(chunk));',
  '  request.on(\'end\', () => {',
  '    if (url.includes(\'service=git-upload-pack\') || url.endsWith(\'/git-upload-pack\')) {',
  '      const advertise = url.includes(\'service=\');',
  '      const run = spawnSync(\'git\', [\'upload-pack\', \'--stateless-rpc\', ...(advertise ? [\'--advertise-refs\'] : []), bare],',
  '        { input: Buffer.concat(chunks), maxBuffer: 8 * 1024 * 1024 });',
  '      if (!advertise) {',
  '        response.writeHead(200, { \'Content-Type\': \'application/x-git-upload-pack-result\' });',
  '        response.end(run.stdout);',
  '        return;',
  '      }',
  '      response.writeHead(200, { \'Content-Type\': \'application/x-git-upload-pack-advertisement\' });',
  '      response.write(\'001e# service=git-upload-pack\\n\');',
  '      response.write(\'0000\');',
  '      response.end(run.stdout);',
  '      return;',
  '    }',
  '    response.statusCode = 401;',
  '    response.setHeader(\'WWW-Authenticate\', \'Basic realm="baton issue573 push"\');',
  '    response.end(\'401 Unauthorized\\n\');',
  '  });',
  '});',
  'server.listen(0, \'127.0.0.1\', () => process.stdout.write(String(server.address().port)));',
].join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] });

const principal = { actor: 'direct:issue573-root', principalId: 'issue573-root', sessionId: 'issue573-root' };
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
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const contractBody = ({ subject, items, sha, branch, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch },
  items,
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

const ITEMS = [
  { id: 'publish-preflight', status: 'delivered', change: 'Preflight the declared remote before the gate run', files: ['impl/src/worktree.mjs'], test: 'node --test test/issue573-preflight-publish.test.mjs', evidence: 'suite green' },
];

/**
 * A real repository with a target branch and a lane branch, an accepted contribution naming the
 * lane tip, and a declared shared remote that cannot publish: `unreachable` names a destination
 * that does not exist, `unauthenticated` points at a local HTTP server that answers 401 to every
 * request (the landing's git environment reads no credential store and is not allowed to prompt).
 * The fixture's gate callback counts its invocations, so a row can assert the derived gate run
 * never started.
 */
async function world(t, { mode }) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue573-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 573');
  git(repo, 'config', 'user.email', 'issue573@example.invalid');
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/worktree.mjs', '// lane change\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#573)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  let publishRemote;
  let httpServer = null;
  if (mode === 'unreachable') {
    publishRemote = join(directory, 'no-such-directory', 'shared.git');
  } else if (mode === 'unauthenticated' || mode === 'read-authorized-write-denied') {
    // Fixture servers live in CHILD processes: the landing's git steps run synchronously on this
    // process, and a server sharing its event loop could never answer a request issued from the
    // same blocked loop.
    let child;
    if (mode === 'unauthenticated') {
      child = spawn(process.execPath, ['-e', [
        'const { createServer } = require(\'node:http\');',
        'const server = createServer((request, response) => {',
        '  response.statusCode = 401;',
        '  response.setHeader(\'WWW-Authenticate\', \'Basic realm="baton issue573"\');',
        '  response.end(\'401 Unauthorized\\n\');',
        '});',
        'server.listen(0, \'127.0.0.1\', () => process.stdout.write(String(server.address().port)));',
      ].join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] });
    } else {
      // Reads must FULLY succeed, so the fixture first publishes the target to a real bare
      // repository the child's upload-pack serves.
      const bare = join(directory, 'readable.git');
      execFileSync('git', ['init', '-q', '--bare', bare], { env: { ...process.env, ...QUIET_GIT_ENV } });
      git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/master');
      git(repo, 'push', '-q', bare, 'master:master');
      child = writeDeniedServer(bare);
    }
    const port = await new Promise((resolve, reject) => {
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        if (/^\d+$/u.test(buffer.trim())) resolve(Number(buffer.trim()));
      });
      child.on('exit', (code) => reject(new Error(`the fixture server exited early: ${code}`)));
      const timer = setTimeout(() => reject(new Error('the fixture server printed no port')), 5_000);
      timer.unref();
    });
    publishRemote = `http://127.0.0.1:${port}/baton-issue573.git`;
    t.after(() => { child.kill(); });
  } else {
    throw new Error(`unknown fixture mode ${mode}`);
  }

  const store = new CoordinationStore(join(directory, 'ledger'));
  let gateRuns = 0;
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
      regenerate: async () => {},
      runGates: async (dir, files) => {
        gateRuns += 1;
        return { files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] };
      },
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'preflight the publish remote', idempotencyKey: 'i573:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i573:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'preflight the publish remote' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'Preflight the declared remote before the gate run', items: ITEMS, sha: tip, branch: 'baton/lane-1',
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i573:integrate', ...args,
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  return { directory, repo, store, runtime, integrate, foldRow, gateRuns: () => gateRuns, tip, targetHead, observedHead };
}

// ── (a) the declared remote's destination does not exist ─────────────────────────────────────

test('573a: a landing whose declared remote does not exist refuses before any gate file runs', needsGit, async (t) => {
  const w = await world(t, { mode: 'unreachable' });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of spending the gate run on a remote it cannot reach');
  assert.equal(error.code, 'integrate_publish_unreachable');
  assert.equal(error.detail.script, 'git push --dry-run', 'the refusal names the pre-flight step that failed');
  assert.equal(w.gateRuns(), 0, 'the derived gate run never started');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});

// ── (b) the declared remote cannot authenticate this environment ─────────────────────────────

test('573b: a landing whose declared remote cannot authenticate refuses before any gate file runs', needsGit, async (t) => {
  const w = await world(t, { mode: 'unauthenticated' });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of spending the gate run on a remote it cannot authenticate to');
  assert.equal(error.code, 'integrate_publish_unauthenticated');
  assert.equal(error.detail.script, 'git push --dry-run', 'the refusal names the pre-flight step that failed');
  assert.equal(w.gateRuns(), 0, 'the derived gate run never started');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});

// ── (c) reads succeed and the push is what the remote refuses ────────────────────────────────

test('573c: a remote that serves reads but refuses the push refuses the landing before any gate file runs', needsGit, async (t) => {
  const w = await world(t, { mode: 'read-authorized-write-denied' });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of spending the gate run on a remote it cannot push to');
  assert.equal(error.code, 'integrate_publish_unauthenticated');
  assert.equal(w.gateRuns(), 0, 'the derived gate run never started');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});
