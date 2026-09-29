#!/bin/sh
# Build and attach the root of a local Bend2 trial.
set -eu
exec python3 - "$@" <<'PY'
import os
import json
import pathlib
import shlex
import shutil
import subprocess
import sys

if len(sys.argv) != 4:
    sys.exit('usage: trial-start.sh REPOSITORY BEND2_CHECKOUT DATABASE')
repo, source, db = (pathlib.Path(p).expanduser().resolve() for p in sys.argv[1:])
state = pathlib.Path(str(db) + '.trial')
state.mkdir(parents=True, exist_ok=True)
db.parent.mkdir(parents=True, exist_ok=True)
q = shlex.quote

def run(*args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)

def executable(variable, default):
    value = os.environ.get(variable, default)
    found = shutil.which(value)
    if not found:
        sys.exit(f'{variable}: executable unavailable: {value}')
    return str(pathlib.Path(found).absolute())

run('git', '-C', repo, 'rev-parse', '--git-dir', stdout=subprocess.DEVNULL)
node = executable('NODE', 'node')
codex = executable('BATON_CODEX', 'codex')
omp = executable('BATON_OMP', 'omp')
muse = executable('BATON_MUSE', 'muse')
# The trial uses the operator's existing subscription login.
codex_argv = [codex, '-c', 'forced_login_method="chatgpt"']
env = {k: v for k, v in os.environ.items() if k not in ('OPENAI_API_KEY', 'CODEX_API_KEY')}
run(*codex_argv, 'login', 'status', env=env)
coord = state / 'baton2'
run('sh', source / 'bend2/scripts/build-native.sh',
    'bend2/src/coordinator/main.bend', str(coord) + '.next', env=env)
os.replace(str(coord) + '.next', coord)
wrapper = state / 'codex-subscription.sh'
wrapper.write_text('#!/bin/sh\nunset OPENAI_API_KEY CODEX_API_KEY\nexec '
                   + shlex.join(codex_argv) + ' "$@"\n')
wrapper.chmod(0o700)
exists = subprocess.run(['git', '-C', str(repo), 'show-ref', '--verify', '--quiet',
                         'refs/heads/bend2-trial']).returncode == 0
if not exists:
    run('git', '-C', repo, 'branch', 'bend2-trial', 'HEAD')
settings = {
    'B2': str(coord), 'DB': str(db), 'TRIAL_REPO': str(repo),
    'TRIAL_SOURCE': str(source), 'TRIAL_STATE': str(state),
    'TRIAL_TARGET': 'bend2-trial', 'TRIAL_CHECK': str(source / 'bend2/scripts/check-node-test.sh'),
    'TRIAL_OMP': omp, 'TRIAL_MUSE': muse, 'TRIAL_NODE': node,
    'TRIAL_ROOT_INSTRUCTIONS': str(state / 'root-instructions.md'),
    'TRIAL_LEAD_INSTRUCTIONS': str(state / 'lead-instructions.md'),
}
envfile = state / 'environment.sh'
envfile.write_text(''.join(f'export {key}={q(value)}\n' for key, value in settings.items()))
# Refresh the standing instructions while preserving operator-edited tasks.
context = ('\n\n## This trial\n\n'
    + f'Source the shell settings from {q(str(envfile))} in each shell call.\n'
    + f'The repository is {repo}; the Bend2 tools are at {source}.\n')
for name in ['root-instructions.md', 'lead-instructions.md']:
    (state / name).write_text((source / 'bend2/trial' / name).read_text() + context)
template = state / 'task-template.md'
template.write_text(
    f'Read {state / "root-instructions.md"} for the current trial workflow before acting.\n'
    + f'Source {envfile} in each shell call.\n'
    + 'Run the issue below through one OMP lead, which recruits and reviews its own workers. '
      'The root reviews and lands the lead branch, publishes bend2-trial and reports to operator.\n\n'
    + '## Assigned issue\n\n'
    + 'Replace this paragraph with the issue number, requested outcome and constraints. '
      'An unassigned template requests no issue work.\n')
first = state / 'first-task.md'
if not first.exists():
    first.write_text(template.read_text())
run(coord, db, 'attach', 'operator', 'terminal', '', '')
sessions = json.loads(subprocess.check_output([str(coord), str(db), 'status'],
                                             text=True, env=env))
root_session = next((session for session in sessions if session['id'] == 'root'), {})
native_root = root_session.get('native', '') if root_session.get('harness') == 'codex' else ''
root_log = state / 'root-native.jsonl'
root_endpoint = [str(coord), str(db), 'receive', 'root', str(wrapper),
                 'gpt-6-astra', 'low', str(repo), str(root_log)]
run(coord, db, 'attach', 'root', 'codex', native_root, json.dumps(root_endpoint))
run(*root_endpoint, '', env=env)
print(f'Attached trial root. Task file: {first}')
print(f'Current root instructions: {state / "root-instructions.md"}')
print(f'Current lead instructions: {state / "lead-instructions.md"}')
print(f'Refreshed issue template: {template}')
print('Copy the template to an issue task file and fill in the assigned issue before sending it.')
print('Existing first-task.md is preserved. Begin any older task by reading the current root instructions.')
print('For the first task, edit first-task.md to name the assigned issue, then seed it:')
print(shlex.join([str(coord), str(db), 'message-file', 'trial-first-task',
                  'operator', 'root', 'task', str(first)]))
print('For a later issue, use a fresh message ID and the filled task file:')
print(shlex.join([str(coord), str(db), 'message-file', 'issue-N-task',
                  'operator', 'root', 'task', str(state / 'issue-N-task.md')]))
print('Read landing reports:')
print(shlex.join([str(coord), str(db), 'inbox', 'operator']))
print(f'Native root responses: {db}.root.log')
print(f'Native root events: {root_log}')
print('Rebuild this kit between lanes after the native turns and their supervisors have exited.')
print('Keep bend2-trial and each lead branch unchecked-out while land-checked advances them.')
PY
