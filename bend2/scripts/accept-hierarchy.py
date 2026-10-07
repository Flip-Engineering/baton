#!/usr/bin/env python3
"""Exercise a native Codex Principal Conductor, an OMP Associate Conductor, and two OMP Players in a clone."""
import argparse
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]


def run(*argv, **kwargs):
    return subprocess.check_output(list(map(str, argv)), text=True, **kwargs).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--coordinator', type=Path,
                        default=SOURCE / '.scratch/bend2/baton2')
    args = parser.parse_args()
    routes = json.loads(args.config.read_text())
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    coord = args.coordinator.resolve()
    db = out / 'state.db'
    repo = out / 'repo'
    env = {**os.environ, 'GIT_AUTHOR_NAME': 'Bend2 hierarchy',
           'GIT_AUTHOR_EMAIL': 'hierarchy@example.invalid',
           'GIT_COMMITTER_NAME': 'Bend2 hierarchy',
           'GIT_COMMITTER_EMAIL': 'hierarchy@example.invalid'}
    run('git', 'clone', '--shared', '--no-checkout', SOURCE, repo, env=env)
    base = run('git', '-C', SOURCE, 'rev-parse', 'HEAD')
    run('git', '-C', repo, 'checkout', '--detach', base, env=env)
    run('git', '-C', repo, 'branch', 'hierarchy-target', base, env=env)

    def call(*argv):
        return json.loads(run(coord, db, *argv, env=env))

    # These wrappers retain native events and process ancestry for this run.
    # Configured launchers own credential discovery and native-state placement.
    wrappers = {}
    for kind in ['codex', 'omp']:
        route = routes[kind]
        wrapper = out / (kind + '-native.py')
        wrapper.write_text('#!/usr/bin/env python3\n' +
            'import json,os,pathlib,subprocess,sys,time\n' +
            f'base=pathlib.Path({str(out)!r})\n' +
            'pid=os.getpid()\n' +
            'record={"pid":pid,"ppid":os.getppid(),"argv":sys.argv[1:],"started":time.time()}\n' +
            f'record["harness"]={kind!r}\n' +
            'path=base/(str(pid)+".process.json")\n' +
            'path.write_text(json.dumps(record,indent=2))\n' +
            f'child=subprocess.Popen([{route["executable"]!r},*sys.argv[1:]],stdout=subprocess.PIPE)\n' +
            'with (base/(str(pid)+".native.jsonl")).open("wb") as log:\n' +
            ' for line in child.stdout:\n' +
            '  sys.stdout.buffer.write(line);sys.stdout.buffer.flush()\n' +
            '  try: keep=json.loads(line).get("type")!="message_update"\n' +
            '  except (ValueError,AttributeError): keep=True\n' +
            '  if keep: log.write(line);log.flush()\n' +
            'code=child.wait()\n' +
            'record.update(ended=time.time(),exitCode=code)\n' +
            'path.write_text(json.dumps(record,indent=2))\n' +
            'sys.exit(code)\n')
        wrapper.chmod(0o700)
        wrappers[kind] = wrapper

    check = out / 'check.sh'
    check.write_text('set -eu\npython3 "$1"\n')
    settings = {'B2': str(coord), 'DB': str(db), 'REPO': str(repo), 'STATE': str(out),
                'SOURCE': str(SOURCE), 'OMP': str(wrappers['omp']), 'CHECK': str(check),
                'OMP_MODEL': routes['omp']['model'], 'OMP_EFFORT': routes['omp']['effort']}
    environment = out / 'environment.sh'
    environment.write_text(''.join(f'export {key}={shlex.quote(value)}\n'
                                   for key, value in settings.items()))
    common = f"""Work only inside {out}. Source {environment} in each shell.
Use the existing native logins through the supplied launchers. Do not change credentials,
toolchains, global configuration or anything outside this scratch directory.
Only the small Python checks described below run; never run the repository's JS suite.
Use coordinator commands for recruitment, reports, guidance and checked landing.
Preserve all native sessions, Player branches and worktrees. Do not push.
"""
    (out / 'worker-a.md').write_text(common + """
Implement a useful standalone text-summary word counter at
bend2/examples/text-summary/words.py, with a count_words(text) function.
Create bend2/examples/text-summary/test_words.py using unittest, runnable directly
with python3, importing the sibling module. Cover empty input, ordinary text,
multiple spaces and Unicode. Review the implementation and run those tests.
Your lead will send an additional tokenization requirement while you work; include
it and its test. Keep working through the coordinator's incoming native guidance.
Commit your two files and state the commit and exact test output in your final response.
The supervisor delivers that response; do not send a duplicate report command.
""")
    (out / 'worker-b.md').write_text(common + """
Implement the second standalone text-summary utility at
bend2/examples/text-summary/lines.py with count_lines(text). Count logical lines
using Python splitlines(), including a final unterminated line. Empty input is zero.
Create bend2/examples/text-summary/test_lines.py using unittest, runnable directly
with python3, importing the sibling module. Cover empty input, LF, CRLF, blank lines
and an unterminated final line. Run the tests, review and commit your two files,
report the commit and exact test output, then end your turn.
""")
    (out / 'lead.md').write_text(common + """
You are the OMP Associate Conductor named lead, parent root. Your workspace is STATE/lead and your
registered branch is hierarchy-lead. Deliver the two text-summary utilities through
two child Players. You review and land their commits; do not implement their files.
The native adapter automatically sends your final response to root after each turn.
Do not send a duplicate report manually. Acknowledge messages addressed to lead.

First turn:
Acknowledge lead-task with `B2 DB ack lead-task lead "Task received; starting both child assignments"`.
1. Recruit child-a and child-b, both parent lead, harness omp, OMP_MODEL/OMP_EFFORT,
   repository REPO, branches hierarchy-a and hierarchy-b, workspaces STATE/child-a
   and STATE/child-b, base hierarchy-lead. Use `B2 DB recruit ID PARENT HARNESS MODEL
   EFFORT REPO BRANCH PATH BASE` with all settings expanded.
2. Detach your own workspace (`git -C STATE/lead checkout --detach`) so that
   land-checked can advance hierarchy-lead. Keep all working files and the branch.
3. Start child-a in the background with stdout/stderr redirected and a new process
   session: `B2 DB turn child-a child-a-turn OMP OMP_MODEL OMP_EFFORT STATE/child-a
   STATE/worker-a.md STATE/child-a.jsonl ""`. Python subprocess.Popen with
   start_new_session=True is suitable; do not wait for the Player to finish.
4. Observe child-a.jsonl until its first tool_execution_start frame, then send
   `B2 DB message token-rule lead child-a guidance BODY` with this exact requirement:
   "Count whitespace-separated tokens using str.split(). A hyphen stays inside a
   token: blue-green counts as one. Add an explicit blue-green regression test."
   This is mid-task guidance; verify the command returns and end your turn with a
   progress report. Child reports invoke this same native lead session.

On the child-a report: inspect its actual diff and tests, read the token-rule receipt
to confirm native steer acceptance, acknowledge the report, and land child-a onto
hierarchy-lead with land-checked and CHECK, selecting only
bend2/examples/text-summary/test_words.py. Both selected trees must be judged:
the target lacks this newly added test, so use the check adapter described below.
Then start child-b in the background through turn as child-b-turn with worker-b.md
and child-b.jsonl, and end with a progress report. No waiting for completion.

On the child-b report: inspect its actual diff and tests, acknowledge it, land it
onto hierarchy-lead selecting only test_lines.py with the same adapter. Inspect the
lead branch tree and run both Python files on that tree. Report LEAD_READY with both
Player SHAs, both landing SHAs, the exact lead branch SHA and guidance receipt.

For these two newly added standalone test files, write STATE/check-added.sh once:
`set -eu; if [ -f "$1" ]; then python3 "$1"; else exit 0; fi`.
Use this absolute path as CHECK for all landings, including the root's. The absent
test on the target is an explicit no-op; every present test must run and pass.
Successful land-checked returns a squash commit different from the Player SHA.
Landings compose from the registered branch, even while your workspace is detached.
""")
    (out / 'root.md').write_text(common + """
You are the Codex Principal Conductor, session root. Exercise one OMP Associate Conductor with two children and checked landings.
The task files are STATE/lead.md, STATE/worker-a.md and STATE/worker-b.md.
Recruit lead under root with harness omp, OMP_MODEL/OMP_EFFORT, repository REPO,
branch hierarchy-lead, path STATE/lead, base hierarchy-target. Assign its responsibility
with `B2 DB role lead associate-conductor`, then attach its endpoint:
OMP_CONDUCTOR_MODEL="$OMP_MODEL" OMP_CONDUCTOR_THINKING="$OMP_EFFORT" node
  "$SOURCE/bend2/scripts/omp-conductor.mjs" "$DB" "$B2" "$OMP" --session lead --attach
(run this as one shell command). Start the lead task in the background with redirected
output using `B2 DB message-file lead-task root lead task STATE/lead.md` in a new
process session. Acknowledge this root task and end your turn. Do not wait for the lead.

Every lead turn reports back and invokes your native session. Review and acknowledge
each progress report, then end your turn while the children work. Do not send guidance
back during a report-delivery call or launch another turn for a working session.
On LEAD_READY, independently inspect both Players, their parent bindings, the guidance
receipt, the lead branch diff and selected checks. Land lead onto hierarchy-target
using land-checked, STATE/check-added.sh, and one quoted, space-separated FILES argument containing
bend2/examples/text-summary/test_words.py bend2/examples/text-summary/test_lines.py.
Check the landed tree equals the lead branch tree and run both tests on that tree.
Write STATE/root-report.md with both levels' commits and review evidence. Send it to
operator with `B2 DB message-file hierarchy-complete root operator report STATE/root-report.md`.
Do not create hierarchy-complete until the final checked landing and tests succeed.
End your turn. No push, no changes outside the scratch directory.
""")
    call('attach', 'operator', 'terminal', '', '')
    call('role', 'operator', 'operator')
    run('node', SOURCE / 'bend2/scripts/codex-conductor.mjs', db, coord, wrappers['codex'],
        '--attach', env={**env, 'CODEX_CONDUCTOR_MODEL': routes['codex']['model']})
    with (out / 'seed.log').open('w') as log:
        seed = subprocess.Popen([str(coord), str(db), 'message-file', 'hierarchy-task',
                                 'operator', 'root', 'task', str(out / 'root.md')],
                                env=env, stdout=log, stderr=subprocess.STDOUT)
        print(f'Hierarchy started: {out}', flush=True)
        while True:
            with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
                connection.row_factory = sqlite3.Row
                completed = connection.execute(
                    "SELECT * FROM messages WHERE id='hierarchy-complete'").fetchone()
            records = [json.loads(p.read_text()) for p in out.glob('*.process.json')]
            if completed and records and all('ended' in p for p in records):
                break
            if seed.poll() not in (None, 0):
                raise RuntimeError(f'Seed exited {seed.returncode}; read {out / "seed.log"}')
            time.sleep(1)  # Observe the proof; the coordinator delivers every turn report.
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        sessions = [dict(r) for r in connection.execute('SELECT * FROM sessions')]
        messages = [dict(r) for r in connection.execute('SELECT * FROM messages ORDER BY seq')]
    assert all(r['exitCode'] == 0 for r in records), records
    by_id = {s['id']: s for s in sessions}
    assert by_id['lead']['parent'] == 'root'
    assert by_id['child-a']['parent'] == by_id['child-b']['parent'] == 'lead'
    guidance = next(m for m in messages if m['id'] == 'token-rule')
    assert json.loads(guidance['receipt'])['success'] is True
    for ident in ['child-a-turn', 'child-b-turn']:
        report = next(m for m in messages if m['id'] == ident)
        assert report['recipient'] == 'lead' and report['receipt']
    assert any(m['sender'] == 'lead' and m['recipient'] == 'root' and m['receipt']
               for m in messages)
    target = run('git', '-C', repo, 'rev-parse', 'hierarchy-target')
    lead = run('git', '-C', repo, 'rev-parse', 'hierarchy-lead')
    assert run('git', '-C', repo, 'rev-parse', target + '^{tree}') == run(
        'git', '-C', repo, 'rev-parse', lead + '^{tree}')
    evidence = {'source': base, 'sessions': sessions, 'messages': messages,
                'processes': records, 'target': target, 'lead': lead}
    (out / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(f'Hierarchy verified: {out / "evidence.json"}', flush=True)


if __name__ == '__main__':
    main()
