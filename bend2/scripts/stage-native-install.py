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
     'entry': 'bend2/src/coordinator/main.bend',
     'wrapper': True, 'build_mode': 'full-native-receiver-router'},
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def executable_source(path, role):
    require(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK),
            'The source-built ' + role + ' binary is unavailable or not executable: ' + str(path))


def source_pin(commit, tree, status, manifest_sha256, default, role, use_default=True, directory=None):
    source_directory = str(Path(directory).resolve()) if directory is not None else str(ROOT)
    if commit is None and manifest_sha256 is None and use_default:
        commit = default['commit']
    if manifest_sha256 is not None:
        require(re.fullmatch(r'[0-9a-f]{64}', manifest_sha256) is not None,
                'The source manifest for ' + role + ' must be a SHA256')
    if commit in (None, ''):
        require(manifest_sha256 is not None,
                'The source for ' + role + ' needs a commit/tree or a source manifest SHA256')
        require(tree is None, 'A source tree for ' + role + ' requires its commit')
        require(status in (None, ''), 'A source status for ' + role + ' requires its commit')
        pin = {'directory': source_directory, 'status': ''}
        pin['manifest_sha256'] = manifest_sha256
        return pin
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None,
            'The source commit for ' + role + ' must be a 40-character lowercase Git object name')
    if status is None:
        status = default['status'] if commit == default['commit'] else ''
    require(isinstance(status, str), 'The source status for ' + role + ' must be a string')
    if tree is None:
        try:
            tree = package_git_tree(commit)
        except Exception as error:
            raise RuntimeError('The source tree for ' + role + ' is missing; supply its recorded tree '
                               'or source manifest hash') from error
    require(re.fullmatch(r'[0-9a-f]{40}', tree) is not None,
            'The source tree for ' + role + ' must be a 40-character lowercase Git object name')
    pin = {'directory': source_directory, 'commit': commit, 'tree': tree, 'status': status}
    if manifest_sha256 is not None:
        pin['manifest_sha256'] = manifest_sha256
    return pin


def package_git_tree(commit):
    import subprocess
    return subprocess.check_output(['git', 'rev-parse', commit + '^{tree}'], cwd=ROOT, text=True).strip()


def binary_specs(args, package):
    default = {'directory': str(ROOT), **package.source_identity()}
    specs = []
    for item in BINARY_LAYOUT:
        option = item['option']
        path = getattr(args, option + '_binary')
        source = source_pin(getattr(args, option + '_source_commit'),
                            getattr(args, option + '_source_tree'),
                            getattr(args, option + '_source_status'),
                            getattr(args, option + '_source_manifest_sha256'),
                            default, item['role'], True,
                            getattr(args, option + '_source_directory', None))
        spec = {**item, 'source_path': path, 'source': source}
        if item.get('wrapper'):
            c_sha = getattr(args, 'full_c_sha256', None)
            if c_sha is not None:
                require(re.fullmatch(r'[0-9a-f]{64}', c_sha) is not None,
                        'The retained full C hash must be a SHA256')
                spec['retained_c_sha256'] = c_sha
            full_commit = getattr(args, 'full_source_commit')
            require(full_commit is None or full_commit == default['commit']
                    or getattr(args, 'full_wrapper_source_commit') is not None,
                    'A retained earlier full CLI requires its current wrapper source commit')
            spec['wrapper_source'] = source_pin(
                getattr(args, 'full_wrapper_source_commit'),
                getattr(args, 'full_wrapper_source_tree'),
                getattr(args, 'full_wrapper_source_status'),
                getattr(args, 'full_wrapper_source_manifest_sha256'), default, item['role'] + ' wrapper',
                True, getattr(args, 'full_wrapper_source_directory', None))
        specs.append(spec)
    return specs


def stage_binaries(prefix, specs, package):
    require(len(specs) == len(BINARY_LAYOUT), 'The receiver layout requires exactly two binaries')
    require({spec['role'] for spec in specs} == {item['role'] for item in BINARY_LAYOUT},
            'The receiver layout requires focused-facade and full-cli binaries')
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
        if spec.get('wrapper_source'):
            record['wrapper_source'] = spec['wrapper_source']
        if spec.get('retained_c_sha256'):
            record['retained_c_sha256'] = spec['retained_c_sha256']
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
    files = sorted(path.relative_to(prefix).as_posix() for path in prefix.rglob('*')
                   if path.is_file() and path.relative_to(prefix).as_posix() != 'SHA256SUMS')
    lines = []
    for name in files:
        lines.append(package.sha256(prefix / name) + '  ' + name)
    (prefix / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')


def stage_source_closures(prefix, args, package):
    closures = {}
    for role in ('focused', 'full', 'full-wrapper'):
        source = getattr(args, role.replace('-', '_') + '_source_closure', None)
        if source is None:
            continue
        source = Path(source).resolve()
        require(source.is_file() and not source.is_symlink(),
                'The source closure for ' + role + ' is unavailable')
        data = json.loads(source.read_text())
        require(isinstance(data, dict) and data.get('schema') == 'baton2-source-closure-v1'
                and isinstance(data.get('files'), list) and data['files'],
                'The source closure for ' + role + ' is not a complete closure manifest')
        seen = set()
        for entry in data['files']:
            require(isinstance(entry, dict) and isinstance(entry.get('path'), str) and entry['path']
                    and entry['path'] not in seen and isinstance(entry.get('bytes'), int)
                    and entry['bytes'] >= 0 and isinstance(entry.get('sha256'), str)
                    and re.fullmatch(r'[0-9a-f]{64}', entry['sha256']) is not None,
                    'The source closure for ' + role + ' has an invalid file record')
            seen.add(entry['path'])
        require(isinstance(data.get('diff_sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', data['diff_sha256']) is not None,
                'The source closure for ' + role + ' has no source diff pin')
        name = 'source-closure-' + role + '.json'
        destination = prefix / name
        shutil.copyfile(source, destination)
        closures[role] = {'path': name, 'sha256': package.sha256(destination)}
    return closures


def require_manifest_closures(specs, closures):
    for spec in specs:
        role = 'focused' if spec['role'] == 'focused-facade' else 'full'
        source = spec['source']
        if 'commit' not in source or 'tree' not in source:
            require(role in closures and closures[role]['sha256'] == source.get('manifest_sha256'),
                    'The ' + role + ' manifest-only source pin requires its bound complete source closure')
        if spec.get('wrapper_source'):
            wrapper = spec['wrapper_source']
            if 'commit' not in wrapper or 'tree' not in wrapper:
                require('full-wrapper' in closures
                        and closures['full-wrapper']['sha256'] == wrapper.get('manifest_sha256'),
                        'The full wrapper manifest-only source pin requires its bound complete source closure')



def main():
    spec = importlib.util.spec_from_file_location('package_native', Path(__file__).with_name('package-native.py'))
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--focused-binary', type=Path, required=True,
                        help='source-built focused receiver facade installed as bin/baton and bin/baton2')
    parser.add_argument('--full-binary', type=Path, required=True,
                        help='full CLI installed as bin/baton-full')
    for role in ('focused', 'full'):
        parser.add_argument('--' + role + '-source-commit',
                            help='exact Git commit that produced the ' + role + ' binary; defaults to this source tree')
        parser.add_argument('--' + role + '-source-status',
                            help='recorded source status for the ' + role + ' binary; defaults to this source tree status')
        parser.add_argument('--' + role + '-source-tree',
                            help='exact Git tree object for the ' + role + ' binary; defaults to the commit tree')
        parser.add_argument('--' + role + '-source-directory',
                            help='source directory for the ' + role + ' binary')
        parser.add_argument('--' + role + '-source-manifest-sha256',
                            help='complete source manifest SHA256 for the ' + role + ' binary')
    for role in ('focused', 'full', 'full-wrapper'):
        parser.add_argument('--' + role + '-source-closure', type=Path,
                            help='complete source closure manifest for ' + role)
    parser.add_argument('--full-c-sha256', help='retained full generated-C SHA256')
    parser.add_argument('--full-wrapper-source-directory', help='current router wrapper source directory')
    for name in ('commit', 'tree', 'status', 'manifest_sha256'):
        parser.add_argument('--full-wrapper-source-' + name.replace('_', '-'),
                            help='current native-entry wrapper source ' + name)
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
        closures = stage_source_closures(prefix, args, package)
        require_manifest_closures(specs, closures)
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
        focused_record = next(record for record in records if record['role'] == 'focused-facade')
        full_record = next(record for record in records if record['role'] == 'full-cli')
        source_manifest = {
            'schema': 'baton2-source-manifest-v1',
            'focused': {'path': focused_record['path'], 'sha256': focused_record['sha256'],
                        'entry': focused_record['entry'], 'source': focused_record['source']},
            'full': {'path': full_record['path'], 'sha256': full_record['sha256'],
                     'entry': full_record['entry'], 'source': full_record['source'],
                     'build_mode': full_record['build_mode']},
            'repl': {'compiler_source': str(args.repl_compiler_source),
                     'runtime': str(args.repl_runtime),
                     'runtime_sha256': args.repl_runtime_sha256,
                     'notices': str(args.repl_runtime_notices)},
            'binaries': [{'role': record['role'], 'path': record['path'],
                          'sha256': record['sha256'], 'build_mode': record['build_mode']}
                         for record in records],
            'closures': closures,
        }
        if full_record.get('wrapper_source') is not None:
            source_manifest['full']['wrapper_source'] = full_record['wrapper_source']
        if full_record.get('retained_c_sha256') is not None:
            source_manifest['full']['retained_c_sha256'] = full_record['retained_c_sha256']
        manifest['source_manifest'] = source_manifest
        package.write_json(prefix / 'source-manifest.json', source_manifest)
        package.write_json(prefix / 'manifest.json', manifest)
        receipt = {
            'schema': 'baton2-native-install-receipt-v1',
            'created_at': manifest['created_at'],
            'manifest': {'path': 'manifest.json',
                         'sha256': package.sha256(prefix / 'manifest.json')},
            'source': manifest['source'],
            'source_manifest': source_manifest,
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
