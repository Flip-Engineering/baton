#!/usr/bin/env python3
"""Verify a retained Main compilation against the current compilation inputs."""
import argparse
import difflib
import glob
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import time
import traceback


ARCHIVE_SHA = '91c0e2640f8d2e3e73fd3dd62ed4d178ce9a6f7ce8f8980b4dc4abf7a6f9ccd4'
COMPILER_ARCHIVES = {
    '6609a2de031417fe4ad149d77afd9282c76237aa0b70dfb48416f4ccfe1ad876': {
        'name': 'Bend 2.0.25 with the Baton #1017 pass collection patch and Malloc=1 launcher',
        'official_release_artifact': False,
        'binary_sha256': 'fad2561b1050ad86d748b3889115362b7d95b5c38a718bfc9bc3c2539d5269a9',
    },
    'db42e8726f9f8e8049b9651a9cedf5f9994a530ef1ad606019a2faf881136fa1': {
        'name': 'Bend 2.0.25 with the Baton #1017 pass collection patch and Bun 1.4.4 launcher',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'f22a9bc5d42ebe57d0e46240a5ca407e673bc84a4ba21e6ad2c693cf44b8d651': {
        'name': 'Bend 2.0.25 with PR1087 arm sharing, the CONSTS insertion bound and the iterative pass-1 emitter (Bun 1.4.4 launcher)',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'b4fc1e5dc357c60b6d683bcdf29c63c2c479c5c5e4d21adb01afdc1ca60d79a3': {
        'name': 'Bend 2.0.25 with compiler main from Baton PR #1101 (Bun 1.4.4 launcher)',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'e14dcc05b6bdde4f5727e9e384e15cd1a9f6164a059b817c1e48fd76bd8a2b1b': {
        'name': 'Bend 2.0.25 compiler main from Baton PR #1101 with runtime lineage metadata',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'fd99eb8446b32b2ab80a5deef1813644f6bb09f472b49bdfad4d14d8367b7cf9': {
        'name': 'Bend 2.0.25 compiler main from Baton source f9356fd with iterative public term lowering',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '9439438bcf409f1ab4714e27016042153e4045ee8b9353370718f4b19e91749d': {
        'name': 'Bend 2.0.25 compiler main from Baton source 7261c8f with WeakSet liveness tracking',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'ebdf6505992f6e1c5b6b143350b324c9395fc90610ccda10300a7b0d80f426cd': {
        'name': 'Bend 2.0.25 compiler main from Baton source c2cc984 with shared type liveness tracking',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '5b8ae4da56ec4103a9c5042f6a834931d0c6fc8d4ed2fb145481d01f8152ed3d': {
        'name': 'Bend 2.0.25 compiler main from Baton PR #1122 with shared string-pattern literals',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'be457f1bb221df434a685506b18c0dd7fe55464ab82257a58189078374bc6f0f': {
        'name': 'Bend 2.0.25 compiler main from Baton PR #1131 with shared parser lowering',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'f5b2c7588b0b4728bd9d0893904a1074469cb2946a1c07cf400ce30d9a8f2333': {
        'name': 'Bend 2.0.25 compiler main from Baton PR #1139 with per-pass collection reuse',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '4a3a566f3dc6ed5e88a872ea37133a655e52b4abca97d31ee97417bb36a2d542': {
        'name': 'Bend 2.0.25 compiler main from Baton PR #1144 with reusable emission buffers and direct parse lowering',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'cad6a74192b7121b932fb7c5856760dfc1e6f7139053930e1fda19dc0e90aada': {
        'name': 'Bend 2.0.25 compiler main with bounded C indentation',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '8388e439ee642cbee177fcff0c0139cc69f8ece561735006dda02b68ff4cc91c': {
        'name': 'Bend 2.0.25 compiler main with literal-prefix lowering and 20-bit FID/CID capacity',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '5bf1999806f90f194041f01285cb831fdde1761df6726a745c333a0b971e5685': {
        'name': 'Bend 2.0.25 compiler main with literal-prefix lowering, 20-bit FID/CID capacity and strong CID value reach',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '5d3e79f021dc544dc2c2e075427b5adfd6858c4a0efd8aa28d0d463a9394850e': {
        'name': 'Bend 2.0.25 compiler main with literal-prefix lowering, 20-bit FID/CID capacity, strong CID value reach and Metal term-tag decode',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    ARCHIVE_SHA: {'name': 'Bend 2.0.25', 'official_release_artifact': True},
    '38bb1813d52ddc7b816a8a01f971fe8503959fef54795ca22eb346b5cfc069a7': {
        'name': 'Bend 2.0.25 with the Baton #741 pure memo patch',
        'official_release_artifact': False,
        'binary_sha256': 'b929035652cba78ba1b034b7214a14bbc2f64f0e6c27265c64c53895d24890c0',
    },
    'ca9f19566db10332c56d5253ad4944d05e675b64ce07b3e12d6ff335c6485d8a': {
        'name': 'Bend 2.0.25 with Baton memoization, the Cgen cache and the emit-lits fixpoint patch',
        'official_release_artifact': False,
        'binary_sha256': '94383bb15b262f5bcd34ae2684d74a06e0f81e88736a75e17c9d8cbe9dbb79dc',
    },
}
ENTRY = 'bend2/src/coordinator/main.bend'
HOST_SOURCE = 'bend2/src/host/process-spawn.c'
HOST_SUBSTITUTIONS = {
    ('92f8b1731faed7a08e94158a4dffd4cdeee53d380444ae963c8875378660619c',
     'c64fd0bc908fc5818653ac61883532b0c77cfd02e391ecd12fac8bc1287adf88'),
    ('467d693493be3e3700598700fa3789f3650b1f7e624331c5ad555c8be7323d99',
     'e6bb44937a9828c04e4b3c9683119e058c4b9d1984783bc742f5392d5199642b'),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fact(path):
    require(path.is_file() and not path.is_symlink(), 'Expected a regular file: ' + str(path))
    return {'path': str(path), 'size_bytes': path.stat().st_size, 'sha256': digest(path)}


def verify_file(row):
    actual = fact(pathlib.Path(row['path']))
    require(all(actual[key] == row[key] for key in ('sha256', 'size_bytes')),
            'Retained file differs from its recorded bytes: ' + row['path'])
    return pathlib.Path(row['path'])


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(root), *args], cwd=root)


def source_files(root, commit, tree):
    require(git(root, 'rev-parse', 'HEAD').decode().rstrip('\n') == commit, 'Retained source HEAD differs.')
    require(git(root, 'rev-parse', 'HEAD^{tree}').decode().rstrip('\n') == tree, 'Retained source tree differs.')
    require(not git(root, 'status', '--porcelain', '--untracked-files=no'), 'Tracked source is dirty.')
    rows = []
    for record in git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD').split(b'\0'):
        if not record:
            continue
        header, name = record.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        relative = name.decode()
        path = root / relative
        require(kind == 'blob' and mode in ('100644', '100755', '120000'),
                'Unsupported source entry: ' + relative)
        if mode == '120000':
            require(path.is_symlink(), 'Source link changed: ' + relative)
            body = os.fsencode(os.readlink(path))
        else:
            require(path.is_file() and not path.is_symlink(), 'Source file changed: ' + relative)
            require(bool(path.stat().st_mode & 0o111) == (mode == '100755'), 'Source mode changed: ' + relative)
            body = path.read_bytes()
        require(hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == oid,
                'Source bytes differ from Git: ' + relative)
        rows.append({'path': relative, 'mode': mode, 'git_blob': oid,
                     'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    return rows


def production_inputs(root, rows):
    selected = sorted((row for row in rows if row['path'].startswith('bend2/src/')), key=lambda row: row['path'])
    expected = {row['path'] for row in selected}
    actual = {str(path.relative_to(root)) for path in (root / 'bend2/src').rglob('*')
              if path.is_file() or path.is_symlink()}
    if expected != actual:
        return selected, 'Production directory contains untracked or missing files.'
    for row in selected:
        path = root / row['path']
        if row['mode'] == '120000':
            return selected, 'A production symlink requires a normal compilation.'
        if path.suffix != '.bend':
            continue
        # Current Main imports are local modules and Base. External imports need a normal build.
        lines = path.read_text().splitlines()
        in_header = True
        for line in lines:
            if in_header and (not line.strip() or line.lstrip().startswith('#')):
                continue
            if in_header and line.startswith('import'):
                value = line[len('import'):].strip()
                if value == 'Base':
                    continue
                match = re.fullmatch(r'(\S+)\s+as\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+#.*)?', value)
                if not match:
                    return selected, 'A module import requires a normal compilation: ' + row['path']
                target = (path.parent / match[1]).resolve()
                if not target.is_relative_to(root / 'bend2/src') or target.suffix != '.bend':
                    return selected, 'A module import leaves the production directory: ' + row['path']
                continue
            in_header = False
            for match in re.finditer(r'\bimport\s+"([^"]+)"', line):
                target = (path.parent / match[1]).resolve()
                if not target.is_relative_to(root / 'bend2/src') or str(target.relative_to(root)) not in expected:
                    return selected, 'A foreign import leaves the production inputs: ' + row['path']
    return selected, None


def canonical_host_change(original, current):
    old = {row['path']: row for row in original}
    new = {row['path']: row for row in current}
    if old.keys() != new.keys():
        return False
    changed = [name for name in old if old[name] != new[name]]
    return (changed == [HOST_SOURCE]
            and old[HOST_SOURCE]['mode'] == new[HOST_SOURCE]['mode'] == '100644'
            and (old[HOST_SOURCE]['sha256'], new[HOST_SOURCE]['sha256']) in HOST_SUBSTITUTIONS)


def substitute_host(original_c, original_host, current_host):
    original_sha = hashlib.sha256(original_host).hexdigest()
    current_sha = hashlib.sha256(current_host).hexdigest()
    require((original_sha, current_sha) in HOST_SUBSTITUTIONS,
            'Foreign source hashes require an approved substitution pair.')
    require(original_c.count(original_host) == 1, 'Main C must contain the complete original foreign source once.')
    prefix, suffix = original_c.split(original_host)
    derived = prefix + current_host + suffix
    require(derived.count(current_host) == 1, 'Derived Main C must contain the complete current foreign source once.')
    return derived, {
        'schema': 'baton2-canonical-foreign-substitution-v1', 'path': HOST_SOURCE,
        'original_host_sha256': original_sha, 'current_host_sha256': current_sha,
        'offset': len(prefix),
        'prefix_size_bytes': len(prefix), 'prefix_sha256': hashlib.sha256(prefix).hexdigest(),
        'suffix_size_bytes': len(suffix), 'suffix_sha256': hashlib.sha256(suffix).hexdigest(),
        'original_c_size_bytes': len(original_c), 'original_c_sha256': hashlib.sha256(original_c).hexdigest(),
        'derived_c_size_bytes': len(derived), 'derived_c_sha256': hashlib.sha256(derived).hexdigest(),
    }


def verify_production_transition(origin, proof, current):
    original = json.loads((origin / 'production-inputs.json').read_text())
    recorded = json.loads((origin / 'current-production-inputs.json').read_text())
    require(current == recorded, 'Current production input membership, bytes or modes differ.')
    substitution = proof.get('foreign_source_substitution')
    if substitution is None:
        require(original == current, 'Main production inputs differ.')
        return
    require(canonical_host_change(original, current), 'Foreign substitution changes other production inputs.')
    old_host = (origin / 'foreign-source-original.c').read_bytes()
    new_host = (origin / 'foreign-source-current.c').read_bytes()
    original_c = (origin / 'baton2.original.c').read_bytes()
    derived, actual = substitute_host(original_c, old_host, new_host)
    require(actual == substitution, 'Canonical foreign substitution proof differs.')
    artifacts = json.loads((origin / 'build-artifacts.json').read_text())
    c_rows = [row['copy'] for row in artifacts if pathlib.Path(row['copy']['path']).name == 'baton2.c']
    require(len(c_rows) == 1 and c_rows[0]['sha256'] == actual['original_c_sha256']
            and c_rows[0]['size_bytes'] == actual['original_c_size_bytes'],
            'Original Main C differs from its completed build artifact.')
    require((origin / 'baton2.c').read_bytes() == derived, 'Derived Main C differs from the canonical substitution.')
    source = json.loads((origin / 'source-files.json').read_text())
    require(next(row for row in source if row['path'] == HOST_SOURCE)['sha256'] == actual['original_host_sha256'],
            'Original source does not bind the canonical foreign input.')
    require(next(row for row in recorded if row['path'] == HOST_SOURCE)['sha256'] == actual['current_host_sha256'],
            'Selected source does not bind the current foreign input.')


def distribution(archive, home):
    require(digest(archive) in COMPILER_ARCHIVES, 'Compiler archive differs from the pinned distributions.')
    expected = {}
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            parts = pathlib.PurePosixPath(member.name).parts
            require(parts and not member.name.startswith('/') and '..' not in parts, 'Unsafe compiler archive member.')
            relative = pathlib.PurePosixPath(*parts[1:])
            if member.isdir():
                continue
            require(str(relative) not in expected and str(relative) != '.', 'Duplicate compiler archive member.')
            path = home / relative
            if member.isfile():
                with source.extractfile(member) as stream:
                    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
                actual = fact(path)
                require(actual['sha256'] == sha and actual['size_bytes'] == member.size,
                        'Extracted compiler file differs from the archive: ' + str(relative))
                require(bool(path.stat().st_mode & 0o111) == bool(member.mode & 0o111),
                        'Extracted compiler executable mode differs: ' + str(relative))
                row = {'path': str(relative), 'size_bytes': member.size, 'sha256': sha,
                       'executable': bool(member.mode & 0o111)}
            elif member.issym():
                require(path.is_symlink() and os.readlink(path) == member.linkname,
                        'Extracted compiler link differs: ' + str(relative))
                require(path.resolve().is_relative_to(home), 'Compiler link leaves the distribution.')
                row = {'path': str(relative), 'link': member.linkname}
            else:
                raise ValueError('Unsupported compiler archive entry: ' + member.name)
            expected[str(relative)] = row
    actual = {str(path.relative_to(home)) for path in home.rglob('*') if path.is_file() or path.is_symlink()}
    require(actual == set(expected), 'Extracted compiler distribution has missing or additional files.')
    return [expected[key] for key in sorted(expected)]


def copy_record(row, destination):
    shutil.copyfile(verify_file(row), destination)


def directory_files(home, expected):
    rows = []
    for path in sorted(home.rglob('*')):
        if path.is_symlink():
            rows.append({'path': str(path.relative_to(home)), 'link': os.readlink(path)})
        elif path.is_file():
            rows.append({**fact(path), 'path': str(path.relative_to(home)),
                         'executable': bool(path.stat().st_mode & 0o111)})
    rows.sort(key=lambda row: row['path'])
    return rows, rows == expected


def select(args, result):
    root = args.source.resolve()
    result.update(schema='baton2-main-c-build-selection-v1', status='miss', root=str(root),
                  bound_root=args.bound_root, entry=ENTRY)
    require(digest(args.proof) == args.proof_sha256, 'Main C reuse proof differs from its verified digest.')
    proof = json.loads(args.proof.read_text())
    require(proof['schema'] == 'baton2-main-c-reuse-v1' and proof['status'] == 'reused'
            and proof['root'] == args.bound_root, 'Main C reuse proof does not bind the selected checkout.')
    origin = args.proof.parent / 'main-c-origin'
    for row in proof['origin_assets']:
        path = args.proof.parent / row['path']
        require(path.resolve().is_relative_to(origin), 'Origin asset leaves Main compilation evidence.')
        verify_file({**row, 'path': str(path)})
    require(digest(args.generated_c) == proof['generated_c_sha256']
            and args.generated_c.stat().st_size == proof['generated_c_size'], 'Verified Main C bytes changed.')
    expected = json.loads((origin / 'current-production-inputs.json').read_text())
    rows = []
    for path in sorted((root / 'bend2/src').rglob('*')):
        if path.is_symlink():
            result['reason'] = 'A production symlink requires a normal compilation.'
            return
        if path.is_file():
            body = path.read_bytes()
            rows.append({'path': str(path.relative_to(root)),
                         'mode': '100755' if path.stat().st_mode & 0o111 else '100644',
                         'git_blob': hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest(),
                         'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    rows.sort(key=lambda row: row['path'])
    result['production_inputs'] = rows
    if rows != expected:
        result['reason'] = 'Actual Main production input membership, bytes or modes differ.'
        return
    verify_production_transition(origin, proof, rows)
    compiler = args.compiler.resolve()
    require(compiler.name == 'bend' and compiler.parent.name == 'bin', 'Unexpected selected compiler layout.')
    actual, matches = directory_files(compiler.parent.parent, json.loads((origin / 'toolchain-files.json').read_text()))
    result.update(compiler=fact(compiler), compiler_distribution=actual)
    if not matches:
        result['reason'] = 'The selected compiler distribution differs from the verified Main compiler.'
        return
    result.update(status='reused', generated_c_sha256=proof['generated_c_sha256'],
                  proof_sha256=args.proof_sha256, origin_source_commit=proof['origin_source_commit'],
                  scope='original-checkout' if str(root) == args.bound_root else 'matching-production-inputs')
    if proof.get('foreign_source_substitution') is not None:
        result['foreign_source_substitution'] = proof['foreign_source_substitution']


def artifact_identity(handoff):
    return sorted((pathlib.Path(item['copy']['path']).name,
                   item['copy']['size_bytes'], item['copy']['sha256'])
                  for item in handoff['build_artifacts'])


def handoff_binding(path, expected_sha):
    handoff = json.loads(path.read_text())
    selected_sha = digest(path)
    if selected_sha == expected_sha:
        return handoff, {'kind': 'selected-handoff', 'selected_sha256': selected_sha,
                         'requested_sha256': expected_sha}
    original_path = verify_file(handoff['origin_handoff'])
    require(digest(original_path) == expected_sha, 'Retained handoff and its original differ from the requested SHA256.')
    original = json.loads(original_path.read_text())
    for key in ('schema', 'source_commit', 'source_tree', 'source_clean_at_seed',
                'main_build_completed', 'actual_main_success_marker'):
        require(handoff[key] == original[key], 'Mapped handoff differs from its original: ' + key)
    for key in ('compiler', 'compiler_archive', 'base', 'build_stdout_as_of_boundary', 'build_stderr_as_of_boundary'):
        require(all(handoff[key][field] == original[key][field] for field in ('size_bytes', 'sha256')),
                'Mapped handoff changes original build bytes: ' + key)
    require(artifact_identity(handoff) == artifact_identity(original), 'Mapped handoff changes Main artifacts.')
    return handoff, {'kind': 'mapped-handoff', 'selected_sha256': selected_sha,
                     'requested_sha256': expected_sha, 'original_handoff': handoff['origin_handoff'],
                     'original_seed': original['source_seed_manifest']}


def prepare(args, result):
    root = args.source.resolve()
    generated = args.run.resolve() / 'generated'
    evidence = args.run.resolve() / 'evidence'
    generated.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    result.update(schema='baton2-main-c-reuse-v1', status='not-requested', entry=ENTRY,
                  current_source_commit=git(root, 'rev-parse', 'HEAD').decode().rstrip('\n'),
                  current_source_tree=git(root, 'rev-parse', 'HEAD^{tree}').decode().rstrip('\n'))
    if not args.handoff:
        require(not args.handoff_sha256, 'A handoff digest requires a retained handoff path.')
        return
    require(re.fullmatch('[0-9a-f]{64}', args.handoff_sha256), 'A retained handoff requires its exact SHA256.')
    pattern = os.path.expandvars(os.path.expanduser(args.handoff))
    paths = glob.glob(pattern)
    require(len(paths) <= 1, 'Retained handoff pattern matched multiple files.')
    result.update(status='miss', requested_handoff=args.handoff, requested_handoff_sha256=args.handoff_sha256)
    if not paths:
        result['reason'] = 'The retained handoff is unavailable on this runner.'
        return
    handoff_path = pathlib.Path(paths[0]).resolve()
    handoff, binding = handoff_binding(handoff_path, args.handoff_sha256)
    result['handoff_binding'] = binding
    require(handoff['schema'] == 'baton2-early-main-review-payload-v1'
            and handoff['main_build_completed'] is True and handoff['source_clean_at_seed'] is True,
            'Retained handoff does not record a completed clean Main build.')
    require(handoff['actual_main_success_marker'] == '.scratch/bend2/baton2', 'Unexpected Main completion marker.')
    origin = generated / 'main-c-origin'
    origin.mkdir()
    shutil.copyfile(handoff_path, origin / 'handoff.json')
    for key, name in (('source_seed_manifest', 'seed.json'),
                      ('build_stdout_as_of_boundary', 'build.stdout'),
                      ('build_stderr_as_of_boundary', 'build.stderr')):
        copy_record(handoff[key], origin / name)
    require(b'.scratch/bend2/baton2\n' in (origin / 'build.stdout').read_bytes().splitlines(keepends=True),
            'Retained build output lacks the completed Main marker.')
    seed = json.loads((origin / 'seed.json').read_text())
    require(seed['schema'] == 'baton2-early-main-source-seed-v1' and seed['source_clean'] is True
            and seed['source_commit'] == handoff['source_commit'] and seed['source_tree'] == handoff['source_tree'],
            'Retained source seed differs from the Main handoff.')
    copy_record(seed['file_manifest'], origin / 'seed-files.json')
    if handoff.get('origin_handoff'):
        copy_record(handoff['origin_handoff'], origin / 'original-handoff.json')
    if seed.get('original_seed_manifest'):
        copy_record(seed['original_seed_manifest'], origin / 'original-seed.json')
    if binding['kind'] == 'mapped-handoff':
        require(seed['original_seed_manifest']['sha256'] == binding['original_seed']['sha256'],
                'Mapped seed does not bind the original Main seed.')
        original_seed = json.loads((origin / 'original-seed.json').read_text())
        for key in ('source_commit', 'source_tree', 'source_clean', 'original_native'):
            require(seed[key] == original_seed[key], 'Mapped seed changes original compiler/source identity: ' + key)
        require(seed['file_manifest']['sha256'] == original_seed['file_manifest']['sha256'],
                'Mapped seed changes the original source/toolchain file manifest.')
    artifacts = []
    c_record = None
    for item in handoff['build_artifacts']:
        require(item['stable_during_copy'] is True, 'Retained Main artifact was unstable during copying.')
        verify_file(item['copy'])
        require(all(item['copy'][key] == item['original'][key] for key in ('sha256', 'size_bytes')),
                'Copied Main artifact differs from its original build.')
        artifacts.append(item)
        if pathlib.Path(item['copy']['path']).name == 'baton2.c':
            require(c_record is None, 'Multiple retained Main C artifacts.')
            c_record = item['copy']
    require(c_record is not None and len(artifacts) == 3 and {pathlib.Path(row['copy']['path']).name for row in artifacts}
            == {'baton2.c', 'baton2.o', 'baton2'}, 'Retained Main artifact set is incomplete.')
    save(origin / 'build-artifacts.json', artifacts)
    original = pathlib.Path(handoff['source']).resolve()
    old_rows = source_files(original, handoff['source_commit'], handoff['source_tree'])
    new_rows = source_files(root, result['current_source_commit'], result['current_source_tree'])
    old_inputs, old_issue = production_inputs(original, old_rows)
    new_inputs, new_issue = production_inputs(root, new_rows)
    save(origin / 'source-files.json', old_rows)
    save(origin / 'current-source-files.json', new_rows)
    save(origin / 'production-inputs.json', old_inputs)
    save(origin / 'current-production-inputs.json', new_inputs)
    old_compiler = verify_file(handoff['compiler'])
    old_archive = verify_file(handoff['compiler_archive'])
    old_base = verify_file(handoff['base'])
    require(old_base == old_compiler.parent.parent / 'bend2/base.bend', 'Retained Base path differs from compiler lookup.')
    old_distribution = distribution(old_archive, old_compiler.parent.parent)
    new_distribution = distribution(args.compiler_archive.resolve(), args.compiler.resolve().parent.parent)
    save(origin / 'toolchain-files.json', old_distribution)
    save(origin / 'current-toolchain-files.json', new_distribution)
    native = seed['original_native']
    command = native['cmdline'].split()
    require(command == [native['exe'], ENTRY, '-o', '.scratch/bend2/baton2.c'],
            'Retained compiler invocation differs from the Main build command.')
    require(native['environment'].get('BEND_NO_TELEMETRY') == '1', 'Retained compiler telemetry setting differs.')
    require(native['environment'].get('BUN_JSC_maxPerThreadStackUsage') == os.environ.get('BUN_JSC_maxPerThreadStackUsage'),
            'Current compiler stack setting differs from the retained invocation.')
    save(origin / 'compiler-invocation.json', {'original': native, 'current': {
        'entry': ENTRY, 'argv': [str(args.compiler.resolve()), ENTRY, '-o', '.scratch/bend2/baton2.c'],
        'cwd': str(root), 'BEND_NO_TELEMETRY': os.environ.get('BEND_NO_TELEMETRY'),
        'BUN_JSC_maxPerThreadStackUsage': os.environ.get('BUN_JSC_maxPerThreadStackUsage')}})
    host_change = canonical_host_change(old_inputs, new_inputs)
    if (old_issue or new_issue or (old_inputs != new_inputs and not host_change)
            or old_distribution != new_distribution):
        result['reason'] = old_issue or new_issue or 'Production inputs or compiler distribution differ.'
        result['origin_source_commit'] = handoff['source_commit']
        return
    if host_change:
        copy_record(c_record, origin / 'baton2.original.c')
        shutil.copyfile(original / HOST_SOURCE, origin / 'foreign-source-original.c')
        shutil.copyfile(root / HOST_SOURCE, origin / 'foreign-source-current.c')
        derived, substitution = substitute_host((origin / 'baton2.original.c').read_bytes(),
                                                (origin / 'foreign-source-original.c').read_bytes(),
                                                (origin / 'foreign-source-current.c').read_bytes())
        (origin / 'baton2.c').write_bytes(derived)
        (origin / 'foreign-source.patch').write_text(''.join(difflib.unified_diff(
            (origin / 'foreign-source-original.c').read_text().splitlines(keepends=True),
            (origin / 'foreign-source-current.c').read_text().splitlines(keepends=True),
            fromfile='original/' + HOST_SOURCE, tofile='current/' + HOST_SOURCE)))
        result['foreign_source_substitution'] = substitution
    else:
        copy_record(c_record, origin / 'baton2.c')
    archive = origin / 'source.tar.gz'
    with (origin / 'source-archive.stdout').open('wb') as stdout, (origin / 'source-archive.stderr').open('wb') as stderr:
        subprocess.run(['git', '-c', 'safe.directory=' + str(original), 'archive', '--format=tar.gz',
                        '--output=' + str(archive), handoff['source_commit']], cwd=original,
                       stdout=stdout, stderr=stderr, check=True)
    result.update(status='reused', origin_source_commit=handoff['source_commit'], origin_source_tree=handoff['source_tree'],
                  origin_handoff_sha256=binding['selected_sha256'], generated_c_sha256=digest(origin / 'baton2.c'),
                  generated_c_size=(origin / 'baton2.c').stat().st_size, root=str(root),
                  origin_assets=[{**fact(path), 'path': str(path.relative_to(generated))}
                                 for path in sorted(origin.rglob('*')) if path.is_file()])
    verify_production_transition(origin, result, new_inputs)
    proof = generated / 'main-c-reuse.json'
    save(proof, result)
    with args.github_env.open('a') as output:
        require('\n' not in str(root) and '\n' not in str(origin), 'Build paths contain a newline.')
        output.write('BATON2_MAIN_GENERATED_C=' + str(origin / 'baton2.c') + '\n')
        output.write('BATON2_MAIN_GENERATED_C_ROOT=' + str(root) + '\n')
        output.write('BATON2_MAIN_GENERATED_C_PROOF=' + str(proof) + '\n')
        output.write('BATON2_MAIN_GENERATED_C_PROOF_SHA256=' + digest(proof) + '\n')
        output.write('BATON2_MAIN_C_VERIFIER=' + str(root / '.github/scripts/reuse-native-main.py') + '\n')


def verify_transfer(args):
    generated = args.generated.resolve()
    result = json.loads((generated / 'main-c-reuse.json').read_text())
    require(result['schema'] == 'baton2-main-c-reuse-v1', 'Unknown Main C reuse proof.')
    if result['status'] != 'reused':
        require(result['status'] in ('miss', 'not-requested'), 'Main C reuse failed.')
        return result
    for row in result['origin_assets']:
        path = generated / row['path']
        require(path.resolve().is_relative_to(generated), 'Origin asset leaves generated C evidence.')
        verify_file({**row, 'path': str(path)})
    origin = generated / 'main-c-origin'
    require(digest(origin / 'handoff.json') == result['origin_handoff_sha256'], 'Origin handoff binding differs.')
    require(digest(generated / 'baton2.c') == result['generated_c_sha256']
            and (generated / 'baton2.c').stat().st_size == result['generated_c_size'], 'Reused Main C differs.')
    rows = source_files(args.source.resolve(), result['current_source_commit'], result['current_source_tree'])
    require(rows == json.loads((origin / 'current-source-files.json').read_text()), 'Current full source differs from reuse proof.')
    current, issue = production_inputs(args.source.resolve(), rows)
    require(issue is None, 'Main production import scope differs.')
    verify_production_transition(origin, result, current)
    require(json.loads((origin / 'toolchain-files.json').read_text())
            == json.loads((origin / 'current-toolchain-files.json').read_text()), 'Main toolchain distributions differ.')
    expected = {row['path']: row for row in json.loads((origin / 'source-files.json').read_text())}
    seen = set()
    with tarfile.open(origin / 'source.tar.gz', 'r:gz') as archive:
        for member in archive:
            if member.isdir() or member.type == tarfile.XGLTYPE:
                continue
            require(member.name in expected and member.name not in seen, 'Unexpected origin source archive entry.')
            seen.add(member.name)
            row = expected[member.name]
            if row['mode'] == '120000':
                require(member.issym(), 'Origin source archive link changed.')
                body = member.linkname.encode()
                sha = hashlib.sha256(body).hexdigest()
                size = len(body)
            else:
                require(member.isfile() and bool(member.mode & 0o111) == (row['mode'] == '100755'),
                        'Origin source archive type or mode changed.')
                with archive.extractfile(member) as stream:
                    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
                size = member.size
            require(sha == row['sha256'] and size == row['size_bytes'], 'Origin source archive bytes differ.')
    require(seen == set(expected), 'Origin source archive is incomplete.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    prepare_parser = modes.add_parser('prepare')
    prepare_parser.add_argument('--source', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--run', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--handoff', default='')
    prepare_parser.add_argument('--handoff-sha256', default='')
    prepare_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--compiler-archive', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--github-env', type=pathlib.Path, required=True)
    verify_parser = modes.add_parser('verify-transfer')
    verify_parser.add_argument('--source', type=pathlib.Path, required=True)
    verify_parser.add_argument('--generated', type=pathlib.Path, required=True)
    select_parser = modes.add_parser('select')
    select_parser.add_argument('--source', type=pathlib.Path, required=True)
    select_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    select_parser.add_argument('--proof', type=pathlib.Path, required=True)
    select_parser.add_argument('--proof-sha256', required=True)
    select_parser.add_argument('--bound-root', required=True)
    select_parser.add_argument('--generated-c', type=pathlib.Path, required=True)
    select_parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.mode == 'verify-transfer':
        print(json.dumps(verify_transfer(args)))
        return
    if args.mode == 'select':
        result = {'pid': os.getpid(), 'observed_at_ns': time.time_ns(), 'output': str(args.output.resolve())}
        try:
            select(args, result)
        except BaseException:
            result.update(status='error', error=traceback.format_exc())
            raise
        finally:
            save(args.output, result)
            retained = args.proof.parent / 'main-c-builds'
            retained.mkdir(exist_ok=True)
            record = retained / (str(result['observed_at_ns']) + '-' + str(os.getpid()) + '.json')
            save(record, result)
            summary = {key: value for key, value in result.items()
                       if key not in ('production_inputs', 'compiler_distribution')}
            summary['record'] = fact(args.output)
            summary['retained_record'] = fact(record)
            print(json.dumps(summary), file=sys.stderr)
        if result['status'] == 'reused':
            print(args.generated_c.resolve())
        return
    result = {}
    try:
        prepare(args, result)
    except BaseException:
        result.update(schema='baton2-main-c-reuse-v1', status='error', error=traceback.format_exc())
        raise
    finally:
        for directory in ('evidence', 'generated'):
            path = args.run.resolve() / directory
            path.mkdir(parents=True, exist_ok=True)
            save(path / 'main-c-reuse.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
