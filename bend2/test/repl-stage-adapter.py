#!/usr/bin/env python3
"""Focused regression for the REPL staging adapter call form (#1001).

The test transforms the actual pinned compiler source and exercises staging
with a disposable runtime and notices file. It never executes the staged
runtime, the launcher, the compiler, or any child build.
"""
import hashlib
import importlib.util
import pathlib
import stat
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/stage-repl-compiler.py'
SOURCE = ROOT / 'bend2/compiler/upstream'


def load_adapter():
    spec = importlib.util.spec_from_file_location('baton_repl_stage_adapter', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class StageAdapterFixtures(unittest.TestCase):
    def setUp(self):
        self.adapter = load_adapter()
        self.pinned = (SOURCE / 'main.ts').read_text()

    def test_pinned_source_uses_queue_argv(self):
        self.assertIn('child.spawnSync(queue, argv, { encoding: "utf8" })', self.pinned)
        self.assertNotIn('child.spawnSync(queue, invocation', self.pinned)

    def test_transform_routes_diagnostics_and_keeps_argv(self):
        extended = self.adapter.extend_frontend(self.pinned)
        self.assertIn('const result = child.spawnSync(queue, argv, { encoding: "utf8" });', extended)
        self.assertIn('if (diagnosticsToStderr) {', extended)
        self.assertIn('process.stderr.write(result.stdout);', extended)
        self.assertIn('process.stderr.write(result.stderr);', extended)
        self.assertIn('args: string[], diagnosticsToStderr = false): void {', extended)
        self.assertIn('bangs ? gpu : cpu, diagnosticsToStderr);', extended)

    def test_transform_rejects_ambiguous_extension_point(self):
        extended = self.adapter.extend_frontend(self.pinned)
        with self.assertRaises(RuntimeError):
            self.adapter.extend_frontend(extended)

    def test_stage_copies_and_transforms_without_execution(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = pathlib.Path(temp)
            runtime = temp / 'bun'
            runtime.write_bytes(b'#!/bin/sh\nexit 0\n')
            runtime.chmod(0o755)
            notices = temp / 'Bun-NOTICES'
            notices.write_text('Bun notices fixture\n')
            destination = temp / 'repl'
            fact = self.adapter.stage(SOURCE, runtime, sha256(runtime.read_bytes()),
                                      notices, destination)
            staged_main = (destination / 'upstream/main.ts').read_text()
            self.assertIn('child.spawnSync(queue, argv, { encoding: "utf8" });', staged_main)
            self.assertIn('if (diagnosticsToStderr) {', staged_main)
            self.assertIn('bangs ? gpu : cpu, diagnosticsToStderr);', staged_main)
            self.assertTrue((destination / 'bun').is_file())
            self.assertTrue((destination / 'notices/Bun-NOTICES').is_file())
            self.assertTrue((destination / 'notices/Bend-LICENSE').is_file())
            launcher = destination / 'compiler'
            self.assertTrue(launcher.is_file())
            self.assertTrue(launcher.stat().st_mode & stat.S_IXUSR)
            self.assertTrue((destination / 'upstream.lock.json').is_file())
            manifest = (destination / 'upstream/compiler.json').read_text()
            self.assertIn('runtimeSha256', manifest)
            self.assertEqual(fact['manifest'], 'upstream/compiler.json')
            self.assertEqual(fact['sha256'], sha256((destination / 'upstream/compiler.json').read_bytes()))

    def test_stage_rejects_wrong_runtime_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = pathlib.Path(temp)
            runtime = temp / 'bun'
            runtime.write_bytes(b'#!/bin/sh\nexit 0\n')
            runtime.chmod(0o755)
            notices = temp / 'Bun-NOTICES'
            notices.write_text('Bun notices fixture\n')
            with self.assertRaises(RuntimeError):
                self.adapter.stage(SOURCE, runtime, '0' * 64, notices, temp / 'repl')


if __name__ == '__main__':
    unittest.main()
