"""Regression for the installed dispatch runtime lookup (#947).

The test compiles the production native-entry router with a stub runtime and
places it in a package layout. Dispatch must use BATON2_NODE, a sibling
bin/node, or the bundled libexec/baton2/repl/bun instead of requiring node on
PATH. The fake runtimes record the helper and arguments they receive.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

import compile_queue


ROOT = pathlib.Path(__file__).resolve().parents[2]
NATIVE_ENTRY = pathlib.Path(os.environ.get('BATON2_NATIVE_ENTRY', ROOT / 'bend2/src/host/native-entry.c')).resolve()
STUB = 'int baton2_runtime_main(int argc, char **argv) { return 0; }\n'
RUNTIME = """#!/bin/sh
printf 'runtime\\t%s\\n' "$0" > "$RECEIPT"
for arg in "$@"; do printf 'arg\\t%s\\n' "$arg" >> "$RECEIPT"; done
exit 0
"""


def compiler():
    for name in (os.environ.get('CC'), 'clang', 'clang-19', '/usr/bin/clang-19'):
        if not name:
            continue
        path = pathlib.Path(name)
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        found = shutil.which(name)
        if found:
            return found
    raise unittest.SkipTest('no clang compiler is available')


class DispatchRuntime(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.helper = self.root / 'libexec/baton2/task-start.mjs'
        self.helper.parent.mkdir(parents=True)
        self.helper.write_text('fixture helper\n')
        self.bundled = self.root / 'libexec/baton2/repl/bun'
        self.bundled.parent.mkdir(parents=True)
        self.bundled.write_text(RUNTIME)
        self.bundled.chmod(0o755)
        self.receipt = self.root / 'receipt'
        stub = self.root / 'stub.c'
        stub.write_text(STUB)
        self.exe = self.bin / 'dispatch-test'
        cc = compiler()
        compile_queue.compile_cc([cc, '-O1', '-pthread', str(NATIVE_ENTRY), str(stub),
                                  '-o', str(self.exe)],
                                 inputs=[NATIVE_ENTRY, stub], output=self.exe,
                                 cwd=ROOT, compiler=cc)

    def run_dispatch(self, extra=None):
        self.receipt.unlink(missing_ok=True)
        env = {'PATH': '/usr/bin:/bin', 'RECEIPT': str(self.receipt)}
        if extra:
            env.update(extra)
        return subprocess.run([str(self.exe), 'dispatch', '--to', 'player',
                               '--text', 'hello'], env=env, capture_output=True, text=True,
                              timeout=30)

    def receipt_rows(self):
        return [line.split('\t', 1) for line in self.receipt.read_text().splitlines()]

    def test_bundled_bun_runs_dispatch_without_node_on_path(self):
        result = self.run_dispatch()
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.receipt_rows()
        self.assertEqual(rows[0], ['runtime', str(self.bundled)])
        args = [value for kind, value in rows[1:]]
        self.assertEqual(args[0], str(self.helper))
        self.assertIn('--baton2', args)
        self.assertIn('--database', args)
        self.assertEqual(args[-4:], ['--to', 'player', '--text', 'hello'])

    def test_explicit_node_runtime_takes_precedence(self):
        node = self.root / 'custom-node'
        node.write_text(RUNTIME)
        node.chmod(0o755)
        result = self.run_dispatch({'BATON2_NODE': str(node)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.receipt_rows()[0], ['runtime', str(node)])

    def test_sibling_node_takes_precedence_over_bundled_runtime(self):
        node = self.bin / 'node'
        node.write_text(RUNTIME)
        node.chmod(0o755)
        result = self.run_dispatch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.receipt_rows()[0], ['runtime', str(node)])


if __name__ == '__main__':
    unittest.main()
