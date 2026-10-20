"""Check product help and native argv preservation through real stored messages."""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
import compile_queue


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class NativeCli(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], cwd=self.directory,
                              capture_output=True, text=True)

    def call(self, *args, db=None):
        result = self.invoke(self.db if db is None else db, *args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def actors(self, db=None):
        self.call('attach', 'operator', 'fixture', '', '', db=db)
        self.call('role', 'operator', 'operator', db=db)
        self.call('attach', 'principal', 'fixture', '', '', db=db)
        self.call('role', 'principal', 'principal-conductor', db=db)

    def assert_help(self, result, global_help=False):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        self.assertTrue(result.stdout.startswith('usage: baton ACTION ARGS\n'))
        for operation in ['baton --project PATH ACTION ARGS', 'baton as SESSION ACTION ARGS',
                          'baton DATABASE as SESSION ACTION ARGS', 'Use help ACTION']:
            self.assertIn(operation, result.stdout)
        if global_help:
            for operation in ['dispatch TEXT [OPTIONS]', 'Administration:',
                              'native-attachment-input', 'knowledge']:
                self.assertIn(operation, result.stdout)
        self.assertNotIn('worker threads, 1 to 128', result.stdout)
        return result.stdout

    def test_bare_help_forms_succeed_without_creating_state(self):
        for verb in ['help', '--help']:
            with self.subTest(verb=verb):
                self.assert_help(self.invoke(verb), global_help=verb == '--help')
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_database_help_forms_leave_missing_database_untouched(self):
        expected = self.assert_help(self.invoke('help'))
        for verb in ['help', '--help']:
            with self.subTest(verb=verb):
                self.assertEqual(self.assert_help(self.invoke(self.db, verb)), expected)
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_commands_keep_usage_and_failure_status(self):
        for args in [[], ['unknown'], [self.db, 'message']]:
            with self.subTest(args=args):
                result = self.invoke(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertTrue(result.stderr.startswith('dispatch TEXT [OPTIONS]\n'))
                for operation in ['Administration:', 'native-attachment-input', 'knowledge']:
                    self.assertIn(operation, result.stderr)
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_help_names_every_supported_pretty_read_and_full_report_reader(self):
        self.assert_help(self.invoke('--help'), global_help=True)
        forms = {'status': 'status [--pretty]', 'players': 'players [--pretty]',
                 'orchestra': 'orchestra [--pretty]', 'pending': 'pending [--index] [--pretty]',
                 'player': 'player [--session SESSION | --id SESSION] [--pretty]',
                 'session': 'session [--session SESSION | --id SESSION] [--pretty]',
                 'worktree': 'worktree [--session SESSION]',
                 'read': 'read ID...', 'attempts': 'attempts [--session SESSION]',
                 'knowledge-read': 'knowledge read [--id ID | --index]'}
        for action, form in forms.items():
            with self.subTest(action=action):
                result = self.invoke('help', action)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stderr, '')
                self.assertIn(form, result.stdout)

    def test_every_pretty_read_runs_and_stays_machine_readable(self):
        self.actors()
        self.call('message', 'delivered-note', 'operator', 'principal', 'guide', 'Review λ.')
        forms = [('status',), ('players',), ('orchestra',), ('pending',), ('player', 'principal'),
                 ('session', 'principal'), ('inbox', 'principal'), ('delivery', 'delivered-note'),
                 ('turns', 'principal'), ('knowledge', 'principal')]
        for args in forms:
            with self.subTest(args=args):
                ordinary = self.call(*args)
                readable = self.invoke(self.db, *args, '--pretty')
                self.assertEqual(readable.returncode, 0, readable.stdout + readable.stderr)
                self.assertEqual(readable.stderr, '')
                self.assertEqual(json.loads(readable.stdout), ordinary)
                if ordinary not in ([], {}):
                    self.assertIn('\n', readable.stdout.strip())

    def test_runtime_option_tokens_and_full_bodies_are_committed_unchanged(self):
        self.actors()
        bodies = ['--help', '--threads', '--gpu', '--gpu-build', '--', '',
                  "spaces ' and λ🙂\nsecond line\n"]
        for index, body in enumerate(bodies):
            ident = 'body-' + str(index)
            with self.subTest(body=body):
                result = self.call('message', ident, 'operator', 'principal', 'guide', body)
                self.assertEqual((result['id'], result['sender'], result['recipient'],
                                  result['kind'], result['body']),
                                 (ident, 'operator', 'principal', 'guide', body))
                pending = self.call('inbox', 'principal')
                self.assertEqual(next(row['body'] for row in pending if row['id'] == ident), body)
                with closing(sqlite3.connect(self.db)) as database:
                    self.assertEqual(database.execute(
                        'SELECT body FROM messages WHERE id=?', (ident,)).fetchone(), (body,))

    def test_runtime_option_tokens_are_preserved_in_database_and_session_fields(self):
        for database_name in ['--help', '--threads', '--gpu', '--gpu-build', '--']:
            with self.subTest(database=database_name):
                database_path = './' + database_name
                self.actors(db=database_path)
                for ident in ['--help', '--threads', '--gpu', '--gpu-build', '--', 'λ🙂']:
                    result = self.call('attach', ident, '--threads', '--gpu', '', db=database_path)
                    self.assertEqual((result['id'], result['harness'], result['native']),
                                     (ident, '--threads', '--gpu'))
                    inspected = self.call('as', 'operator', 'session', '--session', ident,
                                          db=database_path)
                    self.assertEqual(inspected[0]['status'], 'completed')
                    self.assertEqual(inspected[0]['stderr'], '')
                    saved = json.loads(inspected[0]['stdout'])
                    self.assertEqual((saved['id'], saved['harness'], saved['native']),
                                     (ident, '--threads', '--gpu'))
                self.assertTrue((self.directory / database_name).is_file())

    def test_native_entry_preserves_argv_zero_order_empty_bytes_and_return_status(self):
        runtime = self.directory / 'runtime.c'
        runtime.write_text(r'''
#include <stdio.h>
int baton2_runtime_main(int argc, char **argv) {
  if (argv[argc] != NULL) return 1;
  for (int i = 0; i < argc; i++) {
    for (const unsigned char *p = (const unsigned char *)argv[i]; *p; p++)
      printf("%02x", *p);
    putchar('\n');
  }
  return 23;
}
''')
        binary = self.directory / 'native entry'
        compiled = compile_queue.compile_cc(
            [os.environ.get('CC', 'clang'), '-std=gnu11',
             '-Wall', '-Wextra', '-Werror',
             str(ROOT / 'bend2/src/host/native-entry.c'),
             str(runtime), '-o', str(binary)],
            [ROOT / 'bend2/src/host/native-entry.c', runtime], binary, self.directory)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        arguments = ['--help', '--threads', '--gpu', '--gpu-build', '--',
                     '', "λ🙂 ' spaces\nsecond line", '']
        result = subprocess.run([str(binary), *arguments], cwd=self.directory,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        expected = [str(binary), '--', *arguments]
        self.assertEqual(result.stdout.splitlines(), [arg.encode().hex() for arg in expected])

    def test_focused_entry_routes_recovery_to_helper_and_general_cli_to_full_sibling(self):
        runtime = self.directory / 'runtime.c'
        runtime.write_text('int baton2_runtime_main(int argc, char **argv) { (void)argc; (void)argv; return 41; }\n')
        binary = self.directory / 'baton'
        compiled = compile_queue.compile_cc(
            [os.environ.get('CC', 'clang'), '-std=gnu11',
             '-Wall', '-Wextra', '-Werror',
             '-DBATON2_RECEIVE_FOCUSED',
             str(ROOT / 'bend2/src/host/native-entry.c'),
             str(runtime), '-o', str(binary)],
            [ROOT / 'bend2/src/host/native-entry.c', runtime], binary, self.directory)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        helper = self.directory / 'baton-recovery'
        full = self.directory / 'baton-full'
        helper.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(["recovery",*sys.argv[1:]]))\n')
        full.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(["full",*sys.argv[1:]]))\n')
        helper.chmod(0o755)
        full.chmod(0o755)

        recovered = subprocess.run([str(binary), '--recover-receive', 'db', 'session',
                                     'attempt', '1', 'omp'], cwd=self.directory,
                                   capture_output=True, text=True)
        self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
        self.assertEqual(json.loads(recovered.stdout),
                         ['recovery', '--recover-receive', 'db', 'session', 'attempt', '1', 'omp'])
        self.assertEqual(recovered.stderr, '')

        observer = subprocess.run([str(binary), 'db', 'recover-observer',
                                   'session', 'observer'], cwd=self.directory,
                                  capture_output=True, text=True)
        self.assertEqual(observer.returncode, 0, observer.stdout + observer.stderr)
        self.assertEqual(json.loads(observer.stdout),
                         ['recovery', 'db', 'recover-observer', 'session', 'observer'])
        self.assertEqual(observer.stderr, '')

        general = subprocess.run([str(binary), 'status'], cwd=self.directory,
                                 capture_output=True, text=True)
        self.assertEqual(general.returncode, 0, general.stdout + general.stderr)
        self.assertEqual(json.loads(general.stdout), ['full', 'status'])
        self.assertEqual(general.stderr, '')

    def test_help_before_dispatch_reaches_the_cli_not_the_dispatch_frontend(self):
        runtime = self.directory / 'runtime.c'
        runtime.write_text(r'''
#include <stdio.h>
int baton2_runtime_main(int argc, char **argv) {
  if (argv[argc] != NULL) return 1;
  for (int i = 0; i < argc; i++) {
    for (const unsigned char *p = (const unsigned char *)argv[i]; *p; p++)
      printf("%02x", *p);
    putchar('\n');
  }
  return 23;
}
''')
        binary = self.directory / 'baton-entry'
        compiled = compile_queue.compile_cc(
            [os.environ.get('CC', 'clang'), '-std=gnu11',
             '-Wall', '-Wextra', '-Werror',
             str(ROOT / 'bend2/src/host/native-entry.c'),
             str(runtime), '-o', str(binary)],
            [ROOT / 'bend2/src/host/native-entry.c', runtime], binary, self.directory)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        for arguments in (['help', 'dispatch'], ['help', 'task'],
                          ['--help', 'dispatch'], ['-h', 'dispatch']):
            with self.subTest(arguments=arguments):
                result = subprocess.run([str(binary), *arguments], cwd=self.directory,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
                self.assertEqual(result.stderr, '')
                expected = [str(binary), '--', *arguments]
                self.assertEqual(result.stdout.splitlines(),
                                 [arg.encode().hex() for arg in expected])


if __name__ == '__main__':
    unittest.main()
