"""Canceling one coalesced requester leaves the shared command owned."""
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueueCcOwnershipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def test_cancel_one_owner_keeps_other_request_running(self):
        with tempfile.TemporaryDirectory(prefix="queue-cc-owner-") as temporary:
            root = pathlib.Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o2770)
            control = root / "control"
            control.mkdir()
            source = root / "main.c"
            source.write_text("int main(void){return 0;}\n")
            output = root / "result"
            compiler = root / "fake-compiler"
            compiler.write_text(
                "#!/bin/sh\n"
                "printf started > \"$CONTROL/started\"\n"
                "while [ ! -e \"$CONTROL/release\" ]; do sleep 0.02; done\n"
                "printf 'shared-artifact\\n' > \"$1\"\n")
            compiler.chmod(0o755)
            environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state),
                               CONTROL=str(control))
            tokens = [os.urandom(16).hex(), os.urandom(16).hex()]

            def command(token, receipt):
                return [self.candidate, "--", "run", "--token", token,
                        "--receipt", str(receipt), "--kind", "cc", "--state-root", str(state),
                        "--cwd", str(root), "--root", str(root), "--source-root", str(root),
                        "--compiler", str(compiler), "--linker", "/usr/bin/ld",
                        "--version", "fake-owner-v1", "--artifact", "output=" + str(output),
                        "--input", str(source), "--", str(compiler), str(output)]

            children = []
            try:
                children.append(subprocess.Popen(command(tokens[0], root / "first.receipt"),
                    env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
                deadline = time.monotonic() + 20
                keydir = None
                while time.monotonic() < deadline:
                    keys = list((state / "keys").glob("*"))
                    if keys and (control / "started").exists():
                        keydir = keys[0]
                        break
                    if children[0].poll() is not None:
                        break
                    time.sleep(0.02)
                self.assertIsNotNone(keydir, "first shared command did not start")
                children.append(subprocess.Popen(command(tokens[1], root / "second.receipt"),
                    env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if (keydir / "owners" / tokens[1]).exists():
                        break
                    if children[1].poll() is not None:
                        break
                    time.sleep(0.02)
                self.assertTrue((keydir / "owners" / tokens[1]).exists(),
                                "second requester did not join the shared execution")
                canceled = subprocess.run([self.candidate, "--", "cancel", "--state-root", str(state),
                    "--key", keydir.name, "--token", tokens[0]], env=environment,
                    capture_output=True, text=True, timeout=10)
                self.assertEqual(canceled.returncode, 0, canceled.stdout + canceled.stderr)
                self.assertIn("canceled=withdrawn", canceled.stdout)
                self.assertTrue((control / "started").exists())
                self.assertIsNone(children[0].poll(),
                                  "canceling one owner must not stop a command with a live owner")
                (control / "release").touch()
                results = [child.communicate(timeout=30) + (child.returncode,) for child in children]
                self.assertEqual([result[2] for result in results], [0, 0], results)
                self.assertTrue((root / "second.receipt").exists())
                self.assertEqual(output.read_text(), "shared-artifact\n")
            finally:
                (control / "release").touch()
                for child in children:
                    if child.poll() is None:
                        child.wait(timeout=30)


if __name__ == "__main__":
    unittest.main()
