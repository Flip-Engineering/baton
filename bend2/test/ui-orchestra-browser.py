"""Browser qualification for the Orchestra live view (#682).

Drives the real `view` command, a fixture Orchestra built through the native
binary, and headless Chromium over CDP. Skips when Chromium or Node 22 is
unavailable so the general suite passes on hosts without a browser.
"""
import os
import pathlib
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
DRIVER = ROOT / 'bend2/test/ui-orchestra-browser.mjs'


def find_chromium():
    for name in ('chromium', 'chromium-browser', 'google-chrome'):
        path = shutil.which(name)
        if path:
            return path
    return None


@unittest.skipUnless(EXE.is_file(), 'the native binary is not built')
class OrchestraBrowser(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'orchestra.db'
        self.addCleanup(self.cleanup_fixture)

    def instance_owner_pids(self):
        expected = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        processes = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                   check=True, capture_output=True, text=True)
        owners = set()
        for line in processes.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and fields[3] == expected and not fields[2].startswith('Z'):
                owners.add(int(fields[0]))
        return owners

    def cleanup_fixture(self):
        try:
            if self.db.exists():
                owners = self.instance_owner_pids()
                stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                         capture_output=True, text=True)
                self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
                while owners & self.instance_owner_pids():
                    time.sleep(.01)
        except Exception:
            self.temp._finalizer.detach()
            raise
        self.temp.cleanup()

    def test_live_view_browser_qualification(self):
        chromium = find_chromium()
        node = shutil.which('node')
        if not chromium or not node:
            self.skipTest('chromium or node unavailable')
        work = self.temp.name
        evidence = os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE')
        out = (pathlib.Path(evidence) / 'ui-browser' if evidence
               else pathlib.Path(work) / 'evidence')
        out.mkdir(parents=True, exist_ok=True)
        with subprocess.Popen(
            [node, str(DRIVER), str(EXE), work, str(out), chromium],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
            stdout = bytearray()
            stderr = bytearray()
            with selectors.DefaultSelector() as streams:
                streams.register(child.stdout, selectors.EVENT_READ,
                                 (sys.stdout.buffer, stdout))
                streams.register(child.stderr, selectors.EVENT_READ,
                                 (sys.stderr.buffer, stderr))
                while streams.get_map():
                    for key, _ in streams.select():
                        chunk = key.fileobj.read1()
                        if not chunk:
                            streams.unregister(key.fileobj)
                            continue
                        destination, retained = key.data
                        retained.extend(chunk)
                        destination.write(chunk)
                        destination.flush()
            status = child.wait()
        output = stdout.decode()
        errors = stderr.decode()
        self.assertEqual(status, 0, output + errors)
        marker = ('BROWSER_CAPTURE_OK'
                  if os.environ.get('FINAL_NATIVE_CONTEXT_BROWSER_CAPTURE_ONLY') == 'true'
                  else 'BROWSER_QA_OK')
        self.assertIn(marker, output)


if __name__ == '__main__':
    unittest.main()
