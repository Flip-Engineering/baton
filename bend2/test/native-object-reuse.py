"""Reject changed producer inputs before a native router relink starts."""
import argparse
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'native_object_reuse', ROOT / 'tools/cgen-clang-parallel/build_and_measure.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class NativeObjectReuse(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-object-identity-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'generated.c'
        self.header = self.root / 'runtime.h'
        self.object = self.root / 'runtime.o'
        self.entry = self.root / 'bend2/src/coordinator/main.bend'
        self.entry.parent.mkdir(parents=True)
        for path, text in [(self.source, 'producer C'), (self.header, 'producer header'),
                           (self.object, 'producer object'), (self.entry, 'producer Main')]:
            path.write_text(text)
        self.toolchain = {'compiler': 'selected compiler identity'}
        self.args = argparse.Namespace(source=self.source, build_only=True, main_rename=True,
                                       cflags=['-O1', '-pthread'])
        self.extra = ['wrapper.c', '-lsqlite3', '-lm', '-DBATON2_NATIVE_RECEIVER_ROUTER']
        self.receipt = {
            'schema': 'baton-cgen-clang-parallel-build-v1', 'mode': 'sharded-build',
            'source': BUILD.file_identity(self.source),
            'native_entry': BUILD.file_identity(self.entry),
            'compile_flags': ['-O1', '-pthread', '-Dmain=baton2_runtime_main'],
            'link_flags': ['-O1', '-pthread', 'wrapper.c', '-lsqlite3', '-lm'],
            'toolchain': self.toolchain,
            'build': {'objects': [str(self.object)],
                      'object_files': [BUILD.file_identity(self.object)]},
            'process_records': [{'exit': 0, 'dependencies': [BUILD.file_identity(self.header)]}],
        }

    def validate(self, receipt=None):
        with patch.object(BUILD, 'toolchain_receipt', return_value=self.toolchain):
            BUILD.validate_relink(receipt or self.receipt, self.args, self.extra)

    def test_unchanged_completed_producer_can_supply_its_objects(self):
        self.validate()

    def test_changed_original_object_is_rejected(self):
        self.object.write_text('different object')
        with self.assertRaisesRegex(RuntimeError, 'input changed'):
            self.validate()

    def test_changed_header_is_rejected(self):
        self.header.write_text('different header')
        with self.assertRaisesRegex(RuntimeError, 'input changed'):
            self.validate()

    def test_changed_header_symlink_is_rejected(self):
        alias = self.root / 'selected.h'
        alias.symlink_to(self.header)
        self.receipt['process_records'][0]['dependencies'] = [BUILD.file_identity(alias)]
        replacement = self.root / 'replacement.h'
        replacement.write_bytes(self.header.read_bytes())
        alias.unlink()
        alias.symlink_to(replacement)
        with self.assertRaisesRegex(RuntimeError, 'input changed'):
            self.validate()

    def test_dependency_paths_preserve_escaped_spaces(self):
        header = self.root / 'runtime header.h'
        header.write_text('header with a space in its path')
        dependencies = self.root / 'runtime.d'
        escaped = str(header).replace(' ', '\\ ')
        dependencies.write_text('baton2-output: ' + str(self.source) + ' \\\n ' + escaped + '\n')
        self.assertEqual(BUILD.dependency_files(dependencies, self.root),
                         [BUILD.file_identity(path) for path in sorted([self.source, header])])

    def test_changed_generated_c_is_rejected(self):
        self.source.write_text('different generated C')
        with self.assertRaisesRegex(RuntimeError, 'generated C differs'):
            self.validate()

    def test_changed_toolchain_is_rejected(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['toolchain'] = {'compiler': 'another compiler identity'}
        with self.assertRaisesRegex(RuntimeError, 'compiler, tools or compile flags'):
            self.validate(receipt)

    def test_changed_flags_or_missing_main_rename_are_rejected(self):
        self.args.cflags = ['-O0', '-pthread']
        with self.assertRaisesRegex(RuntimeError, 'compile flags'):
            self.validate()
        self.args.main_rename = False
        with self.assertRaisesRegex(RuntimeError, 'main rename'):
            self.validate()

    def test_another_native_role_cannot_supply_the_full_router(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['link_flags'].append('-DBATON2_RECEIVE_FOCUSED')
        with self.assertRaisesRegex(RuntimeError, 'general CLI wrapper'):
            self.validate(receipt)

    def test_receipt_without_original_custody_hashes_is_rejected(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['build'].pop('object_files')
        with self.assertRaisesRegex(RuntimeError, 'original object identities'):
            self.validate(receipt)


if __name__ == '__main__':
    unittest.main()
