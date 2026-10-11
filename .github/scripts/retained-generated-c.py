#!/usr/bin/env python3
"""Transfer completed Main C and its source/build/suite evidence to Darwin packaging."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


HANDOFFS = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/generated-c-handoffs')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def identity(path):
    return {'size': path.stat().st_size, 'sha256': digest(path)}


def write_json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def member(root, relative):
    p = Path(relative)
    require(not p.is_absolute() and p.parts and '..' not in p.parts,
            'Unsafe evidence member: ' + str(relative))
    path = root / p
    require(path.is_file() and not path.is_symlink()
            and path.resolve(strict=True).is_relative_to(root.resolve(strict=True)),
            'Evidence member is not a contained regular file: ' + str(relative))
    return path


def verify_source(source, manifest):
    require(manifest['changedFiles'] == {}, 'Generated C source has unbound source changes')
    require(re.fullmatch(r'[0-9a-f]{40}', manifest['baseCommit']) is not None,
            'Native source commit is not an exact Git object ID')
    require(manifest['files'], 'Native source manifest is empty')
    for relative, item in manifest['files'].items():
        require(identity(member(source, relative)) == item,
                'Native source member differs: ' + relative)


def verify_producer(root, manifest):
    source_manifest_path = member(root, 'source-manifest.json')
    source_manifest = json.loads(source_manifest_path.read_text())
    build = json.loads(member(root, 'native-build/result.json').read_text())
    qualification = json.loads(member(root, 'qualification/after.json').read_text())
    binding = json.loads(member(root, 'qualification/binding.json').read_text())
    results = json.loads(member(root, 'qualification/suite-results.json').read_text())
    plan = json.loads(member(root, 'qualification-plan.json').read_text())
    require(source_manifest['baseCommit'] == manifest['sourceCommit']
            and digest(source_manifest_path) == build['sourceManifestSha256'],
            'Build result does not bind the retained native source')
    require(build['sqliteLinkedBuildExitCode'] == 0
            and identity(member(root, 'baton2.c')) == {
                'size': build['generatedC']['size'], 'sha256': build['generatedC']['sha256']},
            'Completed build C differs from the handoff')
    require(qualification['sourceManifest']['sha256'] == build['sourceManifestSha256']
            and qualification['native']['sha256'] == build['binary']['sha256']
            and qualification['processes'] == [],
            'Qualification does not bind the completed, settled native')
    require(binding['authorized'] is True
            and binding['sourceManifestSha256'] == build['sourceManifestSha256']
            and binding['nativeSha256'] == build['binary']['sha256']
            and binding['buildResultSha256'] == digest(member(root, 'native-build/result.json'))
            and plan['sourceCommit'] == manifest['sourceCommit']
            and plan['sourceManifest']['sha256'] == build['sourceManifestSha256'],
            'Suite admission and source plan differ from the actual build')
    expected = [Path(item['sourcePath']).name for item in plan['suites']]
    require(expected and [row['suite'] for row in results] == expected
            and qualification['results'] == [
                {'suite': row['suite'], 'exitCode': row['exitCode']} for row in results],
            'Completed suites differ from their admitted source plan')
    for row in results:
        require(row['exitCode'] == 0 and row['ownedProcessesAfter'] == []
                and row['nativeAfter']['sha256'] == build['binary']['sha256']
                and row['sourceSha256'] == source_manifest['files'][
                    'bend2/test/' + row['suite']]['sha256'],
                'Suite did not settle successfully on the retained native: ' + row['suite'])
        for stream in ('stdout', 'stderr'):
            path = member(root, 'qualification/' + Path(row[stream]['path']).name)
            require(identity(path) == {'size': row[stream]['bytes'],
                                       'sha256': row[stream]['sha256']},
                    'Retained suite stream differs: ' + row['suite'] + ' ' + stream)
    return source_manifest, build


def verify_handoff(root, expected_sha, source, checkout=True):
    manifest_path = member(root, 'handoff-manifest.json')
    require(digest(manifest_path) == expected_sha, 'Handoff manifest hash differs')
    manifest = json.loads(manifest_path.read_text())
    require(manifest['format'] == 1, 'Unknown handoff format')
    for relative, item in manifest['files'].items():
        require(identity(member(root, relative)) == item,
                'Handoff member differs: ' + relative)
    source_manifest, build = verify_producer(root, manifest)
    if checkout:
        require(subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'],
                                        text=True).strip() == manifest['sourceCommit'],
                'Darwin asset checkout and generated C source commits differ')
    verify_source(source, source_manifest)
    return manifest, build


def copy_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open('rb') as inp, destination.open('xb') as out:
        shutil.copyfileobj(inp, out)
    require(identity(source) == identity(destination), 'Evidence copy differs: ' + str(source))


def snapshot(args):
    root = args.source_root.resolve(strict=True)
    binding = json.loads(args.binding.read_text())
    source_manifest_path = member(root, 'run-source-manifest.json')
    build_result_path = member(root, 'build-evidence/result.json')
    after_path = member(root, 'suite-evidence/after.json')
    require(binding == {'authorized': True,
                        'sourceManifestSha256': digest(source_manifest_path),
                        'buildResultSha256': digest(build_result_path),
                        'qualificationAfterSha256': digest(after_path)},
            'Exact completed build and suite handoff authorization is absent')
    source_manifest = json.loads(source_manifest_path.read_text())
    source = Path(source_manifest['source']).resolve(strict=True)
    require(source == root / 'source', 'Native source root differs from the owned build')
    verify_source(source, source_manifest)
    build = json.loads(build_result_path.read_text())
    generated = member(root / 'build-evidence', build['generatedC']['path'])
    binary = member(source, '.scratch/bend2/baton2')
    require(identity(binary) == {'size': build['binary']['size'],
                                'sha256': build['binary']['sha256']},
            'Completed native binary differs before handoff')
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    mappings = {'baton2.c': generated, 'source-manifest.json': source_manifest_path,
                'qualification-plan.json': member(root, 'post-build-suites-source-plan.json'),
                'handoff-authorization.json': args.binding}
    for directory, prefix in [('build-evidence', 'native-build'),
                              ('suite-evidence', 'qualification')]:
        for path in sorted((root / directory).rglob('*')):
            if path.is_dir():
                require(not path.is_symlink(), 'Evidence directory is a symbolic link')
                continue
            relative = path.relative_to(root / directory).as_posix()
            member(root / directory, relative)
            if path == generated:
                continue
            mappings[prefix + '/' + relative] = path
    for relative, path in mappings.items():
        copy_file(path, args.output / relative)
    handoff = {'format': 1, 'sourceCommit': source_manifest['baseCommit'],
               'producerRoot': str(root),
               'producerGeneratedCPath': str(generated),
               'createdUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'files': {relative: identity(args.output / relative)
                         for relative in sorted(mappings)}}
    write_json(args.output / 'handoff-manifest.json', handoff)
    verify_handoff(args.output, digest(args.output / 'handoff-manifest.json'), source,
                   checkout=False)
    require(identity(binary) == {'size': build['binary']['size'],
                                'sha256': build['binary']['sha256']},
            'Completed native binary differs after handoff')
    verify_source(source, source_manifest)
    print(json.dumps({'handoff': str(args.output),
                      'manifest': identity(args.output / 'handoff-manifest.json')}, indent=2))


def transfer(args):
    require(re.fullmatch(r'[0-9a-f]{64}', args.manifest_sha256) is not None,
            'Handoff requires an exact manifest SHA256')
    if args.operation == 'publish':
        require(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', args.handoff)
                is not None, 'Handoff must be a UUID')
        require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
                and os.environ['DARWIN_FROM_GENERATED_C'] == 'true'
                and os.environ['RUNTIME_SUITE'] == '', 'Retained C requires Darwin-only mode')
        root = HANDOFFS / args.handoff
        require(not root.is_symlink(), 'Handoff root is a symbolic link')
    else:
        root = args.input.resolve(strict=True)
    manifest, build = verify_handoff(root, args.manifest_sha256, args.source)
    if args.operation == 'publish':
        args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
        for relative in ['handoff-manifest.json', *manifest['files']]:
            copy_file(member(root, relative), args.output / relative)
        verify_handoff(args.output, args.manifest_sha256, args.source)
        root = args.output
    result = {'sourceCommit': manifest['sourceCommit'],
              'sourceManifestSha256': build['sourceManifestSha256'],
              'generatedC': identity(member(root, 'baton2.c')),
              'nativeBuildResult': identity(member(root, 'native-build/result.json')),
              'handoffManifestSha256': args.manifest_sha256,
              'workflowSource': os.environ['GITHUB_SHA'],
              'workflowRun': os.environ['GITHUB_RUN_ID'],
              'workflowAttempt': os.environ['GITHUB_RUN_ATTEMPT'],
              'script': identity(Path(__file__))}
    write_json(args.verification, result)
    print(json.dumps(result, indent=2))


def bind_package(args):
    handoff, build = verify_handoff(args.input, args.manifest_sha256, args.source)
    output = args.package
    manifest_path = member(output, 'manifest.json')
    manifest = json.loads(manifest_path.read_text())
    result = json.loads(member(output, 'result.json').read_text())
    require(result['status'] == 'packaged'
            and manifest['source']['commit'] == handoff['sourceCommit'],
            'Darwin package source differs from the handoff')
    require(identity(member(output, 'build/baton2.c')) == {
                'size': build['generatedC']['size'], 'sha256': build['generatedC']['sha256']},
            'Darwin retained C differs from the completed Main C')
    payload = output / manifest['archive_root']
    provenance = payload / 'share/baton2/generated-c-provenance'
    provenance.mkdir(parents=True, exist_ok=False)
    for relative in ['handoff-manifest.json', *handoff['files']]:
        if relative != 'baton2.c':
            copy_file(member(args.input, relative), provenance / relative)
    prefix = provenance.relative_to(payload).as_posix()
    manifest['binary']['sha256'] = digest(member(payload, manifest['binary']['path']))
    manifest['binary']['source'] = {
        'commit': handoff['sourceCommit'],
        'manifest': {'path': prefix + '/source-manifest.json',
                     'sha256': build['sourceManifestSha256']}}
    manifest['assets'] = {'path': 'libexec/baton2', 'source': manifest['source']}
    manifest['build']['generated_c_provenance'] = {
        'path': prefix + '/handoff-manifest.json', 'sha256': args.manifest_sha256,
        'generated_c': identity(member(args.input, 'baton2.c')),
        'native_build_result': {'path': prefix + '/native-build/result.json',
                                **identity(member(args.input, 'native-build/result.json'))}}
    archive = member(output, result['archive']['path'])
    require(digest(archive) == result['archive']['sha256'],
            'Unbound package archive hash differs')
    backup = output / 'unbound-generated-c-package'
    backup.mkdir()
    for filename in ('manifest.json', 'result.json', 'SHA256SUMS'):
        copy_file(member(output, filename), backup / filename)
    archive.rename(backup / archive.name)
    for path in (payload / 'manifest.json', manifest_path):
        path.write_text(json.dumps(manifest, indent=2) + '\n')
    with tarfile.open(archive, 'x:gz') as packed:
        packed.add(payload, arcname=manifest['archive_root'])
    result['archive']['sha256'] = digest(archive)
    result['generatedCProvenance'] = manifest['build']['generated_c_provenance']
    (output / 'SHA256SUMS').write_text(result['archive']['sha256'] + '  ' + archive.name + '\n')
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='operation', required=True)
    s = commands.add_parser('snapshot')
    s.add_argument('--source-root', required=True, type=Path)
    s.add_argument('--binding', required=True, type=Path)
    s.add_argument('--output', required=True, type=Path)
    for name in ('publish', 'verify', 'bind-package'):
        p = commands.add_parser(name)
        p.add_argument('--source', required=True, type=Path)
        p.add_argument('--manifest-sha256', required=True)
        if name == 'publish':
            p.add_argument('--handoff', required=True)
            p.add_argument('--output', required=True, type=Path)
        else:
            p.add_argument('--input', required=True, type=Path)
        if name == 'bind-package':
            p.add_argument('--package', required=True, type=Path)
        else:
            p.add_argument('--verification', required=True, type=Path)
    args = parser.parse_args()
    if args.operation == 'snapshot':
        snapshot(args)
    elif args.operation == 'bind-package':
        bind_package(args)
    else:
        transfer(args)


if __name__ == '__main__':
    main()
