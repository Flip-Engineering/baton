import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time

root = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/stop-lifecycle-b5727640')
run = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/qualifications/stop-lifecycle-b5727640-20261029-r2')
assert not run.exists(), run
run.mkdir(parents=True)
evidence = run / 'evidence'
evidence.mkdir()
(run / 'generated').mkdir()
(run / 'tmp').mkdir()

def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
source = git('rev-parse', 'HEAD')
assert source == 'b5727640f1effc086f51d73d1f78cea8e4980a4f', source
compiler_run = run / 'compiler'
compiler_run.mkdir()
(compiler_run / 'toolchain-home').mkdir()
(compiler_run / 'evidence').mkdir()
prepare = [sys.executable, str(root / '.github/scripts/prepare-native-compiler.py'),
           '--run', str(compiler_run), '--archive',
           '/var/tmp/baton2-compile-queue/toolchains/compiler-facts-only-20261029/bend-2.0.25-linux-x64-compiler-facts-only-20261029.tar.gz',
           '--archive-sha256', '95a6ad2b7798aa4400cc1a78ba61970aab4f749d617323a15a6eabe373be541c',
           '--runner', 'homelab']
with (evidence / 'compiler-prepare.stdout').open('wb') as out, (evidence / 'compiler-prepare.stderr').open('wb') as err:
    result = subprocess.run(prepare, cwd=root, stdout=out, stderr=err)
if result.returncode:
    raise SystemExit(result.returncode)
compiler = compiler_run / 'toolchain-home/bin/bend'
(run / 'generated/compiler-selection.json').write_bytes((compiler_run / 'generated/compiler-selection.json').read_bytes())
os.environ.update({'BEND': str(compiler), 'CC': '/usr/bin/clang-19',
                   'BEND_NO_TELEMETRY': '1', 'BUN_JSC_maxPerThreadStackUsage': '67108864',
                   'TMPDIR': str(run / 'tmp'), 'BATON2_QUEUE_RUN_ROOT': str(run / 'compile-queue')})
queue = runpy.run_path(str(root / '.github/scripts/queue-native-checks.py'))
(run / 'compile-queue').mkdir()
base_env = queue['environment'](run / 'compile-queue')
output = root / '.scratch/bend2/baton2'
output.parent.mkdir(parents=True, exist_ok=True)
command = ['sh', 'bend2/scripts/build-native.sh', 'bend2/src/coordinator/main.bend', str(output)]
started = time.time()
with (evidence / 'build.stdout').open('wb') as out, (evidence / 'build.stderr').open('wb') as err:
    result = subprocess.run(command, cwd=root, env=base_env, stdout=out, stderr=err)
record = {'source_commit': source, 'source_tree': git('rev-parse', 'HEAD^{tree}'),
          'argv': command, 'cwd': str(root), 'exit_code': result.returncode,
          'elapsed_seconds': time.time() - started,
          'binary_sha256': digest(output) if output.exists() else None,
          'compiler_selection': json.loads((compiler_run / 'generated/compiler-selection.json').read_text())}
(evidence / 'build-result.json').write_text(json.dumps(record, indent=2) + '\n')
if result.returncode:
    raise SystemExit(result.returncode)
selected = [
    'Stop.test_missing_attempt_stop_records_custody_missing_without_native_exit',
    'Stop.test_live_native_with_missing_control_endpoint_uses_owner_identity',
]
for number, name in enumerate(selected, 1):
    started = time.time()
    command = [sys.executable, 'bend2/test/stop.py', name]
    with (evidence / f'focused-{number}.stdout').open('wb') as out, (evidence / f'focused-{number}.stderr').open('wb') as err:
        result = subprocess.run(command, cwd=root, env=dict(base_env, BATON2_EXE=str(output)), stdout=out, stderr=err)
    row = {'test': name, 'argv': command, 'cwd': str(root), 'exit_code': result.returncode,
           'elapsed_seconds': time.time() - started,
           'stdout_sha256': digest(evidence / f'focused-{number}.stdout'),
           'stderr_sha256': digest(evidence / f'focused-{number}.stderr')}
    (evidence / f'focused-{number}.json').write_text(json.dumps(row, indent=2) + '\n')
    if result.returncode:
        raise SystemExit(result.returncode)
final = {'source_commit': source, 'source_tree': git('rev-parse', 'HEAD^{tree}'),
         'binary_sha256': digest(output), 'result': 'pass', 'tests': selected,
         'queue_run_root': str(run / 'compile-queue'), 'evidence': str(evidence)}
(evidence / 'result.json').write_text(json.dumps(final, indent=2) + '\n')
