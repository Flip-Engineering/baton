"""Check native helper build routing with a recording queue driver."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DRIVER = '''import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['ROLE_LOG'], 'a') as out:
    out.write(json.dumps(args) + '\\n')
if args[1] == 'bend':
    header = '#include <curl/curl.h>\\n' if os.environ.get('ROLE_CURL') == '1' else ''
    header += ''.join('#include "' + name + '"\\n' for name in os.environ.get('ROLE_INCLUDES', '').split(',') if name)
    pathlib.Path(args[args.index('-o') + 1]).write_text(header + 'int main(void) { return 0; }\\n')
elif args[1] == 'cc' and os.environ.get('ROLE_INCLUDES'):
    source = pathlib.Path(args[args.index('--source') + 1])
    for name in os.environ['ROLE_INCLUDES'].split(','):
        companion = source.parent / name
        expected = pathlib.Path.cwd() / 'bend2/src/host' / name
        assert companion.is_symlink() and companion.resolve() == expected.resolve(), str(companion)
'''


class HelperRole(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scripts = self.root / 'bend2/scripts'
        scripts.mkdir(parents=True)
        for name in ('build-native.sh', 'queue-entry.sh'):
            shutil.copyfile(ROOT / 'bend2/scripts' / name, scripts / name)
        (scripts / 'bend-lineage-guard.sh').write_text('exit 0\n')
        entries = self.root / 'bend2/src/coordinator'
        entries.mkdir(parents=True)
        for name in ('main', 'receive-focused', 'receive-recovery-focused'):
            (entries / (name + '.bend')).touch()
        self.compiler = self.root / 'compiler'
        self.compiler.write_text('#!/bin/sh\nprintf "bend 2.0.25\\n"\n')
        self.compiler.chmod(0o755)
        self.driver = self.root / 'driver.py'
        self.driver.write_text(DRIVER)
        self.log = self.root / 'calls.jsonl'
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(('BEND', 'BATON2_'))}
        self.env.update(BEND=str(self.compiler), BATON2_NATIVE_QUEUE_DRIVER=str(self.driver),
                        ROLE_LOG=str(self.log), TMPDIR=str(self.root))

    def build(self, entry, **env):
        return subprocess.run(['sh', str(self.root / 'bend2/scripts/build-native.sh'),
                               'bend2/src/coordinator/' + entry + '.bend', 'out/helper'],
                              env={**self.env, **env}, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_focused_entry_selects_its_wrapper(self):
        result = self.build('receive-focused')
        self.assertEqual(result.returncode, 0, result.stderr)
        bend, cc = self.calls()
        self.assertEqual(bend[1], 'bend')
        self.assertEqual(cc[1], 'cc')
        self.assertIn('--main-rename', cc)
        self.assertIn('--link-extra', cc)
        self.assertIn('--link-flags=-O1 -pthread -lsqlite3 -lm -DBATON2_RECEIVE_FOCUSED', cc)

    def test_recovery_entry_selects_its_wrapper(self):
        result = self.build('receive-recovery-focused')
        self.assertEqual(result.returncode, 0, result.stderr)
        _, cc = self.calls()
        self.assertIn('--main-rename', cc)
        self.assertIn('--link-extra', cc)
        self.assertIn('--link-flags=-O1 -pthread -lsqlite3 -lm -DBATON2_RECOVERY_HELPER', cc)

    def test_http_entries_link_libcurl(self):
        entries = ('main', 'receive-focused', 'receive-recovery-focused', 'plain')
        (self.root / 'bend2/src/coordinator/plain.bend').touch()
        for entry in entries:
            with self.subTest(entry=entry):
                self.log.unlink(missing_ok=True)
                result = self.build(entry, ROLE_CURL='1')
                self.assertEqual(result.returncode, 0, result.stderr)
                _, cc = self.calls()
                if entry == 'plain':
                    self.assertIn('-lcurl', cc)
                else:
                    flags = next(arg for arg in cc if arg.startswith('--link-flags='))
                    self.assertIn('-lcurl', flags.split())

    def test_role_selection_without_readlink_f(self):
        tools = self.root / 'bin'
        tools.mkdir()
        readlink = tools / 'readlink'
        readlink.write_text('#!/bin/sh\nexit 1\n')
        readlink.chmod(0o755)
        result = self.build('receive-recovery-focused',
                            PATH=str(tools) + os.pathsep + self.env['PATH'])
        self.assertEqual(result.returncode, 0, result.stderr)
        _, cc = self.calls()
        self.assertIn('--link-flags=-O1 -pthread -lsqlite3 -lm -DBATON2_RECOVERY_HELPER', cc)

    def include_sources(self):
        host = self.root / 'bend2/src/host'
        host.mkdir(parents=True)
        for name in ('persistent-path.h', 'jsonl.c'):
            (host / name).write_text('/* ' + name + ' */\n')

    def test_generated_includes_are_bound_before_cc(self):
        self.include_sources()
        result = self.build('main', ROLE_INCLUDES='persistent-path.h,jsonl.c')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls()[-1][1], 'cc')

    def test_existing_correct_generated_include_is_reused(self):
        self.include_sources()
        output = self.root / 'out'
        output.mkdir()
        (output / 'jsonl.c').symlink_to(self.root / 'bend2/src/host/jsonl.c')
        result = self.build('main', ROLE_INCLUDES='jsonl.c')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unrelated_generated_include_is_rejected(self):
        self.include_sources()
        output = self.root / 'out'
        output.mkdir()
        (output / 'jsonl.c').write_text('/* unrelated */\n')
        result = self.build('main', ROLE_INCLUDES='jsonl.c')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('generated C input resolves jsonl.c to an unexpected file', result.stderr)
        self.assertEqual([call[1] for call in self.calls()], ['bend'])

    def test_conflicting_explicit_role_is_rejected(self):
        result = self.build('receive-recovery-focused', BATON2_RECEIVE_FOCUSED='1')
        self.assertEqual(result.returncode, 78)
        self.assertIn('recovery-helper-with-other-native-entry', result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == '__main__':
    unittest.main()
