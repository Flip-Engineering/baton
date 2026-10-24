"""Offline Cargo target release in private NVMe fixtures."""
import contextlib
import fcntl
import os
import pathlib
import select
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BINARY = pathlib.Path(os.environ['BATON2_STORAGE_CARGO_TEST']).resolve()
CARGO = pathlib.Path(os.environ['BATON2_TEST_CARGO']).absolute()
RUSTC = pathlib.Path(os.environ['BATON2_TEST_RUSTC']).absolute()


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
CREATE TABLE log_files(session TEXT,log TEXT);
''')
            db.execute("INSERT INTO sessions VALUES('owner',NULL,'fixture','',?,'','')", (str(self.source),))
        self.commands = self.root / 'commands'
        self.commands.mkdir()
        installed = self.root / 'installed'
        installed.write_text('installed\n')
        for name in ['baton', 'baton2', 'baton.pre-fixture']:
            (self.commands / name).symlink_to(installed)
        self.build()

    def cargo_argv(self, *args):
        return ['nice', '-n', '19', 'ionice', '-c3', str(CARGO), 'build', '--offline', '-j1', *args]

    def build(self, *args, environment=None):
        run = subprocess.run(self.cargo_argv(*args), cwd=self.source,
                             env=environment or self.environment, text=True, capture_output=True)
        print(run.stdout, end='', flush=True)
        print(run.stderr, end='', flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def call(self, *args, environment=None):
        run = subprocess.run([str(BINARY), *map(str, args)], cwd=ROOT,
                             env=environment or self.environment, text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run.stdout.strip()

    def collect(self, target=None, associated='', commands=None):
        return self.call('collect', target or self.target, associated, self.db,
                         self.commands if commands is None else commands)

    def test_generic_apply_keeps_an_unknown_service_selection(self):
        env = dict(self.environment, BATON_STORAGE_ROOTS=f'build-output={self.target}')
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
    def writer(self):
        ready, release = self.root / 'build-ready', self.root / 'build-release'
        os.mkfifo(ready)
        os.mkfifo(release)
        ready_fd = os.open(ready, os.O_RDWR | os.O_NONBLOCK)
        release_fd = os.open(release, os.O_RDWR)
        env = dict(self.environment, BATON_CARGO_BUILD_READY=str(ready),
                   BATON_CARGO_BUILD_RELEASE=str(release))
        with (self.root / 'writer.stdout').open('w') as stdout, (self.root / 'writer.stderr').open('w') as stderr:
            child = subprocess.Popen(self.cargo_argv(), cwd=self.source, env=env,
                                     stdout=stdout, stderr=stderr)
            pidfd = os.pidfd_open(child.pid)
            try:
                readable, _, _ = select.select([ready_fd, pidfd], [], [])
                self.assertIn(ready_fd, readable, 'Cargo exited before its build script was ready')
                self.assertEqual(os.read(ready_fd, 1), b'r')
                yield child
            finally:
                os.write(release_fd, b'x')
                child.wait()
                for descriptor in [ready_fd, release_fd, pidfd]:
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
        pidfd = os.pidfd_open(child.pid)
        try:
            readable, _, _ = select.select([ready_fd, pidfd], [], [])
            self.assertIn(ready_fd, readable, 'collector exited before rename: ' + str(child.poll()))
            self.assertEqual(os.read(ready_fd, 1), b'\x01')
            self.assertFalse(self.target.exists())
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.write(release_fd, b'x')
            stdout, stderr = child.communicate()
            for descriptor in [ready_fd, release_fd, pidfd]:
                os.close(descriptor)
        try:
            self.assertEqual(child.returncode, 0, stdout + stderr)
            self.assertTrue(stdout.startswith('removed\t'), stdout + stderr)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(lock)


if __name__ == '__main__':
    unittest.main()
