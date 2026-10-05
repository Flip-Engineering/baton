"""Remote-run fixture for status publication at actual orphan attachment.

Build test/process.bend first. BATON2_PROCESS_C selects that generated C;
BATON2_ORPHAN_EVIDENCE selects a new retained evidence directory. The fixture
gates the actual follower thread and calls br_attach_orphan and BP_WAIT against
the generated host implementation. Its native child and files are fixture-owned.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
GENERATED = Path(os.environ.get('BATON2_PROCESS_C', ROOT / '.scratch/bend2/process-test.c')).resolve()


class FirstWait(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parent = Path(os.environ.get('BATON2_ORPHAN_EVIDENCE', ROOT / '.scratch/bend2/orphan-first-wait'))
        parent.mkdir(parents=True, exist_ok=True)
        cls.evidence = Path(tempfile.mkdtemp(prefix='run-', dir=parent)).resolve()
        print(f'orphan first-wait evidence: {cls.evidence}', flush=True)
        host = ROOT / 'bend2/src/host/process-spawn.c'
        fixture = ROOT / 'bend2/test/orphan-first-wait.c'
        source = GENERATED.read_text()
        host_source = host.read_text()
        if source.count(host_source) != 1:
            raise AssertionError('generated C must contain the exact selected host source once')
        selected = cls.evidence / 'selected.c'
        selected.write_text(source)
        before = 'if(retained->exited || retained->life<0)br_orphan_exit(retained);'
        after = 'if(retained->life<0)retained->exited=1;'
        if source.count(before) != 1:
            raise AssertionError('status-publication mutation target is ambiguous')
        follower = 'if(retained->exited) {\n      pthread_cond_broadcast(&retained->changed);'
        if source.count(follower) != 1:
            raise AssertionError('follower status-load mutation target is ambiguous')
        mutant = cls.evidence / 'delayed-status.c'
        mutant.write_text(source.replace(before, after, 1).replace(
            follower, follower.replace('pthread_cond_broadcast', 'br_orphan_exit(retained);pthread_cond_broadcast'), 1))
        (cls.evidence / 'inputs.json').write_text(json.dumps({
            str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (host, fixture, Path(__file__), GENERATED, selected, mutant)
        }, indent=2) + '\n')
        cls.selected = cls.evidence / 'selected'
        cls.mutant = cls.evidence / 'delayed-status'
        for code, binary in ((selected, cls.selected), (mutant, cls.mutant)):
            result = cls.record(binary.name + '-build', [
                os.environ.get('CC', 'clang'), '-O1', '-pthread',
                '-DBATON2_PROCESS_SOURCE=' + json.dumps(str(code)),
                str(fixture), '-lsqlite3', '-lm', '-o', str(binary),
            ], timeout=120)
            if result.returncode != 0:
                raise AssertionError(f'{binary.name} build failed; see retained compiler output')
        (cls.evidence / 'binaries.json').write_text(json.dumps({
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (cls.selected, cls.mutant)
        }, indent=2) + '\n')

    @classmethod
    def record(cls, name, argv, timeout):
        prefix = cls.evidence / name
        prefix.with_suffix('.argv.json').write_text(json.dumps(argv, indent=2) + '\n')
        with prefix.with_suffix('.stdout').open('wb') as stdout, prefix.with_suffix('.stderr').open('wb') as stderr:
            try:
                result = subprocess.run(argv, stdout=stdout, stderr=stderr, timeout=timeout)
            except subprocess.TimeoutExpired:
                prefix.with_suffix('.result.json').write_text(json.dumps({'timeout': timeout}) + '\n')
                raise
        prefix.with_suffix('.result.json').write_text(json.dumps({'exit': result.returncode}) + '\n')
        return result

    def exercise(self, binary, mode):
        name = binary.name + '-' + mode
        attempt = self.evidence / (name + '-attempt')
        attempt.mkdir()
        result = self.record(name, [str(binary), mode, str(attempt)], timeout=15)
        output = json.loads((self.evidence / (name + '.stdout')).read_bytes())
        error = (self.evidence / (name + '.stderr')).read_bytes()
        self.assertEqual(output['case'], mode)
        self.assertEqual(output['afterFollower'], output['expected'])
        return result, output, error

    def test_first_wait_qualifies_ended_status_before_follower_runs(self):
        for mode in ('absent', 'malformed', 'nonzero', 'zero', 'signal'):
            with self.subTest(mode=mode):
                result, output, error = self.exercise(self.selected, mode)
                self.assertEqual(result.returncode, 0, error)
                self.assertEqual(error, b'')
                self.assertEqual(output['firstWait'], output['expected'])

    def test_delayed_status_control_fails_at_first_wait(self):
        for mode, expected in (('absent', 'unknown after keeper loss'), ('nonzero', 'exit 13')):
            with self.subTest(mode=mode):
                result, output, error = self.exercise(self.mutant, mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(output['firstWait'], 'exit 0')
                self.assertEqual(output['expected'], expected)
                self.assertEqual(error, f'first wait mismatch: expected {expected}; observed exit 0\n'.encode())


if __name__ == '__main__':
    unittest.main()
