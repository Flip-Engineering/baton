// Issue #451 — `swarm.integrate` refused EVERY accepted contribution on a repository whose install
// lives under a sub-directory. The integration checkout links its dependencies from the repository
// ROOT (`join(realpathSync(repoRoot), 'node_modules')`), and this repository's install is
// `impl/node_modules` — root `node_modules` does not exist — so nothing was linked and the first
// regenerator died `ERR_MODULE_NOT_FOUND`. The refusal then dropped the cause entirely
// (`detail: {}`), so the operator had to reproduce the landing by hand to learn what broke.
//
// Every row below runs on a REAL temporary repository with a REAL lane branch, an accepted
// contribution, and an install that lives under a sub-directory (never the root):
//
//   (a) the integration checkout links the install the repository actually carries (derived from
//       where `package.json` + `node_modules` sit, never a hard-coded name) and the landing's own
//       regenerators — scripts that import a package out of that install — run inside it;
//   (b) a regenerator that dies refuses `integrate_change_invalid` carrying `{script, exit,
//       stderrTail}`, bounded and redacted the #326 way (the tail keeps the LAST words, a
//       credential-shaped value never crosses, and the raw head of an oversized stream is gone);
//   (c) ONE derivation: the lane worktree and the integration checkout resolve the same dependency
//       directories from the same function, and an explicitly configured set still wins;
//   (d) the CLI renders the tail under the refusal line (#265/doc39) instead of a bare cause.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { MAX_STDERR_TAIL_BYTES } from '../src/cli-adapters.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';

// The one derivation the fix introduces is read through a dynamic import: at HEAD the export does
// not exist, and a static named import would fail the whole FILE to link — every row must report
// its own red assertion instead.
const worktree = await import('../src/worktree.mjs');

const principal = { actor: 'direct:issue451-root', principalId: 'issue451-root', sessionId: 'issue451-root' };
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

/** The three scripts a landing regenerates with (`INTEGRATION_REGENERATORS`). They are TRACKED on
 * the base commit, so the integration checkout checks them out; each one imports a package that
 * only the repository's own install carries — resolution is the whole point of the row. */
const REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);
const DEPENDENCY_PACKAGE = 'fixture-dep';

function installDependencies(repo, relative) {
  write(repo, join(relative, 'node_modules', DEPENDENCY_PACKAGE, 'package.json'), `${JSON.stringify({
    name: DEPENDENCY_PACKAGE, version: '1.0.0', type: 'module', exports: './index.js',
  })}\n`);
  write(repo, join(relative, 'node_modules', DEPENDENCY_PACKAGE, 'index.js'),
    'export const fixtureMarker = "installed-dependency-reachable";\n');
  write(repo, join(relative, 'package.json'), `${JSON.stringify({ name: 'fixture-app', private: true })}\n`);
}

/** A regenerator that imports out of the install and writes its artifact inside the checkout. */
function regeneratorSource(artifact) {
  return `import { fixtureMarker } from '${DEPENDENCY_PACKAGE}';\n`
    + "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), fixtureMarker + '\\n');\n`;
}

const EARLY_MARKER = 'early-head-of-the-stream';
const FINAL_MARKER = 'final-marker-last-words';
const CREDENTIAL_SHAPED = `ghp_${'A'.repeat(30)}`;

/** A regenerator that dies the way a broken landing step does: a long stderr (whose head must be
 * dropped by the bound), a credential-shaped value (which must be redacted), and last words. */
function failingRegeneratorSource() {
  return "import { writeSync } from 'node:fs';\n"
    + `writeSync(2, '${EARLY_MARKER}\\n' + 'x'.repeat(${3 * MAX_STDERR_TAIL_BYTES}) + '\\n');\n`
    + `writeSync(2, '${CREDENTIAL_SHAPED}\\n${FINAL_MARKER}\\n');\n`
    + 'process.exit(3);\n';
}

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'dependency-link', status: 'delivered', change: 'Link the install the repository carries',
    files: ['impl/src/lane.mjs'], test: 'node --test test/issue451-integrate-dependency-link.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A real repository whose install lives at `<installAt>/node_modules` — never the root — with a
 * target branch, a lane branch carrying one commit, a recorded accepted contribution, and a live
 * `SwarmRuntime` whose landing authority is the deployment's own shape (`{repoRoot,
 * publishRemote}`, so the runtime exercises its DEFAULT regenerators; the gate runner is the
 * fixture's).
 */
async function world(t, { installAt = 'impl', regenerator = 'ok', accepted = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue451-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 451');
  git(repo, 'config', 'user.email', 'issue451@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    const artifact = `${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`;
    write(repo, script, regenerator === 'failing' && script === REGENERATORS[0]
      ? failingRegeneratorSource() : regeneratorSource(artifact));
  }
  // The manifest is TRACKED on the base branch; the install it describes is untracked working-tree
  // content (a real `npm ci` under a `.gitignore`d `node_modules`), exactly like this repository.
  installDependencies(repo, installAt);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');


  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/lane.mjs', 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work (#451)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  // Issue #558: the deployment's declared shared remote — a bare repository this landing
  // publishes the landed ref to after the fast-forward.
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
    // The deployment's landing authority, minus the fixture's gate runner: `regenerate` is left
    // UNSET so the runtime's own default regenerators (the three `impl/scripts` writers above) run
    // inside the checkout — the exact step that died ERR_MODULE_NOT_FOUND in the issue.
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

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane (#451)', idempotencyKey: 'i451:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i451:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'Lane lands with the install it was built against', sha: tip,
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  if (accepted) {
    record('swarm.contribution_reviewed',
      { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
      'accept');
  }

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i451:integrate', ...args,
  }, principal);
  return { directory, repo, store, runtime, integrate, tip, targetHead, observedHead, installAt };
}

// ── (a) the install under a sub-directory is linked, and the regenerators run ────────────────────

test('451a: an install under a sub-directory is linked and the landing regenerators run in it', needsGit, async (t) => {
  const w = await world(t, { installAt: 'impl' });
  const install = join(w.repo, 'impl', 'node_modules');

  // The link the checkout must carry, named exactly as the repository spells it.
  const checkout = await worktree.createIntegrationCheckout(w.repo, 'contribution:1', {});
  try {
    assert.deepEqual(checkout.dependencyLinks.map((entry) => entry.name), ['impl/node_modules'],
      'the integration checkout links the install where it actually sits, never a guessed name');
    const linked = join(checkout.dir, 'impl', 'node_modules');
    assert.ok(existsSync(linked), 'the link exists inside the checkout');
    assert.ok(lstatSync(linked).isSymbolicLink(), 'a link, never a copy (the #296 landing rule)');
    // The regenerator step, run by hand in the checkout: the import that died in the issue.
    execFileSync(process.execPath, ['impl/scripts/seam-inventory.mjs', '--write'], { cwd: checkout.dir, stdio: 'pipe' });
    assert.equal(readFileSync(join(checkout.dir, 'impl/data/seam-inventory.json'), 'utf8').trim(),
      'installed-dependency-reachable', 'the regenerator resolved its package out of the linked install');
    assert.doesNotMatch(git(checkout.dir, 'status', '--porcelain'), /node_modules/u,
      'the link is not repository content: the checkout\'s own status never names it');
  } finally {
    await checkout.cleanup();
  }
  assert.ok(existsSync(install), 'the repository install is untouched by the link');

  const answer = await w.integrate();
  assert.deepEqual(answer.integration.regenerated.sort(), [
    'impl/data/render-surface-docs.json', 'impl/data/seam-inventory.json', 'impl/data/surface-gate.json',
  ], 'all three landing regenerators ran inside the squash and their artifacts are folded into it');
  assert.doesNotMatch(git(w.repo, 'show', '--name-only', '--format=', 'master'), /node_modules/u,
    'the linked install never lands: the squash carries the lane\'s work and nothing else');
  assert.equal(git(w.repo, 'show', '--format=', 'master:impl/src/lane.mjs'), 'export const lane = 1;',
    'the lane work landed in ONE squashed commit');
});

// ── (b) the refusal carries the cause ───────────────────────────────────────────────────────────

test('451b: a failing regenerator refuses typed with script, exit and a bounded redacted tail', needsGit, async (t) => {
  const w = await world(t, { installAt: 'impl', regenerator: 'failing' });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_change_invalid');
  assert.equal(error.detail.script, 'impl/scripts/seam-inventory.mjs', 'the failing script is named');
  assert.equal(error.detail.exit, 3, 'its exit status is named');
  assert.equal(typeof error.detail.stderrTail, 'string', 'the tail is carried');

  const tail = error.detail.stderrTail;
  assert.match(tail, new RegExp(FINAL_MARKER, 'u'), 'the tail keeps the stream\'s LAST words');
  assert.doesNotMatch(tail, new RegExp(EARLY_MARKER, 'u'),
    'the head of an oversized stream is dropped — the tail is bounded, never the whole capture');
  assert.doesNotMatch(tail, new RegExp(CREDENTIAL_SHAPED, 'u'),
    'a credential-shaped value never crosses (#299/#326 redaction)');
  assert.match(tail, /credential-shaped content redacted/u, 'the redaction is the one vocabulary');
  assert.ok(Buffer.byteLength(tail, 'utf8') <= MAX_STDERR_TAIL_BYTES,
    'the bound is the adapter\'s own (#326), never a second truncation rule');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'a refused landing leaves the target alone');
});

// ── (c) one derivation, shared with the lane worktree ───────────────────────────────────────────

test('451c: the lane worktree and the integration checkout derive the same dependency dirs', needsGit, async (t) => {
  const w = await world(t, { installAt: 'packages/worker' });
  assert.equal(typeof worktree.deriveDependencyDirs, 'function',
    'the ONE derivation is exported by the worktree authority');

  const derived = worktree.deriveDependencyDirs(w.repo);
  assert.deepEqual(derived, ['packages/worker/node_modules'],
    'derived from where the install actually sits, never a hard-coded name');

  // The lane worktree consumed the SAME derivation (the deployment threads this value through).
  const lane = await worktree.createFromBase(w.repo, 'lane-alpha', git(w.repo, 'rev-parse', 'master'), {
    dependencyDirs: derived,
  });
  assert.deepEqual(lane.copiedDependencies, derived, 'the lane worktree carries the same dirs');
  assert.ok(existsSync(join(lane.dir, 'packages/worker/node_modules', DEPENDENCY_PACKAGE, 'index.js')),
    'the lane worktree can resolve the install');

  // The integration checkout takes no configuration at all and must answer the same list.
  const checkout = await worktree.createIntegrationCheckout(w.repo, 'contribution:one', {});
  assert.deepEqual(checkout.dependencyLinks.map((entry) => entry.name), derived,
    'one function, one answer: the integration checkout links what the derivation names');

  // A deployment that DOES configure the dirs keeps them: the configured value is the one used.
  const configured = await worktree.createIntegrationCheckout(w.repo, 'contribution:two', {
    dependencyDirs: ['packages/worker/node_modules'],
  });
  assert.deepEqual(configured.dependencyLinks.map((entry) => entry.name), derived);

  // A repository with no install at all links nothing — absence, never a guess.
  const empty = mkdtempSync(join(tmpdir(), 'baton-issue451-empty-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'master', empty], { env: { ...process.env, ...QUIET_GIT_ENV } });
    write(empty, 'README.md', 'nothing installed\n');
    git(empty, 'add', '-A');
    git(empty, 'commit', '-qm', 'base');
    assert.deepEqual(worktree.deriveDependencyDirs(empty), []);
    const bare = await worktree.createIntegrationCheckout(empty, 'contribution:three', {});
    assert.deepEqual(bare.dependencyLinks, []);
  } finally {
    await checkout.cleanup?.();
    await configured.cleanup();
    await worktree.reap(w.repo, 'lane-alpha').catch(() => {});
    rmSync(empty, { recursive: true, force: true });
  }
});

// ── (d) the CLI renders the tail under the refusal line ─────────────────────────────────────────

test('451d: the CLI prints the refusal tail under the refusal line', () => {
  const wires = [
    // The wire shape the CLI receives from the resident: the runtime's detail rides nested.
    { code: 'integrate_change_invalid', message: 'Landing did not complete: impl/scripts/seam-inventory.mjs --write failed in the landing checkout',
      detail: { script: 'impl/scripts/seam-inventory.mjs', exit: 3, stderrTail: `boom\n${FINAL_MARKER}` }, retryable: false },
    // The embedded shape: the refusal's own detail, unwrapped.
    { code: 'integrate_change_invalid', message: 'Landing did not complete: impl/scripts/seam-inventory.mjs --write failed in the landing checkout',
      script: 'impl/scripts/seam-inventory.mjs', exit: 3, stderrTail: `boom\n${FINAL_MARKER}` },
  ];
  const parsed = parseBatonCli([
    'swarm', 'integrate', 's1', 'contribution:1', '--onto', 'master', '--idempotency-key', 'i451:cli',
  ]);
  assert.equal(parsed.name, 'swarm.integrate');

  return Promise.all(wires.map(async (wire) => {
    const refusal = Object.assign(new Error(`Baton Web request was refused (POST /v1/commands, HTTP 400): ${wire.message}`), {
      code: wire.code, detail: wire,
    });
    const client = { command: async () => { throw refusal; } };
    const error = await runBatonCli(parsed, client).then(() => null, (thrown) => thrown);
    assert.ok(error, 'the refusal still propagates');
    assert.ok(error.message.includes('--write failed in the landing checkout'), 'the refusal line survives');
    assert.match(error.message, /impl\/scripts\/seam-inventory\.mjs exited 3/u, 'the cause is named under it');
    assert.ok(error.message.includes(FINAL_MARKER), 'and the tail is printed');
    assert.ok(error.message.indexOf(FINAL_MARKER) > error.message.indexOf('--write failed in the landing checkout'),
      'the tail renders UNDER the refusal line');
  }));
});
