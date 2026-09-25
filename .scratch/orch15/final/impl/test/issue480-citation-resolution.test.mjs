// Issue #480 — a cited doc that IS in the deployment's checkout is not refused, and a citation
// the checkout genuinely does not carry is a NAMED GAP instead of a refused recruit.
//
// The incident: `baton swarm recruit … --issue 273` refused
// `context_doc_unreadable: context doc docs/audits/…/root.md is outside this checkout or
// unreadable` for a document that IS tracked and present in both checkouts. Every CLI call in that
// loop ran from `<repo>/impl`, and the #441 reading leg resolved each citation against the process
// cwd — so a repository-relative `docs/…` citation resolved to `impl/docs/…`. The correction
// comment on the issue confirmed the premise: a RESOLUTION defect, not a missing file. Its second
// half stands for a citation that really is absent: the seat must read about the gap while the
// recruit is admitted, and only a leg with no readable member at all may refuse (naming the
// remedy).
//
// The rows run the CLI's OWN parser and runner in a CHILD process — the one way to give it a real
// cwd, which is the axis the defect lived on — against the real stack (CoordinationStore behind
// WebNorthbound over the deployment's Context CAS, SwarmRuntime, BatonWebClient), with the issue
// reader injected (the host `gh` is not authenticated here) and `contextRepoRoot` NOT injected, so
// the production derivation is what these rows exercise. The fixture checkout carries the doc at
// its ROOT and a decoy of the same path under `impl/`, so a row can tell "resolved against the
// checkout" from "resolved against the cwd" without reading the code.
//
// Rows:
//   480-a  a recruit issued from a subdirectory of the checkout, from a nested directory, and from
//          a LINKED worktree of it, admits: the cited doc resolves against the deployment's
//          checkout root and the package carries the checkout's bytes, never a decoy at the cwd;
//   480-b  one citation the checkout does not carry → the recruit is ADMITTED, the receipt names
//          the gap (`docs: [{path, state: 'unreadable', reason}]`) and the brief renders it beside
//          the issue and the readable doc;
//   480-c  no readable member at all → the typed refusal, naming the remedy; no package is
//          admitted and no seat joins.
//
// Every await a row takes is BOUNDED and NAMED (#460, docs/42 §8): the bound is the registry's own
// probe deadline and a bound miss carries `fixture_wait_unsettled`, so a hung child can never read
// as a deployment refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

const DRIVER = fileURLToPath(new URL('./issue480-citation-driver.mjs', import.meta.url));
const WAIT_BOUND_MS = FRAME_LIMITS['route.probe_deadline_ms'].value;
const WAIT_UNSETTLED = 'fixture_wait_unsettled';

const PRESENT_DOC = 'docs/480-in-the-checkout.md';
const ABSENT_DOC = 'docs/480-never-committed.md';
// The markers: the checkout root's bytes are the ones a package must carry; the decoys sit at the
// paths the OLD resolution (the process cwd, or a lane worktree) would have found instead.
const CHECKOUT_MARK = 'MARK-CHECKOUT-ROOT-DOCUMENT';
const CWD_DECOY_MARK = 'MARK-DECOY-AT-THE-CLI-CWD';
const WORKTREE_DECOY_MARK = 'MARK-DECOY-IN-THE-LINKED-WORKTREE';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue480-${label}-`));
  roots.push(root);
  return root;
}

function writeDoc(root, relativePath, mark) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, `# ${mark}\n\n${mark}\n`);
}

/** The parent's OWN bound for a one-shot git call: the same declared number the rows use, so no
 * fixture here invents a second timeout vocabulary (docs/42 §8). */
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: WAIT_BOUND_MS,
  });
}

/** One checkout of the served repository: the cited doc at its ROOT, a decoy of the same path
 * under `impl/` (where the incident's CLI ran), and — when asked — a LINKED worktree carrying its
 * own decoy, so a row pins "the deployment's checkout root", not merely "not the cwd". */
function checkout({ linkedWorktree = false } = {}) {
  const root = scratch('checkout');
  if (linkedWorktree) {
    // A real linked worktree needs a commit to fork from, and the fixture keeps its repository
    // honest: the root's own git metadata is what the derivation reads.
    git(root, ['init', '--quiet']);
  } else {
    // The derivation reads git METADATA only (the repository's `.git` and its common directory):
    // a bare `.git` directory is a checkout whose root is exactly this directory.
    mkdirSync(join(root, '.git'), { recursive: true });
  }
  writeDoc(root, PRESENT_DOC, CHECKOUT_MARK);
  writeDoc(root, join('impl', PRESENT_DOC), CWD_DECOY_MARK);
  if (linkedWorktree) {
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.email=issue480@test', '-c', 'user.name=issue480', 'commit', '--quiet', '-m', 'fixture']);
    const lane = join(root, '.baton', 'wt', 'lane-480');
    git(root, ['worktree', 'add', '--quiet', lane]);
    writeDoc(lane, PRESENT_DOC, WORKTREE_DECOY_MARK);
  }
  return root;
}

/** One CLI child: the driver runs the real parser and runner with the cwd this row chose and
 * answers one JSON report. The wait is bounded and a bound miss is named, never swallowed. */
function recruit(cwd, { scenario, docs = [] }) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      DRIVER, '--scenario', scenario, ...docs.flatMap((doc) => ['--doc', doc]),
    ], { cwd, timeout: WAIT_BOUND_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null && error !== undefined) {
        if (error.killed === true || error.signal !== null) {
          reject(Object.assign(
            new Error(`${WAIT_UNSETTLED}: the CLI child from ${cwd} never settled within ${WAIT_BOUND_MS}ms`),
            { code: WAIT_UNSETTLED },
          ));
          return;
        }
        reject(new Error(`the issue480 driver failed under ${cwd}: ${error.message}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch {
        reject(new Error(`the issue480 driver answered no report under ${cwd}: ${stdout}\n${stderr}`));
      }
    });
  });
}

// ── 480-a: the citation resolves against the deployment's checkout root, never the cwd ───────────

test('480-a1: a recruit issued from a subdirectory of the checkout admits its cited doc', async () => {
  const repoRoot = checkout();
  const cwd = join(repoRoot, 'impl');
  const report = await recruit(cwd, { scenario: 'cited' });

  assert.equal(realpathSync(report.cwd), realpathSync(cwd),
    'the CLI really ran from a subdirectory of the checkout, not from its root');
  assert.equal(report.refusal, null, `the recruit is admitted: ${JSON.stringify(report.refusal)}`);
  assert.equal(report.seatJoined, true, 'the seat joined');
  assert.equal(report.admittedPackages, 1, 'exactly ONE package was admitted');
  assert.equal(report.attached, 1, 'the package is attached to the seat run');
  assert.match(report.receipt?.digest ?? '', /^[a-f0-9]{64}$/u, 'the receipt names the package digest');
  assert.deepEqual(report.receipt?.docs, [], 'no gap is named for a document the checkout carries');
  const branches = report.branchNames;
  assert.ok(branches.includes('issue:480'), 'the package carries the issue branch');
  assert.ok(branches.some((name) => name.startsWith('doc:docs.480-in-the-checkout.md:')),
    `the cited doc rides the package as a branch (${branches.join(', ')})`);
  assert.ok(report.brief.includes(CHECKOUT_MARK), 'the seat reads the checkout root\'s bytes');
  assert.equal(report.brief.includes(CWD_DECOY_MARK), false,
    'the decoy at the CLI cwd (`impl/docs/…`) is never the document a citation resolves to');
});

test('480-a2: the same recruit from a nested directory of the checkout admits identically', async () => {
  const repoRoot = checkout();
  const nested = join(repoRoot, 'impl', 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  const report = await recruit(nested, { scenario: 'cited' });

  assert.equal(realpathSync(report.cwd), realpathSync(nested),
    'the CLI really ran from a nested directory of the checkout');
  assert.equal(report.refusal, null, 'the recruit is admitted from a nested cwd');
  assert.equal(report.attached, 1, 'the package is attached to the seat run');
  assert.ok(report.brief.includes(CHECKOUT_MARK), 'the seat reads the checkout root\'s bytes');
  assert.equal(report.brief.includes(CWD_DECOY_MARK), false, 'never the decoy at the cwd');
});

test('480-a3: a CLI run inside a LINKED worktree still resolves at the deployment checkout root', async () => {
  const repoRoot = checkout({ linkedWorktree: true });
  const lane = join(repoRoot, '.baton', 'wt', 'lane-480');
  const report = await recruit(join(lane, 'impl'), { scenario: 'cited' });

  assert.equal(realpathSync(report.cwd), realpathSync(join(lane, 'impl')),
    'the CLI really ran from inside the linked worktree');
  assert.equal(report.refusal, null, 'the recruit is admitted from inside a lane worktree');
  assert.ok(report.brief.includes(CHECKOUT_MARK),
    'the served deployment\'s bytes ride the package, not the worktree\'s copy');
  assert.equal(report.brief.includes(WORKTREE_DECOY_MARK), false,
    'a lane worktree is never the resolution root');
});

// ── 480-b: a genuinely absent citation is a NAMED GAP, and the recruit is admitted ──────────────

test('480-b: one absent citation is a named gap — the recruit is admitted with the gap on the receipt and in the brief', async () => {
  const repoRoot = checkout();
  const report = await recruit(join(repoRoot, 'impl'), { scenario: 'gap' });

  assert.equal(report.refusal, null, `the recruit is admitted: ${JSON.stringify(report.refusal)}`);
  assert.equal(report.seatJoined, true, 'the seat joined');
  assert.equal(report.admittedPackages, 1, 'the package is admitted with the members it could read');
  assert.equal(report.attached, 1, 'the package is attached to the seat run');
  assert.deepEqual(report.receipt?.docs, [
    { path: ABSENT_DOC, state: 'unreadable', reason: 'absent' },
  ], 'the receipt carries the gap list, in the closed row shape');
  assert.ok(report.branchNames.some((name) => name.startsWith('doc:docs.480-in-the-checkout.md:')),
    'the readable citation still rides the package');
  assert.equal(
    report.branchNames.some((name) => name.includes('480-never-committed')), false,
    'a document with no bytes has no branch',
  );
  assert.ok(report.brief.includes('Unreadable citations:'),
    'the brief names the gap the leg read about');
  assert.ok(report.brief.includes(ABSENT_DOC),
    'the brief names the document the seat did not get');
  assert.ok(report.brief.includes(CHECKOUT_MARK), 'the readable document still rides the brief');
});

// ── 480-c: no readable member at all refuses, and the refusal names the remedy ──────────────────

test('480-c: a leg with no readable member refuses typed, naming the remedy', async () => {
  const repoRoot = checkout();
  const report = await recruit(join(repoRoot, 'impl'), {
    scenario: 'empty', docs: [ABSENT_DOC],
  });

  assert.equal(report.receipt, null, 'nothing was admitted');
  assert.equal(report.refusal?.code, 'context_doc_unreadable', 'the refusal is typed');
  assert.equal(report.refusal?.detail?.rule, 'no-readable-member', 'the rule is named');
  assert.deepEqual(report.refusal?.detail?.docs, [
    { path: ABSENT_DOC, state: 'unreadable', reason: 'absent' },
  ], 'the refusal names the documents it could not read');
  assert.match(report.refusal.message, /recruit without --issue/u,
    'the remedy names the reading leg the operator can drop');
  assert.match(report.refusal.message, /--files/u, 'the remedy names the documents leg');
  assert.equal(report.seatJoined, false, 'no seat joined');
  assert.equal(report.admittedPackages, 0, 'no package was admitted');
});
