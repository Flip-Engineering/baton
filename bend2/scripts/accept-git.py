#!/usr/bin/env python3
"""The Git acceptance segment of the root-day runs.

Three scenarios run real OMP workers through the coordinator, on scratch
repositories, with no network remote. Each scenario is green only when the Git
path it exercises answers as the design says.

  landing-publishing  one real worker commits; a real OMP root session reads
                      the worker's report, inspects its worktree and
                      acknowledges it; the gated landing lands the change; the
                      coordinator publishes the landed target and git ls-remote
                      reads the advertised ref back; a remote moved
                      independently makes the next push refuse.
  target-move         two real workers branch from one target; the target
                      moves under the second landing while its gate runs; it
                      lands on top of the first with both changes.
  conflict-recovery   two real workers write one file; the second landing
                      conflicts; the root guides it with a coordinator
                      message; the worker's resumed turn rebases and resolves;
                      the revised branch lands.

Usage:
  python3 bend2/scripts/accept-git.py --config CONFIG.json --output NEW_DIR
          [--coordinator EXE] [--scenarios all|landing-publishing,target-move,conflict-recovery]

The config carries the route entries the driver uses; this segment reads the
``omp`` entry for both the workers and the root session, and refuses by name
when it is absent:

  {"omp": {"executable": "/opt/homebrew/bin/omp", "model": "...", "effort": "high"}}

Every artifact (the state database, the repository, each turn's event log, the
root's own output) goes under ``--output``/<scenario>. The exit is 0 only
when every selected scenario is green, and the closing line names the outcome.
The module is importable too: ``run(config, output, coordinator)`` answers the
same results the command line reports.

Prerequisites, each refused by name: Bend 2.0.25 through BEND, .bend/bin/bend
or node_modules/.bend/bin/bend (the coordinator is built the way
check-native.sh builds it, unless --coordinator names a binary), clang with
the sqlite3 headers, git, the OMP CLI the config names, and credentials for
its model in the inherited HOME. No provider timeout and no retry cutoff is
applied to any turn.
"""

import argparse
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCENARIOS = ("landing-publishing", "target-move", "conflict-recovery")

CHECK_PLAIN = """#!/bin/sh
git rev-parse --verify HEAD >/dev/null || { printf '%s %s %s %s\\n' 706c61696e 6e6f68656164 6572726f 2d; exit 1; }
exit 0
"""

# This check judges the tree and waits for the target to move, so the landing
# under test reaches its compare-and-swap with a target that has already
# moved. Its observation goes to the file BATON_WAIT_LOG names, never to
# stdout, which carries only failure identities. It waits for the sequence
# that moves the target, with no cutoff of its own.
CHECK_MOVE_WAIT = """#!/bin/sh
common=$(git rev-parse --git-common-dir)
repo=$(dirname "$common")
tree=$(git rev-parse HEAD)
before="$BATON_WAIT_BASE"
printf 'check started\\n' >> "$BATON_WAIT_READY"
while [ "$(git -C "$repo" rev-parse refs/heads/main)" = "$before" ]; do
  sleep 0.2
done
printf 'tree %s saw the target move from %s to %s\\n' "$tree" "$before" "$(git -C "$repo" rev-parse refs/heads/main)" >> "$BATON_WAIT_LOG"
git rev-parse --verify HEAD >/dev/null || { printf '%s %s %s %s\\n' 77616974 6e6f68656164 6572726f 2d; exit 1; }
exit 0
"""


class Refused(Exception):
    """A prerequisite the segment cannot supply."""


class Failed(Exception):
    """A scenario that answered against the design."""


def say(message):
    print(message, flush=True)


def route(config, name):
    entry = (config or {}).get(name)
    if not isinstance(entry, dict) or not entry.get("executable") or not entry.get("model"):
        raise Refused(f"the config carries no usable {name} route (executable and model)")
    return {
        "executable": str(entry["executable"]),
        "model": str(entry["model"]),
        "effort": str(entry.get("effort") or "high"),
    }


def coordinator_binary(supplied):
    if supplied:
        path = pathlib.Path(supplied)
        if not path.is_file():
            raise Refused(f"--coordinator names no file: {path}")
        return path
    build = subprocess.run(["sh", "bend2/scripts/build-native.sh"], cwd=ROOT,
                           capture_output=True, text=True)
    if build.returncode != 0:
        raise Refused("the coordinator did not build (set BEND to bend 2.0.25): "
                      + build.stderr.strip())
    path = ROOT / ".scratch/bend2/baton2"
    if not path.is_file():
        raise Refused(f"the coordinator binary is missing at {path}")
    return path


def git(repo, *args, check=True):
    done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and done.returncode != 0:
        raise Failed(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout.strip()


def coord(binary, db, *args, env=None, check=True):
    done = subprocess.run([str(binary), str(db), *[str(a) for a in args]],
                          capture_output=True, text=True, env=env)
    if check and done.returncode != 0:
        raise Failed(f"{args[0] if args else 'command'} refused: {done.stderr.strip()}")
    return done.stdout.strip(), done.returncode, done.stderr.strip()


def coord_json(binary, db, *args, env=None):
    out, _, _ = coord(binary, db, *args, env=env)
    return json.loads(out)


def expect_json(answer, fragment, what):
    if fragment not in answer:
        raise Failed(f"{what}: expected {fragment}, got {answer}")


def seed_repo(run_dir):
    repo = run_dir / "repo"
    repo.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    (repo / "data").mkdir()
    (repo / "data" / "seed.txt").write_text("seed\n")
    (repo / "data" / "shared.txt").write_text("one\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "seed")
    # a landing advances a target no worktree holds
    git(repo, "checkout", "-q", "--detach")
    return repo, git(repo, "rev-parse", "HEAD")


def write_checks(run_dir):
    plain = run_dir / "check-plain.sh"
    plain.write_text(CHECK_PLAIN)
    waiting = run_dir / "check-move-wait.sh"
    waiting.write_text(CHECK_MOVE_WAIT)
    return plain, waiting


def turn_worker(binary, db, repo, run_dir, route_omp, worker, branch, base,
                path, line, turn, guided=False, session=""):
    """One real turn for WORKER, committing in its own recruited worktree."""
    coord(binary, db, "recruit", worker, "root", "omp", route_omp["model"],
          route_omp["effort"], repo, branch, f"wt-{worker}", base)
    worktree = repo / f"wt-{worker}"
    task = run_dir / f"task-{worker}-{turn}.txt"
    if guided:
        task.write_text(
            f"You are worker {worker}. Your working directory is {worktree}.\n"
            "The root left you guidance. Read it by running:\n"
            f"  {binary} {db} inbox {worker}\n"
            "Then do exactly this and nothing else:\n"
            "1. Run: git rebase main\n"
            f"2. The rebase stops on {path}. Write that file so it contains the single line: {line}\n"
            f"3. Run: git add {path}\n"
            "4. Run: GIT_EDITOR=true git rebase --continue\n"
            f"5. Reply with one line: done {worker}\n")
    else:
        task.write_text(
            f"You are worker {worker}. Your working directory is {worktree}.\n"
            "Do exactly this and nothing else:\n"
            f"1. Write the file {path} so it contains the single line: {line}\n"
            f"2. Run: git add {path}\n"
            f"3. Run: git commit -m '{worker} writes {line}'\n"
            f"4. Reply with one line: done {worker}\n")
    out, code, err = coord(binary, db, "turn", worker, turn, route_omp["executable"],
                           route_omp["model"], route_omp["effort"], worktree,
                           task, run_dir / f"turn-{worker}-{turn}.jsonl", session, check=False)
    (run_dir / f"turn-{worker}-{turn}.report").write_text(out + err)
    if code != 0:
        raise Failed(f"the turn of {worker} failed: {err.strip() or out.strip()}")
    committed = git(worktree, "log", "-1", "--format=%h")
    content = git(worktree, "show", f"HEAD:{path}")
    if content != line:
        raise Failed(f"worker {worker} committed {content!r}, expected {line!r}")
    say(f"worker {worker}: branch {branch} at {committed}, {path} = {content}")
    say(f"  report: {out}")
    return worktree


def adapter_env(route_omp):
    return {**os.environ, "OMP_ROOT_MODEL": route_omp["model"],
            "OMP_ROOT_THINKING": route_omp["effort"]}


def root_attach(binary, db, run_dir, route_omp):
    done = subprocess.run(["node", "bend2/scripts/omp-root.mjs", str(db), str(binary),
                           route_omp["executable"], "--attach"],
                          cwd=ROOT, capture_output=True, text=True, env=adapter_env(route_omp))
    (run_dir / "root-attach.log").write_text(done.stdout + done.stderr)
    if done.returncode != 0:
        raise Failed(f"the root adapter could not attach: {done.stderr.strip()}")


def root_turn(binary, db, run_dir, route_omp):
    """One real OMP root turn over the pending messages."""
    done = subprocess.run(["node", "bend2/scripts/omp-root.mjs", str(db), str(binary),
                           route_omp["executable"]],
                          cwd=ROOT, capture_output=True, text=True, env=adapter_env(route_omp))
    (run_dir / "root-turn.out").write_text(done.stdout)
    (run_dir / "root-turn.err").write_text(done.stderr)
    if done.returncode != 0:
        raise Failed(f"the root turn failed (exit {done.returncode}): {done.stderr.strip()}")
    return done.stdout.strip()


def scenario_landing_publishing(config, out, binary):
    run_dir = out / "landing-publishing"
    run_dir.mkdir(parents=True)
    say("=== landing-publishing: real worker, native root review, gated landing, publication ===")
    say(f"artifacts {run_dir}")
    route_omp = route(config, "omp")
    repo, base = seed_repo(run_dir)
    db = run_dir / "state.db"
    plain, _ = write_checks(run_dir)
    coord(binary, db, "attach", "root", "omp", "", "")
    coord(binary, db, "message", "review-setup", "root", "root", "guidance",
          "Remember this instruction for this acceptance run: when a worker report arrives, "
          "inspect its worktree, branch diff and committed file contents, then acknowledge "
          "the report naming what you reviewed. Do not land, push, edit, or launch workers. "
          "The acceptance driver performs the Git acts after your review. "
          "Acknowledge review-setup now and wait for the report.")
    root_attach(binary, db, run_dir, route_omp)
    remote = run_dir / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    git(repo, "remote", "add", "acceptance-remote", str(remote))
    turn_worker(binary, db, repo, run_dir, route_omp, "w1", "wa", base, "data/a.txt", "alpha", "t1")
    delivery = coord_json(binary, db, "delivery", "t1")
    if not delivery.get("receipt"):
        raise Failed("the root did not acknowledge the worker's report")
    say(f"report t1 acknowledged with receipt {delivery['receipt']}")
    say(f"the root's session: {coord(binary, db, 'session', 'root')[0]}")
    if git(repo, "rev-parse", "main") != base:
        raise Failed("the root advanced the target before the requested checked landing")
    answer, _, _ = coord(binary, db, "land-checked", "w1", repo, "main", plain, "data/seed.txt")
    say(f"land-checked: {answer}")
    expect_json(answer, '"status":"landed"', "the gated landing")
    landed = git(repo, "rev-parse", "main")
    answer, _, _ = coord(binary, db, "push", repo, "main", "acceptance-remote")
    say(f"push: {answer}")
    expect_json(answer, '"status":"pushed"', "the publication")
    advertised = subprocess.run(["git", "ls-remote", str(remote), "refs/heads/main"],
                                capture_output=True, text=True).stdout.strip()
    say(f"advertised ref: {advertised}")
    if advertised.split("\t")[0] != landed:
        raise Failed("the remote does not advertise the landed commit")
    if git(repo, "show", "main:data/a.txt") != "alpha":
        raise Failed("the landed tree lost the first worker change")
    say(f"landed tree data/a.txt = {git(repo, 'show', 'main:data/a.txt')}")
    git(repo, "push", "-q", "--force", "acceptance-remote",
        f"{git(repo, 'rev-parse', 'wa')}:refs/heads/main")
    answer, _, _ = coord(binary, db, "push", repo, "main", "acceptance-remote", check=False)
    say(f"push after an independent move: {answer}")
    expect_json(answer, '"status":"rejected"', "the refused push")
    after = subprocess.run(["git", "ls-remote", str(remote), "refs/heads/main"],
                           capture_output=True, text=True).stdout.strip()
    say(f"remote after the refusal: {after}")
    if after.split("\t")[0] != git(repo, "rev-parse", "wa"):
        raise Failed("a rejected push changed the independently moved remote")


def land_under_a_move(binary, db, repo, run_dir, waiting, plain, selected, under, mover):
    """Start UNDER's landing, move the target with MOVER's, answer UNDER's."""
    wait_log = run_dir / "wait-observed.log"
    wait_log.write_text("")
    ready = run_dir / "check-started.log"
    env = {**os.environ, "BATON_WAIT_LOG": str(wait_log),
           "BATON_WAIT_BASE": git(repo, "rev-parse", "main"), "BATON_WAIT_READY": str(ready)}
    with (run_dir / f"land-{under}.out").open("w") as opening:
        child = subprocess.Popen([str(binary), str(db), "land-checked", under, str(repo),
                                  "main", str(waiting), selected],
                                 stdout=opening, stderr=subprocess.STDOUT, text=True, env=env)
        try:
            while not ready.exists():
                if child.poll() is not None:
                    raise Failed(f"the landing of {under} exited before its check started")
                time.sleep(0.2)
            say(f"  {under}'s candidate check started")
            answer, _, _ = coord(binary, db, "land-checked", mover, repo, "main", plain, selected)
            say(f"first landing (moves the target): {answer}")
            expect_json(answer, '\"status\":\"landed\"', f"the landing of {mover}")
            first = git(repo, "rev-parse", "main")
            child.wait()
        finally:
            if child.poll() is None:
                # Reap this scenario's processes if its staged move failed.
                rows = [tuple(map(int, line.split())) for line in subprocess.check_output(
                    ["ps", "-axo", "pid=,ppid="], text=True).splitlines()]
                owned = {child.pid}
                while True:
                    descendants = {pid for pid, parent in rows if parent in owned}
                    if descendants <= owned:
                        break
                    owned |= descendants
                for pid in sorted(owned - {child.pid}, reverse=True) + [child.pid]:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                child.wait()
    answer = (run_dir / f"land-{under}.out").read_text().strip()
    return first, answer, wait_log


def scenario_target_move(config, out, binary):
    run_dir = out / "target-move"
    run_dir.mkdir(parents=True)
    say("=== target-move: the target moves under the second landing, clean rebase ===")
    say(f"artifacts {run_dir}")
    route_omp = route(config, "omp")
    repo, base = seed_repo(run_dir)
    db = run_dir / "state.db"
    plain, waiting = write_checks(run_dir)
    coord(binary, db, "attach", "root", "external", "", "")
    turn_worker(binary, db, repo, run_dir, route_omp, "w1", "wa", base, "data/a.txt", "alpha", "t1")
    turn_worker(binary, db, repo, run_dir, route_omp, "w2", "wb", base, "data/b.txt", "beta", "t2")
    first, answer, wait_log = land_under_a_move(binary, db, repo, run_dir, waiting, plain,
                                                "data/seed.txt", "w2", "w1")
    say(f"second landing: {answer}")
    expect_json(answer, '"status":"landed"', "the second landing")
    say(f"what the gate's check observed: {wait_log.read_text().strip()}")
    if git(repo, "rev-parse", "main^") != first:
        raise Failed("the second landing does not sit on the first")
    if git(repo, "show", "main:data/a.txt") != "alpha":
        raise Failed("the landed tree lost the first worker change")
    say(f"landed tree data/a.txt = {git(repo, 'show', 'main:data/a.txt')}")
    if git(repo, "show", "main:data/b.txt") != "beta":
        raise Failed("the landed tree lost the second worker change")
    say(f"landed tree data/b.txt = {git(repo, 'show', 'main:data/b.txt')}")
    say(git(repo, "log", "--oneline", "main"))


def scenario_conflict_recovery(config, out, binary):
    run_dir = out / "conflict-recovery"
    run_dir.mkdir(parents=True)
    say("=== conflict-recovery: the root guides a conflicted worker, which rebases and lands ===")
    say(f"artifacts {run_dir}")
    route_omp = route(config, "omp")
    repo, base = seed_repo(run_dir)
    db = run_dir / "state.db"
    plain, waiting = write_checks(run_dir)
    coord(binary, db, "attach", "root", "external", "", "")
    turn_worker(binary, db, repo, run_dir, route_omp, "w3", "wc", base, "data/shared.txt", "three", "t1")
    turn_worker(binary, db, repo, run_dir, route_omp, "w4", "wd", base, "data/shared.txt", "four", "t2")
    first, answer, wait_log = land_under_a_move(binary, db, repo, run_dir, waiting, plain,
                                            "data/seed.txt", "w4", "w3")
    say(f"conflicted landing: {answer}")
    expect_json(answer, '"status":"conflict"', "the conflicted landing")
    expect_json(answer, "data/shared.txt", "the conflict answer")
    say(f"what the gate's check observed: {wait_log.read_text().strip()}")
    target = git(repo, "rev-parse", "main")
    if target != first or git(repo, "show", "main:data/shared.txt") != "three":
        raise Failed("the conflict changed the first worker landing")
    say(f"target after the conflict: {target} with data/shared.txt = {git(repo, 'show', 'main:data/shared.txt')}")
    say("the root guides the worker:")
    guidance = coord_json(binary, db, "message", "g1", "root", "w4", "guidance",
                          f"Your landing onto main conflicted: the target moved to {target} and "
                          "data/shared.txt now carries another worker's line. Rebase your branch "
                          "onto main, resolve data/shared.txt so its single line is: three and "
                          "four, and commit the rebase.")
    say(f"  {json.dumps(guidance)}")
    say(f"  the worker's inbox: {coord(binary, db, 'inbox', 'w4')[0]}")
    session = json.loads(coord(binary, db, "session", "w4")[0]).get("native")
    if not session:
        raise Failed("the worker has no recorded native session")
    say(f"  resuming native session {session}")
    turn_worker(binary, db, repo, run_dir, route_omp, "w4", "wd", base, "data/shared.txt",
                "three and four", "t3", guided=True, session=session)
    if coord_json(binary, db, "session", "w4")["native"] != session:
        raise Failed("the resolving worker changed native sessions")
    if git(repo, "rev-parse", "wd^") != target:
        raise Failed("the revised branch is not rebased onto the moved target")
    answer, _, _ = coord(binary, db, "land-checked", "w4", repo, "main", plain, "data/shared.txt")
    say(f"landing the revised branch: {answer}")
    expect_json(answer, '"status":"landed"', "the landing of the revised branch")
    if git(repo, "show", "main:data/shared.txt") != "three and four":
        raise Failed("the revised landing lost the resolution")
    say(f"landed tree data/shared.txt = {git(repo, 'show', 'main:data/shared.txt')}")
    say(git(repo, "log", "--oneline", "main"))


RUNNERS = {
    "landing-publishing": scenario_landing_publishing,
    "target-move": scenario_target_move,
    "conflict-recovery": scenario_conflict_recovery,
}


def run(config, output, coordinator=None, scenarios=None):
    """Run the selected scenarios under OUTPUT and answer {scenario: ok|error}."""
    binary = coordinator_binary(coordinator)
    out = pathlib.Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for key, value in {"GIT_AUTHOR_NAME": "Bend2 acceptance", "GIT_AUTHOR_EMAIL": "acceptance@example.invalid",
                       "GIT_COMMITTER_NAME": "Bend2 acceptance", "GIT_COMMITTER_EMAIL": "acceptance@example.invalid"}.items():
        os.environ[key] = value
    selected = list(scenarios or SCENARIOS)
    results = {}
    for name in selected:
        if name not in RUNNERS:
            raise Refused(f"unknown scenario {name} (all, {', '.join(SCENARIOS)})")
        try:
            RUNNERS[name](config, out, binary)
            results[name] = "ok"
        except Failed as error:
            results[name] = str(error)
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description="The Git acceptance segment of the root-day runs.")
    parser.add_argument("--config", required=True, help="the acceptance config with the route entries")
    parser.add_argument("--output", required=True, help="directory for every artifact")
    parser.add_argument("--coordinator", default=None, help="coordinator binary (built when omitted)")
    parser.add_argument("--scenarios", default="all",
                        help="all, or a comma-separated list of scenario names")
    args = parser.parse_args(argv)
    config = json.loads(pathlib.Path(args.config).read_text())
    scenarios = None if args.scenarios == "all" else [s for s in args.scenarios.split(",") if s]
    try:
        results = run(config, args.output, args.coordinator, scenarios)
    except Refused as refusal:
        print(f"git acceptance: {refusal}", file=sys.stderr)
        return 2
    for name, outcome in results.items():
        print(f"git acceptance: {name} {outcome}", flush=True)
    failed = [name for name, outcome in results.items() if outcome != "ok"]
    if failed:
        print(f"bend2 git acceptance: FAILED - {' '.join(failed)}")
        return 1
    print(f"bend2 git acceptance: green - {len(results)} scenarios, 0 failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
