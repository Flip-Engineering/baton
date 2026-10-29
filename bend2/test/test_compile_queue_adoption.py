"""An execution continues while a live owner remains, whatever happens to the first requester's tree (#1300).

The tests end the whole process tree of the first requester with SIGTERM, the way a
teardown that walks the descendants of a stopped harness does: every process that
descends from the tree root through parent links receives the signal.

* A second owner holds the key: the execution survives and the second owner gets the
  real result; the first owner's token is gone.
* No second owner: the execution still runs to its end and publishes its result, which
  the cache keeps for the next identical request. Only the cancel command ends an
  execution.
* A token whose process no longer exists is not an owner: a requester that joins the
  key removes it.
"""
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest

# The tree root starts a middle process, which starts the queue client: the shape
# harness -> submit script -> queue client, without any setsid or process group.
TREE = '''
import subprocess, sys
subprocess.run([sys.executable, "-c", "import subprocess, sys; subprocess.run(sys.argv[1:])", *sys.argv[1:]])
'''


def descendants(root):
    parents = {}
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
            parents[int(entry.name)] = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            continue
    found, frontier = [], [root]
    while frontier:
        parent = frontier.pop()
        for pid, ppid in parents.items():
            if ppid == parent and pid not in found:
                found.append(pid)
                frontier.append(pid)
    return found


class QueueAdoptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-adoption-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.hold = self.root / "hold"
        self.log = self.root / "log"
        self.output = self.root / "output"
        self.source = self.root / "main.c"
        self.source.write_text("int main(void){return 0;}\n")
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "printf 'start %d\\n' $$ >> " + str(self.log) + "\n"
            "i=0\n"
            "while [ ! -e " + str(self.hold) + " ] && [ $i -lt 1200 ]; do sleep 0.1; i=$((i + 1)); done\n"
            "previous=\n"
            "for argument in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then printf 'complete\\n' > \"$argument\"; fi\n"
            "  previous=$argument\n"
            "done\n"
            "printf 'end\\n' >> " + str(self.log) + "\n")
        self.compiler.chmod(0o755)
        self.children = []
        self.addCleanup(self.stop_children)

    def stop_children(self):
        self.hold.touch()
        for child in self.children:
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()

    def argv(self, token):
        return [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / ("receipt-" + token)), "--kind", "cc",
                "--state-root", str(self.state), "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-adoption-v1",
                "--artifact", "output=" + str(self.output), "--input", str(self.source),
                "--", str(self.compiler), "-o", str(self.output)]

    def environment(self):
        return dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def start_tree(self, token):
        """Start a requester below two ancestors; returns the tree root."""
        child = subprocess.Popen([sys.executable, "-I", "-c", TREE, *self.argv(token)],
                                 env=self.environment(), stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
        self.children.append(child)
        return child

    def until(self, what, test, seconds=60):
        # This deadline detects a broken fixture; it does not bound a compiler.
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return
            time.sleep(0.05)
        self.fail(what)

    def log_lines(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def keydir(self):
        keys = list((self.state / "keys").glob("*"))
        return keys[0] if len(keys) == 1 else None

    def owners(self):
        keydir = self.keydir()
        return sorted(p.name for p in (keydir / "owners").iterdir()) if keydir and (keydir / "owners").is_dir() else []

    def results(self):
        keydir = self.keydir()
        return [dict(line.split("=", 1) for line in p.read_text().splitlines() if "=" in line)
                for p in sorted(keydir.glob("runs/*/result"))] if keydir else []

    def terminate_tree(self, root):
        victims = descendants(root.pid)
        for pid in [root.pid] + victims:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        root.wait(timeout=30)
        return victims

    def compiler_alive(self):
        return any(line.startswith("start ") and pathlib.Path("/proc/" + line.split()[1]).exists()
                   and "Z" not in pathlib.Path("/proc/" + line.split()[1] + "/stat").read_text().rsplit(")", 1)[1].split()[0]
                   for line in self.log_lines())

    def test_execution_survives_the_end_of_the_first_requesters_tree_while_another_owner_remains(self):
        first = self.start_tree("first")
        self.until("the execution started", lambda: any(l.startswith("start") for l in self.log_lines()))
        second = subprocess.Popen(self.argv("second"), env=self.environment(),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(second)
        self.until("both owners are registered", lambda: len(self.owners()) == 2)
        first_token = next(t for t in self.owners() if t == "first")
        self.terminate_tree(first)
        time.sleep(3)
        self.assertEqual(self.results(), [], "the execution ended with the first requester")
        self.assertTrue(self.compiler_alive(), self.log_lines())
        self.assertNotIn("end", self.log_lines())
        self.hold.touch()
        out, err = second.communicate(timeout=60)
        self.assertEqual(second.returncode, 0, out + err)
        self.assertEqual(self.output.read_text(), "complete\n")
        self.assertEqual([r["status"] for r in self.results()], ["completed"])
        self.assertNotIn(first_token, self.owners())

    def test_execution_runs_to_its_end_when_the_only_owner_tree_ends(self):
        first = self.start_tree("only")
        self.until("the execution started", lambda: any(l.startswith("start") for l in self.log_lines()))
        self.terminate_tree(first)
        time.sleep(3)
        self.assertEqual(self.results(), [], "the execution ended with its only requester")
        self.assertTrue(self.compiler_alive(), self.log_lines())
        self.hold.touch()
        self.until("the execution published its result", lambda: [r.get("status") for r in self.results()] == ["completed"])
        self.assertIn("end", self.log_lines())
        # The first requester's client copies the artifact to its path, and it is gone.
        # The result stays cached for the next identical request, which runs nothing.
        self.assertFalse(self.output.exists())
        again = subprocess.run(self.argv("again"), env=self.environment(), capture_output=True, text=True, timeout=60)
        self.assertEqual(again.returncode, 0, again.stdout + again.stderr)
        self.assertEqual(self.output.read_text(), "complete\n")
        self.assertEqual(len([l for l in self.log_lines() if l.startswith("start")]), 1, self.log_lines())

    def test_a_token_whose_process_is_gone_is_removed_when_the_key_is_joined(self):
        gone = subprocess.Popen([sys.executable, "-I", "-c", "pass"])
        gone.wait()
        first = self.start_tree("live")
        self.until("the execution started", lambda: any(l.startswith("start") for l in self.log_lines()))
        stale = self.keydir() / "owners" / "stale"
        stale.write_text("pid=%d\nstarttime=1\nstarted_ns=1\n" % gone.pid)
        second = subprocess.Popen(self.argv("joiner"), env=self.environment(),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(second)
        self.until("the joiner is registered", lambda: "joiner" in self.owners())
        self.assertIn("stale", self.owners())
        self.hold.touch()
        out, err = second.communicate(timeout=60)
        self.assertEqual(second.returncode, 0, out + err)
        self.assertNotIn("stale", self.owners())


if __name__ == "__main__":
    unittest.main()
