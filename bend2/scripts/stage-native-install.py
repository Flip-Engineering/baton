#!/usr/bin/env python3
"""Stage a source-built native coordinator and its required receiver installation payload."""
import argparse
import datetime
import importlib.util
import json
import os
import re
from pathlib import Path
import platform
import shutil


ROOT = Path(__file__).resolve().parents[2]
BINARY_LAYOUT = (
    {'role': 'focused-facade', 'option': 'focused', 'name': 'baton', 'alias': 'baton2',
     'entry': 'bend2/src/coordinator/receive-focused.bend', 'build_mode': 'focused-native-entry'},
    {'role': 'full-cli', 'option': 'full', 'name': 'baton-full', 'alias': None,
     'entry': 'bend2/src/coordinator/main.bend', 'build_mode': 'full-native-entry'},
    {'role': 'receiver-register', 'option': 'register', 'name': 'baton-register', 'alias': None,
     'entry': 'bend2/src/coordinator/receiver-register-focused-direct.bend',
     'build_mode': 'standalone-registrar'},
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def executable_source(path, role):
    require(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK),
            'The source-built ' + role + ' binary is unavailable or not executable: ' + str(path))


def source_pin(package, commit, status, tree, manifest_sha256, default, role):
    commit = default['commit'] if commit is None else commit
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None,
            'The source commit for ' + role + ' must be a 40-character lowercase Git object name')
    if status is None:
        status = default['status'] if commit == default['commit'] else ''
    require(isinstance(status, str), 'The source status for ' + role + ' must be a string')
    if tree is None:
        try:
            tree = package.git('rev-parse', commit + '^{tree}')
        except Exception as error:
            raise RuntimeError('The source tree for ' + role + ' is missing; supply its recorded tree '
                               'or source manifest hash') from error
    require(re.fullmatch(r'[0-9a-f]{40}', tree) is not None,
            'The source tree for ' + role + ' must be a 40-character lowercase Git object name')
    if manifest_sha256 is not None:
        require(re.fullmatch(r'[0-9a-f]{64}', manifest_sha256) is not None,
                'The source manifest hash for ' + role + ' must be a SHA256')
    pin = {'directory': str(ROOT), 'commit': commit, 'tree': tree, 'status': status}
    if manifest_sha256 is not None:
        pin['manifest_sha256'] = manifest_sha256
    return pin


def binary_specs(args, package):
    default = {'directory': str(ROOT), **package.source_identity()}
    specs = []
    for item in BINARY_LAYOUT:
        option = item['option']
        path = getattr(args, option + '_binary')
        source = source_pin(package, getattr(args, option + '_source_commit'),
                            getattr(args, option + '_source_status'),
                            getattr(args, option + '_source_tree'),
                            getattr(args, option + '_source_manifest_sha256'),
                            default, item['role'])
        specs.append({**item, 'source_path': path, 'source': source})
    return specs


def stage_binaries(prefix, specs, package):
    require(len(specs) == len(BINARY_LAYOUT), 'The receiver layout requires exactly three binaries')
    require({spec['role'] for spec in specs} == {item['role'] for item in BINARY_LAYOUT},
            'The receiver layout requires focused-facade, full-cli and receiver-register binaries')
    paths = set()
    records = []
    for spec in specs:
        path = spec['name']
        require(path not in paths, 'Duplicate installed binary path: ' + path)
        paths.add(path)
        source = Path(spec['source_path'])
        executable_source(source, spec['role'])
        destination = prefix / 'bin' / path
        shutil.copyfile(source, destination)
        destination.chmod(0o755)
        record = {'role': spec['role'], 'path': 'bin/' + path,
                  'sha256': package.sha256(destination), 'source': spec['source'],
                  'entry': spec['entry'], 'build_mode': spec['build_mode']}
        if spec['alias']:
            alias = 'bin/' + spec['alias']
            require(alias not in paths, 'Duplicate installed alias path: ' + alias)
            paths.add(alias)
            shutil.copyfile(source, prefix / alias)
            (prefix / alias).chmod(0o755)
            record['alias'] = alias
        records.append(record)
    return records


def stage_checksums(prefix, package, records):
    files = [record['path'] for record in records]
    files.extend(record['alias'] for record in records if record.get('alias'))
    files.extend(['manifest.json', 'install-receipt.json'])
    lines = []
    for name in files:
        require((prefix / name).is_file(), 'The staged installation is missing ' + name)
        lines.append(package.sha256(prefix / name) + '  ' + name)
    (prefix / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')


def main():
    spec = importlib.util.spec_from_file_location('package_native', Path(__file__).with_name('package-native.py'))
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--focused-binary', type=Path, required=True,
                        help='source-built focused receiver facade installed as bin/baton and bin/baton2')
    parser.add_argument('--full-binary', type=Path, required=True,
                        help='full CLI installed as bin/baton-full')
    parser.add_argument('--register-binary', type=Path, required=True,
                        help='native Bend2 receiver registrar installed as bin/baton-register')
    for role in ('focused', 'full', 'register'):
        parser.add_argument('--' + role + '-source-commit',
                            help='exact Git commit that produced the ' + role + ' binary; defaults to this source tree')
        parser.add_argument('--' + role + '-source-status',
                            help='recorded source status for the ' + role + ' binary; defaults to this source tree status')
        parser.add_argument('--' + role + '-source-tree',
                            help='exact Git tree object for the ' + role + ' binary; defaults to the commit tree')
        parser.add_argument('--' + role + '-source-manifest-sha256',
                            help='complete source manifest SHA256 for the ' + role + ' binary')
    parser.add_argument('--prefix', type=Path, required=True, help='new installation prefix')
    parser.add_argument('--repl-compiler-source', type=Path, default=ROOT / 'bend2/compiler/upstream')
    parser.add_argument('--repl-runtime', type=Path, required=True)
    parser.add_argument('--repl-runtime-sha256', required=True)
    parser.add_argument('--repl-runtime-notices', type=Path, required=True)
    parser.add_argument('--context-clang-package', type=Path)
    parser.add_argument('--context-typescript-package', type=Path)
    args = parser.parse_args()
    specs = binary_specs(args, package)
    for spec in specs:
        executable_source(Path(spec['source_path']), spec['role'])
    prefix = args.prefix.absolute()
    prefix.mkdir(parents=True, exist_ok=False)
    try:
        (prefix / 'bin').mkdir()
        records = stage_binaries(prefix, specs, package)
        package.stage_adapters(prefix)
        dependencies = package.stage_repl(prefix, args)
        modules = [package.stage_selected_context_payload(prefix), package.stage_runtime_context_module(prefix)]
        modules.extend(package.stage_clang_context_modules(prefix, args.context_clang_package))
        if args.context_typescript_package is not None:
            modules.append(package.stage_typescript_context_module(prefix, args.context_typescript_package))
        default_source = {'directory': str(ROOT), **package.source_identity()}
        focused = next(record for record in records if record['role'] == 'focused-facade')
        manifest = {
            'schema': 'baton2-native-install-v2', 'kind': 'source',
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': {'system': platform.system(), 'machine': platform.machine()},
            'source': default_source,
            'binaries': records,
            'binary': {'path': focused['path'], 'alias': focused['alias'],
                       'sha256': focused['sha256'], 'source': focused['source']},
            'selected_modules': modules, 'selected_dependencies': dependencies,
            'required_system_dependencies': package.system_dependencies(platform.system()),
            'terms': package.stage_notices(prefix, []),
        }
        package.write_json(prefix / 'manifest.json', manifest)
        receipt = {
            'schema': 'baton2-native-install-receipt-v1',
            'created_at': manifest['created_at'],
            'manifest': {'path': 'manifest.json',
                         'sha256': package.sha256(prefix / 'manifest.json')},
            'source': manifest['source'],
            'binaries': records,
        }
        package.write_json(prefix / 'install-receipt.json', receipt)
        stage_checksums(prefix, package, records)
        print(json.dumps({'status': 'staged', 'prefix': str(prefix),
                          'manifest_sha256': receipt['manifest']['sha256'],
                          'install_receipt_sha256': package.sha256(prefix / 'install-receipt.json'),
                          'checksums_sha256': package.sha256(prefix / 'SHA256SUMS'),
                          'binaries': records,
                          'next': ['python3', str(prefix / 'libexec/baton2/check-install.py')]}))
    except BaseException as error:
        package.write_json(prefix / 'staging-failure.json', {'error': repr(error)})
        raise


if __name__ == '__main__':
    main()
