"""A cc request that differs from a measured one only in its C source reuses the measured peak (#1310).

The history group of a cc request is its request key without the digest of the
C-family source files and without the digests of the input rows. The content digest
of every other input or aux file (a driver script, a helper, a data file) stays in
it, with the kind, entry, options, toolchain, artifact names and normalized command.
A command that exits 0 with no signal raises the group record under state/history.
The tests start commands that touch a fixed amount of memory so that the sampled
peak is positive, and they compare claim records with the group record, never with
a fixed number.

* An edited C source finds the group record: its claim is a known claim (`history=1`).
* A later larger successful measurement raises the record; a later smaller one leaves it.
* A command that does not exit 0 records no group peak.
* Another option, another command argument, or a changed helper or data file is
  another group: the claim has no history.
* An edited source of a measured group starts beside a running claim whose history is
  known, which a request without history does not.
* A request of a group that was never measured waits beside a running claim.
* A cgen request is admitted on the record of its exact key only: no group record
  exists for it, whatever was measured before.
* The records are in state/history; the directory peaks/ of the memory-admission
  executable is not created, and the attempt file `group` of that executable is not
  written.
"""
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

COMPILER = '''#!{python}
import pathlib, sys, time

args = sys.argv[1:]
source = pathlib.Path(args[args.index("--source") + 1]).read_text()
output = args[args.index("-o") + 1]
settings = dict(line.split("=", 1) for line in source.splitlines() if "=" in line)
memory = bytes(b"x") * (int(settings.get("mb", "64")) * 1024 * 1024)
with open(settings["log"], "a") as log:
    log.write("allocated %s %d\\n" % (settings["name"], len(memory)))
hold = pathlib.Path(settings["hold"])
deadline = time.monotonic() + 120
while not hold.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
if settings.get("exit", "0") != "0":
    sys.exit(int(settings["exit"]))
pathlib.Path(output).write_text("complete " + settings["name"] + "\\n")
with open(settings["log"], "a") as log:
    log.write("end %s\\n" % settings["name"])
'''


def fields(path):
    return dict(line.split("=", 1) for line in pathlib.Path(path).read_text().splitlines() if "=" in line)


class HistoryGroupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-history-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.log = self.root / "log"
        self.source = self.root / "main.c"
        self.entry = self.root / "entry.bend"
        self.helper = self.root / "helper.py"
        self.helper.write_text("# driver version 1\n")
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(COMPILER.format(python=sys.executable))
        self.compiler.chmod(0o755)
        self.holds = {}
        self.children = []
        self.addCleanup(self.release_all)

    def release_all(self):
        for hold in self.holds.values():
            hold.touch()
        for child in self.children:
            try:
                child.wait(timeout=60)
            except subprocess.TimeoutExpired:
                child.kill()

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

    def allocated(self, name):
        return any(line.startswith("allocated %s " % name) for line in self.log_lines())

    def request(self, name, edit, options=(), exit_code=0, mb=64, aux=(), extra=(), kind="cc"):
        """Start a request whose source text carries the edit; returns the process."""
        hold = self.root / ("hold-" + name)
        self.holds[name] = hold
        source = self.entry if kind == "cgen" else self.source
        source.write_text("mb=%d\nname=%s\nlog=%s\nhold=%s\nexit=%d\n# edit %s\n"
                          % (mb, name, self.log, hold, exit_code, edit))
        output = self.root / ("output-" + name + (".c" if kind == "cgen" else ""))
        argv = [self.candidate, "--", "run", "--token", name,
                "--receipt", str(self.root / ("receipt-" + name)), "--kind", kind,
                "--state-root", str(self.state), "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler)]
        if kind == "cgen":
            argv += ["--entry", "entry.bend", "--artifact", "c.c=" + str(output)]
        else:
            argv += ["--linker", "/usr/bin/ld", "--version", "fake-history-v1",
                     "--artifact", "output=" + str(output), "--input", str(self.source)]
        for path in aux:
            argv += ["--aux", str(path)]
        for option in options:
            argv += ["--option", option]
        argv += ["--", str(self.compiler), "--source", str(source), "-o", str(output), *extra]
        child = subprocess.Popen(argv, env=dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state)),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def measured(self, name, edit, options=(), **more):
        """Run a request to its end after the sampler saw its memory."""
        child = self.request(name, edit, options, **more)
        self.until("%s allocated" % name, lambda: self.allocated(name))
        time.sleep(1.5)
        self.holds[name].touch()
        out, err = child.communicate(timeout=60)
        self.assertEqual(child.returncode, 0, out + err)

    def group_records(self):
        history = self.state / "history"
        return {p.name: int(fields(p)["peak_kb"]) for p in history.iterdir()} if history.is_dir() else {}

    def claim(self, name):
        """The record of the running claim of a request, by its key."""
        running = self.state / "admission" / "running"
        keys = {p.name: fields(p) for p in running.iterdir()} if running.is_dir() else {}
        mine = [c for c in keys.values() if c.get("key") and (self.state / "keys" / c["key"]).is_dir()
                and (self.state / "keys" / c["key"] / "owners" / name).exists()]
        return mine[0] if mine else None

    def waiting_count(self):
        waiting = self.state / "admission" / "waiting"
        return len(list(waiting.iterdir())) if waiting.is_dir() else 0

    def test_an_edited_source_reuses_the_peak_of_its_group(self):
        self.assertEqual(self.group_records(), {})
        self.measured("first", "one")
        records = self.group_records()
        self.assertEqual(len(records), 1, records)
        group, peak = next(iter(records.items()))
        self.assertGreater(peak, 32 * 1024, "the sampled peak is below the memory the command touched")
        second = self.request("second", "two")
        self.until("second allocated", lambda: self.allocated("second"))
        self.until("second has a claim", lambda: self.claim("second") is not None)
        claim = self.claim("second")
        self.assertEqual(claim["history"], "1", claim)
        self.assertGreater(int(claim["expected_kb"]), 0, claim)
        self.holds["second"].touch()
        out, err = second.communicate(timeout=60)
        self.assertEqual(second.returncode, 0, out + err)
        self.assertEqual(len(list((self.state / "keys").iterdir())), 2, "the edit must be another request")
        self.assertEqual(list(self.group_records()), [group])
        self.assertFalse((self.state / "peaks").exists(), "records belong in history/, not in the peaks/ of the other executable")
        attempts = list((self.state / "keys").glob("*/runs/*"))
        self.assertTrue(attempts and all((a / "history-group").is_file() and not (a / "group").exists() for a in attempts))

    def test_a_later_larger_measurement_raises_the_group_record_and_a_smaller_one_leaves_it(self):
        self.measured("small", "one", mb=32)
        (group, low), = self.group_records().items()
        self.measured("large", "two", mb=192)
        self.assertEqual(list(self.group_records()), [group])
        high = self.group_records()[group]
        self.assertGreater(high, low + 64 * 1024, "the larger measurement did not raise the record")
        self.measured("small-again", "three", mb=32)
        self.assertEqual(self.group_records()[group], high, "a smaller measurement lowered the record")
        following = self.request("following", "four", mb=32)
        self.until("following has a claim", lambda: self.claim("following") is not None)
        claim = self.claim("following")
        self.assertEqual(claim["history"], "1", claim)
        self.assertEqual(int(claim["expected_kb"]), high, "the claim must expect the raised high-water mark")
        self.holds["following"].touch()
        out, err = following.communicate(timeout=60)
        self.assertEqual(following.returncode, 0, out + err)

    def test_a_changed_helper_or_data_file_is_another_group(self):
        notes = self.root / "notes.txt"
        notes.write_text("notes one\n")
        self.measured("first", "one", aux=[self.helper, notes])
        (group,) = self.group_records()
        same = self.request("same", "two", aux=[self.helper, notes])
        self.until("same has a claim", lambda: self.claim("same") is not None)
        self.assertEqual(self.claim("same")["history"], "1", "an edit of the C source must keep the group")
        self.holds["same"].touch()
        out, err = same.communicate(timeout=60)
        self.assertEqual(same.returncode, 0, out + err)
        for what, change in (("helper", lambda: self.helper.write_text("# driver version 2\n")),
                             ("notes", lambda: notes.write_text("notes two\n"))):
            change()
            child = self.request("changed-" + what, "two", aux=[self.helper, notes])
            self.until("changed-%s has a claim" % what, lambda: self.claim("changed-" + what) is not None)
            self.assertEqual(self.claim("changed-" + what)["history"], "0",
                             "a changed %s inherited the history of the earlier one" % what)
            self.holds["changed-" + what].touch()
            out, err = child.communicate(timeout=60)
            self.assertEqual(child.returncode, 0, out + err)
        self.assertEqual(len(self.group_records()), 3)
        self.assertIn(group, self.group_records())

    def test_another_command_argument_is_another_group(self):
        self.measured("first", "one")
        other = self.request("other", "one", extra=["--jobs", "4"])
        self.until("other has a claim", lambda: self.claim("other") is not None)
        self.assertEqual(self.claim("other")["history"], "0")
        self.holds["other"].touch()
        out, err = other.communicate(timeout=60)
        self.assertEqual(other.returncode, 0, out + err)

    def test_a_cgen_request_is_admitted_on_the_record_of_its_exact_key_only(self):
        self.measured("first", "one", kind="cgen")
        self.assertEqual(self.group_records(), {})
        self.assertEqual(len(list((self.state / "keys").glob("*/peak"))), 1)
        second = self.request("second", "two", kind="cgen")
        self.until("second has a claim", lambda: self.claim("second") is not None)
        claim = self.claim("second")
        self.assertEqual(claim["history"], "0", claim)
        self.holds["second"].touch()
        out, err = second.communicate(timeout=60)
        self.assertEqual(second.returncode, 0, out + err)
        self.assertEqual(self.group_records(), {})

    def test_a_command_that_does_not_exit_zero_records_no_group_peak(self):
        failing = self.request("failing", "broken", exit_code=1)
        self.until("failing allocated", lambda: self.allocated("failing"))
        time.sleep(1.5)
        self.holds["failing"].touch()
        out, err = failing.communicate(timeout=60)
        self.assertNotEqual(failing.returncode, 0, out + err)
        self.assertEqual(self.group_records(), {})
        exact = list((self.state / "keys").glob("*/peak"))
        self.assertEqual(len(exact), 1, "the failed request keeps the peak of its own key")
        fixed = self.request("fixed", "repaired")
        self.until("fixed has a claim", lambda: self.claim("fixed") is not None)
        self.assertEqual(self.claim("fixed")["history"], "0")
        self.holds["fixed"].touch()
        out, err = fixed.communicate(timeout=60)
        self.assertEqual(fixed.returncode, 0, out + err)

    def test_another_option_is_another_group(self):
        self.measured("first", "one")
        other = self.request("other", "one", options=["mode=other"])
        self.until("other has a claim", lambda: self.claim("other") is not None)
        self.assertEqual(self.claim("other")["history"], "0")
        self.holds["other"].touch()
        out, err = other.communicate(timeout=60)
        self.assertEqual(other.returncode, 0, out + err)
        self.assertEqual(len(self.group_records()), 2)

    def test_an_edited_source_of_a_measured_group_starts_beside_a_known_claim(self):
        self.measured("a1", "one")
        self.measured("b1", "one", options=["mode=b"])
        running = self.request("b2", "two", options=["mode=b"])
        self.until("b2 allocated", lambda: self.allocated("b2"))
        self.until("b2 has a claim", lambda: self.claim("b2") is not None)
        self.assertEqual(self.claim("b2")["history"], "1")
        edited = self.request("a2", "two")
        self.until("a2 started beside the running claim of b2", lambda: self.allocated("a2"))
        self.assertNotIn("end b2", self.log_lines())
        self.assertEqual(self.claim("a2")["history"], "1")
        self.holds["a2"].touch()
        self.holds["b2"].touch()
        for child in (edited, running):
            out, err = child.communicate(timeout=60)
            self.assertEqual(child.returncode, 0, out + err)

    def test_a_group_that_was_never_measured_waits_beside_a_running_claim(self):
        self.measured("a1", "one")
        running = self.request("a2", "two")
        self.until("a2 allocated", lambda: self.allocated("a2"))
        self.until("a2 has a claim", lambda: self.claim("a2") is not None)
        unmeasured = self.request("fresh", "one", options=["mode=fresh"])
        self.until("fresh has a ticket", lambda: self.waiting_count() == 1)
        time.sleep(3)
        self.assertFalse(self.allocated("fresh"), "a request without history started beside a running claim")
        self.holds["a2"].touch()
        out, err = running.communicate(timeout=60)
        self.assertEqual(running.returncode, 0, out + err)
        self.until("fresh started after the claim ended", lambda: self.allocated("fresh"))
        self.holds["fresh"].touch()
        out, err = unmeasured.communicate(timeout=60)
        self.assertEqual(unmeasured.returncode, 0, out + err)


if __name__ == "__main__":
    unittest.main()
