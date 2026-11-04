#!/bin/sh
# Build and attach the Principal Conductor of a local Bend2 trial.
set -eu
exec python3 - "$@" <<'PY'
import os
import json
import pathlib
import shlex
import shutil
import subprocess
import sys

if len(sys.argv) != 5:
    sys.exit('usage: trial-start.sh REPOSITORY BEND2_CHECKOUT DATABASE CHECK_PROGRAM')
repo, source, db, check = (pathlib.Path(p).expanduser().resolve() for p in sys.argv[1:])
if not check.is_file():
    sys.exit(f'CHECK_PROGRAM: file unavailable: {check}')
state = pathlib.Path(str(db) + '.trial')
state.mkdir(parents=True, exist_ok=True)
db.parent.mkdir(parents=True, exist_ok=True)
q = shlex.quote

def run(*args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)

def executable(variable, default, required=True):
    value = os.environ.get(variable, default)
    found = shutil.which(value)
    if not found:
        if required:
            sys.exit(f'{variable}: executable unavailable: {value}')
        return value
    return str(pathlib.Path(found).absolute())

run('git', '-C', repo, 'rev-parse', '--git-dir', stdout=subprocess.DEVNULL)
node = executable('NODE', 'node')
codex = executable('BATON_CODEX', 'codex')
omp = executable('BATON_OMP', 'omp')
muse = executable('BATON_MUSE', 'muse', required=False)
bend = executable('BEND', os.environ['BEND']) if os.environ.get('BEND') else None
if bend:
    bend = str(pathlib.Path(bend).resolve())
# The trial uses the operator's existing subscription login.
codex_argv = [codex, '-c', 'forced_login_method="chatgpt"']
env = {k: v for k, v in os.environ.items() if k not in ('OPENAI_API_KEY', 'CODEX_API_KEY')}
if bend:
    env['BEND'] = bend
run(*codex_argv, 'login', 'status', env=env)
coord = state / 'baton2'
runtime = state / 'bin/baton2'
runtime.parent.mkdir(parents=True, exist_ok=True)
run('sh', source / 'bend2/scripts/build-native.sh',
    'bend2/src/coordinator/main.bend', str(runtime) + '.next', env=env)
os.replace(str(runtime) + '.next', runtime)
helpers = state / 'libexec/baton2'
helpers.mkdir(parents=True, exist_ok=True)
for name in ('task-start.mjs', 'project-settings.mjs', 'git-series.mjs', 'native-history.mjs'):
    shutil.copy2(source / 'bend2/harness' / name, helpers / name)
shutil.copytree(source / 'bend2/harness/git-series-bin', helpers / 'git-series-bin', dirs_exist_ok=True)
link = state / 'baton2.next'
link.symlink_to(pathlib.Path('bin/baton2'))
os.replace(link, coord)
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
    'TRIAL_TARGET': 'bend2-trial', 'TRIAL_CHECK': str(check),
    'TRIAL_OMP': omp, 'TRIAL_MUSE': muse, 'TRIAL_NODE': node,
    'TRIAL_PRINCIPAL_INSTRUCTIONS': str(state / 'principal-conductor-instructions.md'),
    'TRIAL_ASSOCIATE_INSTRUCTIONS': str(state / 'associate-conductor-instructions.md'),
    'TRIAL_ROOT_INSTRUCTIONS': str(state / 'principal-conductor-instructions.md'),
    'TRIAL_LEAD_INSTRUCTIONS': str(state / 'associate-conductor-instructions.md'),
}
if bend:
    settings['BEND'] = bend
envfile = state / 'environment.sh'
envfile.write_text(''.join(f'export {key}={q(value)}\n' for key, value in settings.items()))
# Refresh standing instructions and preserve caller-authored files.
context = ('\n\n## This trial\n\n'
    + f'Source the shell settings from {q(str(envfile))} in each shell call.\n'
    + f'The repository is {repo}; the Bend2 tools are at {source}.\n'
    + f'The check program is {check}. Each issue must name its selected test files.\n')
for name, legacy in [('principal-conductor-instructions.md', 'root-instructions.md'),
                     ('associate-conductor-instructions.md', 'lead-instructions.md')]:
    selected = source / 'bend2/trial' / name
    if not selected.is_file():
        selected = source / 'bend2/trial' / legacy
    (state / name).write_text(selected.read_text() + context)
    (state / legacy).write_text(f'Read {state / name} for the current trial instructions.\n')
run(coord, db, 'attach', 'operator', 'terminal', '', '')
run(coord, db, 'role', 'operator', 'operator')
sessions = json.loads(subprocess.check_output([str(coord), str(db), 'status'],
                                             text=True, env=env))
root_session = next((session for session in sessions if session['id'] == 'root'), {})
native_root = root_session.get('native', '') if root_session.get('harness') == 'codex' else ''
root_log = state / 'root-native.jsonl'
root_endpoint = [str(coord), str(db), 'receive', 'root', str(wrapper),
                 'gpt-6-astra', 'low', str(repo), str(root_log)]
run(coord, db, 'attach', 'root', 'codex', native_root, json.dumps(root_endpoint))
run(coord, db, 'role', 'root', 'principal-conductor')
run(*root_endpoint, '', env=env)
print('Attached trial Principal Conductor.')
print(f'Current Principal Conductor instructions: {state / "principal-conductor-instructions.md"}')
print(f'Current Associate Conductor instructions: {state / "associate-conductor-instructions.md"}')
print('Dispatch complete task text with the issue, requested outcome, constraints and selected test paths:')
print(shlex.join([str(coord), str(db), 'dispatch',
    'Read the current Principal Conductor instructions. Handle ISSUE with OUTCOME, CONSTRAINTS and SELECTED_TEST_PATHS.',
    '--project', str(repo), '--to', 'root']))
print('Baton selects the current assignment and preserves the recorded conversation automatically.')
print('Dispatch requests and setup outcomes are retained in the database. Read current input with task-input-read --current in the selected actor context.')
print('Create a scratchpad deliberately for working notes. Existing caller-authored files remain preserved.')
print('Read landing reports:')
print(shlex.join([str(coord), str(db), 'inbox', 'operator']))
print(f'Native Principal Conductor responses: {db}.root.log')
print(f'Native Principal Conductor events: {root_log}')
print('Rebuild this kit between lanes after the native turns and their supervisors have exited.')
print('Keep bend2-trial and each Associate Conductor branch unchecked-out while land-checked advances them.')
PY
