"""Changed relink tools must reach execution through the maintained queue adapter."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
ADAPTER_PATH = ROOT / '.github/scripts/queue-native-checks.py'
SPEC = importlib.util.spec_from_file_location('relink_cache_adapter', ADAPTER_PATH)
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)

CONSUMER = '''import hashlib,json,pathlib,sys
arguments=sys.argv[1:]
receipt=json.loads(pathlib.Path(arguments[arguments.index('--relink-from')+1]).read_text())
name=arguments[arguments.index('--observed-tool')+1]
tool=receipt['toolchain'][name]
actual=hashlib.sha256(pathlib.Path(tool['path']).read_bytes()).hexdigest()
if actual!=tool['sha256']:
    print('Producer '+name+' identity changed.',file=sys.stderr)
    raise SystemExit(78)
output=pathlib.Path(arguments[arguments.index('--binary')+1])
output.write_text(json.dumps({'tool':name,'sha256':actual})+'\\n')
'''


def identity(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


class NativeRelinkCache(unittest.TestCase):
    def exercise_changed_tool(self, name):
        evidence = os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE')
        if evidence:
            Path(evidence).mkdir(parents=True, exist_ok=True)
        directory = Path(tempfile.mkdtemp(prefix='relink-cache-' + name + '-', dir=evidence))
        print('Retained relink cache evidence: ' + str(directory), flush=True)
        state = directory / 'queue'
        state.mkdir(mode=0o2770)
        state.chmod(0o2770)
        run = directory / 'run'
        run.mkdir()
        consumer = directory / 'consumer.py'
        consumer.write_text(CONSUMER)
        sharder, linker = directory / 'sharder.py', directory / 'selected-linker'
        sharder.write_text('original sharder bytes\n')
        linker.write_text('original selected linker bytes\n')
        source, header, original_object = [directory / value for value in
                                           ('main.bend', 'runtime.h', 'original.o')]
        for path in (source, header, original_object):
            path.write_text('queue fixture input\n')
        closure = directory / 'source-closure.json'
        closure.write_text(json.dumps({'source': str(directory),
                                       'files': [{'path': source.name}]}))
        producer = directory / 'producer.json'
        producer.write_text(json.dumps({
            'build': {'object_files': [identity(original_object)]},
            'process_records': [{'dependencies': [identity(header)]}],
            'source_closure': identity(closure),
            'toolchain': {'compiler_executable': identity(sys.executable),
                          'driver': identity(consumer), 'sharder': identity(sharder),
                          'linker': identity(linker), 'ccache': None},
        }))
        config = directory / 'queue-config.json'
        client = Path(ADAPTER.CLIENT).resolve()
        config.write_text(json.dumps({'run': str(run), 'client': str(client),
                                      'state': str(state), 'cc': str(Path(sys.executable).resolve()),
                                      'bend': str(Path(sys.executable).resolve())}))
        environment = dict(os.environ, BATON2_NATIVE_QUEUE=str(config))
        output = directory / 'result'
        command = [sys.executable, str(ADAPTER_PATH), 'stage', 'cc', sys.executable,
                   str(consumer), '--cc', sys.executable, '--relink-from', str(producer),
                   '--observed-tool', name, '--binary', str(output)]
        executions = []

        def invoke(label):
            started = time.time_ns()
            process = subprocess.Popen(command, cwd=directory, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate()
            (directory / (label + '.stdout')).write_bytes(stdout)
            (directory / (label + '.stderr')).write_bytes(stderr)
            row = {'label': label, 'argv': command, 'cwd': str(directory), 'pid': process.pid,
                   'started_ns': started, 'finished_ns': time.time_ns(), 'exit': process.returncode,
                   'client': identity(client), 'adapter': identity(ADAPTER_PATH),
                   'python': identity(sys.executable)}
            executions.append(row)
            (directory / 'executions.json').write_text(json.dumps(executions, indent=2) + '\n')
            return process.returncode, stderr.decode(errors='replace')

        code, stderr = invoke('original')
        self.assertEqual(code, 0, stderr)
        self.assertEqual(json.loads(output.read_text())['tool'], name)
        first_requests = set((run / 'evidence/compile-queue').glob('*/request.json'))
        code, stderr = invoke('unchanged')
        self.assertEqual(code, 0, stderr)
        unchanged_requests = set((run / 'evidence/compile-queue').glob('*/request.json')) - first_requests
        first_keys = {json.loads(path.read_text())['key'] for path in first_requests}
        unchanged_keys = {json.loads(path.read_text())['key'] for path in unchanged_requests}

        def attempts(requests):
            return {dict(line.split('=', 1) for line in
                         (path.parent / 'queue-result').read_text().splitlines()
                         if '=' in line)['attempt'] for path in requests}

        first_attempts = attempts(first_requests)
        unchanged_attempts = attempts(unchanged_requests)
        self.assertTrue(unchanged_keys and first_keys == unchanged_keys)
        self.assertEqual(first_attempts, unchanged_attempts,
                         'Unchanged inputs must reuse the authentic completed producer result')
        changed = sharder if name == 'sharder' else linker
        changed.write_text('changed ' + name + ' bytes\n')
        code, stderr = invoke('changed')
        later_requests = (set((run / 'evidence/compile-queue').glob('*/request.json'))
                          - first_requests - unchanged_requests)
        later_keys = {json.loads(path.read_text())['key'] for path in later_requests}
        (directory / 'cache-outcome.json').write_text(json.dumps({
            'tool': name, 'original_keys': sorted(first_keys), 'changed_keys': sorted(later_keys),
            'unchanged_keys': sorted(unchanged_keys),
            'original_attempts': sorted(first_attempts), 'unchanged_attempts': sorted(unchanged_attempts),
            'changed_exit': code, 'changed_tool': identity(changed),
            'producer_receipt': identity(producer)}, indent=2) + '\n')
        self.assertNotEqual(code, 0, 'Changed tooling must reach the consumer identity check.\n' + stderr)
        self.assertIn('Producer ' + name + ' identity changed.', stderr)
        self.assertTrue(later_keys and first_keys.isdisjoint(later_keys),
                        'Changed consumed tool bytes reused the original queue key')

    def test_changed_sharder_cannot_reuse_the_completed_result(self):
        self.exercise_changed_tool('sharder')

    def test_changed_selected_linker_cannot_reuse_the_completed_result(self):
        self.exercise_changed_tool('linker')


if __name__ == '__main__':
    unittest.main()
