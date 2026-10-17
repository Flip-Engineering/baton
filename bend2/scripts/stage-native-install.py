#!/usr/bin/env python3
"""Stage a source-built native coordinator and its required installation payload."""
import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil


ROOT = Path(__file__).resolve().parents[2]


def main():
    spec = importlib.util.spec_from_file_location('package_native', Path(__file__).with_name('package-native.py'))
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True, help='qualified source-built coordinator')
    parser.add_argument('--prefix', type=Path, required=True, help='new installation prefix')
    parser.add_argument('--repl-compiler-source', type=Path, default=ROOT / 'bend2/compiler/upstream')
    parser.add_argument('--repl-runtime', type=Path, required=True)
    parser.add_argument('--repl-runtime-sha256', required=True)
    parser.add_argument('--repl-runtime-notices', type=Path, required=True)
    parser.add_argument('--context-clang-package', type=Path)
    parser.add_argument('--context-typescript-package', type=Path)
    args = parser.parse_args()
    package.require(args.binary.is_file() and not args.binary.is_symlink()
                    and os.access(args.binary, os.X_OK), 'The source-built coordinator is unavailable')
    prefix = args.prefix.absolute()
    prefix.mkdir(parents=True, exist_ok=False)
    try:
        (prefix / 'bin').mkdir()
        for name in ('baton', 'baton2'):
            shutil.copyfile(args.binary, prefix / 'bin' / name)
            (prefix / 'bin' / name).chmod(0o755)
        package.stage_adapters(prefix)
        dependencies = package.stage_repl(prefix, args)
        modules = [package.stage_selected_context_payload(prefix), package.stage_runtime_context_module(prefix)]
        modules.extend(package.stage_clang_context_modules(prefix, args.context_clang_package))
        if args.context_typescript_package is not None:
            modules.append(package.stage_typescript_context_module(prefix, args.context_typescript_package))
        manifest = {
            'schema': 'baton2-native-install-v1', 'kind': 'source',
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': {'system': platform.system(), 'machine': platform.machine()},
            'source': {'directory': str(ROOT), **package.source_identity()},
            'binary': {'path': 'bin/baton2', 'alias': 'bin/baton', 'sha256': package.sha256(prefix / 'bin/baton2')},
            'selected_modules': modules, 'selected_dependencies': dependencies,
            'required_system_dependencies': package.system_dependencies(platform.system()),
            'terms': package.stage_notices(prefix, []),
        }
        package.write_json(prefix / 'manifest.json', manifest)
        print(json.dumps({'status': 'staged', 'prefix': str(prefix),
                          'manifest_sha256': package.sha256(prefix / 'manifest.json'),
                          'next': ['python3', str(prefix / 'libexec/baton2/check-install.py')]}))
    except BaseException as error:
        package.write_json(prefix / 'staging-failure.json', {'error': repr(error)})
        raise


if __name__ == '__main__':
    main()
