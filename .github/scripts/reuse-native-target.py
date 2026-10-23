#!/usr/bin/env python3
"""Restore an exact completed target build and retain its producer evidence."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


transfer, target, evidence = map(pathlib.Path, sys.argv[1:4])
target_commit, producer_run = sys.argv[4:6]
baseline = transfer / 'baseline-build'
manifest = json.loads((baseline / 'manifest.json').read_text())
assert manifest['schema'] == 'baton2-baseline-build-evidence-v1'
assert manifest['target_commit'] == target_commit
assert manifest['workflow_run_id'] == producer_run
assert manifest['workflow_run_attempt'] == '1'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=target, text=True).strip() == target_commit
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=target, text=True)
build = manifest['target_build']
assert build['status'] == 'completed'
record = build['record']
assert record['label'] == 'target-build' and record['exit_code'] == 0
assert record['argv'] == ['sh', 'bend2/scripts/build-native.sh']
assert record['cwd'] == manifest['source_path']
original_results = json.loads((transfer / 'results.json').read_text())
assert [row for row in original_results if row['label'] == 'target-build'] == [record]
for filename in (record['stdout'], record['stderr']):
    entry = manifest['build_streams'][filename]
    for directory in (transfer, baseline):
        path = directory / filename
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_size == entry['size_bytes'] and digest(path) == entry['sha256']
selection = json.loads((evidence.parent / 'generated/compiler-selection.json').read_text())
assert manifest['compiler_archive_sha256'] == selection['compiler_archive_sha256']
assert manifest['compiler_binary_sha256'] == digest(pathlib.Path(os.environ['BEND']))
compiler = subprocess.check_output([os.environ['CC'], '--version'], text=True)
assert compiler == manifest['native_compiler_version']
entries = ((manifest['generated_c'], 'generated.c', 'baton2.c'),
           (manifest['binary'], 'baton2', 'baton2'))
destination = target / '.scratch/bend2'
destination.mkdir(parents=True, exist_ok=True)
for entry, filename, installed_name in entries:
    assert entry['path'] == filename
    path = baseline / filename
    assert path.is_file() and not path.is_symlink()
    assert path.stat().st_size == entry['size_bytes'] and digest(path) == entry['sha256']
    shutil.copyfile(path, destination / installed_name)
mode = int(manifest['binary']['mode'], 8)
assert 0 <= mode <= 0o777 and mode & 0o100
(destination / 'baton2').chmod(mode)
shutil.copytree(baseline, evidence / 'baseline-build')
for filename in ('results.json', record['stdout'], record['stderr']):
    shutil.copyfile(transfer / filename, evidence / 'baseline-build' / ('original-' + filename))
result = {'schema': 'baton2-target-build-reuse-v1', 'target_commit': target_commit,
          'workflow_run_id': producer_run, 'workflow_run_attempt': '1',
          'producer_manifest_sha256': digest(baseline / 'manifest.json'),
          'generated_c_sha256': manifest['generated_c']['sha256'],
          'binary_sha256': manifest['binary']['sha256'], 'producer_build': record,
          'status': 'restored'}
(evidence / 'target-build-reuse.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
