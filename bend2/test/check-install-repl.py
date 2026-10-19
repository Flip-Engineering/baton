"""Verify the bundled REPL dependency accepted and refused by check-install."""
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECK = load('baton_check_install', ROOT / 'bend2/scripts/check-install.py')
STAGER = load('baton_stage_repl', ROOT / 'bend2/scripts/stage-repl-compiler.py')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def locked_source(root, lock):
    source = pathlib.Path(os.environ.get('BATON2_REPL_COMPILER_SOURCE',
                                         ROOT / 'bend2/compiler/upstream'))
    missing = []
    for row in lock['files']:
        path = source / row['path']
        if not path.is_file() or sha256(path) != row['sha256']:
            missing.append(row)
    if not missing:
        return source
    overlay = root / 'compiler-source'
    shutil.copytree(source, overlay)
    for row in missing:
        relative = 'bend2/compiler/upstream/' + row['path']
        try:
            commits = subprocess.check_output(
                ['git', 'rev-list', '--all', '--', relative], cwd=ROOT, text=True).split()
        except (OSError, subprocess.CalledProcessError):
            raise unittest.SkipTest('git history is unavailable for the REPL lock: ' + row['path'])
        found = None
        for commit in commits:
            try:
                data = subprocess.check_output(['git', 'show', commit + ':' + relative], cwd=ROOT)
            except (OSError, subprocess.CalledProcessError):
                continue
            if hashlib.sha256(data).hexdigest() == row['sha256']:
                found = data
                break
        if found is None:
            raise unittest.SkipTest('no history blob matches the REPL lock: ' + row['path'])
        (overlay / row['path']).write_bytes(found)
    return overlay


class ReplDependency(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.prefix = self.root / 'prefix'
        runtime = self.root / 'bun'
        runtime.write_text('#!/bin/sh\nexit 0\n')
        runtime.chmod(0o755)
        notices = self.root / 'Bun-NOTICES'
        notices.write_text('Bun runtime notices for the fixture.\n')
        lock = json.loads((ROOT / 'bend2/compiler/repl-upstream.lock.json').read_text())
        source = locked_source(self.root, lock)
        self.destination = self.prefix / 'libexec/baton2/repl'
        fact = STAGER.stage(source, runtime, sha256(runtime), notices, self.destination)
        self.entry = {'id': 'bend2-repl-compiler', 'required': True,
                      'path': 'libexec/baton2/repl', **fact}
        self.manifest = {'selected_dependencies': [self.entry]}

    def test_staged_dependency_is_accepted(self):
        self.assertEqual(CHECK.verify_repl(self.prefix, self.manifest), self.entry)

    def test_missing_dependency_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'one bundled Bend2 REPL compiler'):
            CHECK.verify_repl(self.prefix, {'selected_dependencies': []})

    def test_extra_file_is_refused(self):
        (self.destination / 'upstream/extra.ts').write_text('extra\n')
        with self.assertRaisesRegex(RuntimeError, 'outside its manifest'):
            CHECK.verify_repl(self.prefix, self.manifest)

    def test_changed_file_is_refused(self):
        path = self.destination / 'upstream/base.bend'
        path.write_text(path.read_text() + '\n')
        with self.assertRaisesRegex(RuntimeError, 'differs from its manifest'):
            CHECK.verify_repl(self.prefix, self.manifest)

    def test_wrong_mode_is_refused(self):
        (self.destination / 'compiler').chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'differs from its manifest'):
            CHECK.verify_repl(self.prefix, self.manifest)

    def test_changed_compiler_manifest_is_refused(self):
        path = self.destination / 'upstream/compiler.json'
        manifest = json.loads(path.read_text())
        manifest['frontend'] = 'upstream/other.ts'
        path.write_text(json.dumps(manifest) + '\n')
        with self.assertRaisesRegex(RuntimeError, 'manifest differs from its package hash'):
            CHECK.verify_repl(self.prefix, self.manifest)

    def test_changed_provenance_is_refused(self):
        path = self.destination / 'upstream.provenance.json'
        provenance = json.loads(path.read_text())
        provenance['lock_sha256'] = '0' * 64
        path.write_text(json.dumps(provenance) + '\n')
        row = next(row for row in self.entry['files']
                   if row['path'] == 'upstream.provenance.json')
        row['sha256'] = sha256(path)
        row['bytes'] = path.stat().st_size
        compiler_path = self.destination / 'upstream/compiler.json'
        compiler = json.loads(compiler_path.read_text())
        compiler['files'] = self.entry['files']
        compiler_path.write_text(json.dumps(compiler) + '\n')
        self.entry['sha256'] = sha256(compiler_path)
        with self.assertRaisesRegex(RuntimeError, 'source provenance differs'):
            CHECK.verify_repl(self.prefix, self.manifest)


if __name__ == '__main__':
    unittest.main()
