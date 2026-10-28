#!/usr/bin/env python3
"""Exercise completed queue Cgen verification in the Main C selector."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name('reuse-native-main.py')
SPEC = importlib.util.spec_from_file_location('reuse_native_main', SCRIPT)
REUSE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REUSE)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CompletedQueueCgenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='main-cgen-reuse-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.root = self.base / 'source'
        self.root.mkdir()
        write(self.root / REUSE.ENTRY, 'import Base\n\ndef main() -> U32:\n  0\n')
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.email', 'fixture@example.invalid'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.name', 'Fixture'], cwd=self.root, check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=self.root, check=True)
        self.compiler_home = self.base / 'toolchain'
        self.compiler = self.compiler_home / 'bin/bend'
        self.runtime = self.compiler_home / 'bin/bun'
        self.manifest = self.compiler_home / 'fork-manifest.json'
        write(self.compiler, b'compiler binary')
        write(self.runtime, b'runtime binary')
        self.compiler.chmod(0o755)
        self.runtime.chmod(0o755)
        write(self.manifest, json.dumps({'compiler': {'sha256': sha(self.compiler)},
                                         'bun': {'sha256': sha(self.runtime)}}))
        self.archive = self.base / 'compiler.tar.gz'
        write(self.archive, b'fixture archive')
        self.distribution = REUSE.directory_files(self.compiler_home, [])[0]
        self.key = 'a' * 64
        self.queue_root = self.base / 'queue'
        self.keydir = self.queue_root / 'keys' / self.key
        self.attempt = self.keydir / 'attempts' / 'attempt-1'
        self.completed = self.keydir / 'completed'
        self.artifact = self.completed / 'artifacts/output.c'
        write(self.artifact, b'/* verified cgen */\n')
        write(self.attempt / 'meta', self.meta_text())
        write(self.attempt / 'identity-config', self.identity_config_text())
        write(self.attempt / 'command', 'bend ' + REUSE.ENTRY + ' -o output.c\n')
        write(self.attempt / 'argv', b'bend\0' + REUSE.ENTRY.encode() + b'\0-o\0output.c\0')
        source_digest, _ = REUSE.queue_source_digest(self.root, REUSE.ENTRY)
        write(self.attempt / 'source-digest', 'digest=' + source_digest + '\n')
        write(self.completed / 'result', self.result_text(source_digest))
        diagnostics = {
            'schema': 'baton2-compiler-execution-observation-v1',
            'queue_attempt': {
                'meta': {'key': self.key, 'kind': 'cgen', 'entry': REUSE.ENTRY},
                'meta_sha256': sha(self.attempt / 'meta'),
                'argv_sha256': sha(self.attempt / 'argv'),
                'command_sha256': sha(self.attempt / 'command'),
                'source_digest': 'digest=' + source_digest,
            },
            'toolchain': {
                'compiler': {'path': str(self.compiler), 'sha256': sha(self.compiler)},
                'runtime': {'sha256': sha(self.runtime)},
                'manifest': {'sha256': sha(self.manifest)},
            },
        }
        write(self.attempt / 'compiler-diagnostics.json', json.dumps(diagnostics))
        self.generated = self.base / 'generated'
        self.generated.mkdir()
        self.proof = self.generated / 'main-c-reuse.json'
        self.github_env = self.base / 'github-env'
        self.github_env.write_text('')
        self.prepare_args = SimpleNamespace(
            handoff='', handoff_sha256='', cgen_key=self.key, queue_root=self.queue_root,
            compiler=self.compiler, compiler_archive=self.archive, github_env=self.github_env)

    def meta_text(self):
        return ('kind=cgen\nkey=' + self.key + '\nentry=' + REUSE.ENTRY +
                '\nsource_root=' + str(self.root) + '\nartifact_name=output.c\n')

    def identity_config_text(self, source_root=None, compiler=None):
        source_root = str(source_root or self.root)
        compiler = str(compiler or self.compiler)
        return ('kind=\nstate_root=\ncwd=\nroot=\nsource_root=\nentry=\ncompiler=\nreceipt=\ntoken=\n'
                'token=fixture-token\nreceipt=fixture-receipt\nstate_root=/tmp/queue\n'
                'cwd=' + source_root + '\nroot=' + source_root + '\nkind=cgen\n'
                'source_root=' + source_root + '\nentry=' + REUSE.ENTRY + '\n'
                'compiler=' + compiler + '\nartifact=output.c\n')

    def result_text(self, source_digest):
        return ('schema=baton-compile-queue-result-v2\n'
                'identity_schema=baton-compile-queue-identity-v2\nkind=cgen\nkey=' + self.key +
                '\nverified=1\nexternal=0\nstatus=completed\nexit=0\nattempt=' + str(self.attempt) +
                '\nartifact=output.c\tfile\t' + sha(self.artifact) + '\n')

    def prepare(self):
        result = {'schema': 'baton2-main-c-reuse-v1', 'status': 'miss', 'entry': REUSE.ENTRY,
                  'root': str(self.root),
                  'current_source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip(),
                  'current_source_tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=self.root, text=True).strip()}
        with mock.patch.object(REUSE, 'distribution', return_value=self.distribution):
            REUSE.prepare_cgen(self.prepare_args, result, self.root, self.generated)
        return result

    def select(self, result):
        args = SimpleNamespace(
            source=self.root, bound_root=str(self.root), proof=self.proof,
            proof_sha256=REUSE.digest(self.proof), generated_c=self.generated / 'main-c-origin/baton2.c',
            compiler=self.compiler, compiler_archive=self.archive)
        selected = {}
        with mock.patch.object(REUSE, 'distribution', return_value=self.distribution):
            REUSE.select(args, selected)
        return selected

    def test_completed_cgen_selects_when_result_artifact_source_and_toolchain_match(self):
        self.prepare()
        selected = self.select(None)
        self.assertEqual(selected['status'], 'reused', selected)

    def test_retained_b15f28_identity_config_is_accepted(self):
        retained = pathlib.Path(
            '/var/tmp/baton2-compile-queue/keys/'
            'b15f28cb7eb42c210d28a47ce5f7c6fdd57d1c2b2be8a1e16833c7cfa1fed57b/runs/'
            '1793206134916190647-2545431/identity-config')
        fields = REUSE.queue_fields(retained)
        config_source_root = REUSE.queue_effective(fields, 'source_root')
        config_compiler = REUSE.queue_effective(fields, 'compiler')
        self.assertEqual(REUSE.queue_effective(fields, 'kind'), 'cgen')
        self.assertEqual(REUSE.queue_effective(fields, 'entry'), REUSE.ENTRY)
        self.assertTrue(pathlib.Path(config_source_root).is_absolute())
        self.assertTrue(pathlib.Path(config_compiler).is_absolute())

        write(self.attempt / 'meta', self.meta_text().replace(str(self.root), config_source_root))
        write(self.attempt / 'identity-config', retained.read_bytes())
        diagnostics_path = self.attempt / 'compiler-diagnostics.json'
        diagnostics = json.loads(diagnostics_path.read_text())
        diagnostics['toolchain']['compiler']['path'] = config_compiler
        write(diagnostics_path, json.dumps(diagnostics))
        result = self.prepare()
        self.assertEqual(result['status'], 'reused', result)

    def test_identity_config_requires_non_empty_final_values(self):
        with self.assertRaisesRegex(ValueError, 'non-empty effective entry'):
            REUSE.queue_effective({'entry': ['', REUSE.ENTRY, '']}, 'entry')

    def test_altered_cgen_artifact_is_refused(self):
        self.prepare()
        write(self.generated / 'main-c-origin/baton2.c', b'changed C\n')
        with self.assertRaisesRegex(ValueError, 'Retained file differs from its recorded bytes'):
            self.select(None)

    def test_altered_source_closure_selects_normal_generation(self):
        self.prepare()
        write(self.root / REUSE.ENTRY, 'import Base\n\ndef main() -> U32:\n  1\n')
        selected = self.select(None)
        self.assertEqual(selected['status'], 'miss', selected)
        self.assertIn('production input', selected['reason'])

    def test_altered_compiler_distribution_selects_normal_generation(self):
        self.prepare()
        write(self.compiler, b'changed compiler')
        selected = self.select(None)
        self.assertEqual(selected['status'], 'miss', selected)
        self.assertIn('compiler distribution', selected['reason'])


if __name__ == '__main__':
    unittest.main()
