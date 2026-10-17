"""Exercise retained build evidence validation with explicit synthetic process records."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import types


parser = argparse.ArgumentParser()
parser.add_argument('--helper', type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('reuse_main', args.helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(tempfile.mkdtemp(prefix='reuse-combined-fixture.'))
source = root / 'source'
source.mkdir()
(source / 'bend2/src/coordinator').mkdir(parents=True)
(source / 'bend2/src/host').mkdir(parents=True)
(source / 'tools/cgen-clang-parallel').mkdir(parents=True)
(source / module.ENTRY).write_text('import Base\n\ndef main() -> IO(Unit):\n  IO.pure(Unit,Unit{})\n')
(source / 'bend2/src/host/native-entry.c').write_text('int main(void) { return 0; }\n')
(source / 'tools/cgen-clang-parallel/build_native.py').write_text('# synthetic sharder driver\n')
(source / 'tools/cgen-clang-parallel/shard_emitted_c.py').write_text('# synthetic splitter\n')
(source / 'README.md').write_text('Synthetic reuse evidence fixture.\n')
for argv in (['git', 'init', '-q'], ['git', 'add', '-A'],
             ['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
              'commit', '-q', '-m', 'Record synthetic evidence']):
    subprocess.run(argv, cwd=source, check=True)
commit = module.git(source, 'rev-parse', 'HEAD').decode().strip()
tree = module.git(source, 'rev-parse', 'HEAD^{tree}').decode().strip()
toolchain = root / 'toolchain'
(toolchain / 'bin').mkdir(parents=True)
(toolchain / 'bend2').mkdir()
for relative in ('bin/bend', 'bin/bun', 'bend2/base.bend'):
    path = toolchain / relative
    path.write_text('Synthetic file: ' + relative + '\n')
    path.chmod(0o755 if relative.startswith('bin/') else 0o644)
archive = root / 'compiler.tar.gz'
with tarfile.open(archive, 'w:gz') as packed:
    packed.add(toolchain, arcname='bend')
module.COMPILER_ARCHIVES[module.digest(archive)] = {'name': 'Explicit synthetic test distribution'}
logical = Path('/original-combined-fixture')


def fact(path):
    actual = module.fact(path)
    return {'path': str(logical / path.relative_to(root)), 'bytes': actual['size_bytes'], 'sha256': actual['sha256']}


def save(path, value):
    module.save(path, value)


rows = module.source_files(source, commit, tree)
manifest = root / 'source-files.json'
save(manifest, [{'path': row['path'], 'kind': 'file', 'bytes': row['size_bytes'],
                 'sha256': row['sha256'], 'mode': row['mode'], 'git_blob': row['git_blob']} for row in rows])
inputs = root / 'input.json'
save(inputs, {'tree': tree})
checked = root / 'checked.json'
save(checked, {'source_tree': tree, 'success': True, 'records': [
    {'returncode': 0, 'natural_exit': True, 'original_wait_completed': True}]})
check = root / 'check.json'
save(check, {'source_tree': tree, 'natural_check_success_verified': True, 'result': fact(checked)})
records = []
fixture_pid = os.getpid()
fixture_birth = '123456'
fixture_stat = f"{fixture_pid} (synthetic fixture) " + ' '.join(['S'] + ['0'] * 18 + [fixture_birth])
phase_argv = {
    'c-generation': [str(logical / 'toolchain/bin/bend'), module.ENTRY, '-o', '.scratch/bend2/baton2.c'],
    'main-object': ['/usr/bin/clang-19', '-O1', '-pthread', '-Dmain=baton2_runtime_main',
                    '-c', '.scratch/bend2/baton2.c', '-o', '.scratch/bend2/baton2.o'],
    'native-link': ['/usr/bin/clang-19', '-O1', '-pthread', 'bend2/src/host/native-entry.c',
                    '.scratch/bend2/baton2.o', '-lsqlite3', '-lm', '-o', '.scratch/bend2/baton2']}
for phase, argv in phase_argv.items():
    directory = root / phase
    directory.mkdir()
    (directory / 'stdout').write_text('')
    (directory / 'stderr').write_text('')
    row = {'argv': argv, 'cwd': str(logical / 'source'), 'source_tree': tree,
           'returncode': 0, 'wait_status': 0, 'natural_exit': True, 'original_wait': True,
           'original_wait_completed': True, 'pid': os.getpid(),
           'stat_after_spawn': fixture_stat,
           'birth': fixture_birth,
           'environment': {'BEND_NO_TELEMETRY': '1', 'BUN_JSC_maxPerThreadStackUsage': '67108864'},
           'stdout': fact(directory / 'stdout'), 'stderr': fact(directory / 'stderr')}
    save(directory / 'result.json', row)
    records.append(row)
boundary = root / 'boundary'
boundary.mkdir()
(source / '.scratch/bend2').mkdir(parents=True)
artifacts = []
for name in ('baton2.c', 'baton2.o', 'baton2'):
    original = source / '.scratch/bend2' / name
    original.write_text('Synthetic completed artifact: ' + name + '\n')
    copied = boundary / name
    shutil.copyfile(original, copied)
    artifacts.append({'original': fact(original), 'copy': fact(copied), 'stable_during_copy': True})
handoff = {'schema': 'baton2-combined-main-handoff-v1', 'main_build_completed': True,
           'qualification': False, 'source': str(logical / 'source'), 'source_tree': tree,
           'source_manifest': fact(manifest), 'input_manifest': fact(inputs),
           'source_check_proof': fact(check), 'compiler': fact(toolchain / 'bin/bend'),
           'records': records, 'build_artifacts': artifacts}
original_handoff = root / 'handoff.json'
save(original_handoff, handoff)
reference = root / 'reference.json'
save(reference, {'schema': 'baton2-combined-main-ci-reference-v1',
                 'original_handoff': module.fact(original_handoff),
                 'path_maps': [{'original': str(logical), 'copy': str(root.resolve())}]})
selected, binding = module.handoff_binding(reference, module.digest(reference))
assert selected == handoff
os.environ['BUN_JSC_maxPerThreadStackUsage'] = '67108864'
os.environ['BEND_NO_TELEMETRY'] = '1'
run = root / 'valid-run'
prepared = {}
module.prepare(types.SimpleNamespace(source=source, run=run, handoff=str(reference),
    handoff_sha256=module.digest(reference), compiler=toolchain / 'bin/bend',
    compiler_archive=archive, github_env=root / 'github-env'), prepared)
assert prepared['status'] == 'reused'
shutil.copyfile(run / 'generated/main-c-origin/baton2.c', run / 'generated/baton2.c')
assert module.verify_transfer(types.SimpleNamespace(source=source, generated=run / 'generated'))['status'] == 'reused'
selection = {}
proof = run / 'generated/main-c-reuse.json'
module.select(types.SimpleNamespace(source=source, compiler=toolchain / 'bin/bend', proof=proof,
    proof_sha256=module.digest(proof), bound_root=str(source.resolve()), generated_c=run / 'generated/baton2.c'), selection)
assert selection['status'] == 'reused'
outcomes = [{'case': 'prepare-transfer-select-with-mapped-original', 'success': True}]

# A declared no-PCH sharded route retains the same three Main artifacts and
# binds their object/link work through one hash-verified build receipt.
sharded_handoff = copy.deepcopy(handoff)
sharded_handoff['records'] = [handoff['records'][0]]
route_build_dir = root / 'combined-sharded-build'
route_build_dir.mkdir()
fake_clang = route_build_dir / 'clang-19'
fake_clang.write_text('#!/bin/sh\nprintf "%s\\n" "Debian clang version 19.1.7"\n')
fake_clang.chmod(0o700)
route_source = source / '.scratch/bend2/baton2.c'
route_entry = source / 'bend2/src/host/native-entry.c'
route_output = source / '.scratch/bend2/baton2'
route_object = source / '.scratch/bend2/baton2.o'
compile_names = ['baton_core.c', 'baton_spins.c'] + [f'shard_{index:02d}.c' for index in range(4)]
split_manifest = {'schema': 'baton2-clang-c-shards-v1', 'counts': {'segments': 12}}
compile_rows = [{'source_name': name, 'object_name': Path(name).with_suffix('.o').name,
                 'source_sha256': module.digest(route_source),
                 'object_sha256': hashlib.sha256(name.encode()).hexdigest()} for name in compile_names]
receipt = {'schema': 'baton2-clang-sharded-main-build-v1',
    'route': 'linux-x86_64-clang-19-no-pch', 'compiler': str(fake_clang),
    'compiler_version': 'Debian clang version 19.1.7',
    'source': str(logical / route_source.relative_to(root)),
    'source_sha256': module.digest(route_source),
    'entry': str(logical / route_entry.relative_to(root)),
    'entry_sha256': module.digest(route_entry),
    'splitter': str(logical / Path('source/tools/cgen-clang-parallel/shard_emitted_c.py')),
    'splitter_sha256': module.digest(source / 'tools/cgen-clang-parallel/shard_emitted_c.py'),
    'driver': str(logical / Path('source/tools/cgen-clang-parallel/build_native.py')),
    'driver_sha256': module.digest(source / 'tools/cgen-clang-parallel/build_native.py'),
    'ccache': '', 'ccache_sha256': '',
    'split_manifest_sha256': hashlib.sha256(json.dumps(split_manifest, sort_keys=True,
                                         separators=(',', ':')).encode()).hexdigest(),
    'split_manifest': split_manifest, 'shards': 4, 'segments': 12,
    'compile_flags': ['-O1', '-pthread', '-Dmain=baton2_runtime_main'],
    'compile_objects': compile_rows,
    'aggregate_command': [str(fake_clang), '-r', *[row['object_name'] for row in compile_rows],
                          '-o', 'baton2.o'],
    'link_command': [str(fake_clang), '-O1', '-pthread',
                     str(logical / route_entry.relative_to(root)), 'baton2.o',
                     '-lsqlite3', '-lm', '-o', 'baton2'],
    'object': str(logical / route_object.relative_to(root)),
    'object_sha256': module.digest(route_object),
    'output': str(logical / route_output.relative_to(root)),
    'output_sha256': module.digest(route_output)}
route_receipt_path = source / '.scratch/bend2/baton2.build.json'
save(route_receipt_path, receipt)
sharded_handoff['native_build'] = {'route': receipt['route'], 'receipt': fact(route_receipt_path)}
sharded_result = root / 'sharded-route-validation'
sharded_result.mkdir()
validated, native_record = module.combined_evidence(sharded_handoff, binding, sharded_result, archive)
assert json.loads((sharded_result / 'sharded-main-build-validation.json').read_text())['status'] == 'verified'
assert native_record['original_native']['original_record']['argv'] == handoff['records'][0]['argv']
outcomes.append({'case': 'combined-sharded-route-receipt', 'success': True})
sharded_handoff_path = root / 'sharded-handoff.json'
save(sharded_handoff_path, sharded_handoff)
sharded_reference = root / 'sharded-reference.json'
save(sharded_reference, {'schema': 'baton2-combined-main-ci-reference-v1',
    'original_handoff': module.fact(sharded_handoff_path),
    'path_maps': [{'original': str(logical), 'copy': str(root.resolve())}]})
sharded_prepared = {}
module.prepare(types.SimpleNamespace(source=source, run=root / 'sharded-reuse-run',
    handoff=str(sharded_reference), handoff_sha256=module.digest(sharded_reference),
    compiler=toolchain / 'bin/bend', compiler_archive=archive,
    github_env=root / 'sharded-reuse-env'), sharded_prepared)
assert sharded_prepared['status'] == 'reused'
outcomes.append({'case': 'prepare-sharded-route-reuse', 'success': True})

legacy_sharded = copy.deepcopy(sharded_handoff)
legacy_sharded.pop('native_build')
legacy_result = root / 'sharded-legacy-refusal'
legacy_result.mkdir()
try:
    module.combined_evidence(legacy_sharded, binding, legacy_result, archive)
except ValueError as error:
    assert 'phase record is missing' in str(error)
    outcomes.append({'case': 'sharded-route-requires-declaration', 'success': True,
                     'refusal': str(error)})
else:
    raise AssertionError('Sharded build without a receipt declaration was accepted.')


def rejected(label, changed, expected, selected_binding=binding):
    destination = root / ('refusal-' + label)
    destination.mkdir()
    try:
        module.combined_evidence(changed, selected_binding, destination, archive)
    except ValueError as error:
        assert expected in str(error), (label, expected, str(error))
        outcomes.append({'case': label, 'success': True, 'refusal': str(error)})
    else:
        raise AssertionError('Invalid evidence was accepted: ' + label)


bad = copy.deepcopy(handoff)
bad['records'][0]['wait_status'] = 9
rejected('signalled-c-generation', bad, 'did not finish naturally')
bad = copy.deepcopy(handoff)
bad['records'][0]['birth'] = '0'
rejected('wrong-process-birth', bad, 'birth record differs')
bad = copy.deepcopy(handoff)
bad['records'][1]['original_wait_completed'] = False
rejected('incomplete-object-wait', bad, 'did not finish naturally')
bad = copy.deepcopy(handoff)
bad['build_artifacts'][0]['stable_during_copy'] = False
rejected('unstable-artifact', bad, 'copy was unstable')
bad = copy.deepcopy(handoff)
bad['build_artifacts'][0]['copy']['sha256'] = '0' * 64
rejected('changed-artifact', bad, 'retained bytes differ')
bad = copy.deepcopy(handoff)
bad['source_manifest']['sha256'] = '0' * 64
rejected('changed-source-manifest', bad, 'retained bytes differ')
bad = copy.deepcopy(handoff)
bad['records'][2]['argv'][-1] = 'other-output'
save(root / 'native-link/result.json', bad['records'][2])
rejected('different-link-output', bad, 'link invocation differs')
save(root / 'native-link/result.json', handoff['records'][2])
bad_binding = copy.deepcopy(binding)
bad_binding['path_maps'][0]['original'] = str(logical / 'unmapped')
rejected('unmapped-source', handoff, 'lacks a CI mapping', bad_binding)
bad = copy.deepcopy(handoff)
bad['source'] = str(logical / '../outside')
rejected('escaping-source-path', bad, 'is not absolute')
try:
    module.handoff_binding(reference, '0' * 64)
except ValueError as error:
    assert 'reference digest differs' in str(error)
    outcomes.append({'case': 'wrong-reference-digest', 'success': True})
else:
    raise AssertionError('Changed CI reference digest was accepted.')


def physical(value):
    if isinstance(value, dict):
        return {key: physical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [physical(item) for item in value]
    if isinstance(value, str) and value.startswith(str(logical) + '/'):
        return str(root / Path(value).relative_to(logical))
    return value


direct = physical(handoff)
for row in direct['records']:
    save(Path(row['stdout']['path']).parent / 'result.json', row)
direct_check = physical(json.loads(check.read_text()))
save(check, direct_check)
direct['source_check_proof'] = {'path': str(check), 'bytes': check.stat().st_size, 'sha256': module.digest(check)}
direct_path = root / 'direct-handoff.json'
save(direct_path, direct)
direct_result = {}
module.prepare(types.SimpleNamespace(source=source, run=root / 'direct-run', handoff=str(direct_path),
    handoff_sha256=module.digest(direct_path), compiler=toolchain / 'bin/bend',
    compiler_archive=archive, github_env=root / 'direct-env'), direct_result)
assert direct_result['status'] == 'reused'
outcomes.append({'case': 'direct-combined-handoff', 'success': True})
original_bun = (toolchain / 'bin/bun').read_bytes()
(toolchain / 'bin/bun').write_bytes(b'Changed auxiliary compiler distribution file.\n')
try:
    module.prepare(types.SimpleNamespace(source=source, run=root / 'closure-refusal-run', handoff=str(direct_path),
        handoff_sha256=module.digest(direct_path), compiler=toolchain / 'bin/bend',
        compiler_archive=archive, github_env=root / 'closure-refusal-env'), {})
except ValueError as error:
    assert 'Extracted compiler file differs from the archive' in str(error), str(error)
    outcomes.append({'case': 'changed-full-compiler-closure', 'success': True, 'refusal': str(error)})
else:
    raise AssertionError('Changed auxiliary compiler distribution file was accepted.')
finally:
    (toolchain / 'bin/bun').write_bytes(original_bun)
legacy_stdout = root / 'legacy.stdout'
legacy_stderr = root / 'legacy.stderr'
legacy_stdout.write_text('.scratch/bend2/baton2\n')
legacy_stderr.write_text('')
legacy_seed = root / 'legacy-seed.json'
save(legacy_seed, {'schema': 'baton2-early-main-source-seed-v1', 'source_clean': True,
    'source_commit': commit, 'source_tree': tree, 'file_manifest': module.fact(manifest),
    'original_native': {'exe': str(toolchain / 'bin/bend'),
        'cmdline': ' '.join(direct['records'][0]['argv']), 'environment': direct['records'][0]['environment']}})
legacy = {'schema': 'baton2-early-main-review-payload-v1', 'source_clean_at_seed': True,
    'main_build_completed': True, 'actual_main_success_marker': '.scratch/bend2/baton2',
    'source': str(source), 'source_commit': commit, 'source_tree': tree,
    'compiler': module.fact(toolchain / 'bin/bend'), 'base': module.fact(toolchain / 'bend2/base.bend'),
    'compiler_archive': module.fact(archive), 'source_seed_manifest': module.fact(legacy_seed),
    'build_stdout_as_of_boundary': module.fact(legacy_stdout), 'build_stderr_as_of_boundary': module.fact(legacy_stderr),
    'build_artifacts': [{'original': module.fact(Path(item['original']['path'])),
                         'copy': module.fact(Path(item['copy']['path'])), 'stable_during_copy': True}
                        for item in direct['build_artifacts']]}
legacy_path = root / 'legacy-handoff.json'
save(legacy_path, legacy)
legacy_result = {}
module.prepare(types.SimpleNamespace(source=source, run=root / 'legacy-run', handoff=str(legacy_path),
    handoff_sha256=module.digest(legacy_path), compiler=toolchain / 'bin/bend',
    compiler_archive=archive, github_env=root / 'legacy-env'), legacy_result)
assert legacy_result['status'] == 'reused'
outcomes.append({'case': 'legacy-handoff', 'success': True})
legacy_stdout.write_text('No completion marker.\n')
legacy['build_stdout_as_of_boundary'] = module.fact(legacy_stdout)
legacy_origin = root / 'legacy-refusal'
legacy_origin.mkdir()
try:
    module.legacy_evidence(legacy, {'kind': 'selected-handoff'}, legacy_origin)
except ValueError as error:
    assert 'lacks the completed Main marker' in str(error)
    outcomes.append({'case': 'legacy-missing-marker', 'success': True, 'refusal': str(error)})
else:
    raise AssertionError('Incomplete legacy marker was accepted.')

sharded = root / 'sharded-build'
sharded.mkdir()
sharded_source = sharded / 'baton2.c'
sharded_source.write_bytes(b'generated C fixture\n')
sharded_entry = sharded / 'native-entry.c'
sharded_entry.write_bytes(b'int main(void) { return 0; }\n')
sharded_output = sharded / 'baton2'
sharded_output.write_bytes(b'linked executable fixture\n')
sharded_object = sharded / 'baton2.o'
sharded_object.write_bytes(b'aggregated object fixture\n')
fake_clang = sharded / 'clang-19'
fake_clang.write_text('#!/bin/sh\nprintf "%s\\n" "Debian clang version 19.1.7"\n')
fake_clang.chmod(0o700)
compile_names = ['baton_core.c', 'baton_spins.c'] + [f'shard_{index:02d}.c' for index in range(4)]
split_manifest = {'schema': 'baton2-clang-c-shards-v1', 'counts': {'segments': 12}}
compile_rows = [{'source_name': name, 'object_name': Path(name).with_suffix('.o').name,
                 'source_sha256': module.digest(sharded_source),
                 'object_sha256': hashlib.sha256(name.encode()).hexdigest()} for name in compile_names]
driver = args.helper.resolve().parents[2] / 'tools/cgen-clang-parallel/build_native.py'
splitter = driver.with_name('shard_emitted_c.py')
manifest_sha = hashlib.sha256(json.dumps(split_manifest, sort_keys=True,
                                         separators=(',', ':')).encode()).hexdigest()
sharded_receipt = {'schema': 'baton2-clang-sharded-main-build-v1',
    'route': 'linux-x86_64-clang-19-no-pch', 'compiler': str(fake_clang),
    'source': str(sharded_source), 'source_sha256': module.digest(sharded_source),
    'entry': str(sharded_entry), 'entry_sha256': module.digest(sharded_entry),
    'splitter': str(splitter), 'splitter_sha256': module.digest(splitter),
    'driver': str(driver), 'driver_sha256': module.digest(driver),
    'ccache': '', 'ccache_sha256': '',
    'split_manifest_file_sha256': hashlib.sha256(
        (json.dumps(split_manifest, indent=2) + '\n').encode()).hexdigest(),
    'split_manifest_sha256': manifest_sha, 'split_manifest': split_manifest,
    'shards': 4, 'segments': 12,
    'compile_flags': ['-O1', '-pthread', '-Dmain=baton2_runtime_main'],
    'compile_objects': compile_rows,
    'aggregate_command': [str(fake_clang), '-r', *[row['object_name'] for row in compile_rows],
                          '-o', 'baton2.o'],
    'link_command': [str(fake_clang), '-O1', '-pthread', str(sharded_entry.resolve()),
                     'baton2.o', '-lsqlite3', '-lm', '-o', 'baton2'],
    'object': str(sharded_object), 'object_sha256': module.digest(sharded_object),
    'output': str(sharded_output), 'output_sha256': module.digest(sharded_output)}
receipt_path = sharded / 'baton2.build.json'
save(receipt_path, sharded_receipt)
verified_build = module.verify_sharded_build(receipt_path, sharded_source, sharded_entry, sharded_output)
assert verified_build['status'] == 'verified'
outcomes.append({'case': 'sharded-build-receipt', 'success': True})
bad_receipt = copy.deepcopy(sharded_receipt)
bad_receipt['compile_flags'] = ['-O2']
save(receipt_path, bad_receipt)
try:
    module.verify_sharded_build(receipt_path, sharded_source, sharded_entry, sharded_output)
except ValueError as error:
    assert 'compile flags differ' in str(error)
    outcomes.append({'case': 'sharded-build-receipt-flags-refused', 'success': True})
else:
    raise AssertionError('A changed sharded compile command was accepted.')
# Restore the mapped fixture facts before testing dirty tracked source.
save(check, {'source_tree': tree, 'natural_check_success_verified': True, 'result': fact(checked)})
for row in handoff['records']:
    save(root / Path(row['stdout']['path']).relative_to(logical).parent / 'result.json', row)
(source / module.ENTRY).write_text('Changed production input.\n')
rejected('dirty-production-source', handoff, 'Tracked source is dirty')
save(root / 'results.json', {'success': True, 'synthetic_evidence_only': True, 'compiler_executed': False,
    'helper': module.fact(args.helper), 'cases': outcomes, 'root': str(root)})
print(json.dumps({'success': True, 'cases': len(outcomes), 'result': module.fact(root / 'results.json')}))
