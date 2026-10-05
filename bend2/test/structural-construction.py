"""Structural construction qualification for #671.

Owner: structure Section, session semantic-controls-structure-research. Test-only
file; it edits no shared native source, parser, MCP, briefing or law file.

Subject: the accepted structural grammar and result contract pinned at proposal
2543678035631371a6f024a1c58ac9ec16239c12 (docs-only delta of
71695806f52ae2823aabeb4b957db9a35edd9af9).

    ensemble ENSEMBLE OWNER COUPLING [--section SECTION CAPABILITY]...
    recruit PLAYER PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE
      --role player|associate-conductor
      [--ensemble ENSEMBLE OWNER]...
      [--section ENSEMBLE OWNER SECTION]...

The composed executable is supplied through BATON2_STRUCTURAL_EXE. Until the
native module and the interfaces aggregation land, that executable does not
exist and a selected run of this file is unjudged by the repo's own rule
(scripts/check-unittest.sh: a run that skipped any test prints no failure
identity and exits 1). No expected-failure marker, skip ledger or failure-count
manifest is checked in here; the case list is a program, not a record.

Fixture mechanisms, all fixture-owned: a fresh owned Git repository and a fresh
owned SQLite fixture database per case, sessions attached with an empty
(endpoint-free) receiver, a BEFORE INSERT trigger raising RAISE(ABORT) on the
last structural table to reach the real host rollback, and a bounded
.git/hooks/post-checkout barrier that holds the operation after Git created the
child worktree and before registration. Both mechanisms were measured on this
host as fixture primitives only; reachable is not qualified, and a trigger abort
establishes the SQLite error -> rollback path, not disk IO-failure behaviour.

Baseline negative control: with BATON2_BASELINE_EXE set, the baseline group
asserts the accepted contract is absent and the legacy plain form still works.
That is a bounded control for the fixtures and the harness, not candidate
qualification.
"""
import contextlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
PROPOSAL = '2543678035631371a6f024a1c58ac9ec16239c12'

# Wire constants from the accepted result contract.
RESULT_TYPE = 'structural-result'
REFUSAL_PREFIX = '{"error":"structural-refused",'
HOST_PREFIX = '{"error":"structural-host-failure",'
COMMON_FIELDS = ('type', 'status', 'phase', 'subject', 'requested', 'structure',
                 'workspace', 'condition', 'next')
HARNESSES = ('omp', 'codex', 'muse', 'claude-code')

GIT_ENV = {
    'GIT_AUTHOR_NAME': 'Structural fixture',
    'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
    'GIT_COMMITTER_NAME': 'Structural fixture',
    'GIT_COMMITTER_EMAIL': 'fixture@example.invalid',
    'GIT_CONFIG_GLOBAL': '/dev/null',
    'GIT_CONFIG_SYSTEM': '/dev/null',
}


def executable(variable):
    value = os.environ.get(variable)
    return Path(value) if value else None


def git(repo, *args):
    proc = subprocess.run(['git', '-C', str(repo), *map(str, args)],
                          capture_output=True, text=True, timeout=120,
                          env={**os.environ, **GIT_ENV})
    if proc.returncode != 0:
        raise AssertionError(f'git {args} failed: {proc.stderr.strip()}')
    return proc.stdout.strip()


def read_only(db, sql, params=()):
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        return con.execute(sql, params).fetchall()
    finally:
        con.close()


def writable(db, sql):
    con = sqlite3.connect(str(db))
    try:
        con.execute(sql)
        con.commit()
    finally:
        con.close()


class StructuralFixture:
    """One fresh owned repository and one fresh owned fixture database."""

    def __init__(self, exe, prefix):
        self.exe = Path(exe)
        scratch = ROOT / '.scratch'
        scratch.mkdir(exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix=prefix, dir=scratch))
        self.repo = self.root / 'repo'
        self.db = self.root / 'fixture.db'
        self.barriers = self.root / 'barriers'
        self.barriers.mkdir()
        self.repo.mkdir()
        self.children = []
        self.base = self._seed_repo()

    def _seed_repo(self):
        git(self.repo, 'init', '-q')
        (self.repo / 'seed.txt').write_text('seed\n')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'seed')
        return git(self.repo, 'rev-parse', 'HEAD')

    # -- commands ---------------------------------------------------------

    def run(self, *args, timeout=120):
        proc = subprocess.run([str(self.exe), str(self.db), *map(str, args)],
                              capture_output=True, text=True, timeout=timeout,
                              cwd=str(self.root))
        return proc.returncode, proc.stdout, proc.stderr

    def spawn(self, *args):
        proc = subprocess.Popen([str(self.exe), str(self.db), *map(str, args)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, cwd=str(self.root),
                                start_new_session=True)
        self.children.append(proc)
        return proc

    def drain(self, proc, timeout=120):
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            out, err = proc.communicate()
            raise AssertionError('owned child exceeded its bound')
        if proc in self.children:
            self.children.remove(proc)
        return proc.returncode, out, err

    # -- fixture state ----------------------------------------------------

    def session(self, name, harness='omp'):
        rc, out, err = self.run('attach', name, harness, f'native-{name}', '')
        if rc != 0:
            raise AssertionError(f'attach {name} failed: {rc} {err.strip()}')
        return name

    def conductor(self, name, harness='omp'):
        self.session(name, harness)
        rc, out, err = self.run('role', name, 'conductor')
        if rc != 0:
            raise AssertionError(f'role {name} failed: {rc} {err.strip()}')
        return name

    def ensemble(self, name, owner, coupling):
        rc, out, err = self.run('ensemble', name, owner, coupling)
        if rc != 0:
            raise AssertionError(f'ensemble {name} failed: {rc} {err.strip()}')
        return name

    def rows(self, sql, params=()):
        return read_only(self.db, sql, params)

    def scalar(self, sql, params=()):
        rows = self.rows(sql, params)
        return rows[0][0] if rows else None

    # -- fixture mechanisms ----------------------------------------------

    def abort_trigger(self, table, name='fixture-abort'):
        writable(self.db, f"CREATE TRIGGER IF NOT EXISTS '{name}' "
                          f"BEFORE INSERT ON '{table}' "
                          f"BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")

    def barrier(self, name):
        return self.barriers / name

    def hold_post_checkout(self, bound=1200):
        """Install a bounded post-checkout barrier in the owned repository."""
        entered = (self.barrier('entered')).resolve()
        release = (self.barrier('release')).resolve()
        log = (self.barrier('hook-args')).resolve()
        hook = self.repo / '.git' / 'hooks' / 'post-checkout'
        hook.write_text(
            '#!/bin/sh\n'
            f'printf \'%s\\n\' "$1 $2 $3" >> "{log}"\n'
            f': > "{entered}"\n'
            'i=0\n'
            f'while [ ! -e "{release}" ]; do\n'
            '  i=$((i+1))\n'
            f'  [ "$i" -gt {bound} ] && exit 0\n'
            '  sleep 0.05\n'
            'done\n'
            'exit 0\n')
        hook.chmod(0o755)
        return entered, release

    def wait_for(self, path, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists():
                return True
            time.sleep(0.05)
        return False

    def close(self):
        release = self.barrier('release')
        with contextlib.suppress(OSError):
            release.write_text('release\n')
        for proc in list(self.children):
            with contextlib.suppress(Exception):
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            with contextlib.suppress(Exception):
                proc.communicate(timeout=10)
        self.children.clear()
        shutil.rmtree(self.root, ignore_errors=True)


class StructuralCase(unittest.TestCase):
    """Shared setup: one fixture per case, torn down with its owned children."""

    EXE_VARIABLE = 'BATON2_STRUCTURAL_EXE'

    def setUp(self):
        exe = executable(self.EXE_VARIABLE)
        if exe is None or not exe.is_file():
            self.skipTest(
                f'{self.EXE_VARIABLE} does not name a built composed executable')
        self.fixture = StructuralFixture(exe, 'structural-construction-')
        self.addCleanup(self.fixture.close)

    # -- shared assertions -------------------------------------------------

    def one_object(self, stream, channel):
        text = stream.strip()
        self.assertTrue(text, f'{channel} carried no result object')
        obj, index = json.JSONDecoder().raw_decode(text)
        self.assertEqual(text[index:].strip(), '',
                         f'{channel} carried bytes after the single result object')
        return obj

    def common(self, obj):
        for field in COMMON_FIELDS:
            self.assertIn(field, obj, f'result omits the common field {field}')
        self.assertEqual(obj['type'], RESULT_TYPE)

    def assert_refused(self, rc, out, err, status=None, phase=None):
        self.assertEqual(out.strip(), '', 'a refusal wrote to stdout')
        self.assertTrue(err.startswith(REFUSAL_PREFIX),
                        f'refusal did not begin with the registered prefix: {err[:120]!r}')
        self.assertEqual(rc, 2, 'an admission refusal must exit 2')
        obj = self.one_object(err, 'stderr')
        self.common(obj)
        self.assertNotIn('hostError', obj, 'a refusal is not a host failure')
        if status is not None:
            self.assertEqual(obj['status'], status)
        if phase is not None:
            self.assertEqual(obj['phase'], phase)
        return obj

    def assert_host_failure(self, rc, out, err, status):
        self.assertEqual(out.strip(), '', 'a host failure wrote to stdout')
        self.assertTrue(err.startswith(HOST_PREFIX),
                        f'host failure did not begin with its prefix: {err[:120]!r}')
        self.assertNotEqual(rc, 0, 'a host failure must exit nonzero')
        obj = self.one_object(err, 'stderr')
        self.common(obj)
        self.assertEqual(obj['status'], status)
        self.assertIn('hostError', obj, 'a host failure carries hostError')
        return obj

    def assert_configured(self, rc, out, err):
        self.assertEqual(rc, 0, f'configured success must exit 0: {err.strip()[:200]}')
        self.assertEqual(err.strip(), '', 'configured success wrote to stderr')
        obj = self.one_object(out, 'stdout')
        self.common(obj)
        self.assertEqual(obj['status'], 'configured')
        self.assertEqual(obj['phase'], 'registration')
        self.assertNotIn('error', obj, 'configured success carries no error field')
        return obj


class ExtendedSurface(StructuralCase):
    """The extended grammar, its wire shape and its value preservation."""

    def test_extended_section_declaration_succeeds_with_conforming_wire_shape(self):
        f = self.fixture
        f.conductor('lead')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose', '--section', 'core', 'review')
        obj = self.assert_configured(rc, out, err)
        self.assertEqual(obj['workspace']['disposition'], 'notRequested')
        self.assertEqual(f.scalar('SELECT coupling FROM ensembles WHERE id=?', ('team',)), 'loose')
        self.assertEqual(f.scalar('SELECT capability FROM sections WHERE ensemble=? AND id=?',
                                  ('team', 'core')), 'review')

    def test_late_invalid_clause_refuses_and_preserves_preexisting_values(self):
        f = self.fixture
        f.conductor('lead')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose', '--section', 'core', 'original')
        self.assert_configured(rc, out, err)
        rc, out, err = f.run('ensemble', 'team', 'lead', 'tight', '--section', 'spare', '')
        self.assert_refused(rc, out, err, status='preflightRefused', phase='preflight')
        self.assertEqual(f.scalar('SELECT coupling FROM ensembles WHERE id=?', ('team',)), 'loose',
                         'a refused request changed a preexisting coupling')
        self.assertEqual(f.scalar('SELECT capability FROM sections WHERE ensemble=? AND id=?',
                                  ('team', 'core')), 'original')
        self.assertIsNone(f.scalar('SELECT id FROM sections WHERE ensemble=? AND id=?',
                                   ('team', 'spare')))

    def test_conflicting_capability_for_one_compound_key_refuses_the_whole_request(self):
        f = self.fixture
        f.conductor('lead')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose',
                             '--section', 'core', 'first', '--section', 'core', 'second')
        self.assert_refused(rc, out, err)
        self.assertIsNone(f.scalar('SELECT id FROM ensembles WHERE id=?', ('team',)))

    def test_same_local_section_name_in_different_ensembles(self):
        f = self.fixture
        f.conductor('one')
        f.conductor('two')
        self.assert_configured(*f.run('ensemble', 'alpha', 'one', 'loose',
                                      '--section', 'review', 'alpha capability'))
        self.assert_configured(*f.run('ensemble', 'beta', 'two', 'loose',
                                      '--section', 'review', 'beta capability'))
        self.assertEqual(f.scalar('SELECT capability FROM sections WHERE ensemble=? AND id=?',
                                  ('alpha', 'review')), 'alpha capability')
        self.assertEqual(f.scalar('SELECT capability FROM sections WHERE ensemble=? AND id=?',
                                  ('beta', 'review')), 'beta capability')


class RollbackAndLegacy(StructuralCase):
    """Host rollback after an earlier write, and the legacy error surface."""

    def test_trigger_abort_rolls_back_the_earlier_write(self):
        f = self.fixture
        f.conductor('lead')
        self.assert_configured(*f.run('ensemble', 'team', 'lead', 'loose'))
        f.abort_trigger('sections')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'tight', '--section', 'core', 'cap')
        obj = self.assert_host_failure(rc, out, err, status='registrationFailed')
        self.assertIn('stage', obj['hostError'])
        self.assertEqual(f.scalar('SELECT coupling FROM ensembles WHERE id=?', ('team',)), 'loose',
                         'the rollback did not preserve the earlier coupling value')
        self.assertIsNone(f.scalar('SELECT id FROM sections WHERE ensemble=? AND id=?',
                                   ('team', 'core')))

    def test_plain_form_keeps_its_legacy_owner_conflict_error(self):
        f = self.fixture
        f.conductor('owner')
        f.conductor('other')
        self.assert_configured(*f.run('ensemble', 'team', 'owner', 'loose'))
        rc, out, err = f.run('ensemble', 'team', 'other', 'loose')
        self.assertNotEqual(rc, 0, 'the legacy owner conflict must not report success')
        self.assertFalse(err.startswith(REFUSAL_PREFIX) or err.startswith(HOST_PREFIX),
                         'the plain form must not return the structural refusal object')
        self.assertEqual(f.scalar('SELECT owner FROM ensembles WHERE id=?', ('team',)), 'owner')
        self.assertEqual(f.scalar('SELECT coupling FROM ensembles WHERE id=?', ('team',)), 'loose')

    def test_extended_form_returns_the_typed_owner_conflict(self):
        f = self.fixture
        f.conductor('owner')
        f.conductor('other')
        self.assert_configured(*f.run('ensemble', 'team', 'owner', 'loose'))
        rc, out, err = f.run('ensemble', 'team', 'other', 'loose', '--section', 'core', 'cap')
        self.assert_refused(rc, out, err)
        self.assertEqual(f.scalar('SELECT owner FROM ensembles WHERE id=?', ('team',)), 'owner')
        self.assertEqual(f.scalar('SELECT coupling FROM ensembles WHERE id=?', ('team',)), 'loose')


class RecruitSurface(StructuralCase):
    """Extended recruit: role, memberships, workspaces and no startup effects."""

    def _parent(self):
        f = self.fixture
        f.conductor('lead')
        self.assert_configured(*f.run('ensemble', 'team', 'lead', 'loose'))
        return f

    def _args(self, child, harness='omp'):
        f = self.fixture
        return ('recruit', child, 'lead', harness, 'model-x', 'high',
                str(f.repo), f'codex/{child}', str(f.root / child), f.base)

    def test_extended_recruit_records_role_membership_and_workspace(self):
        f = self._parent()
        rc, out, err = f.run(*self._args('child'), '--role', 'player', '--ensemble', 'team', 'lead')
        obj = self.assert_configured(rc, out, err)
        self.assertEqual(obj['workspace']['disposition'], 'created')
        self.assertTrue(Path(f.root / 'child').is_dir(), 'the created worktree is gone')
        self.assertEqual(f.scalar('SELECT role FROM session_roles WHERE session=?', ('child',)), 'player')
        self.assertEqual(f.scalar('SELECT session FROM ensemble_members WHERE ensemble=? AND session=?',
                                  ('team', 'child')), 'child')

    def test_extended_recruit_requires_an_explicit_role(self):
        f = self._parent()
        rc, out, err = f.run(*self._args('child'))
        self.assertNotEqual(rc, 0, 'a recruit without --role must not report success')
        self.assertIsNone(f.scalar('SELECT id FROM sessions WHERE id=?', ('child',)))

    def test_absent_role_row_receives_the_admitted_role(self):
        f = self._parent()
        rc, out, err = f.run(*self._args('child'), '--role', 'associate-conductor')
        self.assert_configured(rc, out, err)
        self.assertEqual(f.scalar('SELECT role FROM session_roles WHERE session=?', ('child',)),
                         'conductor')
        rc, out, err = f.run('role', 'child')
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)['role'], 'associate-conductor')

    def test_stored_role_conflict_names_the_ordinary_role_operation(self):
        f = self._parent()
        self.assert_configured(*f.run(*self._args('child'), '--role', 'associate-conductor'))
        rc, out, err = f.run(*self._args('child'), '--role', 'player')
        obj = self.assert_refused(rc, out, err)
        rendered = json.dumps(obj.get('next', []))
        self.assertIn('role', rendered,
                      'the corrective operation for a role conflict must be the role command')

    def test_every_harness_assignment_configures_without_starting_anything(self):
        f = self._parent()
        for index, harness in enumerate(HARNESSES):
            child = f'child-{index}'
            rc, out, err = f.run(*self._args(child, harness), '--role', 'player')
            self.assert_configured(rc, out, err)
            self.assertEqual(f.scalar('SELECT harness FROM sessions WHERE id=?', (child,)), harness)
            self.assertEqual(f.scalar('SELECT count(*) FROM executions WHERE session=?', (child,)), 0,
                             'configuration started an execution row')
            self.assertEqual(f.scalar('SELECT endpoint FROM sessions WHERE id=?', (child,)), '',
                             'configuration registered a receiver endpoint')

    def test_dirty_matching_retry_reports_unchanged_and_preserves_dirt(self):
        f = self._parent()
        self.assert_configured(*f.run(*self._args('child'), '--role', 'player'))
        worktree = f.root / 'child'
        (worktree / 'dirty.txt').write_text('uncommitted work\n')
        before = git(worktree, 'status', '--porcelain')
        rc, out, err = f.run(*self._args('child'), '--role', 'player')
        obj = self.assert_configured(rc, out, err)
        self.assertEqual(obj['workspace']['disposition'], 'unchanged')
        self.assertEqual((worktree / 'dirty.txt').read_text(), 'uncommitted work\n')
        self.assertEqual(git(worktree, 'status', '--porcelain'), before)


class PostGitBarrier(StructuralCase):
    """The post-checkout barrier: revalidation after Git, before registration."""

    def _parent(self):
        f = self.fixture
        f.conductor('lead')
        self.assert_configured(*f.run('ensemble', 'team', 'lead', 'loose'))
        return f

    def _args(self):
        f = self.fixture
        return ('recruit', 'child', 'lead', 'omp', 'model-x', 'high',
                str(f.repo), 'codex/structural-child', str(f.root / 'child'), f.base,
                '--role', 'player', '--ensemble', 'team', 'lead')

    def test_barrier_then_grouping_change_refuses_registration_and_keeps_the_worktree(self):
        f = self._parent()
        entered, release = f.hold_post_checkout()
        child = f.spawn(*self._args())
        self.assertTrue(f.wait_for(entered), 'the post-checkout barrier was never entered')
        rc, out, err = f.run('role', 'lead', 'player')
        self.assertEqual(rc, 0, 'the ordinary grouping change must succeed while held')
        release.write_text('release\n')
        rc, out, err = f.drain(child)
        obj = self.assert_refused(rc, out, err, status='registrationRefused', phase='registration')
        self.assertEqual(obj['workspace']['disposition'], 'created')
        self.assertTrue(Path(f.root / 'child').is_dir(),
                        'a refused registration removed the created worktree')
        self.assertEqual(f.scalar('SELECT count(*) FROM sessions WHERE id=?', ('child',)), 0)

    def test_barrier_with_trigger_reports_registration_failed_and_keeps_the_worktree(self):
        f = self._parent()
        f.abort_trigger('ensemble_members')
        entered, release = f.hold_post_checkout()
        child = f.spawn(*self._args())
        self.assertTrue(f.wait_for(entered), 'the post-checkout barrier was never entered')
        release.write_text('release\n')
        rc, out, err = f.drain(child)
        obj = self.assert_host_failure(rc, out, err, status='registrationFailed')
        self.assertEqual(obj['workspace']['disposition'], 'created')
        self.assertTrue(Path(f.root / 'child').is_dir(),
                        'a failed registration removed the created worktree')
        self.assertEqual(f.scalar('SELECT count(*) FROM sessions WHERE id=?', ('child',)), 0)


class BaselineNegativeControl(unittest.TestCase):
    """Bounded control: the accepted contract is absent from a baseline binary.

    This is not candidate qualification. It shows that the fixtures and the
    harness run, and that the extended grammar and result object are new.
    """

    EXE_VARIABLE = 'BATON2_BASELINE_EXE'

    def setUp(self):
        exe = executable(self.EXE_VARIABLE)
        if exe is None or not exe.is_file():
            self.skipTest(f'{self.EXE_VARIABLE} does not name a baseline executable')
        self.fixture = StructuralFixture(exe, 'structural-baseline-')
        self.addCleanup(self.fixture.close)

    def test_plain_form_configures_and_the_extended_grammar_is_absent(self):
        f = self.fixture
        f.conductor('lead')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose')
        self.assertEqual(rc, 0, f'the baseline plain form failed: {err.strip()[:200]}')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose', '--section', 'core', 'review')
        self.assertNotEqual(rc, 0, 'the baseline accepted the extended Section grammar')
        self.assertFalse(err.startswith(REFUSAL_PREFIX),
                         'the baseline returned the structural refusal object')
        rc, out, err = f.run('recruit', 'child', 'lead', 'omp', 'model-x', 'high',
                             str(f.repo), 'codex/child', str(f.root / 'child'), f.base,
                             '--role', 'player')
        self.assertNotEqual(rc, 0, 'the baseline accepted the extended recruit grammar')

    def test_fixture_trigger_reaches_a_real_sqlite_error_and_rollback(self):
        """Qualify the abort-trigger mechanism against a real command+rollback."""
        f = self.fixture
        f.conductor('lead')
        rc, out, err = f.run('ensemble', 'team', 'lead', 'loose')
        self.assertEqual(rc, 0, f'fixture ensemble failed: {err.strip()[:200]}')
        f.abort_trigger('sections')
        rc, out, err = f.run('section', 'team', 'core', 'lead', 'review')
        self.assertNotEqual(rc, 0, 'the fixture trigger did not abort the insert')
        self.assertIn('fixture failure', err + out,
                      'the abort message did not reach the caller')
        self.assertIsNone(f.scalar('SELECT id FROM sections WHERE ensemble=? AND id=?',
                                   ('team', 'core')),
                          'the aborted statement was not rolled back')
        self.assertIsNotNone(f.scalar('SELECT id FROM ensembles WHERE id=?', ('team',)))

    def test_fixture_post_checkout_barrier_holds_the_real_worktree_add(self):
        """Qualify the hook barrier against the real git worktree add -b path."""
        f = self.fixture
        f.conductor('lead')
        entered, release = f.hold_post_checkout()
        child = f.spawn('recruit', 'child', 'lead', 'omp', 'model-x', 'high',
                        str(f.repo), 'codex/barrier-child', str(f.root / 'child'), f.base)
        self.assertTrue(f.wait_for(entered),
                        'post-checkout did not run during git worktree add -b')
        args = (f.barrier('hook-args')).read_text().strip()
        fields = args.split()
        self.assertEqual(len(fields), 3, f'post-checkout argv was {args!r}')
        self.assertEqual(fields[0], '0' * 40, 'a new worktree should report a zero old HEAD')
        self.assertEqual(fields[2], '1', 'the branch-checkout flag should be 1')
        release.write_text('release\n')
        rc, out, err = f.drain(child)
        self.assertEqual(rc, 0, f'the held recruit failed: {err.strip()[:200]}')
        self.assertTrue(Path(f.root / 'child').is_dir())


if __name__ == '__main__':
    unittest.main()
