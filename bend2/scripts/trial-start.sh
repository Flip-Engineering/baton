#!/bin/sh
# Build and attach the root of a local Bend2 trial.
set -eu
exec python3 - "$@" <<'PY'
import os
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
    'TRIAL_OMP': omp, 'TRIAL_MUSE': muse,
}
envfile = state / 'environment.sh'
envfile.write_text(''.join(f'export {key}={q(value)}\n' for key, value in settings.items()))
first = state / 'first-task.md'
if not first.exists():
    first.write_text((source / 'bend2/trial/root-instructions.md').read_text()
        + '\n\n## This trial\n\n'
        + f'Source the shell settings from {q(str(envfile))} in each shell call.\n'
        + f'The repository is {repo}; the Bend2 tools are at {source}.\n'
        + f'The standing instructions are {source}/bend2/trial/root-instructions.md.\n'
        + 'Use gh issue list and gh issue view in the repository to select one open issue '
          'with a concrete, small change. Read the current issue comments and local source '
          'before assigning it. Continue that one lane through review, landing and publication. '
          'Report the outcome and wait for the operator to choose further work.\n')
run(coord, db, 'attach', 'operator', 'terminal', '', '')
run(node, source / 'bend2/scripts/codex-root.mjs', db, coord, wrapper, '--attach',
    env={**env, 'CODEX_ROOT_MODEL': 'gpt-6-astra'})
print(f'Attached trial root. Task file: {first}')
print('Edit that task file to narrow the first issue before seeding it.')
print('Seed the first task:')
print(shlex.join([str(coord), str(db), 'message-file', 'trial-first-task',
                  'operator', 'root', 'task', str(first)]))
print('Read landing reports:')
print(shlex.join([str(coord), str(db), 'inbox', 'operator']))
print(f'Native root responses: {db}.root.log')
print('The target branch bend2-trial must remain unchecked-out while land-checked advances it.')
PY
