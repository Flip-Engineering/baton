"""Check product help and native argv preservation through real stored messages."""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing


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

    def assert_help(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        self.assertTrue(result.stdout.startswith('usage: baton2 DATABASE COMMAND ARGS\n'))
        for operation in ['start SESSION', 'recruit ID PARENT', 'receiver SESSION',
                          'dispatch-file ID', 'land-checked PLAYER_ID']:
            self.assertIn(operation, result.stdout)
        self.assertNotIn('worker threads, 1 to 128', result.stdout)
        return result.stdout

    def test_bare_help_forms_succeed_without_creating_state(self):
        expected = None
        for verb in ['help', '--help']:
            with self.subTest(verb=verb):
                text = self.assert_help(self.invoke(verb))
                if expected is None:
                    expected = text
                self.assertEqual(text, expected)
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_database_help_forms_leave_missing_database_untouched(self):
        expected = self.assert_help(self.invoke('--help'))
        for verb in ['help', '--help']:
            with self.subTest(verb=verb):
                self.assertEqual(self.assert_help(self.invoke(self.db, verb)), expected)
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_commands_keep_usage_and_failure_status(self):
        expected = self.assert_help(self.invoke('help'))
        for args in [[], ['unknown'], [self.db, 'message']]:
            with self.subTest(args=args):
                result = self.invoke(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr.rstrip('\n'), expected.rstrip('\n'))
                self.assertEqual(list(self.directory.iterdir()), [])

    def test_help_names_every_supported_pretty_read_and_full_report_reader(self):
        text = self.assert_help(self.invoke('--help'))
        for form in ['status --pretty', 'players --pretty', 'orchestra --pretty', 'pending --pretty',
                     'player ID --pretty', 'session ID --pretty', 'inbox ID --pretty',
                     'delivery ID --pretty', 'turns PLAYER_ID --pretty', 'knowledge READER --pretty',
                     'worktree ID --pretty']:
            self.assertIn(form, text)
        for reader in ['delivery MESSAGE_ID', 'turns PLAYER_ID', 'latestReport']:
            self.assertIn(reader, text)

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
                self.actors(db=database_name)
                for ident in ['--help', '--threads', '--gpu', '--gpu-build', '--', 'λ🙂']:
                    result = self.call('attach', ident, '--threads', '--gpu', '', db=database_name)
                    self.assertEqual((result['id'], result['harness'], result['native']),
                                     (ident, '--threads', '--gpu'))
                    saved = self.call('session', ident, db=database_name)
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
        compiled = subprocess.run([os.environ.get('CC', 'clang'), '-std=c11',
                                   '-Wall', '-Wextra', '-Werror',
                                   str(ROOT / 'bend2/src/host/native-entry.c'),
                                   str(runtime), '-o', str(binary)], capture_output=True, text=True)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        arguments = ['--help', '--threads', '--gpu', '--gpu-build', '--',
                     '', "λ🙂 ' spaces\nsecond line", '']
        result = subprocess.run([str(binary), *arguments], cwd=self.directory,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        expected = [str(binary), '--', *arguments]
        self.assertEqual(result.stdout.splitlines(), [arg.encode().hex() for arg in expected])


if __name__ == '__main__':
    unittest.main()
