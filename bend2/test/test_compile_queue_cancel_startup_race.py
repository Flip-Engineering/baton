"""A same-key startup racing a cancellation keeps the canceled outcome (#1373).

BATON2_COMPILE_QUEUE_BIN names the queue executable under test.

When the last owner of a key cancels, the cancel command removes the owner's
token and signals the supervisor's process group. A supervisor that is still
starting (here: blocked in admission, before it installs signal handling)
dies without publishing a terminal result, and the waiting run command falls
back to the missing-result path. That path used to decide canceled versus
failed from the current live-owner count. A new request for the same key that
starts up while the cancellation is delivered publishes its owner token
before the fallback counts, so the count is nonzero and the canceled request
was recorded as `failed` although its owner canceled and its execution never
produced a result.

* Each round pins its supervisor in admission by holding the state admission
  lock, so the cancel signal deterministically ends the supervisor before it
  can publish a result. The pin uses the lock file the supervisor itself
  acquires; it is released once the attempt result is recorded.
* Each round publishes a second owner token for the same key as soon as the
  supervisor is observed dead, simulating a same-key request that starts up
  while the cancellation is delivered. The token file carries the same
  fields a joining run publishes for a live process; only its presence
  before the fallback counts matters.
* The only valid outcome for the canceled attempt is canceled with exit 130
  and the missing-result cancellation detail. A `failed` record means the
  new token leaked into the canceled attempt's accounting.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest

WORKERS = 4
ROUNDS_PER_WORKER = 6


def supervisor_starttime(pid):
    try:
        text = pathlib.Path("/proc/%d/stat" % pid).read_text()
    except FileNotFoundError:
        return None
    return text.rsplit(")", 1)[1].split()[19]


class CancelStartupRaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def environment(self, state):
        return dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))

    def argv(self, root, state, token):
        return [self.candidate, "--", "run", "--token", token,
                "--receipt", str(root / ("receipt-" + token)), "--kind", "cc",
                "--state-root", str(state), "--cwd", str(root), "--root", str(root),
                "--source-root", str(root), "--compiler", str(root / "compiler"),
                "--linker", "/usr/bin/ld", "--version", "fake-cancel-race-v1",
                "--artifact", "output=" + str(root / "result"),
                "--input", str(root / "main.c"), "--", str(root / "compiler"), "-o", str(root / "result")]

    def key(self, root, state):
        done = subprocess.run(
            [self.candidate, "--", "key", "--kind", "cc", "--state-root", str(state),
             "--cwd", str(root), "--root", str(root), "--source-root", str(root),
             "--compiler", str(root / "compiler"), "--linker", "/usr/bin/ld",
             "--version", "fake-cancel-race-v1",
             "--artifact", "output=" + str(root / "result"),
             "--input", str(root / "main.c"), "--", str(root / "compiler"), "-o", str(root / "result")],
            env=self.environment(state), capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def wait_for_active(self, state):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            keys = list((state / "keys").glob("*")) if (state / "keys").is_dir() else []
            if keys and (keys[0] / "active").exists():
                return keys[0]
            time.sleep(0.005)
        self.fail("the supervisor never registered")

    def wait_for_token_removal(self, keydir, token):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if not (keydir / "owners" / token).exists():
                return
            time.sleep(0.001)
        self.fail("the cancel never removed the owner token")

    def wait_for_supervisor_death(self, pid, start):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if supervisor_starttime(pid) != start:
                return
            time.sleep(0.005)
        self.fail("the supervisor never exited after the cancel signal")

    def reap(self, proc):
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.communicate(timeout=10)
        except Exception:
            pass

    def wait_for_result(self, keydir):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            results = sorted((keydir / "runs").glob("*/result")) if (keydir / "runs").is_dir() else []
            if results:
                return results[0].read_text()
            time.sleep(0.02)
        self.fail("the canceled attempt never recorded a terminal result")

    def canceled_round(self, index):
        temporary = tempfile.TemporaryDirectory(prefix="queue-cancel-race-")
        self.addCleanup(temporary.cleanup)
        root = pathlib.Path(temporary.name)
        state = root / "state"
        (state / "admission").mkdir(parents=True, mode=0o2770)
        state.chmod(0o2770)
        (root / "main.c").write_text("int main(void){return 0;}\n")
        compiler = root / "compiler"
        compiler.write_text("#!/bin/sh\nsleep 30\n")
        compiler.chmod(0o755)
        env = self.environment(state)
        key = self.key(root, state)
        # Pin the supervisor before it can start the command: it blocks in
        # admission while this lock is held, still without signal handling,
        # so the cancel signal ends it before it publishes any result.
        admission_lock = open(state / "admission" / "lock", "w")
        self.addCleanup(admission_lock.close)
        fcntl.flock(admission_lock, fcntl.LOCK_EX)
        self.addCleanup(fcntl.flock, admission_lock, fcntl.LOCK_UN)
        run = subprocess.Popen(self.argv(root, state, "token-a"), env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.reap, run)
        keydir = self.wait_for_active(state)
        active = dict(line.split("=", 1) for line in (keydir / "active").read_text().splitlines() if "=" in line)
        supervisor_pid = int(active["pid"])
        supervisor_start = active["starttime"]
        time.sleep(0.2)
        cancel = subprocess.Popen(
            [self.candidate, "--", "cancel", "--state-root", str(state), "--key", key, "--token", "token-a"],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # A same-key request starts up while the cancellation is delivered.
        # The cancel removes token-a just before it counts owners, so the
        # removal is the earliest observable point of the delivery: publish
        # token-b just after it, still before the run command accounts for
        # the missing result. The holder keeps the token's process live so
        # the owner count sees it.
        self.wait_for_token_removal(keydir, "token-a")
        time.sleep(0.02)
        holder = subprocess.Popen(["sleep", "120"])
        self.addCleanup(self.reap, holder)
        (keydir / "owners" / "token-b").write_text(
            "pid=%d\nstarttime=%s\nstarted_ns=%d\npriority=0\n"
            % (holder.pid, supervisor_starttime(holder.pid), time.monotonic_ns()))
        try:
            canceled_out, canceled_err = cancel.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            cancel.kill()
            return index, "the cancel command hung"
        if "canceled=requested" not in canceled_out:
            return index, "cancel was not delivered: " + canceled_out + canceled_err
        self.wait_for_supervisor_death(supervisor_pid, supervisor_start)
        record = self.wait_for_result(keydir)
        if "status=canceled" not in record or "exit=130" not in record:
            return index, "outcome was not a cancellation:\n%s" % record
        if "all requesters canceled before a terminal result" not in record:
            return index, "cancellation came from the wrong path:\n%s" % record
        try:
            run.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            run.kill()
            return index, "the canceled run command hung"
        if run.returncode != 130:
            return index, "canceled run exited %s instead of 130" % (run.returncode,)
        return index, None

    def test_a_cancellation_racing_a_same_key_startup_keeps_the_canceled_outcome(self):
        import concurrent.futures
        rounds = WORKERS * ROUNDS_PER_WORKER
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            outcomes = list(pool.map(self.canceled_round, range(rounds)))
        failures = [(index, why) for index, why in outcomes if why]
        self.assertEqual(failures, [], "%d of %d rounds lost the cancellation: %r" % (len(failures), rounds, failures[:2]))


if __name__ == "__main__":
    unittest.main()
