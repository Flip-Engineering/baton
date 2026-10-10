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
    def test_live_view_browser_qualification(self):
        chromium = find_chromium()
        node = shutil.which('node')
        if not chromium or not node:
            self.skipTest('chromium or node unavailable')
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as work:
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
            self.assertIn('BROWSER_QA_OK', output)


if __name__ == '__main__':
    unittest.main()
