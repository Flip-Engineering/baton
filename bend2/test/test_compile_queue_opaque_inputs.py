"""Compile queue identity and opaque-input allocation regressions.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Set
BATON2_COMPILE_QUEUE_BASELINE to compare small fixtures with the deployed queue.
The allocation check uses a private queue and a fake compiler command.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueueOpaqueInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        cls.baseline = os.environ.get("BATON2_COMPILE_QUEUE_BASELINE")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-opaque-input-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "previous=\n"
            "for arg in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then printf 'opaque-input-artifact\\n' > \"$arg\"; fi\n"
            "  previous=$arg\n"
            "done\n"
        )
        self.compiler.chmod(0o755)
        (self.root / "main.c").write_text('#include "local.h"\nint main(void){return VALUE;}\n')
        (self.root / "local.h").write_text("#define VALUE 0\n")
        (self.root / "main.bend").write_text('import "./local.bend"\ndef main() -> U32: value()\n')
        (self.root / "local.bend").write_text("def value() -> U32: 1\n")
        self.payload = self.root / "payload.bin"
        self.payload.write_bytes(b'\x00\xff\xfe#include "missing.h"\nimport "missing.bend"\n' * 64)

    def command(self, binary, action="key", payload=None, kind="cc"):
        output = self.root / "output"
        command = [binary, "--", action, "--kind", kind,
                   "--state-root", str(self.state), "--cwd", str(self.root),
                   "--root", str(self.root), "--source-root", str(self.root),
                   "--compiler", str(self.compiler), "--linker", str(self.compiler),
                   "--version", "fake-opaque-input-v1", "--artifact", "binary=" + str(output)]
        if kind == "cgen":
            command += ["--entry", "main.bend"]
        else:
            command += ["--input", str(self.root / "main.c")]
        command += ["--aux", str(payload or self.payload),
                    "--", str(self.compiler), "-o", str(output)]
        return command

    def key(self, binary, **kwargs):
        result = subprocess.run(self.command(binary, **kwargs), env=self.environment,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_small_binary_identity_matches_deployed_queue(self):
        if not self.baseline:
            self.skipTest("BATON2_COMPILE_QUEUE_BASELINE is required for comparison")
        for kind in ("cc", "cgen"):
            with self.subTest(kind=kind):
                self.assertEqual(self.key(self.candidate, kind=kind),
                                 self.key(self.baseline, kind=kind))

    def test_all_binary_bytes_affect_identity(self):
        before = self.key(self.candidate)
        with self.payload.open("r+b") as stream:
            stream.seek(1)
            stream.write(b"\xfd")
        self.assertNotEqual(before, self.key(self.candidate))

    def test_c_header_and_bend_import_changes_affect_identity(self):
        for kind, path in (("cc", "local.h"), ("cgen", "local.bend")):
            with self.subTest(kind=kind):
                before = self.key(self.candidate, kind=kind)
                target = self.root / path
                target.write_text(target.read_text() + "\n# changed\n")
                self.assertNotEqual(before, self.key(self.candidate, kind=kind))
                if self.baseline:
                    self.assertEqual(self.key(self.candidate, kind=kind),
                                     self.key(self.baseline, kind=kind))

    def test_symlink_uses_resolved_source_extension(self):
        linked = self.root / "header.bin"
        linked.symlink_to(self.root / "local.h")
        before = self.key(self.candidate, payload=linked)
        (self.root / "local.h").write_text('#include "nested.h"\n#define VALUE 0\n')
        (self.root / "nested.h").write_text("#define NESTED 1\n")
        after = self.key(self.candidate, payload=linked)
        self.assertNotEqual(before, after)
        (self.root / "nested.h").write_text("#define NESTED 2\n")
        self.assertNotEqual(after, self.key(self.candidate, payload=linked))
        if self.baseline:
            self.assertEqual(self.key(self.candidate, payload=linked),
                             self.key(self.baseline, payload=linked))

    def test_source_cycle_and_extension_case_preserve_identity(self):
        (self.root / "local.h").write_text('#include "cycle.H"\n#define VALUE 0\n')
        (self.root / "cycle.H").write_text('#include "local.h"\n')
        result = self.key(self.candidate)
        if self.baseline:
            self.assertEqual(result, self.key(self.baseline))

    def test_escaping_include_is_rejected(self):
        outside = self.root.parent / (self.root.name + "-outside.h")
        self.addCleanup(outside.unlink, missing_ok=True)
        outside.write_text("#define OUTSIDE 1\n")
        (self.root / "local.h").write_text('#include "../' + outside.name + '"\n')
        for binary in filter(None, (self.candidate, self.baseline)):
            result = subprocess.run(self.command(binary), env=self.environment,
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("outside root", result.stderr)

    def write_c_file(self, path, megabytes, lines_per_megabyte_filler=b"int filler_value_0123456789 = 0;\n"):
        """A C file of the given size with quoted includes at the start, the middle and the end."""
        filler = lines_per_megabyte_filler * ((1 << 20) // len(lines_per_megabyte_filler))
        with path.open("wb") as stream:
            stream.write(b'  \t#include "first.h"\n')
            for index in range(megabytes):
                stream.write(filler)
                if index == megabytes // 2:
                    stream.write(b'#include "middle.h" // trailing text\n')
                    stream.write(b'#include <system.h>\n// #include "commented.h"\n# include "spaced.h"\n')
            stream.write(b'#include "last.h"')
        for name in ("first", "middle", "last"):
            (self.root / (name + ".h")).write_text("#define %s 1\n" % name.upper())

    def test_c_include_scan_matches_deployed_queue_on_small_file(self):
        if not self.baseline:
            self.skipTest("BATON2_COMPILE_QUEUE_BASELINE is required for comparison")
        big = self.root / "scan.c"
        self.write_c_file(big, 2)
        self.assertEqual(self.key(self.candidate, payload=big), self.key(self.baseline, payload=big))

    def test_large_c_file_is_keyed_and_its_includes_affect_identity(self):
        # A C file is scanned for quoted includes. Reading it as one text and splitting that
        # text recursed once per character and line and overflowed the stack above 90 MB.
        big = self.root / "large.c"
        self.write_c_file(big, 130)
        self.assertGreater(big.stat().st_size, 100 * 1024 * 1024)
        before = self.key(self.candidate, payload=big)
        self.assertRegex(before.strip().splitlines()[-1], r"^[0-9a-f]{64}$")
        for name in ("first", "middle", "last"):
            with self.subTest(include=name):
                target = self.root / (name + ".h")
                target.write_text(target.read_text() + "#define CHANGED 1\n")
                changed = self.key(self.candidate, payload=big)
                self.assertNotEqual(before, changed)
                before = changed

    def waiter_rss(self, payload):
        (self.root / "output").unlink(missing_ok=True)
        # A running job without a recorded peak makes the request wait for admission.
        running = self.state / "admission" / "running"
        for directory in (self.state / "admission", running):
            directory.mkdir(mode=0o2770, exist_ok=True)
            directory.chmod(0o2770)
        lock = (running / "00000000000000000001-0000000001").open("w")
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lock.write(f"pid={os.getpid()}\nstarttime=1\nroot={os.getpid()}\nmeasure=tree\nkey=held\n"
                   "group=\nexpected_kb=0\nhistory=0\nbackfill=0\nadmitted_ns=1\n")
        lock.flush()
        process = subprocess.Popen(self.command(self.candidate, action="run", payload=payload),
                                   env=self.environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 60
            samples = []
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    stdout, stderr = process.communicate()
                    self.fail("waiter exited before admission sample: " + stdout + stderr)
                status = pathlib.Path(f"/proc/{process.pid}/status").read_text()
                values = dict(line.split(":", 1) for line in status.splitlines() if ":" in line)
                runs = list(self.state.glob(f"keys/*/runs/*-{process.pid}/meta"))
                if runs:
                    self.assertFalse((self.root / "output").exists())
                    samples.append(int(values["VmRSS"].split()[0]))
                    if len(samples) == 3:
                        return min(samples)
                time.sleep(0.1)
            self.fail("queue did not reach its pre-execution wait")
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
            stdout, stderr = process.communicate(timeout=60)
            self.assertEqual(process.returncode, 0, stdout + stderr)

    @unittest.skipUnless(pathlib.Path("/proc/self/status").exists(), "Linux /proc is required")
    def test_large_opaque_payload_has_bounded_waiter_allocation(self):
        # These are allocation observations; admission and execution use the same queue path.
        small = self.root / "small.bin"
        large = self.root / "large.bin"
        small.write_bytes(b"\x00\xff\xfe\n" * 1024)
        with large.open("wb") as stream:
            for _ in range(64):
                stream.write(b"\x00\xff\xfe\n" * (1024 * 256))
        small_rss = self.waiter_rss(small)
        large_rss = self.waiter_rss(large)
        observation = {"small_bytes": small.stat().st_size, "large_bytes": large.stat().st_size,
                       "small_waiter_rss_kib": small_rss, "large_waiter_rss_kib": large_rss,
                       "rss_growth_kib": large_rss - small_rss}
        print(json.dumps(observation, sort_keys=True), flush=True)
        # A whole decoded character list grows by far more than one input byte per byte.
        self.assertLess(large_rss - small_rss, large.stat().st_size // 1024)


if __name__ == "__main__":
    unittest.main()
