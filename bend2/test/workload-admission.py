"""Workloads retain execution, session-detached memory and shared admission."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / 'bend2/scripts/run-workload.py'


def fields(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)


class WorkloadAdmission(unittest.TestCase):
    def setUp(self):
        self.queue = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
        if not self.queue:
            self.skipTest('BATON2_COMPILE_QUEUE_BIN is required')
        self.temporary = tempfile.TemporaryDirectory(prefix='workload-admission-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        self.worker = self.root / 'worker.py'
        self.worker.write_text(
            'import os,subprocess,sys,time\n'
            'from pathlib import Path\n'
            'root=Path.cwd()\n'
            'if sys.argv[1:]==["child"]:\n'
            ' data=bytearray(64*1024*1024)\n'
            ' (root/"child-started").touch()\n'
            ' while not (root/"release").exists(): time.sleep(.02)\n'
            'else:\n'
            ' p=subprocess.Popen([sys.executable,__file__,"child"],start_new_session=True)\n'
            ' p.wait()\n'
            ' print("workload-output",flush=True)\n'
            ' print("workload-error-output",file=sys.stderr,flush=True)\n'
            ' with (root/"executions").open("a") as out: out.write("ran\\n")\n'
            ' sys.exit(int(os.environ.get("WORKLOAD_EXIT","0")))\n')

    def launch(self):
        return subprocess.Popen([sys.executable, str(LAUNCHER), '--',
            sys.executable, str(self.worker)], cwd=self.root, env=self.environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def wait_for(self, predicate, process):
        deadline = time.monotonic() + 60
        while not predicate():
            if process.poll() is not None:
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(.02)
        self.assertTrue(predicate(), process.communicate() if process.poll() is not None else 'condition did not arrive')

    def finish(self, process, expected=0):
        (self.root / 'release').touch()
        out, err = process.communicate(timeout=60)
        self.assertEqual(process.returncode, expected, (out, err))
        return out, err

    def stop(self, process):
        (self.root / 'release').touch()
        if process.poll() is None:
            process.communicate(timeout=60)

    def test_a_new_session_child_contributes_to_the_retained_peak(self):
        process = self.launch()
        self.addCleanup(self.stop, process)
        self.wait_for(lambda: (self.root / 'child-started').exists(), process)
        self.wait_for(lambda: any(int(fields(p).get('kb', '0')) >= 64*1024
            for p in self.state.glob('keys/*/runs/*/usage')), process)
        out, err = self.finish(process)
        self.assertIn('workload-output', out)
        self.assertIn('workload-error-output', err)
        peaks = [fields(p) for p in self.state.glob('keys/*/runs/*/peak')]
        self.assertTrue(any(int(p.get('peak_kb', '0')) >= 64*1024 for p in peaks), peaks)

    def test_repeated_work_executes_again_and_uses_its_measured_history(self):
        for _ in range(2):
            process = self.launch()
            self.addCleanup(self.stop, process)
            self.wait_for(lambda: (self.root / 'child-started').exists(), process)
            self.finish(process)
            (self.root / 'child-started').unlink()
            (self.root / 'release').unlink()
        self.assertEqual((self.root / 'executions').read_text().splitlines(), ['ran', 'ran'])
        claims = [fields(p) for p in self.state.glob('keys/*/runs/*/admission')]
        self.assertTrue(any(int(p.get('expected_kb', '0')) > 0 for p in claims), claims)

    def test_a_measured_workload_waits_for_available_host_memory(self):
        first = self.launch()
        self.addCleanup(self.stop, first)
        self.wait_for(lambda: (self.root / 'child-started').exists(), first)
        self.finish(first)
        (self.root / 'child-started').unlink()
        (self.root / 'release').unlink()
        (self.state / 'meminfo').write_text('total_kb=1048576\navailable_kb=1\n')
        second = self.launch()
        self.addCleanup(self.stop, second)
        self.wait_for(lambda: len(list(self.state.glob('keys/*/runs/*/meta'))) == 2, second)
        self.assertFalse((self.root / 'child-started').exists())
        self.assertEqual((self.root / 'executions').read_text().splitlines(), ['ran'])
        (self.state / 'meminfo').write_text('total_kb=1048576\navailable_kb=1048576\n')
        self.wait_for(lambda: (self.root / 'child-started').exists(), second)
        self.finish(second)

    def test_a_failed_test_keeps_its_output_and_exit_status(self):
        self.environment['WORKLOAD_EXIT'] = '7'
        process = self.launch()
        self.addCleanup(self.stop, process)
        self.wait_for(lambda: (self.root / 'child-started').exists(), process)
        out, err = self.finish(process, expected=7)
        self.assertIn('workload-output', out)
        self.assertIn('workload-error-output', err)
        results = [fields(p) for p in self.state.glob('keys/*/runs/*/result')]
        self.assertEqual([r['exit'] for r in results], ['7'])


if __name__ == '__main__':
    unittest.main()
