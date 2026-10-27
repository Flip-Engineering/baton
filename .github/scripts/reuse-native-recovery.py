#!/usr/bin/env python3
"""Verify retained focused-recovery C and derive it for the pinned target tree."""
import argparse
import hashlib
import json
import os
import pathlib
import posixpath
import shutil
import subprocess
import sys
import traceback


ORIGIN_COMMIT = 'c6953f8f2c8869091ac849e8fec180c13ff8f99d'
ORIGIN_TREE = 'cc7ef79b3e19c4addedc3fbacc4733344fac0212'
TARGET_BASE_COMMIT = '9993e042b51793c11de71548c2e5c74006713dac'
TARGET_BASE_TREE = 'f99c67f1025592e6139474f282f02fb6034735ef'
ENTRY = 'bend2/src/coordinator/receive-recovery-focused.bend'
HOST_SOURCE = 'bend2/src/host/control.c'
LINK_SOURCE = 'bend2/src/host/native-entry.c'
BASE_SHA256 = 'e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798'
OLD_SOURCE_DIGEST = '135f33abbcb4ab13c5a60e4f2d7dfafe058a7d679d3f4c9b94765ee3a63486de'
OLD_C_SHA256 = '2ee44b644f274759ea8d4ad73a6d82bff9be3d57d3ece4304e224887955b4e1e'
OLD_HOST_SHA256 = '9a2eb95b395e87af7f6f99bf4b5265554463584a4a5979dbf2c00a3caa560443'
CURRENT_HOST_SHA256 = 'f54835767dd5fe0ec871e05be69d981ab3ea9cc4aa9e4b2ec2ffb18dca1dcb21'
SPAWN_SOURCE = 'bend2/src/host/process-spawn.c'
OLD_SPAWN_SHA256 = 'e82d6727d23c94d46044f5a4e12210a903482c4aca19371993989a82d1bf87fd'
CURRENT_SPAWN_SHA256 = '9db470c0db6dcb37973ef11f242f20eb4e045949da586482a7680a825a7e288e'
GENERATOR = {
    'source_commit': '04e328c809526932bf72d346c17a197c8fef7e29',
    'source_tree': '5ada6a6d736309ba1c1579e2257800e24aa94223',
    'compiler_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    'runtime_sha256': '10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235',
    'manifest_sha256': '4acf1821c81aa3ca5c4835a58828fdc15cd3f66e6521525f10dfb7585d505499',
    'diagnostics_sha256': '45711439291134b187c91a4871c3f902a0bf1e374cb2cab7c12a5ec06aed3de2',
    'runtime_version': '1.4.4',
    'runtime_revision': '1.4.4+38afee6c8',
    'compiler_version': '2.0.25',
}
CAPTURED_FILES = {
    'result': 'ba2c9f3e746129cf30cd75010307a7bf36da9341051804899719f289a1e8d707',
    'source-digest': '3e9d46d98dd66788d43931b52145415993e8ed75e1baaef38e8fdead769bc9a8',
    'meta': '8300f085493a7ff8826f5bbe675f072cfc0ba3d06175c8412b66c853feff7265',
    'argv': '2a5d68f9c824d7ce64610858a4048ee7b93d2f5bd424ad65fbf3e714c528ce2a',
    'command': 'c1f919d63c204781d17a2087a8e52389dee2de7c67540b6028fadc3fe76a83e2',
    'request.json': '305b792d0c53b120748a89c2dc2b62ff5f389d437d581bde5d0b4a04f7f46601',
    'receipt': '46a6cb26d504e308d906ccab6cf470e31da98d0301d4736c7706bbe50f378ce6',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_sha256(path):
    with pathlib.Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(root), *args], cwd=root)


def git_tree(root, commit):
    return git(root, 'rev-parse', commit + '^{tree}').decode().strip()


def git_blob_rows(root, commit):
    rows = {}
    for record in git(root, 'ls-tree', '-rz', '--full-tree', commit, '--', 'bend2/src').split(b'\0'):
        if not record:
            continue
        header, raw_path = record.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        path = raw_path.decode()
        require(kind == 'blob', 'Unsupported source tree entry: ' + path)
        body = git(root, 'cat-file', 'blob', oid)
        require(hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == oid,
                'Git blob differs: ' + path)
        rows[path] = (mode, body)
    return rows


def bend_imports(body):
    targets = []
    for line in body.decode('utf-8').splitlines():
        trimmed = line.lstrip()
        if not trimmed.startswith('import '):
            continue
        value = trimmed[7:]
        target = value.split('"')[1] if value.startswith('"') else value.split()[0]
        if target != 'Base':
            targets.append(target)
    return targets


def c_includes(body):
    text = body.decode('utf-8')
    prefix = '#include "'
    mode = 0
    matched = 0
    target = ''
    output = []
    for char in text:
        newline = char == '\n'
        if mode == 2:
            if char == '"' or newline:
                if target:
                    output.append(target)
                mode = 0 if newline else 3
                matched = 0
                target = ''
            else:
                target += char
        elif newline:
            mode = 0
            matched = 0
            target = ''
        elif mode == 3:
            continue
        elif mode == 0 and char.isspace():
            continue
        elif char == prefix[matched]:
            mode = 2 if matched == len(prefix) - 1 else 1
            matched += 1
        else:
            mode = 3
            matched = 0
    if mode == 2 and target:
        output.append(target)
    return output


def source_closure(root, commit, entry):
    all_rows = git_blob_rows(root, commit)
    require(entry in all_rows, 'Source entry is missing: ' + entry)
    seen = set()
    queue = [entry]
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        require(path in all_rows, 'Source import is missing: ' + path)
        mode, body = all_rows[path]
        require(mode in ('100644', '100755'), 'Source closure contains a symlink or unsupported mode: ' + path)
        seen.add(path)
        if path.endswith('.bend'):
            targets = bend_imports(body)
        elif path.endswith(('.c', '.h')):
            targets = c_includes(body)
        else:
            targets = []
        for target in targets:
            require(not target.startswith('/'), 'Source closure contains an absolute import: ' + path)
            child = posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
            require(child.startswith('bend2/src/'), 'Source import leaves bend2/src: ' + path)
            if child not in seen:
                queue.append(child)
    records = []
    for path in sorted(seen):
        mode, body = all_rows[path]
        records.append((path, mode, sha256(body), len(body), body))
    rows = sorted(path + '\t' + digest + '\t' + str(size)
                  for path, mode, digest, size, body in records)
    serialized = ('schema=baton-compile-queue-source-v2\nsource-entry=' + entry + '\n'
                  + ''.join('source-file=' + row + '\n' for row in rows))
    return records, sha256(serialized.encode('utf-8'))


def compare_closures(old, current, allowed_path, allowed_hashes, allowed_path_2=None, allowed_hashes_2=None):
    old_map = {path: (mode, digest, size, body) for path, mode, digest, size, body in old}
    new_map = {path: (mode, digest, size, body) for path, mode, digest, size, body in current}
    require(old_map.keys() == new_map.keys(), 'Focused recovery source closure membership differs.')
    changed = [path for path in sorted(old_map) if old_map[path][:3] != new_map[path][:3]]
    allowed = {allowed_path: allowed_hashes}
    if allowed_path_2 is not None:
        allowed[allowed_path_2] = allowed_hashes_2
    require(all(path in allowed for path in changed)
            and [allowed_path] == [path for path in changed if path == allowed_path],
            'Focused recovery source closure has another changed input.')
    for path, (old_sha, new_sha) in allowed.items():
        if path in changed:
            require((old_map[path][1], new_map[path][1]) == (old_sha, new_sha),
                    'Focused recovery changed source hashes do not match the reviewed pair: ' + path)
    return old_map, new_map


def verify_source_transition(root, target_commit):
    require(git_tree(root, ORIGIN_COMMIT) == ORIGIN_TREE, 'Retained c6953 source tree differs.')
    require(git_tree(root, TARGET_BASE_COMMIT) == TARGET_BASE_TREE, 'Selected 9993 base tree differs.')
    ancestry = subprocess.run(['git', '-c', 'safe.directory=' + str(root), 'merge-base', '--is-ancestor',
                               TARGET_BASE_COMMIT, target_commit], cwd=root, check=False)
    require(ancestry.returncode == 0, 'Selected source does not descend from the pinned 9993 tree.')
    old, old_digest = source_closure(root, ORIGIN_COMMIT, ENTRY)
    current, current_digest = source_closure(root, target_commit, ENTRY)
    base, _ = source_closure(root, TARGET_BASE_COMMIT, ENTRY)
    require(old_digest == OLD_SOURCE_DIGEST, 'Retained Cgen source digest differs from the pinned c6953 closure.')
    base_map = {path: (mode, digest, size, body) for path, mode, digest, size, body in base}
    current_map = {path: (mode, digest, size, body) for path, mode, digest, size, body in current}
    require(base_map.keys() == current_map.keys(),
            'Focused recovery source closure membership changed after the pinned 9993 tree.')
    later = sorted(path for path in base_map if base_map[path][:3] != current_map[path][:3])
    spawn_applied = bool(later)
    require(later == [] or later == [SPAWN_SOURCE],
            'Focused recovery source closure changed after the pinned 9993 tree: ' + ', '.join(later))
    if spawn_applied:
        require((base_map[SPAWN_SOURCE][1], current_map[SPAWN_SOURCE][1])
                == (OLD_SPAWN_SHA256, CURRENT_SPAWN_SHA256),
                'Focused recovery durable-status source does not match the reviewed transition.')
    old_map, new_map = compare_closures(old, current, HOST_SOURCE,
                                        (OLD_HOST_SHA256, CURRENT_HOST_SHA256),
                                        SPAWN_SOURCE if spawn_applied else None,
                                        (OLD_SPAWN_SHA256, CURRENT_SPAWN_SHA256))
    old_host = old_map[HOST_SOURCE][3]
    current_host = new_map[HOST_SOURCE][3]
    transition = {'origin_source_digest': old_digest, 'current_source_digest': current_digest,
                  'closure_file_count': len(old), 'changed_input': HOST_SOURCE,
                  'old_control_sha256': sha256(old_host), 'current_control_sha256': sha256(current_host),
                  'old_control': old_host, 'current_control': current_host}
    if spawn_applied:
        transition['old_spawn_sha256'] = sha256(old_map[SPAWN_SOURCE][3])
        transition['current_spawn_sha256'] = sha256(new_map[SPAWN_SOURCE][3])
        transition['old_spawn'] = old_map[SPAWN_SOURCE][3]
        transition['current_spawn'] = new_map[SPAWN_SOURCE][3]
    origin_rows = git_blob_rows(root, ORIGIN_COMMIT)
    current_rows = git_blob_rows(root, target_commit)
    require(origin_rows[LINK_SOURCE][:2] == current_rows[LINK_SOURCE][:2],
            'Separately linked native-entry.c changed.')
    require(origin_rows[LINK_SOURCE][1] == current_rows[LINK_SOURCE][1],
            'Separately linked native-entry.c bytes changed.')
    transition['native_entry_sha256'] = sha256(current_rows[LINK_SOURCE][1])
    return transition


def parse_fields(text):
    fields = {}
    for line in text.splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        fields.setdefault(key, []).append(value)
    return fields


def one(fields, key):
    values = fields.get(key, [])
    require(len(values) == 1, 'Captured Cgen field is missing or repeated: ' + key)
    return values[0]


def cgen_request_valid(request, result_key, cwd):
    key_argv = request.get('key_argv', [])
    return (request.get('key') == result_key and request.get('cwd') == cwd
            and ENTRY in key_argv and '--kind' in key_argv
            and key_argv[key_argv.index('--kind') + 1] == 'cgen')


def verify_generator(generator_root, diagnostics):
    generator_root = pathlib.Path(generator_root).resolve()
    manifest_path = generator_root / 'fork-manifest.json'
    require(file_sha256(manifest_path) == GENERATOR['manifest_sha256'], 'Retained generator manifest differs.')
    manifest = json.loads(manifest_path.read_text())
    require(manifest['schema'] == 'baton-bend-distribution-fork-manifest-v1'
            and manifest['source_commit'] == GENERATOR['source_commit']
            and manifest['source_tree'] == GENERATOR['source_tree'], 'Retained generator source identity differs.')
    compiler = generator_root / 'bin/bend'
    runtime = generator_root / 'bin/bun'
    base = generator_root / 'bend2/base.bend'
    require(file_sha256(compiler) == GENERATOR['compiler_sha256'], 'Retained generator launcher differs.')
    require(file_sha256(runtime) == GENERATOR['runtime_sha256'], 'Retained generator runtime differs.')
    require(file_sha256(base) == BASE_SHA256, 'Retained generator Base differs.')
    require(manifest['compiler']['sha256'] == GENERATOR['compiler_sha256']
            and manifest['bun']['sha256'] == GENERATOR['runtime_sha256'], 'Generator manifest toolchain hashes differ.')
    require(diagnostics['toolchain']['compiler']['path'] == str(compiler)
            and diagnostics['toolchain']['runtime']['path'] == str(runtime), 'Cgen toolchain paths differ.')
    require(diagnostics['toolchain']['compiler']['sha256'] == GENERATOR['compiler_sha256']
            and diagnostics['toolchain']['runtime']['sha256'] == GENERATOR['runtime_sha256']
            and diagnostics['toolchain']['manifest']['sha256'] == GENERATOR['manifest_sha256'],
            'Cgen toolchain observations differ.')
    require(diagnostics['toolchain']['compiler']['source_commit'] == GENERATOR['source_commit']
            and diagnostics['toolchain']['compiler']['source_tree'] == GENERATOR['source_tree'],
            'Cgen compiler source identity differs.')
    require(diagnostics['toolchain']['runtime']['version'] == GENERATOR['runtime_version']
            and diagnostics['toolchain']['runtime']['revision'] == GENERATOR['runtime_revision']
            and diagnostics['toolchain']['compiler']['version'] == GENERATOR['compiler_version'],
            'Cgen toolchain versions differ.')
    require(diagnostics['environment']['BEND_LIB']['state'] == 'absent',
            'Retained Cgen used an explicit BEND_LIB.')
    files = manifest['source']['files']
    require(len(files) == 76, 'Retained generator source file set differs.')
    for row in files:
        path = generator_root / row['path']
        require(path.is_file() and not path.is_symlink(), 'Retained generator source file is missing: ' + row['path'])
        require(path.stat().st_size == row['bytes'] and file_sha256(path) == row['sha256'],
                'Retained generator source bytes differ: ' + row['path'])
    return {'source_commit': GENERATOR['source_commit'], 'source_tree': GENERATOR['source_tree'],
            'compiler_sha256': GENERATOR['compiler_sha256'], 'runtime_sha256': GENERATOR['runtime_sha256'],
            'manifest_sha256': GENERATOR['manifest_sha256'], 'base_sha256': BASE_SHA256,
            'generator_root': str(generator_root)}


def verify_capture(origin, generator_root):
    origin = pathlib.Path(origin).resolve()
    evidence = origin / 'cgen'
    for name, expected in CAPTURED_FILES.items():
        path = evidence / name
        require(file_sha256(path) == expected, 'Captured Cgen evidence differs: ' + name)
    generated = origin / 'generated.c'
    require(file_sha256(generated) == OLD_C_SHA256, 'Retained recovery C differs.')
    diagnostics_path = evidence / 'compiler-diagnostics.json'
    require(file_sha256(diagnostics_path) == GENERATOR['diagnostics_sha256'], 'Cgen diagnostics differ.')
    diagnostics = json.loads(diagnostics_path.read_text())
    result = parse_fields((evidence / 'result').read_text())
    require(one(result, 'status') == 'completed' and one(result, 'verified') == '1'
            and one(result, 'external') == '0' and one(result, 'exit') == '0', 'Cgen result is not a completed verified run.')
    require(one(result, 'key') == '011b71caa2b095f9013b03341551f19e5480feee7cf0ca0aedd07ec3189d3454',
            'Cgen result key differs.')
    artifact = result.get('artifact', [])
    require(artifact == ['output.c\tfile\t' + OLD_C_SHA256], 'Cgen result artifact differs.')
    source_digest = parse_fields((evidence / 'source-digest').read_text())
    require(one(source_digest, 'digest') == OLD_SOURCE_DIGEST, 'Cgen source digest differs.')
    require(diagnostics['queue_attempt']['source_digest'] == 'digest=' + OLD_SOURCE_DIGEST,
            'Cgen diagnostics source digest differs.')
    for name in ('meta', 'argv', 'command'):
        require(diagnostics['queue_attempt'][name + '_sha256'] == CAPTURED_FILES[name],
                'Cgen diagnostics file binding differs: ' + name)
    require(diagnostics['queue_attempt']['meta']['entry'] == ENTRY
            and diagnostics['queue_attempt']['meta']['source_root'].endswith('/deploy-c6953-recovery-20261027'),
            'Cgen source root or entry differs.')
    receipt = parse_fields((evidence / 'receipt').read_text())
    require(one(receipt, 'status') == 'completed'
            and one(receipt, 'key') == one(result, 'key')
            and one(receipt, 'reused') == '0', 'Cgen wrapper receipt differs.')
    request = json.loads((evidence / 'request.json').read_text())
    require(cgen_request_valid(request, one(result, 'key'), diagnostics['queue_attempt']['meta']['cwd']),
            'Cgen request does not bind the completed recovery entry and result.')
    generator = verify_generator(generator_root, diagnostics)
    return {'cgen_result_sha256': CAPTURED_FILES['result'],
            'cgen_diagnostics_sha256': GENERATOR['diagnostics_sha256'],
            'cgen_source_digest': OLD_SOURCE_DIGEST, 'cgen_key': one(result, 'key'),
            'generated_c_sha256': OLD_C_SHA256, 'generator': generator}


def substitute_fragment(original_c, old_host, current_host):
    require(original_c.count(old_host) == 1, 'Generated C must contain the old host source exactly once.')
    prefix, suffix = original_c.split(old_host)
    result = prefix + current_host + suffix
    require(result.count(current_host) == 1, 'Derived C must contain the current host source exactly once.')
    return result, prefix, suffix


def derive(original_c, old_host, current_host, spawn=None):
    require(sha256(original_c) == OLD_C_SHA256, 'Retained recovery C hash differs.')
    require(sha256(old_host) == OLD_HOST_SHA256 and sha256(current_host) == CURRENT_HOST_SHA256,
            'Foreign source hashes do not match the focused recovery substitution.')
    result, prefix, suffix = substitute_fragment(original_c, old_host, current_host)
    substitution = {'path': HOST_SOURCE, 'old_sha256': OLD_HOST_SHA256,
                    'current_sha256': CURRENT_HOST_SHA256, 'offset': len(prefix),
                    'prefix_sha256': sha256(prefix), 'suffix_sha256': sha256(suffix),
                    'original_c_sha256': sha256(original_c), 'derived_c_sha256': sha256(result),
                    'derived_c_size_bytes': len(result)}
    spawn_substitution = None
    if spawn is not None:
        old_spawn, current_spawn = spawn
        require(sha256(old_spawn) == OLD_SPAWN_SHA256 and sha256(current_spawn) == CURRENT_SPAWN_SHA256,
                'Foreign source hashes do not match the durable-status substitution.')
        result, prefix, suffix = substitute_fragment(result, old_spawn, current_spawn)
        spawn_substitution = {'path': SPAWN_SOURCE, 'old_sha256': OLD_SPAWN_SHA256,
                              'current_sha256': CURRENT_SPAWN_SHA256, 'offset': len(prefix),
                              'prefix_sha256': sha256(prefix), 'suffix_sha256': sha256(suffix),
                              'original_c_sha256': substitution['derived_c_sha256'],
                              'derived_c_sha256': sha256(result),
                              'derived_c_size_bytes': len(result)}
    return result, substitution, spawn_substitution


def prepare(args):
    root = pathlib.Path(args.source).resolve()
    require(os.environ.get('BEND_LIB') is None, 'Focused recovery C reuse requires the default Bend Base lookup.')
    target_commit = git(root, 'rev-parse', 'HEAD').decode().strip()
    target_tree = git_tree(root, target_commit)
    require(not git(root, 'status', '--porcelain=v1', '--untracked-files=no'), 'Tracked source tree is dirty.')
    transition = verify_source_transition(root, target_commit)
    base = pathlib.Path(args.compiler).resolve().parent.parent / 'bend2/base.bend'
    require(file_sha256(base) == BASE_SHA256, 'Selected compiler Base differs from the retained generator Base.')
    generator = pathlib.Path(args.generator_root).resolve()
    origin = pathlib.Path(args.run).resolve() / 'generated/recovery-c-origin'
    evidence = origin / 'cgen'
    evidence.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.origin_c, origin / 'generated.c')
    for name, path in (('result', args.result), ('source-digest', args.source_digest),
                       ('meta', args.meta), ('argv', args.argv), ('command', args.command),
                       ('request.json', args.request), ('receipt', args.receipt),
                       ('compiler-diagnostics.json', args.diagnostics)):
        shutil.copyfile(path, evidence / name)
    captured = verify_capture(origin, generator)
    spawn = (transition['old_spawn'], transition['current_spawn']) if 'old_spawn' in transition else None
    derived, substitution, spawn_substitution = derive((origin / 'generated.c').read_bytes(),
                                                       transition['old_control'], transition['current_control'],
                                                       spawn)
    generated = origin / 'baton-recovery.c'
    generated.write_bytes(derived)
    proof = {
        'schema': 'baton2-focused-recovery-c-reuse-v1', 'status': 'reused',
        'entry': ENTRY, 'origin_source_commit': ORIGIN_COMMIT, 'origin_source_tree': ORIGIN_TREE,
        'current_source_commit': target_commit, 'current_source_tree': target_tree,
        'source_closure_file_count': transition['closure_file_count'],
        'origin_source_digest': transition['origin_source_digest'],
        'current_source_digest': transition['current_source_digest'],
        'changed_input': HOST_SOURCE, 'captured_cgen': captured,
        'foreign_source_substitution': substitution,
        'generated_c': str(generated), 'generated_c_sha256': sha256(derived),
        'selected_base_sha256': BASE_SHA256,
    }
    if spawn_substitution is not None:
        proof['changed_input_2'] = SPAWN_SOURCE
        proof['foreign_source_substitution_spawn'] = spawn_substitution
    proof_path = pathlib.Path(args.run).resolve() / 'generated/recovery-c-reuse.json'
    proof_path.write_text(json.dumps(proof, indent=2) + '\n')
    env = pathlib.Path(args.github_env)
    with env.open('a') as stream:
        stream.write('BATON2_RECOVERY_GENERATED_C=' + str(generated) + '\n')
        stream.write('BATON2_RECOVERY_C_PROOF=' + str(proof_path) + '\n')
        stream.write('BATON2_RECOVERY_C_PROOF_SHA256=' + file_sha256(proof_path) + '\n')
        stream.write('BATON2_RECOVERY_C_GENERATOR_ROOT=' + str(generator) + '\n')
    return proof


def select(args):
    root = pathlib.Path(args.source).resolve()
    require(os.environ.get('BEND_LIB') is None, 'Focused recovery C reuse requires the default Bend Base lookup.')
    require(not git(root, 'status', '--porcelain=v1', '--untracked-files=no'), 'Tracked source tree is dirty.')
    proof_path = pathlib.Path(args.proof).resolve()
    require(file_sha256(proof_path) == args.proof_sha256, 'Focused recovery C proof digest differs.')
    proof = json.loads(proof_path.read_text())
    require(proof['schema'] == 'baton2-focused-recovery-c-reuse-v1' and proof['status'] == 'reused'
            and proof['entry'] == ENTRY,
            'Focused recovery C proof does not bind the selected entry and source.')
    target_commit = git(root, 'rev-parse', 'HEAD').decode().strip()
    require(target_commit == proof['current_source_commit']
            and git_tree(root, target_commit) == proof['current_source_tree'],
            'Selected source differs from the recovery C proof.')
    transition = verify_source_transition(root, target_commit)
    require(proof['origin_source_digest'] == transition['origin_source_digest']
            and proof['current_source_digest'] == transition['current_source_digest'],
            'Focused recovery source closure differs from the proof.')
    current_base = pathlib.Path(args.compiler).resolve().parent.parent / 'bend2/base.bend'
    require(file_sha256(current_base) == BASE_SHA256, 'Selected compiler Base differs from the focused recovery proof.')
    origin = proof_path.parent / 'recovery-c-origin'
    captured = verify_capture(origin, args.generator_root)
    require(captured == proof['captured_cgen'], 'Retained Cgen identity differs from the proof.')
    spawn = (transition['old_spawn'], transition['current_spawn']) if 'old_spawn' in transition else None
    derived, substitution, spawn_substitution = derive((origin / 'generated.c').read_bytes(),
                                                       transition['old_control'], transition['current_control'],
                                                       spawn)
    generated = pathlib.Path(args.generated_c).resolve()
    require(generated.is_file() and file_sha256(generated) == proof['generated_c_sha256']
            and generated.read_bytes() == derived, 'Selected recovery C differs from the derived C.')
    require(substitution == proof['foreign_source_substitution'], 'Foreign source substitution proof differs.')
    require(spawn_substitution == proof.get('foreign_source_substitution_spawn'),
            'Durable-status substitution proof differs.')
    return generated


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_subparsers(dest='mode', required=True)
    prepare_parser = modes.add_parser('prepare')
    for name in ('source', 'run', 'origin-c', 'result', 'source-digest', 'meta', 'argv', 'command',
                 'request', 'receipt', 'diagnostics', 'generator-root', 'compiler', 'github-env'):
        prepare_parser.add_argument('--' + name, type=pathlib.Path, required=True)
    select_parser = modes.add_parser('select')
    for name in ('source', 'compiler', 'proof', 'generated-c', 'generator-root', 'output'):
        select_parser.add_argument('--' + name, type=pathlib.Path, required=True)
    select_parser.add_argument('--proof-sha256', required=True)
    args = parser.parse_args()
    try:
        if args.mode == 'prepare':
            proof = prepare(args)
            print(json.dumps({key: value for key, value in proof.items() if key != 'captured_cgen'}))
        else:
            selected = select(args)
            result = {'schema': 'baton2-focused-recovery-c-selection-v1', 'status': 'reused',
                      'selected_c': str(selected), 'selected_c_sha256': file_sha256(selected)}
            args.output.write_text(json.dumps(result, indent=2) + '\n')
            print(selected)
    except BaseException:
        traceback.print_exc(file=sys.stderr)
        raise


if __name__ == '__main__':
    main()
