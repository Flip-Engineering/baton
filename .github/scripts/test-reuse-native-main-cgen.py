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
QUEUE_PATH = pathlib.Path(__file__).with_name('queue-native-checks.py')
QUEUE_SPEC = importlib.util.spec_from_file_location('queue_native_checks', QUEUE_PATH)
QUEUE = importlib.util.module_from_spec(QUEUE_SPEC)
QUEUE_SPEC.loader.exec_module(QUEUE)


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
        self.queue_output = self.attempt / 'work/output.c'
        self.exec_script = self.base / '.github/scripts/compile-cgen-exec.py'
        self.queue_argv = ['/usr/bin/python3', str(self.exec_script), str(self.queue_output),
                           str(self.compiler), REUSE.ENTRY, '-o', str(self.queue_output)]
        write(self.attempt / 'meta', self.meta_text())
        write(self.attempt / 'identity-config', self.identity_config_text())
        write(self.attempt / 'command', '\n'.join(self.queue_argv) + '\n')
        write(self.attempt / 'argv', b'\0'.join(arg.encode() for arg in self.queue_argv) + b'\0')
        source_digest, _ = REUSE.queue_source_digest(self.root, REUSE.ENTRY)
        write(self.attempt / 'source-digest', 'digest=' + source_digest + '\n')
        write(self.completed / 'result', self.result_text(source_digest))
        diagnostics = {
            'schema': 'baton2-compiler-execution-observation-v1',
            'compiler_argv': self.queue_argv[3:],
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

    def test_identity_config_with_empty_defaults_is_accepted(self):
        fields = REUSE.queue_fields(self.attempt / 'identity-config')
        self.assertEqual(REUSE.queue_effective(fields, 'kind'), 'cgen')
        self.assertEqual(REUSE.queue_effective(fields, 'entry'), REUSE.ENTRY)
        self.assertEqual(REUSE.queue_effective(fields, 'source_root'), str(self.root))
        self.assertEqual(REUSE.queue_effective(fields, 'compiler'), str(self.compiler))
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

    def test_cache_hit_diagnostic_at_another_path_is_bound_by_compiler_bytes(self):
        target_compiler = self.base / 'target-run/toolchain-home/bin/bend'
        write(target_compiler, self.compiler.read_bytes())
        diagnostics = json.loads((self.attempt / 'compiler-diagnostics.json').read_text())
        diagnostics['compiler_argv'][0] = str(target_compiler)
        diagnostics['toolchain']['compiler']['path'] = str(target_compiler)
        write(self.attempt / 'compiler-diagnostics.json', json.dumps(diagnostics))

        result = self.prepare()

        self.assertEqual(result['status'], 'reused', result)
        self.assertFalse(result['origin_compiler_identity']['paths_match'])
        self.assertEqual(result['origin_compiler_identity']['sha256'], sha(self.compiler))
        selected = self.select(result)
        self.assertEqual(selected['status'], 'reused', selected)

    def test_cache_hit_diagnostic_with_different_compiler_bytes_is_refused(self):
        target_compiler = self.base / 'target-run/toolchain-home/bin/bend'
        write(target_compiler, b'different compiler')
        diagnostics = json.loads((self.attempt / 'compiler-diagnostics.json').read_text())
        diagnostics['compiler_argv'][0] = str(target_compiler)
        diagnostics['toolchain']['compiler']['path'] = str(target_compiler)
        diagnostics['toolchain']['compiler']['sha256'] = sha(target_compiler)
        write(self.attempt / 'compiler-diagnostics.json', json.dumps(diagnostics))

        with self.assertRaisesRegex(ValueError, 'Completed Cgen compiler diagnostics differ from the selected compiler'):
            self.prepare()


class QueueCacheDiagnosticRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='queue-cache-diagnostics-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.state = self.base / 'queue'
        self.key = 'b' * 64
        self.keydir = self.state / 'keys' / self.key
        self.attempt = self.keydir / 'runs/attempt-1'
        self.directory = self.base / 'current-request'
        self.completed = self.keydir / 'completed'
        self.attempt.mkdir(parents=True)
        self.directory.mkdir()
        self.completed.mkdir()
        write(self.completed / 'result', 'schema=baton-compile-queue-result-v2\n'
              'key=' + self.key + '\nstatus=completed\nexit=0\nattempt=' + str(self.attempt) + '\n')
        for name, body in (('stdout', ''), ('stderr', ''), ('meta', 'kind=cc\n'),
                           ('command', 'old command\n'), ('source-digest', 'digest=old\n'),
                           ('argv', b'old\0argv\0')):
            write(self.attempt / name, body)
        self.original_diagnostics = b'{"execution":"original candidate"}\n'
        write(self.attempt / QUEUE.DIAGNOSTIC_FILE, self.original_diagnostics)
        compiler = self.base / 'target-run/bin/cc'
        write(compiler, b'target compiler')
        compiler.chmod(0o755)
        request = {'command': ['/usr/bin/python3', QUEUE.EXEC_SCRIPT,
                               str(self.base / 'output'), str(compiler), '-c', 'input.c']}
        write(self.directory / 'request.json', json.dumps(request))
        write(self.directory / 'receipt', 'status=completed\nreused=1\n')

    def test_cache_hit_copies_original_execution_diagnostics_without_overwriting(self):
        QUEUE.retain({'state': str(self.state)}, self.key, self.directory, True)

        self.assertEqual((self.attempt / QUEUE.DIAGNOSTIC_FILE).read_bytes(),
                         self.original_diagnostics)
        self.assertEqual((self.directory / QUEUE.DIAGNOSTIC_FILE).read_bytes(),
                         self.original_diagnostics)


if __name__ == '__main__':
    unittest.main()
