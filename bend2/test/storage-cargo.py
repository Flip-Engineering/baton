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



    def selection_paths(self):
        runtime = self.root / 'runtime'
        runtime.mkdir(exist_ok=True)
        config = self.root / 'config.json'
        config.write_text('{}\n')
        manifest = self.root / 'inputs.json'
        manifest.write_text('{}\n')
        return runtime, config, manifest

    def selection_record(self, runtime, config, manifest, schema="acp.fframes-service-selection/v1"):
        record = {"schema": schema, "acp_commit": "e382392cdc4daaff043350d0780aa492d9eb0d90",
                  "runtime": str(runtime), "config": str(config), "manifest": str(manifest),
                  "private_commit": "beaa8d55830c6a4fe2a913c2b2137270823ef803"}
        return record

    def write_record(self, text):
        record = self.root / 'selection.json'
        record.write_text(text)
        return record

    def apply_roots(self, target, record):
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={target}|selection:{record}')
        return self.call('apply', self.db, 'owner', environment=env)

    def test_compact_maintained_selection_record_retains_the_registered_runtime(self):
        runtime, config, manifest = self.selection_paths()
        target = runtime / 'target'
        shutil.copytree(self.target, target)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions VALUES('owner','admit-runtime',?,'exited','')", (str(target),))
        record = self.write_record(json.dumps(self.selection_record(runtime, config, manifest), separators=(',', ':')))
        answer = self.apply_roots(target, record)
        self.assertIn('cargo-runtime-selected', answer)
        self.assertTrue(target.exists())

    def test_pretty_selection_record_with_escaped_value_retains(self):
        runtime, config, manifest = self.selection_paths()
        escaped = self.root / 'conf"ig.json'
        escaped.write_text('{}\n')
        target = runtime / 'target'
        shutil.copytree(self.target, target)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions VALUES('owner','admit-runtime',?,'exited','')", (str(target),))
        record = self.write_record(json.dumps(self.selection_record(runtime, escaped, manifest), indent=2))
        answer = self.apply_roots(target, record)
        self.assertIn('cargo-runtime-selected', answer)
        self.assertTrue(target.exists())

    def test_unregistered_output_releases_against_a_complete_record(self):
        runtime, config, manifest = self.selection_paths()
        record = self.write_record(json.dumps(self.selection_record(runtime, config, manifest), separators=(',', ':')))
        answer = self.apply_roots(self.target, record)
        self.assertIn('cargo-output-released', answer)
        self.assertFalse(self.target.exists())
        self.build()

    def test_invalid_json_record_keeps_the_output(self):
        self.selection_paths()
        record = self.write_record('{not json')
        answer = self.apply_roots(self.target, record)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())

    def test_missing_schema_record_keeps_the_output(self):
        runtime, config, manifest = self.selection_paths()
        fields = self.selection_record(runtime, config, manifest)
        del fields['schema']
        record = self.write_record(json.dumps(fields, separators=(',', ':')))
        answer = self.apply_roots(self.target, record)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())

    def test_missing_required_runtime_keeps_the_output(self):
        runtime, config, manifest = self.selection_paths()
        fields = self.selection_record(runtime, config, manifest)
        del fields['runtime']
        record = self.write_record(json.dumps(fields, separators=(',', ':')))
        answer = self.apply_roots(self.target, record)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())

    def test_truncated_record_keeps_the_output(self):
        runtime, config, manifest = self.selection_paths()
        text = json.dumps(self.selection_record(runtime, config, manifest), separators=(',', ':'))
        record = self.write_record(text[:len(text) // 2])
        answer = self.apply_roots(self.target, record)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())

    def test_selected_ancestor_runtime_directory_retains_nested_output(self):
        runtime, config, manifest = self.selection_paths()
        nested = runtime / 'nested' / 'target'
        nested.parent.mkdir(parents=True)
        shutil.copytree(self.target, nested)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions VALUES('owner','admit-nested',?,'exited','')", (str(nested),))
        record = self.write_record(json.dumps(self.selection_record(runtime, config, manifest), separators=(',', ':')))
        answer = self.apply_roots(nested, record)
        self.assertIn('cargo-runtime-selected', answer)
        self.assertTrue(nested.exists())

    def test_missing_selection_record_keeps_the_output(self):
        env = dict(self.environment,
                   BATON_STORAGE_ROOTS=f'build-output={self.target}|selection:{self.root / "absent.json"}')
        answer = self.call('apply', self.db, 'owner', environment=env)
        self.assertIn('cargo-selection-unknown', answer)
        self.assertTrue(self.target.exists())


    def native_remove(self, path, root, env=None):
        st = os.lstat(path)
        rst = os.stat(root)
        identity = 'dir:%d:%d' % (st.st_dev, st.st_ino)
        root_identity = 'dir:%d:%d' % (rst.st_dev, rst.st_ino)
        run = subprocess.run([str(BINARY), 'remove', str(path), str(root), identity, root_identity],
                             cwd=ROOT, env=env or self.environment, text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run.stdout.strip(), run.stderr

    def test_candidate_bind_mount_boundary_preserves_the_tree(self):
        # The hook injects the kernel's answer for a same-device bind mount:
        # unprivileged fixtures cannot mount, and st_dev alone cannot see it.
        parent = self.root / 'parent'
        candidate = parent / 'candidate'
        (candidate / 'keep').mkdir(parents=True)
        (candidate / 'keep' / 'file.txt').write_text('keep\n')
        env = dict(self.environment, BATON_CARGO_TEST_CANDIDATE_BOUNDARY='exdev')
        answer, stderr = self.native_remove(candidate, parent, env)
        self.assertIn('refused', answer, answer)
        self.assertIn('error=18', answer, answer)
        self.assertIn('preserves candidate mount entry=candidate', stderr)
        self.assertEqual((candidate / 'keep' / 'file.txt').read_text(), 'keep\n')

    def test_candidate_unknown_mount_identity_preserves_the_tree(self):
        # statx unavailable or a mask without the mount id is unknown evidence:
        # it must preserve, never authorize deletion.
        parent = self.root / 'parent'
        candidate = parent / 'candidate'
        (candidate / 'keep').mkdir(parents=True)
        (candidate / 'keep' / 'file.txt').write_text('keep\n')
        env = dict(self.environment, BATON_CARGO_TEST_CANDIDATE_BOUNDARY='unknown')
        answer, stderr = self.native_remove(candidate, parent, env)
        self.assertIn('refused', answer, answer)
        self.assertIn('error=95', answer, answer)
        self.assertEqual((candidate / 'keep' / 'file.txt').read_text(), 'keep\n')

    def test_unknown_child_mount_identity_preserves_the_subtree(self):
        mounted = self.target / 'debug' / 'mount-unknown'
        mounted.mkdir()
        (mounted / 'keep').write_text('retained subtree\n')
        env = dict(self.environment, BATON_CARGO_TEST_MOUNT_UNKNOWN=mounted.name)
        run = subprocess.run([str(BINARY), 'collect', str(self.target), '', str(self.db), str(self.commands)],
                             cwd=ROOT, env=env, text=True, capture_output=True)
        print(run.stdout + run.stderr, end='', flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('refused', run.stdout)
        self.assertIn('error=95', run.stdout)
        self.assertEqual((mounted / 'keep').read_text(), 'retained subtree\n')
        self.assertTrue(self.target.exists())
        self.build()

    def staging_clone(self):
        # A bare repository is the authenticated remote. The upstream checkout
        # and the candidate clone both record it as origin, so the identity and
        # reachability checks run without network access.
        remote = self.root / 'remote.git'
        subprocess.run(['git', 'init', '-q', '--bare', str(remote)],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(remote), 'symbolic-ref', 'HEAD', 'refs/heads/main'],
                       check=True, capture_output=True)
        upstream = self.root / 'upstream'
        subprocess.run(['git', 'clone', '-q', str(remote), str(upstream)],
                       check=True, capture_output=True)
        def git(*args, cwd=None):
            return subprocess.run(['git', '-C', str(cwd or upstream), *args],
                                  check=True, capture_output=True, text=True)
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'user.name', 'Fixture')
        (upstream / 'file.txt').write_text('published\n')
        git('add', '.')
        git('commit', '-qm', 'published')
        git('push', '-q', 'origin', 'HEAD:refs/heads/main')
        staging = self.root / 'staging'
        staging.mkdir()
        clone = staging / 'root-source'
        subprocess.run(['git', 'clone', '-q', str(remote), str(clone)],
                       check=True, capture_output=True)
        git('config', 'user.email', 'fixture@example.invalid', cwd=clone)
        git('config', 'user.name', 'Fixture', cwd=clone)
        return upstream, staging, clone, remote

    def staging_apply(self, staging, source=None):
        roots = 'staging-source=' + str(staging) + (('|' + str(source)) if source else '')
        env = dict(self.environment, BATON_STORAGE_ROOTS=roots)
        return self.call('apply', self.db, 'owner', environment=env)

    def test_staging_source_clone_is_collected_when_published_and_clean(self):
        upstream, staging, clone, remote = self.staging_clone()
        answer = self.staging_apply(staging, upstream)
        self.assertIn('staging-source-released', answer)
        self.assertFalse(clone.exists())
        self.assertTrue(upstream.exists())
        self.assertTrue(remote.exists())

    def test_staging_source_dirty_clone_is_preserved(self):
        upstream, staging, clone, remote = self.staging_clone()
        (clone / 'local-change.txt').write_text('uncommitted\n')
        answer = self.staging_apply(staging, upstream)
        self.assertIn('worktree-dirty', answer)
        self.assertTrue(clone.exists())
        self.assertEqual((clone / 'local-change.txt').read_text(), 'uncommitted\n')

    def test_staging_source_unpublished_commit_is_preserved(self):
        upstream, staging, clone, remote = self.staging_clone()
        subprocess.run(['git', '-C', str(clone), 'commit', '--allow-empty', '-qm', 'local'],
                       check=True, capture_output=True)
        answer = self.staging_apply(staging, upstream)
        self.assertIn('unpublished-commit', answer)
        self.assertTrue(clone.exists())

    def test_staging_source_unpublished_ref_is_preserved(self):
        upstream, staging, clone, remote = self.staging_clone()
        subprocess.run(['git', '-C', str(clone), 'branch', 'local-only'],
                       check=True, capture_output=True)
        answer = self.staging_apply(staging, upstream)
        self.assertIn('unpublished-ref', answer)
        self.assertTrue(clone.exists())

    def test_staging_source_remote_identity_mismatch_is_preserved(self):
        upstream, staging, clone, remote = self.staging_clone()
        other = self.root / 'other.git'
        subprocess.run(['git', 'init', '-q', '--bare', str(other)],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(clone), 'remote', 'set-url', 'origin', str(other)],
                       check=True, capture_output=True)
        answer = self.staging_apply(staging, upstream)
        self.assertIn('remote-identity-mismatch', answer)
        self.assertTrue(clone.exists())

    def test_staging_source_linked_worktree_registration_is_preserved(self):
        upstream, staging, clone, remote = self.staging_clone()
        linked = staging / 'linked-checkout'
        subprocess.run(['git', '-C', str(clone), 'worktree', 'add', '-q', str(linked)],
                       check=True, capture_output=True)
        answer = self.staging_apply(staging, upstream)
        self.assertIn('worktree-dependency', answer)
        self.assertTrue(clone.exists())
        self.assertTrue(linked.exists())
        self.assertTrue((linked / '.git').is_file())

    def test_staging_source_root_without_authenticated_repo_is_refused(self):
        upstream, staging, clone, remote = self.staging_clone()
        env = dict(self.environment, BATON_STORAGE_ROOTS='staging-source=' + str(staging))
        run = subprocess.run([str(BINARY), 'apply', str(self.db), 'owner'],
                             cwd=ROOT, env=env, text=True, capture_output=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('no participating writer covers root', run.stderr)
        self.assertTrue(clone.exists())

if __name__ == '__main__':
    unittest.main()
