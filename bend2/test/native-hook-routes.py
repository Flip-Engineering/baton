"""Exercise production C routing with a runtime argv fixture and private siblings.

The caller queues two C-only builds of native-entry.c and native-route-runtime.c:
BATON2_ROUTE_FOCUSED uses BATON2_RECEIVE_FOCUSED;
BATON2_ROUTE_FULL uses BATON2_NATIVE_RECEIVER_ROUTER.
The fixture binaries are used only by these routing tests.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class NativeHookRoutes(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-hook-routes-')
        self.addCleanup(temporary.cleanup)
        self.prefix = Path(temporary.name)
        self.focused = self.prefix / 'baton'
        self.full = self.prefix / 'baton-full'
        shutil.copy2(os.environ['BATON2_ROUTE_FOCUSED'], self.focused)
        shutil.copy2(os.environ['BATON2_ROUTE_FULL'], self.full)

    def route(self, executable, args, expected, data=''):
        result = subprocess.run([str(executable), *args], input=data,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '\n'.join([str(expected), '--', *args]) + '\n' + data)

    def test_focused_stop_hook_reaches_focused_runtime(self):
        self.route(self.focused, ['--stop-hook'], self.focused,
                   '{"hook_event_name":"PostToolUse","tool_name":"Bash"}\n')

    def test_full_stop_hook_reaches_focused_runtime(self):
        self.route(self.full, ['--stop-hook'], self.focused,
                   '{"hook_event_name":"Stop","stop_hook_active":true}\n')

    def test_focused_redelivery_preserves_database_and_message_argv(self):
        self.route(self.focused, ['--redeliver-message', str(self.prefix / 'database λ.sqlite'),
                                 'message:operator:two words'], self.focused)

    def test_full_redelivery_preserves_database_and_message_argv(self):
        self.route(self.full, ['--redeliver-message', str(self.prefix / 'database λ.sqlite'),
                              'message:operator:two words'], self.focused)

    def test_public_help_keeps_the_full_cli(self):
        self.route(self.focused, ['help', 'receiver'], self.full)

    def test_unknown_flag_keeps_the_full_cli(self):
        self.route(self.focused, ['--unknown-native-route'], self.full)

    def test_codex_session_preserves_native_message_and_token(self):
        for executable in (self.focused, self.full):
            for token in ([], ['claim-token']):
                with self.subTest(executable=executable, token=token):
                    self.route(executable, [str(self.prefix / 'database λ.sqlite'),
                               'codex-inbox-session', 'worker',
                               '019a174b-1234-7123-8123-123456789abc',
                               'message:operator:two words', *token], self.focused)

    def test_codex_follow_preserves_session_and_native(self):
        for executable in (self.focused, self.full):
            with self.subTest(executable=executable):
                self.route(executable, [str(self.prefix / 'database.sqlite'),
                           'codex-inbox-follow', 'worker',
                           '019a174b-1234-7123-8123-123456789abc'], self.focused)

    def test_codex_delivery_preserves_complete_pointer(self):
        for executable in (self.focused, self.full):
            with self.subTest(executable=executable):
                self.route(executable, [str(self.prefix / 'database.sqlite'),
                           'codex-inbox-deliver', '019a174b-1234-7123-8123-123456789abc',
                           'Pending input λ🙂 with spaces.'], self.focused)

    def test_codex_witness_preserves_native(self):
        for executable in (self.focused, self.full):
            with self.subTest(executable=executable):
                self.route(executable, [str(self.prefix / 'database.sqlite'),
                           'codex-input-witness', '019a174b-1234-7123-8123-123456789abc'],
                           self.focused)


if __name__ == '__main__':
    unittest.main()
