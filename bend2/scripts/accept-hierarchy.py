#!/usr/bin/env python3
"""Exercise a native Codex Principal Conductor, an OMP Associate Conductor, and two OMP Players in a clone."""
import argparse
import hashlib
import importlib.util
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
    helper_path = repo / 'bend2/scripts/accept-native-receive.py'
    spec = importlib.util.spec_from_file_location('hierarchy_native_acceptance', helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    coord, coordinator_provenance = helper.prepare_coordinator(SOURCE, repo, out, coord)

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
    worker_a_task = common + """
Implement a useful standalone text-summary word counter at
bend2/examples/text-summary/words.py, with a count_words(text) function.
Create bend2/examples/text-summary/test_words.py using unittest, runnable directly
with python3, importing the sibling module. Cover empty input, ordinary text,
multiple spaces and Unicode. Review the implementation and run those tests.
Your lead will send an additional tokenization requirement while you work; include
it and its test. Keep working through the coordinator's incoming native guidance.
Commit your two files and state the commit and exact test output in your final response.
The supervisor delivers that response; do not send a duplicate report command.
"""
    worker_b_task = common + """
Implement the second standalone text-summary utility at
bend2/examples/text-summary/lines.py with count_lines(text). Count logical lines
using Python splitlines(), including a final unterminated line. Empty input is zero.
Create bend2/examples/text-summary/test_lines.py using unittest, runnable directly
with python3, importing the sibling module. Cover empty input, LF, CRLF, blank lines
and an unterminated final line. Run the tests, review and commit your two files,
report the commit and exact test output, then end your turn.
"""
    lead_task = common + """
You are the OMP Associate Conductor named lead, parent root. Your workspace is STATE/lead and your
registered branch is hierarchy-lead. Deliver the two text-summary utilities through
two child Players. You review and land their commits; do not implement their files.
The native adapter automatically sends your final response to root after each turn.
Do not send a duplicate report manually. Read each message addressed to lead completely.

First turn:
Read the complete pending input; Baton records the read internally.
1. Recruit child-a and child-b, both parent lead, harness omp, OMP_MODEL/OMP_EFFORT,
   repository REPO, branches hierarchy-a and hierarchy-b, workspaces STATE/child-a
   and STATE/child-b, base hierarchy-lead. Use `B2 DB recruit ID PARENT HARNESS MODEL
   EFFORT REPO BRANCH PATH BASE` with all settings expanded.
2. Detach your own workspace (`git -C STATE/lead checkout --detach`) so that
   land-checked can advance hierarchy-lead. Keep all working files and the branch.
3. Start child-a in the background with stdout/stderr redirected and a new process
   session. Pass its complete assignment below as stdin to `B2 DB as lead turn
   --session child-a --command OMP --model OMP_MODEL --effort OMP_EFFORT
   --cwd STATE/child-a --file - --output-log STATE/child-a.jsonl`.
   Expand each setting. Python subprocess.Popen with stdin=PIPE and
   start_new_session=True is suitable; write and close its stdin, then keep the
   process owned while the child works. Baton creates the direct turn identity.
4. Resolve the actual log through log_generations for session child-a and
   base STATE/child-a.jsonl. Observe that registered log until its first
   tool_execution_start frame, then send `B2 DB as lead guide --to child-a
   --text BODY` with this exact requirement:
   "Count whitespace-separated tokens using str.split(). A hyphen stays inside a
   token: blue-green counts as one. Add an explicit blue-green regression test."
   This is mid-task guidance; verify the command returns and end your turn with a
   progress report. Child reports invoke this same native lead session.

On the child-a report: inspect its actual diff and tests. Verify the guidance's
native response in child-a's registered log: the matching response has command
steer and success true. Read the report completely. Then land child-a onto
hierarchy-lead with land-checked and CHECK, selecting only
bend2/examples/text-summary/test_words.py. Both selected trees must be judged:
the target lacks this newly added test, so use the check adapter described below.
Then start child-b through the same direct turn command with --session child-b,
its complete assignment below on stdin, --cwd STATE/child-b and
--output-log STATE/child-b.jsonl. End with a progress report while it works.

On the child-b report: inspect its actual diff and tests, then land it
onto hierarchy-lead selecting only test_lines.py with the same adapter. Inspect the
lead branch tree and run both Python files on that tree. Report LEAD_READY with both
Player SHAs, both landing SHAs and the exact lead branch SHA.

For these two newly added standalone test files, write STATE/check-added.sh once:
`set -eu; if [ -f "$1" ]; then python3 "$1"; else exit 0; fi`.
Use this absolute path as CHECK for all landings, including the root's. The absent
test on the target is an explicit no-op; every present test must run and pass.
Successful land-checked returns a squash commit different from the Player SHA.
Landings compose from the registered branch, even while your workspace is detached.
""" + '\nThe complete child assignments are this JSON object. Decode each value and\n' \
        'pass its complete text through stdin; preserve these assignments in the database.\n' \
        + json.dumps({'child-a': worker_a_task, 'child-b': worker_b_task}, ensure_ascii=False) + '\n'
    root_task = common + """
You are the Codex Principal Conductor, session root. Exercise one OMP Associate Conductor with two children and checked landings.
The complete lead assignment is supplied below as a JSON string.
Recruit lead under root with harness omp, OMP_MODEL/OMP_EFFORT, repository REPO,
branch hierarchy-lead, path STATE/lead, base hierarchy-target. Assign its responsibility
with `B2 DB role lead associate-conductor`, then attach its endpoint:
OMP_CONDUCTOR_MODEL="$OMP_MODEL" OMP_CONDUCTOR_THINKING="$OMP_EFFORT" node
  "$SOURCE/bend2/scripts/omp-conductor.mjs" "$DB" "$B2" "$OMP" --session lead --attach
(run this as one shell command). Dispatch the decoded complete lead assignment
through stdin to `B2 DB dispatch --to lead --stdin --command OMP`
in the background with redirected output and a new process session. This uses
the lead's recorded route. Read this root task completely and end your turn
while the lead works.

Every lead turn reports back and invokes your native session. Read and review
each progress report, then end your turn while the children work. Do not send guidance
back during a report-delivery call or launch another turn for a working session.
On LEAD_READY, independently inspect both Players, their parent bindings, the lead
branch diff and selected checks. Land lead onto hierarchy-target
using land-checked, STATE/check-added.sh, and one quoted, space-separated FILES argument containing
bend2/examples/text-summary/test_words.py bend2/examples/text-summary/test_lines.py.
Check the landed tree equals the lead branch tree and run both tests on that tree.
Send `B2 DB as root report --text BODY` with HIERARCHY_COMPLETE, both levels'
commits and review evidence after the final checked landing and tests succeed.
End your turn. No push, no changes outside the scratch directory.
""" + '\nComplete lead assignment as a JSON string:\n' + json.dumps(lead_task, ensure_ascii=False) + '\n'
    call('attach', 'operator', 'terminal', '', '')
    call('role', 'operator', 'operator')
    run('node', SOURCE / 'bend2/scripts/codex-conductor.mjs', db, coord, wrappers['codex'],
        '--attach', env={**env, 'CODEX_CONDUCTOR_MODEL': routes['codex']['model']})
    with (out / 'seed.log').open('w') as log:
        seed = subprocess.Popen([str(coord), str(db), 'agent-native-input'], stdin=subprocess.PIPE,
                                env=env, stdout=log, stderr=subprocess.STDOUT)
        seed.stdin.write(json.dumps(['message', 'hierarchy-task', 'operator', 'root',
                                    'task', root_task], ensure_ascii=False).encode('utf-8'))
        seed.stdin.close()
        print(f'Hierarchy started: {out}', flush=True)
        while True:
            with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
                connection.row_factory = sqlite3.Row
                completed = connection.execute(
                    "SELECT * FROM messages WHERE sender='root' AND recipient='operator' "
                    "AND kind='report' AND instr(body,'HIERARCHY_COMPLETE')>0").fetchone()
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
        turns = [dict(r) for r in connection.execute('SELECT * FROM turns')]
        child_logs = [dict(r) for r in connection.execute(
            'SELECT * FROM log_generations WHERE session=? AND base=?',
            ('child-a', str(out / 'child-a.jsonl')))]
    assert all(r['exitCode'] == 0 for r in records), records
    by_id = {s['id']: s for s in sessions}
    assert by_id['lead']['parent'] == 'root'
    assert by_id['child-a']['parent'] == by_id['child-b']['parent'] == 'lead'
    guidance_body = ('Count whitespace-separated tokens using str.split(). A hyphen stays inside a '
                     'token: blue-green counts as one. Add an explicit blue-green regression test.')
    guidance = next(m for m in messages if m['sender'] == 'lead' and m['recipient'] == 'child-a'
                    and m['kind'] == 'guidance' and m['body'] == guidance_body)
    assert guidance['receipt'], guidance
    child_turns = {turn['id'] for turn in turns if turn['worker'] == 'child-a'}
    native_steer = []
    generation_facts = []
    for generation in child_logs:
        assert generation['attempt'] in child_turns, generation
        path = Path(generation['log'])
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for line in stream:
                digest.update(line)
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if (event.get('id') == guidance['id'] and event.get('type') == 'response'
                        and event.get('command') == 'steer' and event.get('success') is True):
                    native_steer.append({'generation': generation, 'response': event})
        generation_facts.append({**generation, 'size_bytes': path.stat().st_size,
                                 'sha256': digest.hexdigest()})
    assert native_steer, {'guidance': guidance, 'generations': generation_facts}
    for child in ['child-a', 'child-b']:
        report = next(m for m in messages if m['sender'] == child and m['kind'] == 'report'
                      and any(turn['id'] == m['id'] and turn['worker'] == child for turn in turns))
        assert report['recipient'] == 'lead' and report['receipt']
    assert any(m['sender'] == 'lead' and m['recipient'] == 'root' and m['receipt']
               for m in messages)
    target = run('git', '-C', repo, 'rev-parse', 'hierarchy-target')
    lead = run('git', '-C', repo, 'rev-parse', 'hierarchy-lead')
    assert run('git', '-C', repo, 'rev-parse', target + '^{tree}') == run(
        'git', '-C', repo, 'rev-parse', lead + '^{tree}')
    evidence = {'source': base, 'coordinator': coordinator_provenance,
                'sessions': sessions, 'messages': messages, 'turns': turns,
                'processes': records, 'target': target, 'lead': lead,
                'native_steer': native_steer, 'guidance_generations': generation_facts}
    (out / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(f'Hierarchy verified: {out / "evidence.json"}', flush=True)


if __name__ == '__main__':
    main()
