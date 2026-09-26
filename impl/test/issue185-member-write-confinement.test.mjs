// Issue #185 (observed 2026-08-13) — "member writes can escape the worktree into the operator's
// main checkout": two wave members wrote their declared deliverable to a repo-relative path and the
// content appeared in the operator's MAIN working tree, captured by a later base commit. The
// recorded suspicion was a member whose harness cwd (or absolute-path resolution) pointed at the
// main checkout, with the write-scope machinery governing only baton-surface operations.
//
// Re-run 2026-09-26 on master f3f4c859 through this same path: a member's repo-relative deliverable
// lands inside its own worktree and the operator's main checkout is untouched. The contract this
// file pins, through the REAL dispatch path (coordinator -> adapter spawn -> worktree readiness)
// against a REAL temporary repository:
//   I1 the member's harness process runs with its cwd inside its OWN worktree;
//   I2 its repo-relative deliverable lands in that worktree;
//   I3 the operator's main checkout stays untouched — the member's file never appears there, and
//      the checkout carries no modification it did not make.
//
// A regression of the worktree readiness (a member spawned in the orchestrator's cwd) turns I1 and
// I3 red: the deliverable would land in the main checkout, which is exactly #185's shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import { createDriver } from '../src/index.mjs';
import { createBrief } from '../src/messages.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const DELIVERABLE = 'member-deliverable.md';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** A real repository whose root is the "operator's main checkout" this test watches. */
function realRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'i185-repo-'));
  git(['init', '-q'], repoRoot);
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Baton i185 pin', GIT_COMMITTER_NAME: 'Baton i185 pin',
    GIT_AUTHOR_EMAIL: 'i185-pin@example.invalid', GIT_COMMITTER_EMAIL: 'i185-pin@example.invalid',
  });
  writeFileSync(join(repoRoot, 'README.md'), 'i185 confinement fixture\n');
  git(['add', '-A'], repoRoot);
  git(['commit', '-qm', 'fixture'], repoRoot);
  return repoRoot;
}

async function waitForMemberWrite(log, workerId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // The harness's result text is the turn summary (`emitResult` -> lifecycle.turn_completed);
    // the assistant echo rides a content.message and carries no cwd.
    const hit = log.read(workerId)
      .find((e) => e.kind === 'lifecycle.turn_completed' && String(e.payload?.summary ?? '').startsWith('wrote:'));
    if (hit) return hit.payload.summary;
    if (Date.now() >= deadline) {
      const kinds = log.read(workerId).map((e) => `${e.kind}(${e.actor})`).join(',');
      assert.fail(`member ${workerId} never reported its write within ${timeoutMs}ms; logged kinds: ${kinds}`);
    }
    await sleep(25);
  }
}

test('185: a member\'s repo-relative deliverable lands in its worktree, never the operator\'s main checkout', async () => {
  const repoRoot = realRepo();
  const logDir = mkdtempSync(join(tmpdir(), 'i185-log-'));
  const { coordinator, log } = createDriver({
    repoRoot,
    logDir,
    adapters: { claude: new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] }) },
    stopDeadlineMs: 3000,
  });
  const brief = createBrief({
    goal: `WRITE_RELATIVE:${DELIVERABLE} — write your declared deliverable, then wrap up.`,
    constraints: [`Write the deliverable to its repo-relative path: ${DELIVERABLE}`],
    pathScope: ['**'],
    definitionOfDone: 'the declared deliverable is written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  });
  const handle = await coordinator.spawn('claude', brief);
  try {
    const wrote = await waitForMemberWrite(log, handle.id);
    const row = coordinator.list().find((w) => w.id === handle.id);
    const worktree = row?.worktree ?? null;
    assert.ok(worktree, 'dispatch must record the member worktree');

    // I1 — the child's OWN view of its cwd is the worktree it was dispatched into, inside the
    // main checkout but never equal to it.
    assert.equal(wrote, `wrote:${DELIVERABLE} cwd:${worktree}`,
      'the member process must run with its cwd inside its own worktree');

    // I2 — the deliverable it wrote at the repo-relative path is in that worktree.
    const inWorktree = join(worktree, DELIVERABLE);
    assert.equal(existsSync(inWorktree), true,
      `the member's repo-relative deliverable must land in its worktree (${worktree})`);
    assert.match(readFileSync(inWorktree, 'utf8'), /member deliverable written from/u);

    // I3 — the operator's main checkout is untouched: the file is not there, and its working tree
    // is clean. This is the exact #185 escape.
    assert.equal(existsSync(join(repoRoot, DELIVERABLE)), false,
      'the member\'s deliverable must never appear in the operator\'s main checkout');
    const status = git(['status', '--porcelain'], repoRoot);
    assert.equal(status, '', `the operator's main checkout must stay untouched (git status said: ${JSON.stringify(status)})`);

    // The worktree is a real checkout of the same repository, and it is the member's own.
    const escaped = relative(repoRoot, worktree);
    assert.equal(isAbsolute(escaped) || escaped === '..' || escaped.startsWith(`..${sep}`), false,
      `the member worktree must live under the main checkout, not outside it (got ${worktree})`);
    assert.equal(git(['rev-parse', '--show-toplevel'], worktree), worktree,
      'the member\'s own git view resolves to its worktree, so relative paths it derives stay there');
  } finally {
    await Promise.resolve(coordinator.kill(handle.id)).catch(() => {});
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
});
