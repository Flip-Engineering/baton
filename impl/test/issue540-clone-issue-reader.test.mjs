// Issue #540 — a clone resident reads its issue. `gh` resolves the repository from the process
// cwd's remote, and the standard deployment layout is a `git clone --no-local` whose `origin` is a
// LOCAL PATH: gh then answers "none of the git remotes configured for this repository point to a
// known GitHub host. … please use `gh auth login`", and `baton swarm recruit … --issue N` refused
// `issue_reader_unavailable: … gh is not authenticated on this host` while the operator's gh WAS
// authenticated on that host. Every lane on that resident was sent to repair a credential that was
// never the problem, and the context-package leg was unreachable in the layout that needs it most.
//
// Rows:
//   540a  the repository resolves from the deployment's own checkout, one hop through a local-path
//         origin — the clone-resident layout — for every remote spelling a checkout carries;
//   540b  a checkout whose remotes resolve no GitHub host answers null, never a throw;
//   540c  the reader names the resolved repository to gh (`--repo OWNER/NAME`) and answers the
//         issue document;
//   540d  gh's no-repository answer is refused `issue_reader_no_repository`, naming the real
//         cause — the misreport this issue records;
//   540e  a genuine authentication answer still refuses `issue_reader_unavailable`, so the
//         reordering is a classification and never a suppression;
//   540f  end to end: a recruit issued from a clone-resident checkout hands the resolved
//         repository to the reader, and the admitted package rides the recruit.
//
// The git fixtures carry no commit, so no fixture writes a repository config (the #605 rule):
// `git init` plus `git remote add` are the whole fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBatonCli, readGitHubIssue, resolveIssueRepository, runBatonCli } from '../src/application-cli.mjs';

const PRIMARY_REMOTE = 'https://github.com/Flip-Engineering/baton.git';
const RESOLVED = 'Flip-Engineering/baton';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue540-${label}-`));
  roots.push(root);
  return root;
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** One checkout with one remote URL — the primary checkout's own spelling, or the intermediate
 * local path a `git clone --no-local` resident carries. */
function checkout(label, remoteUrl) {
  const directory = scratch(label);
  git(['init', '-q', directory]);
  git(['-C', directory, 'remote', 'add', 'origin', remoteUrl]);
  return directory;
}
const issueDocument = (number) => ({
  number, title: `Issue ${number}`, body: `Body of ${number}`, labels: [],
  url: `https://github.com/${RESOLVED}/issues/${number}`,
});
function refusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

test('540a: the repository resolves from the deployment checkout, one hop through a clone-resident origin', () => {
  const primary = checkout('primary', PRIMARY_REMOTE);
  const clone = checkout('clone', primary);
  assert.equal(resolveIssueRepository({ root: clone }), RESOLVED,
    'the local-path origin is followed into the checkout it names and THAT checkout\'s remote is read');
  assert.equal(resolveIssueRepository({ root: primary }), RESOLVED,
    'a checkout whose origin IS the shared remote resolves directly');
  assert.equal(resolveIssueRepository({ root: clone, hops: 1 }), null,
    'the walk is bounded: one hop is the whole of it, so a chain of intermediates cannot be followed forever');
  assert.equal(resolveIssueRepository({ root: checkout('scp', 'git@github.com:Flip-Engineering/baton.git') }),
    RESOLVED, 'the scp spelling resolves to the same repository');
  assert.equal(resolveIssueRepository({ root: checkout('ssh', 'ssh://git@github.com/Flip-Engineering/baton') }),
    RESOLVED, 'the ssh URL spelling resolves to the same repository');
});

test('540b: a checkout whose remotes resolve no GitHub host answers null, never a throw', () => {
  assert.equal(resolveIssueRepository({ root: checkout('lonely', join(scratch('nowhere'), 'intermediate')) }), null,
    'a local-path remote whose checkout declares nothing answers absence');
  assert.equal(resolveIssueRepository({ root: join(scratch('not-a-checkout'), 'missing') }), null,
    'a path that is not a checkout is absence, not an error');
  assert.equal(resolveIssueRepository({}), null, 'no root is absence');
  assert.equal(resolveIssueRepository({ root: checkout('other-forge', 'https://gitlab.example.test/owner/name.git') }), null,
    'another forge resolves no GitHub repository');
});

test('540c: the reader names the resolved repository to gh', () => {
  const calls = [];
  const exec = (file, args) => { calls.push({ file, args }); return JSON.stringify(issueDocument(540)); };
  const issue = readGitHubIssue({ issue: 540, exec, repo: RESOLVED });
  assert.deepEqual(calls[0], { file: 'gh', args: ['issue', 'view', '540', '--json', 'number,title,body,labels,url', '--repo', RESOLVED] },
    'gh is told the repository explicitly, so the read never depends on which remote the cwd carries');
  assert.equal(issue.number, 540, 'the reader answers the issue document it read');
  readGitHubIssue({ issue: 540, exec, repo: null });
  assert.equal(calls[1].args.includes('--repo'), false,
    'no resolved repository names no --repo: gh keeps its own cwd-relative behavior');
});

test('540d: gh\'s no-repository answer is refused as its own cause, never as a credential failure', () => {
  const observed = 'none of the git remotes configured for this repository point to a known GitHub'
    + ' host. To tell gh about a new GitHub host, please use `gh auth login`';
  const exec = () => { throw Object.assign(new Error('Command failed with exit code 1'), { stderr: observed }); };
  const error = refusalOf(() => readGitHubIssue({ issue: 540, exec }));
  assert.equal(error.code, 'issue_reader_no_repository',
    'the checkout\'s own remotes are the cause, and the typed code says so');
  assert.match(error.message, /no remote of this checkout resolves to a GitHub host/u,
    'the refusal names the real cause, not the credential the operator does not have to fix');
  assert.doesNotMatch(error.message, /not authenticated/u,
    'the misreport this issue records: the no-repository answer never reads as an authentication fact');
});

test('540e: a genuine authentication answer still refuses issue_reader_unavailable', () => {
  const exec = () => { throw Object.assign(new Error('Command failed with exit code 1'), {
    stderr: 'error: not logged in to any GitHub hosts. Run gh auth login to authenticate.',
  }); };
  const error = refusalOf(() => readGitHubIssue({ issue: 540, exec }));
  assert.equal(error.code, 'issue_reader_unavailable', 'a real credential failure is still named as one');
  assert.match(error.message, /not authenticated/u);
});

test('540f: a recruit issued from a clone resident hands the resolved repository to the reader', async () => {
  const clone = checkout('clone-e2e', checkout('primary-e2e', PRIMARY_REMOTE));
  const seen = [];
  const reader = async ({ issue, repo }) => { seen.push({ issue, repo }); return issueDocument(issue); };
  const sent = [];
  const client = {
    command: async (name, args) => {
      sent.push({ name, args });
      return name === 'package.admit'
        ? { packageDigest: 'a'.repeat(64), reused: false, branches: args.branches.map((branch) => branch.name) }
        : { ok: true };
    },
  };
  const parsed = parseBatonCli(['--idempotency-key', 'k540', 'swarm', 'recruit', 's-540', 'lane', 'Read #540', '--issue', '540']);
  await runBatonCli(parsed, client, { contextRepoRoot: clone, issueReader: reader });
  assert.deepEqual(seen, [{ issue: 540, repo: RESOLVED }],
    'the reading leg resolves the repository from the deployment checkout, never from the cwd');
  assert.equal(sent[0].name, 'package.admit', 'the issue is admitted as ONE package before the recruit crosses the wire');
  assert.equal(sent.at(-1).name, 'swarm.recruit');
  assert.equal(sent.at(-1).args.options.contextPackage.digest, 'a'.repeat(64),
    'the admitted digest rides the recruit');
});
