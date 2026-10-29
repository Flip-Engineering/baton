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
    'f46d75d3cb3a68c68bdcfaeb5dfe465e06343b47d6376949fd862510a82781d3': {
        'name': 'Bend 2.0.25 with String lowering, checked-body sharing and compiler worker reuse',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
        'bun_sha256': '10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235',
        'source_commit': '018855661c0240fd3df7b7235ce35ea9b465ab0d',
        'source_tree': '65018fc29356d9b6731b4142f23e5c69b43a32c4',
        'source_lock_sha256': 'b7a78d737db755c0f060cee481c65736a589b83c61110fafee227b2b5254619d',
        'source_manifest_sha256': '0d8aace71896212c7c60a6867d95b05051fae74582eaeb5a809f6baf3deee715',
        'source_metadata_sha256': '3207a6bd1b2a857a48cb30c3112a0bdc1e80286ec3bc4a45917e47366e417660',
        'source_input_count': 84,
    },
    '5bc55753ac04af350312c2f9fb298a7a674bd5bc8dfe14342bc60566d7aa76f3': {
        'name': 'Bend 2.0.25 with emitted C unit cache and constructor shadow handling',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'b096466b3b849234d3393ba9c726f78121f31762dc4e5379fe886e9b61b75590': {
        'name': 'Bend 2.0.25 with header-read unit identities, worker reuse and checked-store cleanup',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
        'bun_sha256': '10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235',
        'source_commit': 'acaae6ef6c0348751a38634223f3946fa6a874b2',
        'source_tree': 'b906600c4cf4d741fa881e6fe506329a3cba3149',
        'source_lock_sha256': '477af3f2ef97c6a8f70864ea8ada1f8bc8dd4ff8a95ebda2269215e99d59f603',
        'source_manifest_sha256': 'e2a0a259c2e3c58b3b964ebeb165ca89b1896dc8df73e3518adf0c12b6a881aa',
        'source_metadata_sha256': 'ee9326dd6e59e37cbfe9ebc4d5829b4737196d38de38f1d453f702fcee13f948',
        'source_input_count': 84,
    },
    '2b272454ec56a3d47f6957d8ad28da7d946dce470747e8bde5d5ff274c48e957': {
        'name': 'Bend 2.0.25 with compiler worker reuse and checked-store cleanup',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
        'bun_sha256': '10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235',
        'source_commit': '4d8a487d5a9471154cc6a2e530560419ad29d285',
        'source_tree': '8a7ba06a3f97bb5367731cba6f478e7c8bd85a02',
        'source_lock_sha256': '9409738c6e4274ee544b27780a28e3bdbed8ea83215db62126e7fa27657591bc',
        'source_manifest_sha256': 'df9a900c3d286206ec5d99a7d94fe9f744e75f80732bf0af9cc16d47f34c38e0',
        'source_metadata_sha256': 'b4faea6aa40243f14e0890ee2244f9c597b28a1f62b6e417499f4e3ccbc28c9c',
        'source_input_count': 84,
    },
    '113a272649904e80144b1954dba8b4999249efa408a6ce1ca346906114986c4d': {
        'name': 'Bend 2.0.25 with measured unit processes and checked-store cleanup',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '2b2b41e938355141b55d617ee38157d50f62597c197e1b772486a7e517451065': {
        'name': 'Bend 2.0.25 with shared arm, use and application summaries',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    'bf7c9a9b0a94354a107b110f5f5e37cae6c3a02a6e209455ba8ec10506b41796': {
        'name': 'Bend 2.0.25 with total fallback coverage for literal list helpers',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '1554306bde85194bf1271ba8048d8e752a4cba81d2a3d3213282923ece91a965': {
        'name': 'Bend 2.0.25 with compiler heap, fact and helper emission diagnostics',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '1531397e083ae39bcd0e7955fcd54ff4c47c4f214a765fbd4fa15fce536eed58': {
        'name': 'Bend 2.0.25 with facts-only generic units and spins specialized by erased types',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
    '8e46a9e6adeac20cf8c332a943c3e1c9243c11a7b0d3b75a6a5d3a90252d6cbf': {
        'name': 'Bend 2.0.25 with reachable incremental emission and shared literal row continuations',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
    },
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
    '3f0c31436e3f39e3ffc581496de34ef5077faf5dd0b106438de0049f0e7e8f75': {
        'name': 'Bend 2.0.25 compiler main with literal-prefix lowering, the restored 1 << 20 CID ceiling, 20-bit FID capacity, strong CID value reach, List collection and Metal term-tag decode',
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
    '2b2b41e938355141b55d617ee38157d50f62597c197e1b772486a7e517451065': {
        'name': 'Bend 2.0.25 compiler with shared arms',
        'official_release_artifact': False,
        'binary_sha256': '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e',
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
    # Select the transitive import closure of the Main entry, not the whole
    # source directory. A file outside the closure cannot reach the generated
    # C: module imports are static relative paths, foreign inputs are static
    # string imports, and Base comes from the compiler distribution, which is
    # bound separately. Any import shape outside this model fails closed to a
    # normal compilation, and the closure is recomputed from the current
    # bytes on both sides, so a change that imports a previously unrelated
    # file pulls that file into the compared set.
    by_path = {row['path']: row for row in rows}
    if len(by_path) != len(rows):
        return [], 'A production path is recorded twice.'
    selected = {}
    pending = [ENTRY]
    while pending:
        relative = pending.pop()
        if relative in selected:
            continue
        row = by_path.get(relative)
        if row is None:
            return [], 'A production dependency is not tracked: ' + relative
        if row['mode'] == '120000':
            return [], 'A production symlink requires a normal compilation.'
        selected[relative] = row
        path = root / relative
        if not relative.endswith('.bend'):
            if relative.endswith(('.c', '.h')):
                # A quoted C include is a tracked production input exactly
                # like a Bend foreign import: the generated C is compiled
                # with this header through bend2/src/host, so its bytes
                # belong to the reuse identity (persistent-path.h in
                # host/control.c and host/process-spawn.c).
                for match in re.finditer(r'#\s*include\s+"([^"]+)"', path.read_text()):
                    child = os.path.normpath(os.path.join(os.path.dirname(relative), match[1]))
                    if child not in ('bend2/src',) and not child.startswith('bend2/src/'):
                        return [], 'A C include leaves the production inputs: ' + relative
                    pending.append(child)
            continue
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
                    return [], 'A module import requires a normal compilation: ' + relative
                child = os.path.normpath(os.path.join(os.path.dirname(relative), match[1]))
                if not (child.startswith('bend2/src/') and child.endswith('.bend')):
                    return [], 'A module import leaves the production directory: ' + relative
                pending.append(child)
                continue
            in_header = False
            for match in re.finditer(r'\bimport\s+"([^"]+)"', line):
                child = os.path.normpath(os.path.join(os.path.dirname(relative), match[1]))
                if not child.startswith('bend2/src/'):
                    return [], 'A foreign import leaves the production inputs: ' + relative
                pending.append(child)
    return sorted(selected.values(), key=lambda row: row['path']), None


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
    archive_sha = digest(archive)
    require(archive_sha in COMPILER_ARCHIVES, 'Compiler archive differs from the pinned distributions.')
    identity = COMPILER_ARCHIVES[archive_sha]
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
    if 'source_commit' in identity:
        manifest_path = home / 'fork-manifest.json'
        source_path = home / 'provenance/source.json'
        validation_path = home / 'provenance/validation.json'
        require(digest(manifest_path) == identity['source_manifest_sha256'],
                'Retained compiler source manifest differs from its registered SHA256.')
        manifest = json.loads(manifest_path.read_text())
        source = json.loads(source_path.read_text())
        validation = json.loads(validation_path.read_text())
        require(manifest.get('source_commit') == identity['source_commit']
                and manifest.get('source_tree') == identity['source_tree']
                and manifest.get('source_lock_sha256') == identity['source_lock_sha256'],
                'Retained compiler manifest source identity differs from its registry entry.')
        require(source.get('source_commit') == identity['source_commit']
                and source.get('source_tree') == identity['source_tree']
                and source.get('lock_sha256') == identity['source_lock_sha256']
                and source.get('input_count') == identity['source_input_count']
                and digest(source_path) == identity['source_metadata_sha256'],
                'Retained compiler source metadata differs from its registry entry.')
        require(validation.get('status') == 'not_run'
                and validation.get('source_commit') == identity['source_commit']
                and validation.get('source_tree') == identity['source_tree'],
                'Retained compiler validation metadata does not identify unrun current source.')
        lock_path = home / source['lock_path']
        require(digest(lock_path) == identity['source_lock_sha256'],
                'Retained compiler source lock differs from its registered SHA256.')
        lock = json.loads(lock_path.read_text())
        require(manifest.get('source_files') == lock.get('files'),
                'Retained compiler source manifest differs from its lock.')
        for row in manifest['source_files']:
            path = home / 'bend2' / row['path']
            require(path.is_file() and path.stat().st_size == row['bytes']
                    and digest(path) == row['sha256'],
                    'Retained compiler source file differs from its manifest: ' + row['path'])
    return [expected[key] for key in sorted(expected)]


def copy_record(row, destination):
    shutil.copyfile(verify_file(row), destination)


def queue_fields(path):
    fields = {}
    rows = []
    for line in pathlib.Path(path).read_text().splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key == 'artifact':
            rows.append(value)
        else:
            fields.setdefault(key, []).append(value)
    fields['artifact'] = rows
    return fields


def queue_one(fields, key):
    values = fields.get(key, [])
    require(len(values) == 1, 'Queue evidence must contain exactly one ' + key + ' field.')
    return values[0]


def queue_effective(fields, key):
    values = fields.get(key, [])
    require(bool(values) and bool(values[-1].strip()),
            'Queue identity configuration must contain a non-empty effective ' + key + ' field.')
    return values[-1]


def queue_compiler_identity(argv_path, config_compiler, diagnostics):
    arguments = pathlib.Path(argv_path).read_bytes().split(b'\0')
    if arguments and arguments[-1] == b'':
        arguments.pop()
    require(len(arguments) >= 4
            and pathlib.Path(os.fsdecode(arguments[1])).name == 'compile-cgen-exec.py',
            'Completed Cgen argv does not record the queue compiler command.')
    requested_path = os.fsdecode(arguments[3])
    require(requested_path == config_compiler,
            'Queue identity configuration compiler differs from the original Cgen command.')
    compiler_argv = diagnostics.get('compiler_argv')
    compiler = diagnostics.get('toolchain', {}).get('compiler', {})
    observed_argv_path = compiler_argv[0] if isinstance(compiler_argv, list) and compiler_argv else ''
    observed_path = compiler.get('path', '')
    require(pathlib.Path(requested_path).is_absolute()
            and pathlib.Path(observed_argv_path).is_absolute()
            and pathlib.Path(observed_path).is_absolute()
            and pathlib.Path(observed_argv_path).name == pathlib.Path(observed_path).name == 'bend'
            and re.fullmatch('[0-9a-f]{64}', compiler.get('sha256', '')),
            'Completed Cgen compiler paths or content identity are incomplete.')
    return {'queue_command_path': requested_path,
            'diagnostic_command_path': observed_argv_path,
            'diagnostic_resolved_path': observed_path,
            'sha256': compiler['sha256'],
            'paths_match': requested_path == observed_path}


def queue_source_digest(root, entry):
    """Reproduce CompileQueueIdentity.source_digest for a Cgen entry."""
    root = root.resolve()
    entry_path = (root / entry).resolve()
    require(entry_path.is_relative_to(root), 'Queue source entry leaves the selected source root.')
    records = {}
    pending = [entry_path]
    while pending:
        path = pending.pop(0).resolve()
        require(path.is_relative_to(root), 'Queue source dependency leaves the selected source root.')
        relative = path.relative_to(root).as_posix()
        if relative in records:
            continue
        require(path.is_file() and not path.is_symlink(), 'Queue source dependency is not a regular file: ' + relative)
        body = path.read_bytes()
        records[relative] = (hashlib.sha256(body).hexdigest(), len(body))
        targets = []
        if path.suffix.lower() == '.bend':
            for line in body.decode('utf-8').splitlines():
                trimmed = line.lstrip()
                if not trimmed.startswith('import '):
                    continue
                value = trimmed[7:]
                if value.startswith('"'):
                    quoted = value.split('"')
                    target = quoted[1] if len(quoted) > 1 else ''
                else:
                    tokens = value.split()
                    target = tokens[0] if tokens else ''
                if target != 'Base':
                    targets.append(target)
        elif path.suffix.lower() in ('.c', '.h'):
            text = body.decode('utf-8')
            prefix, mode, matched, target = '#include "', 0, 0, ''
            for char in text:
                newline = char == '\n'
                if mode == 2:
                    if char == '"' or newline:
                        if target:
                            targets.append(target)
                        mode, matched, target = (0 if newline else 3), 0, ''
                    else:
                        target += char
                elif newline:
                    mode, matched, target = 0, 0, ''
                elif mode == 3:
                    continue
                elif mode == 0 and char.isspace():
                    continue
                elif char == prefix[matched]:
                    mode = 2 if matched == len(prefix) - 1 else 1
                    matched += 1
                else:
                    mode, matched = 3, 0
            if mode == 2 and target:
                targets.append(target)
        for target in targets:
            child = pathlib.Path(target) if target.startswith('/') else path.parent / target
            pending.append(child)
    entry_relative = entry_path.relative_to(root).as_posix()
    text = 'schema=baton-compile-queue-source-v2\nsource-entry=' + entry_relative + '\n'
    text += ''.join('source-file={}\t{}\t{}\n'.format(path, *records[path]) for path in sorted(records))
    return hashlib.sha256(text.encode()).hexdigest(), records


def prepare_cgen(args, result, root, generated):
    require(not args.handoff and not args.handoff_sha256,
            'A completed queue Cgen key and a full Main handoff are separate inputs.')
    require(re.fullmatch('[0-9a-f]{64}', args.cgen_key), 'A completed Cgen input requires its exact 64-character key.')
    queue_root = args.queue_root.resolve()
    keydir = queue_root / 'keys' / args.cgen_key
    completed = keydir / 'completed'
    evidence_paths = {
        'result': completed / 'result',
    }
    require(evidence_paths['result'].is_file() and not evidence_paths['result'].is_symlink(),
            'Completed queue result is unavailable.')
    result_fields = queue_fields(evidence_paths['result'])
    require(queue_one(result_fields, 'schema') == 'baton-compile-queue-result-v2'
            and queue_one(result_fields, 'identity_schema') == 'baton-compile-queue-identity-v2'
            and queue_one(result_fields, 'kind') == 'cgen'
            and queue_one(result_fields, 'key') == args.cgen_key
            and queue_one(result_fields, 'verified') == '1'
            and queue_one(result_fields, 'external') == '0'
            and queue_one(result_fields, 'status') == 'completed'
            and queue_one(result_fields, 'exit') == '0',
            'Queue result is not a completed verified native Cgen result for the requested key.')
    attempt_value = queue_one(result_fields, 'attempt')
    attempt = pathlib.Path(attempt_value).resolve()
    require(attempt.is_relative_to(keydir.resolve()) and attempt.is_dir(),
            'Queue result attempt does not belong to the requested key directory.')
    for name in ('meta', 'identity-config', 'command', 'argv', 'source-digest', 'compiler-diagnostics.json'):
        evidence_paths[name] = attempt / name
        require(evidence_paths[name].is_file() and not evidence_paths[name].is_symlink(),
                'Queue attempt evidence is missing: ' + name)
    meta = queue_fields(evidence_paths['meta'])
    config = queue_fields(evidence_paths['identity-config'])
    require(queue_one(meta, 'kind') == 'cgen' and queue_one(meta, 'key') == args.cgen_key
            and queue_one(meta, 'entry') == ENTRY and queue_one(meta, 'artifact_name') == 'output.c',
            'Queue metadata does not bind the requested Main Cgen input.')
    config_kind = queue_effective(config, 'kind')
    config_entry = queue_effective(config, 'entry')
    config_source_root = queue_effective(config, 'source_root')
    config_compiler = queue_effective(config, 'compiler')
    require(config_kind == 'cgen' and config_entry == ENTRY,
            'Queue identity configuration does not bind the Main Cgen entry.')
    require(pathlib.Path(queue_one(meta, 'source_root')).is_absolute()
            and pathlib.Path(config_source_root).is_absolute()
            and config_source_root == queue_one(meta, 'source_root'),
            'Queue source roots differ between identity configuration and attempt metadata.')
    require(pathlib.Path(config_compiler).is_absolute(),
            'Queue identity configuration compiler path is not absolute.')
    digest_value = queue_one(queue_fields(evidence_paths['source-digest']), 'digest')
    actual_source_digest, closure = queue_source_digest(root, ENTRY)
    require(digest_value == actual_source_digest, 'Completed Cgen source dependency closure differs from this checkout.')
    diagnostic_path = evidence_paths['compiler-diagnostics.json']
    diagnostics = json.loads(diagnostic_path.read_text())
    require(diagnostics.get('schema') == 'baton2-compiler-execution-observation-v1',
            'Queue compiler diagnostics schema differs.')
    queue_attempt = diagnostics.get('queue_attempt', {})
    for name in ('meta', 'argv', 'command'):
        require(queue_attempt.get(name + '_sha256') == digest(evidence_paths[name]),
                'Compiler diagnostics do not bind queue attempt ' + name + '.')
    require(queue_attempt.get('meta', {}).get('key') == args.cgen_key
            and queue_attempt.get('meta', {}).get('kind') == 'cgen'
            and queue_attempt.get('meta', {}).get('entry') == ENTRY
            and queue_attempt.get('source_digest') == 'digest=' + actual_source_digest,
            'Compiler diagnostics do not bind the requested Cgen key and source closure.')
    toolchain = diagnostics.get('toolchain', {})
    compiler_id = toolchain.get('compiler', {})
    runtime_id = toolchain.get('runtime', {})
    manifest_id = toolchain.get('manifest', {})
    compiler_identity = queue_compiler_identity(evidence_paths['argv'], config_compiler, diagnostics)
    compiler = args.compiler.resolve()
    compiler_home = compiler.parent.parent
    manifest_path = compiler_home / 'fork-manifest.json'
    runtime = compiler_home / 'bin/bun'
    require(manifest_path.is_file() and runtime.is_file(), 'Selected compiler distribution lacks its runtime manifest or runtime.')
    require(compiler_id.get('sha256') == digest(compiler)
            and runtime_id.get('sha256') == digest(runtime)
            and manifest_id.get('sha256') == digest(manifest_path),
            'Completed Cgen compiler diagnostics differ from the selected compiler distribution.')
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get('compiler', {}).get('sha256') == compiler_id['sha256']
            and manifest.get('bun', {}).get('sha256') == runtime_id['sha256'],
            'Selected compiler manifest does not bind the Cgen compiler and runtime.')
    current_distribution = distribution(args.compiler_archive.resolve(), compiler_home)
    result_artifacts = queue_one(result_fields, 'artifact').split('\t')
    require(len(result_artifacts) == 3 and result_artifacts[:2] == ['output.c', 'file']
            and re.fullmatch('[0-9a-f]{64}', result_artifacts[2]),
            'Completed Cgen result artifact set differs from output.c.')
    artifact = completed / 'artifacts/output.c'
    require(artifact.is_file() and not artifact.is_symlink()
            and artifact.resolve().is_relative_to(completed.resolve())
            and digest(artifact) == result_artifacts[2], 'Completed Cgen artifact bytes differ from the queue result.')
    origin = generated / 'main-c-origin'
    origin.mkdir()
    for name, path in evidence_paths.items():
        shutil.copyfile(path, origin / ('cgen-' + name))
    shutil.copyfile(artifact, origin / 'baton2.c')
    rows = source_files(root, result['current_source_commit'], result['current_source_tree'])
    inputs, issue = production_inputs(root, rows)
    require(issue is None, issue or 'Main production closure could not be verified.')
    queue_rows = [{'path': path, 'sha256': value[0], 'size_bytes': value[1]} for path, value in sorted(closure.items())]
    save(origin / 'source-files.json', rows)
    save(origin / 'current-source-files.json', rows)
    save(origin / 'production-inputs.json', inputs)
    save(origin / 'current-production-inputs.json', inputs)
    save(origin / 'queue-source-closure.json', queue_rows)
    save(origin / 'toolchain-files.json', current_distribution)
    save(origin / 'current-toolchain-files.json', current_distribution)
    shutil.copyfile(manifest_path, origin / 'compiler-manifest.json')
    archive = origin / 'source.tar.gz'
    subprocess.run(['git', '-c', 'safe.directory=' + str(root), 'archive', '--format=tar.gz',
                    '--output=' + str(archive), result['current_source_commit']], cwd=root, check=True)
    result.update(status='reused', origin_kind='completed-queue-cgen', origin_cgen_key=args.cgen_key,
                  origin_cgen_result_sha256=digest(origin / 'cgen-result'),
                  origin_cgen_artifact_sha256=digest(origin / 'baton2.c'),
                  origin_cgen_source_digest=actual_source_digest,
                  origin_cgen_source_closure=queue_rows,
                  origin_cgen_source_root=queue_one(meta, 'source_root'),
                  origin_cgen_meta_sha256=digest(origin / 'cgen-meta'),
                  origin_compiler_manifest_sha256=digest(origin / 'compiler-manifest.json'),
                  origin_compiler_archive_sha256=digest(args.compiler_archive.resolve()),
                  origin_compiler_identity=compiler_identity,
                  generated_c_sha256=digest(origin / 'baton2.c'), generated_c_size=(origin / 'baton2.c').stat().st_size,
                  root=str(root), origin_assets=[{**fact(path), 'path': str(path.relative_to(generated))}
                                                for path in sorted(origin.rglob('*')) if path.is_file()])
    proof = generated / 'main-c-reuse.json'
    save(proof, result)
    with args.github_env.open('a') as output:
        for name, value in (
            ('BATON2_MAIN_GENERATED_C', origin / 'baton2.c'), ('BATON2_MAIN_GENERATED_C_ROOT', root),
            ('BATON2_MAIN_GENERATED_C_PROOF', proof),
            ('BATON2_MAIN_GENERATED_C_PROOF_SHA256', digest(proof)),
            ('BATON2_MAIN_C_VERIFIER', root / '.github/scripts/reuse-native-main.py')):
            text = str(value)
            require('\n' not in text, 'Build paths contain a newline.')
            output.write(name + '=' + text + '\n')


def verify_cgen_origin(origin, proof):
    result_fields = queue_fields(origin / 'cgen-result')
    require(queue_one(result_fields, 'schema') == 'baton-compile-queue-result-v2'
            and queue_one(result_fields, 'identity_schema') == 'baton-compile-queue-identity-v2'
            and queue_one(result_fields, 'kind') == 'cgen'
            and queue_one(result_fields, 'key') == proof['origin_cgen_key']
            and queue_one(result_fields, 'verified') == '1'
            and queue_one(result_fields, 'external') == '0'
            and queue_one(result_fields, 'status') == 'completed'
            and queue_one(result_fields, 'exit') == '0',
            'Retained queue result no longer verifies the completed Cgen key.')
    artifact = queue_one(result_fields, 'artifact').split('\t')
    require(len(artifact) == 3 and artifact[:2] == ['output.c', 'file']
            and artifact[2] == proof['origin_cgen_artifact_sha256'],
            'Retained queue result artifact binding differs from the Cgen proof.')
    meta = queue_fields(origin / 'cgen-meta')
    config = queue_fields(origin / 'cgen-identity-config')
    require(queue_one(meta, 'kind') == 'cgen' and queue_one(meta, 'key') == proof['origin_cgen_key']
            and queue_one(meta, 'entry') == ENTRY and queue_one(meta, 'artifact_name') == 'output.c'
            and queue_one(meta, 'source_root') == proof['origin_cgen_source_root'],
            'Retained queue metadata differs from the Cgen proof.')
    config_kind = queue_effective(config, 'kind')
    config_entry = queue_effective(config, 'entry')
    config_source_root = queue_effective(config, 'source_root')
    config_compiler = queue_effective(config, 'compiler')
    require(config_kind == 'cgen' and config_entry == ENTRY
            and config_source_root == proof['origin_cgen_source_root'],
            'Retained queue identity configuration differs from the Cgen proof.')
    require(pathlib.Path(config_compiler).is_absolute(),
            'Retained identity configuration compiler path is not absolute.')
    source_digest = queue_one(queue_fields(origin / 'cgen-source-digest'), 'digest')
    require(source_digest == proof['origin_cgen_source_digest'], 'Retained queue source digest differs.')
    diagnostics = json.loads((origin / 'cgen-compiler-diagnostics.json').read_text())
    queue_attempt = diagnostics.get('queue_attempt', {})
    for name in ('meta', 'argv', 'command'):
        require(queue_attempt.get(name + '_sha256') == digest(origin / ('cgen-' + name)),
                'Retained compiler diagnostics do not bind queue attempt ' + name + '.')
    require(queue_attempt.get('meta', {}).get('key') == proof['origin_cgen_key']
            and queue_attempt.get('source_digest') == 'digest=' + proof['origin_cgen_source_digest'],
            'Retained compiler diagnostics differ from the Cgen source identity.')
    toolchain = diagnostics.get('toolchain', {})
    require(queue_compiler_identity(origin / 'cgen-argv', config_compiler, diagnostics)
            == proof.get('origin_compiler_identity'),
            'Retained Cgen compiler paths or content identity differ from the reuse proof.')
    manifest = json.loads((origin / 'compiler-manifest.json').read_text())
    require(toolchain.get('compiler', {}).get('sha256') == manifest.get('compiler', {}).get('sha256')
            and toolchain.get('runtime', {}).get('sha256') == manifest.get('bun', {}).get('sha256')
            and toolchain.get('manifest', {}).get('sha256') == proof['origin_compiler_manifest_sha256'],
            'Retained compiler diagnostics differ from the compiler manifest.')


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
            body = os.fsencode(os.readlink(path))
            rows.append({'path': str(path.relative_to(root)), 'mode': '120000',
                         'git_blob': hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest(),
                         'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
        elif path.is_file():
            body = path.read_bytes()
            rows.append({'path': str(path.relative_to(root)),
                         'mode': '100755' if path.stat().st_mode & 0o111 else '100644',
                         'git_blob': hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest(),
                         'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    # Select through the same entry-closure function that prepared the
    # proof: the manifest records the closure rows, so this side compares
    # the closure it recomputes from the actual checkout bytes against
    # that manifest. Files outside the closure do not select or reject
    # reuse; a changed file inside the closure changes its row.
    rows, issue = production_inputs(root, rows)
    result['production_inputs'] = rows
    if issue is not None:
        result['reason'] = issue
        return
    if rows != expected:
        result['reason'] = 'Actual Main production input membership, bytes or modes differ.'
        return
    verify_production_transition(origin, proof, rows)
    compiler = args.compiler.resolve()
    if proof.get('origin_kind') == 'completed-queue-cgen':
        queue_digest, closure = queue_source_digest(root, ENTRY)
        queue_rows = [{'path': path, 'sha256': value[0], 'size_bytes': value[1]}
                      for path, value in sorted(closure.items())]
        require(queue_digest == proof['origin_cgen_source_digest']
                and queue_rows == proof['origin_cgen_source_closure'],
                'Completed Cgen source dependency closure differs from the selected checkout.')
        require(digest(origin / 'cgen-result') == proof['origin_cgen_result_sha256']
                and digest(origin / 'baton2.c') == proof['origin_cgen_artifact_sha256'],
                'Completed queue Cgen result or artifact differs from its proof.')
        require(digest(origin / 'cgen-meta') == proof['origin_cgen_meta_sha256'],
                'Completed queue Cgen metadata differs from its proof.')
        verify_cgen_origin(origin, proof)
        require(digest(origin / 'compiler-manifest.json') == proof['origin_compiler_manifest_sha256'],
                'Completed Cgen compiler manifest differs from its proof.')
        require(args.compiler_archive is not None
                and digest(args.compiler_archive.resolve()) == proof['origin_compiler_archive_sha256'],
                'Selected compiler archive differs from the completed Cgen compiler archive.')
        selected_distribution = distribution(args.compiler_archive.resolve(), compiler.parent.parent)
        require(selected_distribution == json.loads((origin / 'toolchain-files.json').read_text()),
                'Selected compiler archive distribution differs from the completed Cgen compiler distribution.')
    require(compiler.name == 'bend' and compiler.parent.name == 'bin', 'Unexpected selected compiler layout.')
    actual, matches = directory_files(compiler.parent.parent, json.loads((origin / 'toolchain-files.json').read_text()))
    result.update(compiler=fact(compiler), compiler_distribution=actual)
    if not matches:
        result['reason'] = 'The selected compiler distribution differs from the verified Main compiler.'
        return
    result.update(status='reused', generated_c_sha256=proof['generated_c_sha256'],
                  proof_sha256=args.proof_sha256,
                  origin_source_commit=proof.get('origin_source_commit', proof['current_source_commit']),
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
    if args.cgen_key:
        prepare_cgen(args, result, root, generated)
        return
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
    if result.get('origin_kind') == 'completed-queue-cgen':
        require(digest(origin / 'cgen-result') == result['origin_cgen_result_sha256']
                and digest(origin / 'baton2.c') == result['origin_cgen_artifact_sha256'],
                'Transferred completed queue Cgen evidence differs.')
        require(digest(origin / 'compiler-manifest.json') == result['origin_compiler_manifest_sha256'],
                'Transferred completed Cgen compiler manifest differs.')
        require(digest(origin / 'cgen-meta') == result['origin_cgen_meta_sha256'],
                'Transferred completed Cgen metadata differs.')
        verify_cgen_origin(origin, result)
    else:
        require(digest(origin / 'handoff.json') == result['origin_handoff_sha256'], 'Origin handoff binding differs.')
    require(digest(generated / 'baton2.c') == result['generated_c_sha256']
            and (generated / 'baton2.c').stat().st_size == result['generated_c_size'], 'Reused Main C differs.')
    rows = source_files(args.source.resolve(), result['current_source_commit'], result['current_source_tree'])
    require(rows == json.loads((origin / 'current-source-files.json').read_text()), 'Current full source differs from reuse proof.')
    current, issue = production_inputs(args.source.resolve(), rows)
    require(issue is None, 'Main production import scope differs.')
    verify_production_transition(origin, result, current)
    if result.get('origin_kind') == 'completed-queue-cgen':
        queue_digest, closure = queue_source_digest(args.source.resolve(), ENTRY)
        queue_rows = [{'path': path, 'sha256': value[0], 'size_bytes': value[1]}
                      for path, value in sorted(closure.items())]
        require(queue_digest == result['origin_cgen_source_digest']
                and queue_rows == result['origin_cgen_source_closure'],
                'Transferred Cgen source dependency closure differs from the selected source.')
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
    prepare_parser.add_argument('--cgen-key', default='')
    prepare_parser.add_argument('--queue-root', type=pathlib.Path, default=pathlib.Path('/var/tmp/baton2-compile-queue'))
    prepare_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--compiler-archive', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--github-env', type=pathlib.Path, required=True)
    verify_parser = modes.add_parser('verify-transfer')
    verify_parser.add_argument('--source', type=pathlib.Path, required=True)
    verify_parser.add_argument('--generated', type=pathlib.Path, required=True)
    select_parser = modes.add_parser('select')
    select_parser.add_argument('--source', type=pathlib.Path, required=True)
    select_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    select_parser.add_argument('--compiler-archive', type=pathlib.Path)
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
