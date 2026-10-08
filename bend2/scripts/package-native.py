#!/usr/bin/env python3
"""Build and package the Darwin arm64 native artifact."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import tarfile
import time


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = 'baton2-development-darwin-arm64'
COMPILER_ARCHIVE_SHA256 = 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31'
COMPILER_ARCHIVE_URL = 'https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz'
COMPILER_LICENSE_URL = 'https://raw.githubusercontent.com/bendlang/bend/v2.0.25/LICENSE'
COMPILER_LICENSE_SHA256 = '0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def file_info(path):
    return {'bytes': path.stat().st_size, 'sha256': sha256(path)}


def module_directory_name(module_id):
    require(isinstance(module_id, str) and module_id, 'A selected module needs a non-empty identity')
    try:
        encoded = module_id.encode('utf-8').hex()
    except UnicodeEncodeError as error:
        raise RuntimeError('A selected module identity is not valid Unicode') from error
    return 'm-' + encoded


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def source_identity():
    return {'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
            'bend2_tree': git('rev-parse', 'HEAD:bend2'), 'status': git('status', '--porcelain=v1')}


def build(env, directory):
    argv = ['sh', 'bend2/scripts/build-native.sh']
    stdout = directory / 'build.stdout'
    stderr = directory / 'build.stderr'
    started = time.monotonic()
    with stdout.open('wb') as out, stderr.open('wb') as err:
        result = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err)
    record = {'argv': argv, 'cwd': str(ROOT), 'exit_code': result.returncode,
              'elapsed_seconds': time.monotonic() - started,
              'stdout': {'path': str(stdout.relative_to(directory)), **file_info(stdout)},
              'stderr': {'path': str(stderr.relative_to(directory)), **file_info(stderr)}}
    write_json(directory / 'build.json', record)
    require(result.returncode == 0, 'Native build failed; full output is retained in ' + str(directory))
    return record


def archive_notices(archive):
    require(sha256(archive) == COMPILER_ARCHIVE_SHA256,
            'Compiler archive does not match the upstream Bend 2.0.25 pin')
    notices = []
    with tarfile.open(archive, 'r:gz') as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts,
                    'Unsafe compiler archive member: ' + member.name)
            if member.isfile():
                base = path.name.upper()
                if base in ('LICENSE', 'NOTICE', 'COPYING') or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.')):
                    with source.extractfile(member) as stream:
                        notices.append((path, stream.read()))
    return notices


def stage_adapters(payload):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')
    ui = directory / 'ui'
    ui.mkdir()
    for name in ('server.mjs', 'index.html', 'styles.css', 'app.js'):
        shutil.copyfile(ROOT / 'bend2/ui/orchestra' / name, ui / name)
    shutil.copyfile(ROOT / 'bend2/ui/orchestra/native-owner-subscription.mjs',
                    ui / 'native-owner-subscription.mjs')
    fixtures = ui / 'fixtures'
    fixtures.mkdir()
    for name in ('fixture-small.json', 'fixture-dense.json', 'fixture-gap.json'):
        shutil.copyfile(ROOT / 'bend2/ui/orchestra/fixtures' / name, fixtures / name)
    shutil.copyfile(ROOT / 'bend2/scripts/context-provider.mjs', directory / 'context-provider.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-project-policy.mjs', directory / 'context-project-policy.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-query-artifact.mjs', directory / 'context-query-artifact.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-worktree-capture.mjs', directory / 'context-worktree-capture.mjs')


def stage_selected_context_payload(payload):
    source_root = ROOT / 'bend2/context/bend2'
    declaration_path = source_root / 'selected-module.json'
    require(declaration_path.is_file() and not declaration_path.is_symlink(),
            'The selected Bend2 module file list is unavailable')
    declaration = json.loads(declaration_path.read_text())
    require(isinstance(declaration, dict) and isinstance(declaration.get('moduleId'), str)
            and declaration['moduleId'] and isinstance(declaration.get('protocolVersion'), str)
            and isinstance(declaration.get('files'), list)
            and declaration['files'], 'The selected Bend2 module has no files')

    module_root = payload / 'lib/context/modules' / module_directory_name(declaration['moduleId'])
    module_root.mkdir(parents=True)
    seen = set()
    for entry in declaration['files']:
        require(isinstance(entry, dict) and isinstance(entry.get('path'), str),
                'A selected Bend2 artifact needs a path')
        relative = PurePosixPath(entry['path'])
        require(not relative.is_absolute() and relative.parts
                and '..' not in relative.parts and '.' not in relative.parts,
                'Unsafe selected Bend2 artifact path: ' + str(relative))
        name = relative.as_posix()
        require(name not in seen, 'Duplicate selected Bend2 artifact: ' + name)
        seen.add(name)
        source = source_root.joinpath(*relative.parts)
        resolved = source.resolve()
        require(resolved.is_relative_to(source_root.resolve()) and source.is_file()
                and not source.is_symlink(),
                'Selected Bend2 artifact is missing or outside its module root: ' + name)
        destination = module_root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    return {'moduleId': declaration['moduleId'],
            'protocolVersion': declaration['protocolVersion'],
            'path': module_root.relative_to(payload).as_posix()}


def stage_notices(payload, compiler_notices, kind='development'):
    directory = payload / 'notices'
    directory.mkdir()
    terms = {'baton_root_license': None, 'baton_root_notice': None,
             'bend_reference_license': 'notices/bend-reference-LICENSE',
             'bend_compiler_runtime_license': {'path': 'notices/bend-2.0.25-LICENSE',
                                              'url': COMPILER_LICENSE_URL,
                                              'sha256': COMPILER_LICENSE_SHA256}}
    distribution = ['This is a Baton2 native ' + kind + ' artifact.']
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = ROOT / name
        if source.is_file():
            destination = directory / ('baton2-' + name)
            shutil.copyfile(source, destination)
            terms[field] = {'source_path': name,
                            'path': destination.relative_to(payload).as_posix(),
                            **file_info(destination)}
            distribution.append('baton2-' + name + ' contains the Baton2 project '
                                + name.lower() + ' copied from root ' + name + '.')
    if terms['baton_root_license'] is None:
        distribution.extend(['This source snapshot has no root LICENSE.',
                             'The maintainer must resolve Baton2 distribution terms before a public release.'])
    reference = ROOT / 'docs/bend2/reference/upstream/LICENSE'
    require(sha256(reference) == COMPILER_LICENSE_SHA256,
            'The upstream Bend license differs from its versioned pin')
    shutil.copyfile(reference, directory / 'bend-reference-LICENSE')
    shutil.copyfile(reference, directory / 'bend-2.0.25-LICENSE')
    for path, data in compiler_notices:
        destination = directory / 'compiler-archive' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    distribution.extend([
        'bend-2.0.25-LICENSE is the pinned upstream compiler/runtime license at ' + COMPILER_LICENSE_URL + '.',
        'bend-reference-LICENSE applies to the separately pinned Bend reference.',
        'compiler-archive/ retains license and notice files found in the verified Bend archive.'])
    (directory / 'distribution.md').write_text('\n'.join(distribution) + '\n')
    return terms


def check_project_terms(terms, source_files, files):
    sources = {entry['path']: entry for entry in source_files}
    staged = {entry['path']: entry for entry in files}
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = sources.get(name)
        path = 'notices/baton2-' + name
        expected = None if source is None else {
            'source_path': name, 'path': path, 'bytes': source['bytes'], 'sha256': source['sha256']}
        require(terms[field] == expected, 'Baton2 ' + name + ' terms differ from the source inventory')
        file_expected = None if expected is None else {
            key: expected[key] for key in ('path', 'bytes', 'sha256')}
        require(staged.get(path) == file_expected, 'Baton2 ' + name + ' file differs from its terms')


def artifact_identity(release_version):
    if release_version is None:
        return {'archive_root': ARCHIVE_ROOT, 'kind': 'development'}
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', release_version) is not None,
            'Release version must be a single identifier starting with a letter or digit and containing letters, digits, dots, underscores, plus signs or hyphens')
    require((ROOT / 'LICENSE').is_file(), 'Release packaging requires the project root LICENSE')
    return {'archive_root': 'baton2-' + release_version + '-darwin-arm64',
            'kind': 'release', 'version': release_version}


def package(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    build_output = output / 'build'
    build_output.mkdir()
    result = {'status': 'running', 'source_directory': str(ROOT), 'output': str(output)}
    write_json(output / 'result.json', result)
    try:
        require(platform.system() == 'Darwin' and platform.machine() == 'arm64',
                'This native artifact requires a Darwin arm64 build host')
        identity = artifact_identity(args.release_version)
        compiler = args.bend.resolve()
        env = dict(os.environ, BEND=str(compiler))
        build_record = build(env, build_output)
        archive = args.compiler_archive.resolve()
        compiler_notices = archive_notices(archive)
        binary = ROOT / '.scratch/bend2/baton2'
        generated = ROOT / '.scratch/bend2/baton2.c'
        require(binary.is_file(), 'The production build did not create .scratch/bend2/baton2')
        if generated.is_file():
            generated_copy = build_output / 'baton2.c'
            shutil.copyfile(generated, generated_copy)
            build_record['generated_c'] = {'path': str(generated_copy.relative_to(output)),
                                           **file_info(generated_copy)}
            write_json(build_output / 'build.json', build_record)
        source_files = [{'path': name, **file_info(ROOT / name)}
                        for name in git('ls-files', 'bend2', 'docs/bend2/reference', '.github/workflows/bend2-native.yml',
                                        'LICENSE', 'NOTICE').splitlines()
                        if (ROOT / name).is_file()]
        source = {'directory': str(ROOT), **source_identity(), 'files': source_files}
        payload = output / identity['archive_root']
        (payload / 'bin').mkdir(parents=True)
        shutil.copyfile(binary, payload / 'bin/baton2')
        (payload / 'bin/baton2').chmod(0o755)
        stage_adapters(payload)
        selected_context = stage_selected_context_payload(payload)
        terms = stage_notices(payload, compiler_notices, identity['kind'])
        files = [{'path': path.relative_to(payload).as_posix(), **file_info(path)}
                 for path in sorted(payload.rglob('*')) if path.is_file()]
        check_project_terms(terms, source_files, files)
        manifest = {
            'schema': 'baton2-native-artifact-v1', **identity,
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': {'system': platform.system(), 'machine': platform.machine(), 'artifact': 'darwin-arm64'},
            'source': source,
            'binary': {'path': 'bin/baton2', **file_info(binary)}, 'files': files,
            'selected_modules': [selected_context],
            'build': {'command': build_record, 'compiler_archive': {'url': COMPILER_ARCHIVE_URL, **file_info(archive)}},
            'terms': terms,
        }
        write_json(payload / 'manifest.json', manifest)
        shutil.copyfile(payload / 'manifest.json', output / 'manifest.json')
        destination = output / (identity['archive_root'] + '-' + source['commit'] + '.tar.gz')
        with tarfile.open(destination, 'x:gz') as artifact:
            artifact.add(payload, arcname=identity['archive_root'])
        require(sha256(payload / 'bin/baton2') == sha256(binary), 'The staged executable differs from the build output')
        archive_sha = sha256(destination)
        (output / 'SHA256SUMS').write_text(archive_sha + '  ' + destination.name + '\n')
        result.update(status='packaged', archive={'path': destination.name, **file_info(destination)},
                      manifest={'path': 'manifest.json', **file_info(output / 'manifest.json')},
                      source=source, build=str(build_output))
        write_json(output / 'result.json', result)
        print(json.dumps(result), flush=True)
    except BaseException as error:
        result.update(status='failed', error=repr(error))
        write_json(output / 'result.json', result)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='new output directory, retained on failure')
    parser.add_argument('--bend', required=True, type=Path, help='installed Bend compiler')
    parser.add_argument('--compiler-archive', required=True, type=Path,
                        help='verified official Bend 2.0.25 archive used for license notices')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    args = parser.parse_args()
    package(args)


if __name__ == '__main__':
    main()
