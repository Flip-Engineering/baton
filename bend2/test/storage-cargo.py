"""Offline Cargo target release in private test directories."""
import contextlib
import fcntl
import json
import os
import pathlib
import select
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BINARY = pathlib.Path(os.environ['BATON2_STORAGE_CARGO_TEST']).resolve()
CARGO = pathlib.Path(os.environ['BATON2_TEST_CARGO']).absolute()
RUSTC = pathlib.Path(os.environ['BATON2_TEST_RUSTC']).absolute()


def child_exit(child):
    readable, writable = os.pipe()

    def wait():
        child.wait()
        os.write(writable, b'x')

    watcher = threading.Thread(target=wait)
    watcher.start()
    return readable, writable, watcher


class CargoRelease(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='cargo-release-', dir=ROOT / '.scratch')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source'
        (self.source / 'src').mkdir(parents=True)
        (self.source / 'Cargo.toml').write_text(
            '[package]\nname="cargo_release_fixture"\nversion="0.1.0"\nedition="2021"\n')
        (self.source / 'src/main.rs').write_text('fn main() { println!("fixture"); }\n')
        (self.source / 'build.rs').write_text('''use std::io::{Read,Write};
fn main() {
 println!("cargo:rerun-if-env-changed=BATON_CARGO_BUILD_READY");
 println!("cargo:rerun-if-env-changed=BATON_CARGO_BUILD_RELEASE");
 if let Ok(path)=std::env::var("BATON_CARGO_BUILD_READY") {
  let mut ready=std::fs::OpenOptions::new().write(true).open(path).unwrap();
  ready.write_all(b"r").unwrap();
  let path=std::env::var("BATON_CARGO_BUILD_RELEASE").unwrap();
  let mut release=std::fs::File::open(path).unwrap();
  let mut b=[0u8;1]; release.read_exact(&mut b).unwrap();
 }
}
''')
        self.target = self.root / 'target'
        self.environment = dict(os.environ, CARGO_TARGET_DIR=str(self.target),
                                CARGO_HOME=str(self.root / 'cargo-home'),
                                CARGO_NET_OFFLINE='true', RUSTC=str(RUSTC),
                                TMPDIR=str(self.root))
        self.environment.pop('CARGO_BUILD_BUILD_DIR', None)
        self.db = self.root / 'state.sqlite'
        with sqlite3.connect(self.db) as db:
            db.executescript('''
CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,endpoint TEXT,workspace TEXT,branch TEXT,base TEXT);
CREATE TABLE executions(session TEXT,id TEXT,directory TEXT,phase TEXT,status TEXT);
CREATE TABLE messages(seq INTEGER PRIMARY KEY,id TEXT,sender TEXT,recipient TEXT,kind TEXT,body TEXT,receipt TEXT);
CREATE TABLE message_reads(message TEXT,recipient TEXT,PRIMARY KEY(message,recipient));
CREATE TABLE log_files(session TEXT,log TEXT);
CREATE TABLE log_generations(session TEXT,log TEXT,base TEXT,attempt TEXT);
''')
            db.execute("INSERT INTO sessions VALUES('owner',NULL,'fixture','',?,'','')", (str(self.source),))
            # The recorded exited execution under the target admits the root in
            # the current-main apply pipeline without adding a live consumer.
            db.execute("INSERT INTO executions VALUES('owner','admit',?,'exited','')", (str(self.target),))
        self.commands = self.root / 'commands'
        self.commands.mkdir()
        installed = self.root / 'installed'
        installed.write_text('installed\n')
        for name in ['baton', 'baton2', 'baton.pre-fixture']:
            (self.commands / name).symlink_to(installed)
        self.build()

    def cargo_argv(self, *args):
        priority = ['nice', '-n', '19']
        if sys.platform == 'linux':
            priority += ['ionice', '-c3']
        return [*priority, str(CARGO), 'build', '--offline', '-j1', *args]

    def build(self, *args, environment=None):
        run = subprocess.run(self.cargo_argv(*args), cwd=self.source,
                             env=environment or self.environment, text=True, capture_output=True)
        print(run.stdout, end='', flush=True)
        print(run.stderr, end='', flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def call(self, *args, environment=None):
        run = subprocess.run([str(BINARY), *map(str, args)], cwd=ROOT,
                             env=environment or self.environment, text=True, capture_output=True)
        print(run.stderr, end='', flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run.stdout.strip()

    def collect(self, target=None, associated='', commands=None):
        return self.call('collect', target or self.target, associated, self.db,
                         self.commands if commands is None else commands)

    def test_generic_apply_keeps_an_unknown_service_selection(self):
        env = dict(self.environment, BATON_STORAGE_ROOTS=f'build-output={self.target}')
        preview = json.loads(self.call('preview', self.db, 'owner', environment=env))
        entry = preview['roots'][0]['preview']['entries'][0]
        self.assertEqual(entry['path'], str(self.target))
        self.assertEqual(entry['decision'], 'keep')
        self.assertEqual(entry['reason'], 'cargo-selection-unknown')
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())

    def test_cargo_marker_and_legacy_layout_are_classified(self):
        probe = self.call('probe', self.target)
        self.assertTrue(probe.startswith('cargo\t'), probe)
        tag = self.target / 'CACHEDIR.TAG'
        if tag.exists():
            tag.unlink()
        probe = self.call('probe', self.target)
        self.assertTrue(probe.endswith('\tlayout'), probe)
        self.assertTrue(self.collect().startswith('removed\t'))
        self.assertFalse(self.target.exists())
        self.build()

    def test_a_directory_name_does_not_classify_output(self):
        other = self.root / 'unrelated' / 'target'
        other.mkdir(parents=True)
        (other / 'source.txt').write_text('keep\n')
        self.assertEqual(self.call('probe', other), 'unclassified')
        self.assertIn('unclassified', self.collect(other))
        self.assertTrue((other / 'source.txt').exists())

    def test_selected_and_rollback_binaries_are_kept(self):
        binary = self.target / 'debug/cargo_release_fixture'
        for name in ['baton', 'baton.pre-fixture']:
            link = self.commands / name
            original = link.resolve()
            link.unlink()
            link.symlink_to(binary)
            self.assertIn('cargo-runtime-selected', self.collect())
            relative = pathlib.Path(os.path.relpath(self.target, ROOT))
            self.assertIn('cargo-runtime-selected', self.collect(relative))
            self.assertTrue(binary.exists())
            link.unlink()
            link.symlink_to(original)

    def test_unknown_selection_and_live_consumer_are_kept(self):
        self.assertIn('cargo-selection-unknown', self.collect(commands=''))
        self.assertIn('cargo-selection-unknown', self.collect(commands=self.root / 'missing'))
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions VALUES('owner','build',?,'running','')", (str(self.target),))
        self.assertIn('cargo-consumer-present', self.collect())
        self.assertTrue(self.target.exists())

    @contextlib.contextmanager
    def writer(self, *args):
        ready, release = self.root / 'build-ready', self.root / 'build-release'
        os.mkfifo(ready)
        os.mkfifo(release)
        ready_fd = os.open(ready, os.O_RDWR | os.O_NONBLOCK)
        release_fd = os.open(release, os.O_RDWR)
        env = dict(self.environment, BATON_CARGO_BUILD_READY=str(ready),
                   BATON_CARGO_BUILD_RELEASE=str(release))
        with (self.root / 'writer.stdout').open('w') as stdout, (self.root / 'writer.stderr').open('w') as stderr:
            child = subprocess.Popen(self.cargo_argv(*args), cwd=self.source, env=env,
                                     stdout=stdout, stderr=stderr)
            exited, exit_writer, watcher = child_exit(child)
            try:
                readable, _, _ = select.select([ready_fd, exited], [], [])
                self.assertIn(ready_fd, readable, 'Cargo exited before its build script was ready')
                self.assertEqual(os.read(ready_fd, 1), b'r')
                yield child
            finally:
                os.write(release_fd, b'x')
                child.wait()
                watcher.join()
                for descriptor in [ready_fd, release_fd, exited, exit_writer]:
                    os.close(descriptor)
                output = (self.root / 'writer.stdout').read_text() + (self.root / 'writer.stderr').read_text()
                print(output, end='', flush=True)
                self.assertEqual(child.returncode, 0, output)

    def test_actual_cargo_writer_keeps_the_target(self):
        with self.writer():
            self.assertIn('cargo-writer-active', self.collect())
            self.assertTrue(self.target.exists())
        self.assertTrue(self.collect().startswith('removed\t'))
        self.build()

    def test_target_triple_and_custom_profile_are_collected(self):
        version = subprocess.check_output([str(RUSTC), '-vV'], text=True)
        triple = next(line.split(': ', 1)[1] for line in version.splitlines() if line.startswith('host: '))
        with (self.source / 'Cargo.toml').open('a') as manifest:
            manifest.write('\n[profile.review]\ninherits="dev"\n')
        self.build('--target', triple, '--profile', 'review')
        self.assertTrue((self.target / triple / 'review' / '.cargo-lock').exists())
        with self.writer('--target', triple, '--profile', 'review'):
            self.assertIn('cargo-writer-active', self.collect())
        self.assertTrue(self.collect().startswith('removed\t'))
        self.assertFalse(self.target.exists())

    def test_separate_build_directory_is_locked(self):
        build = self.root / 'build'
        self.environment['CARGO_BUILD_BUILD_DIR'] = str(build)
        self.build()
        with self.writer():
            self.assertIn('cargo-writer-active', self.collect(associated=build))
        self.assertTrue(self.collect(associated=build).startswith('removed\t'))
        self.assertTrue(build.exists())
        self.build()

    def release_preview(self, target=None):
        return json.loads(self.call('release-preview', target or self.target, self.db,
                                    self.commands))['entries'][0]

    def test_preview_and_collection_agree_on_released_output(self):
        entry = self.release_preview()
        self.assertEqual(entry['decision'], 'remove', entry)
        self.assertEqual(entry['reason'], 'cargo-output-released', entry)
        self.assertTrue(self.collect().startswith('removed\t'))

    def test_tag_alone_is_kept_and_tag_fifo_is_unreadable(self):
        other = self.root / 'tagged'
        other.mkdir()
        tag = other / 'CACHEDIR.TAG'
        tag.write_text('Signature: 8a477f597d28d172789f06886806bc55\n')
        self.assertEqual(self.call('probe', other), 'unclassified')
        self.assertEqual(self.release_preview(other)['reason'], 'unclassified-cargo-output')
        self.assertIn('unclassified-cargo-output', self.collect(other))
        tag.unlink()
        os.mkfifo(tag)
        self.assertTrue(self.call('probe', other).startswith('unreadable\t'))
        self.assertTrue(tag.exists())

    def test_symlinks_are_unlinked_inside_and_refused_at_the_target(self):
        evidence = self.root / 'evidence'
        evidence.mkdir()
        (evidence / 'keep').write_text('keep\n')
        (self.target / 'linked-directory').symlink_to(evidence, target_is_directory=True)
        (self.target / 'linked-file').symlink_to(evidence / 'keep')
        alias = self.root / 'alias'
        alias.symlink_to(self.target, target_is_directory=True)
        self.assertTrue(self.call('probe', alias).startswith('unreadable\t'))
        self.assertIn('cargo-output-unreadable', self.collect(alias))
        self.assertTrue(self.target.exists())
        self.assertTrue(self.collect().startswith('removed\t'))
        self.assertEqual((evidence / 'keep').read_text(), 'keep\n')

    def test_foreign_owned_directory_is_unreadable(self):
        foreign = pathlib.Path(ROOT.anchor) / 'usr'
        self.assertNotEqual(foreign.stat().st_uid, os.geteuid())
        self.assertTrue(self.call('probe', foreign).startswith('unreadable\t'))

    def test_canonical_lease_and_pending_consumers_are_kept(self):
        alias = self.root / 'target-alias'
        alias.symlink_to(self.target, target_is_directory=True)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions VALUES('owner','lease',?,'running','')", (str(alias),))
        self.assertIn('execution:lease', self.collect())
        relative = pathlib.Path(os.path.relpath(self.target, ROOT))
        self.assertIn('execution:lease', self.collect(relative))
        with sqlite3.connect(self.db) as db:
            db.execute('DELETE FROM executions')
            db.execute("UPDATE sessions SET workspace=? WHERE id='owner'", (str(alias),))
            db.execute("INSERT INTO messages VALUES(1,'pending','root','owner','task','work',NULL)")
        self.assertIn('pending:owner', self.collect())
        self.assertTrue(self.target.exists())

    def test_database_path_consumer_is_kept(self):
        # The copied coordinator database is itself an allocation consumer.
        resident = self.target / 'state.sqlite'
        with sqlite3.connect(self.db) as source, sqlite3.connect(resident) as destination:
            source.backup(destination)
        self.db = resident
        self.assertIn('database-path', self.collect())
        self.assertTrue(resident.exists())

    def test_live_cwd_with_recorded_operation_is_kept(self):
        child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.buffer.read(1)'],
                                 cwd=self.target / 'debug', stdin=subprocess.PIPE)
        try:
            with sqlite3.connect(self.db) as db:
                db.execute("INSERT INTO executions VALUES('owner','consumer',?,'running','')",
                           (str(self.target / 'debug'),))
            self.assertIn('execution:consumer', self.collect())
            self.assertTrue(self.target.exists())
        finally:
            child.communicate(b'x')
        self.assertEqual(child.returncode, 0)

    def test_cwd_only_process_leaves_release_eligible(self):
        child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.buffer.read(1)'],
                                 cwd=self.target / 'debug', stdin=subprocess.PIPE)
        try:
            self.assertEqual(self.release_preview()['decision'], 'remove')
            self.assertTrue(self.collect().startswith('removed\t'))
            self.assertFalse(self.target.exists())
        finally:
            child.communicate(b'x')
        self.assertEqual(child.returncode, 0)

    def test_device_mismatch_preserves_the_child_subtree(self):
        mounted = self.target / 'debug/mount-fixture'
        mounted.mkdir()
        (mounted / 'keep').write_text('retained subtree\n')
        env = dict(self.environment, BATON_CARGO_TEST_DEVICE_MISMATCH=mounted.name)
        run = subprocess.run([str(BINARY), 'collect', str(self.target), '', str(self.db), str(self.commands)],
                             cwd=ROOT, env=env, text=True, capture_output=True)
        print(run.stdout + run.stderr, end='', flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('partial ', run.stdout)
        self.assertIn('restore-error=0', run.stdout)
        self.assertIn('preserves mount entry=mount-fixture', run.stderr)
        self.assertEqual((mounted / 'keep').read_text(), 'retained subtree\n')

    @contextlib.contextmanager
    def collector_boundary(self, boundary):
        ready, release = self.root / 'collector-ready', self.root / 'collector-release'
        os.mkfifo(ready)
        os.mkfifo(release)
        ready_fd = os.open(ready, os.O_RDWR | os.O_NONBLOCK)
        release_fd = os.open(release, os.O_RDWR)
        env = dict(self.environment, BATON_CARGO_TEST_BOUNDARY=boundary,
                   BATON_CARGO_TEST_RENAMED=str(ready), BATON_CARGO_TEST_RELEASE=str(release))
        child = subprocess.Popen([str(BINARY), 'collect', str(self.target), '', str(self.db), str(self.commands)],
                                 cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        exited, exit_writer, watcher = child_exit(child)
        result = {}
        try:
            readable, _, _ = select.select([ready_fd, exited], [], [])
            self.assertIn(ready_fd, readable, 'collector exited before boundary ' + boundary)
            self.assertEqual(os.read(ready_fd, 1), b'\x01')
            yield result
        finally:
            os.write(release_fd, b'x')
            stdout, stderr = child.communicate()
            watcher.join()
            for descriptor in [ready_fd, release_fd, exited, exit_writer]:
                os.close(descriptor)
            result.update(stdout=stdout, stderr=stderr, exit=child.returncode)
            print(stderr, end='', flush=True)
            self.assertEqual(child.returncode, 0, stdout + stderr)

    def test_replacement_after_observation_is_changed(self):
        with self.collector_boundary('observed') as result:
            self.target.rename(self.root / 'original')
            self.target.mkdir()
            (self.target / 'keep').write_text('replacement\n')
        self.assertEqual(result['stdout'].strip(), 'changed')
        self.assertEqual((self.target / 'keep').read_text(), 'replacement\n')
        self.assertTrue((self.root / 'original/debug/.cargo-lock').exists())

    def test_new_profile_after_locking_keeps_the_allocation(self):
        with self.collector_boundary('locked') as result:
            profile = self.target / 'x/triple/profile'
            profile.mkdir(parents=True)
            (profile / '.cargo-lock').touch()
        self.assertIn('cargo-lock-layout-changed', result['stdout'])
        self.assertTrue(self.target.exists())
        with (profile / '.cargo-lock').open() as lock:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            self.assertIn('cargo-writer-active', self.collect())

    def test_partial_removal_restores_the_original_path(self):
        with socket.socket(socket.AF_UNIX) as endpoint:
            self.bind_socket(endpoint)
            answer = self.collect()
            self.assertIn('partial ', answer)
            self.assertIn('restore-error=0', answer)
            self.assertTrue((self.target / 'retained-socket').exists())
            self.assertEqual(list(self.root.glob('.target.baton-cargo-*')), [])
            self.assertEqual(self.release_preview()['decision'], 'keep')

    def test_failed_restore_is_reported_by_the_next_preview(self):
        with socket.socket(socket.AF_UNIX) as endpoint:
            self.bind_socket(endpoint)
            with self.collector_boundary('renamed') as result:
                boxes = list(self.root.glob('.target.baton-cargo-*'))
                self.assertEqual(len(boxes), 1)
                self.target.mkdir()
                (self.target / 'keep').write_text('replacement\n')
            self.assertIn('partial ', result['stdout'])
            self.assertTrue((boxes[0] / 'output/retained-socket').exists())
            self.assertEqual((self.target / 'keep').read_text(), 'replacement\n')
            self.assertIn(str(boxes[0]), self.call('probe', self.target))
            self.assertIn(str(boxes[0]), self.release_preview()['reason'])

    def bind_socket(self, endpoint):
        # Relative binding fits the platform's sockaddr_un path field even
        # when the private checkout has a long absolute path.
        previous = os.open('.', os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.chdir(self.target)
            endpoint.bind('retained-socket')
        finally:
            os.fchdir(previous)
            os.close(previous)

    def test_box_cleanup_failure_preserves_the_removed_answer(self):
        with self.collector_boundary('removed') as result:
            box, = self.root.glob('.target.baton-cargo-*')
            (box / 'keep').write_text('retain box\n')
        self.assertTrue(result['stdout'].startswith('removed\t'), result)
        self.assertIn('retained box=', result['stderr'])
        self.assertIn(str(box), self.call('probe', self.target))

    def test_lock_is_held_after_rename_and_through_removal(self):
        ready, release = self.root / 'renamed', self.root / 'release'
        os.mkfifo(ready)
        os.mkfifo(release)
        ready_fd = os.open(ready, os.O_RDWR | os.O_NONBLOCK)
        release_fd = os.open(release, os.O_RDWR)
        lock = os.open(self.target / 'debug/.cargo-lock', os.O_RDONLY)
        env = dict(self.environment, BATON_CARGO_TEST_RENAMED=str(ready),
                   BATON_CARGO_TEST_RELEASE=str(release))
        child = subprocess.Popen([str(BINARY), 'collect', str(self.target), '', str(self.db), str(self.commands)],
                                 cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        exited, exit_writer, watcher = child_exit(child)
        try:
            readable, _, _ = select.select([ready_fd, exited], [], [])
            self.assertIn(ready_fd, readable, 'collector exited before rename: ' + str(child.poll()))
            self.assertEqual(os.read(ready_fd, 1), b'\x01')
            self.assertFalse(self.target.exists())
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.write(release_fd, b'x')
            stdout, stderr = child.communicate()
            watcher.join()
            for descriptor in [ready_fd, release_fd, exited, exit_writer]:
                os.close(descriptor)
        try:
            self.assertEqual(child.returncode, 0, stdout + stderr)
            self.assertTrue(stdout.startswith('removed\t'), stdout + stderr)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(lock)



    def test_recorded_service_selection_reclaims_the_output(self):
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={self.target}|{self.commands}')
        preview = json.loads(self.call('preview', self.db, 'owner', environment=env))
        entry = preview['roots'][0]['preview']['entries'][0]
        self.assertEqual(entry['decision'], 'remove', entry)
        self.assertEqual(entry['reason'], 'cargo-output-released', entry)
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-output-released', answer)
        self.assertFalse(self.target.exists())
        self.build()

    def test_recorded_rollback_selection_keeps_the_output(self):
        binary = self.target / 'debug/cargo_release_fixture'
        link = self.commands / 'baton.pre-fixture'
        original = link.resolve()
        link.unlink()
        link.symlink_to(binary)
        try:
            env = dict(self.environment,
                       BATON_STORAGE_ROOTS=f'build-output={self.target}|{self.commands}')
            answer = self.call('apply', self.db, 'owner', environment=env)
            self.assertIn('cargo-runtime-selected', answer)
            self.assertTrue(binary.exists())
        finally:
            link.unlink()
            link.symlink_to(original)



    def test_acp_selection_record_retains_the_registered_runtime(self):
        record = self.root / 'selection.json'
        record.write_text(json.dumps({
            "schema": "acp.fframes-service-selection/v1",
            "acp_commit": "e382392cdc4daaff043350d0780aa492d9eb0d90",
            "runtime": str(self.root / 'registered' / 'runtime'),
            "config": "/etc/recorded/service.json",
            "manifest": "/etc/recorded/inputs.json",
            "private_commit": "beaa8d55830c6a4fe2a913c2b2137270823ef803",
        }))
        target = self.root / 'registered' / 'runtime' / 'target'
        shutil.copytree(self.target, target)
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={target}|selection:{record}')
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-runtime-selected', answer)
        self.assertTrue(target.exists())

    def test_acp_selection_record_releases_unregistered_output(self):
        record = self.root / 'selection.json'
        record.write_text(json.dumps({
            "schema": "acp.fframes-service-selection/v1",
            "runtime": str(self.root / 'registered' / 'runtime'),
            "config": "/etc/recorded/service.json",
            "manifest": "/etc/recorded/inputs.json",
        }))
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={self.target}|selection:{record}')
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-output-released', answer)
        self.assertFalse(self.target.exists())
        self.build()

    def test_missing_selection_record_keeps_the_output(self):
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={self.target}|selection:{self.root / "absent.json"}')
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())


if __name__ == '__main__':
    unittest.main()
