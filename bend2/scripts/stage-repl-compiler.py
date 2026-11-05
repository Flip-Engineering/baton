#!/usr/bin/env python3
"""Stage the exact compiler source and runtime used by the Bend2 REPL frontend."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil


ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / 'bend2/compiler'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError('The pinned compiler source does not contain its exact REPL extension point')
    return source.replace(before, after, 1)


def extend_loader(source):
    source = replace_once(source,
        'seen: Map<string, string | null>, spn?: Span): Promise<number> {',
        'seen: Map<string, string | null>, spn?: Span, source?: string, aliases?: Record<Name, Name>): Promise<number> {')
    source = replace_once(source, '  if (!fs.existsSync(file)) {',
                          '  if (source === undefined && !fs.existsSync(file)) {')
    source = replace_once(source, '  const real = fs.realpathSync(file);',
                          '  const real = source === undefined ? fs.realpathSync(file) : path.resolve(file);')
    source = replace_once(source, '  const al    : Record<Name, Name> = Object.create(null);',
                          '  const al    : Record<Name, Name> = aliases ?? Object.create(null);')
    return replace_once(source, '  const text  = fs.readFileSync(file, "utf8");',
                         '  const text  = source ?? fs.readFileSync(file, "utf8");')


def extend_frontend(source):
    source = replace_once(source, 'function cli_report(', 'export function cli_report(')
    source = replace_once(source,
        'async function cli_build(bin: string, file: string, evidence: string): Promise<void> {',
        'export async function cli_build(bin: string, file: string, evidence: string | undefined = undefined, extraLibs: string[] = [], diagnosticsToStderr = false): Promise<void> {\n'
        '  evidence ??= fs.mkdtempSync(path.join(path.dirname(path.resolve(bin)), ".bend-repl-build-"));')
    source = replace_once(source,
        '  const cpu = [...objc, "-std=c11", "-O3", file, "-lpthread", "-lm",',
        '  const sdkFlags: string[] = [];\n'
        '  if (mac) {\n'
        '    const command = "/usr/bin/xcrun";\n'
        '    const arguments_ = ["--sdk", "macosx", "--show-sdk-path"];\n'
        '    const result = child.spawnSync(command, arguments_, { encoding: "utf8" });\n'
        '    if (diagnosticsToStderr) process.stderr.write(JSON.stringify({ sdkStep: { command, arguments: arguments_, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr } }) + "\\n");\n'
        '    if (result.status !== 0 || result.error || result.signal) {\n'
        '      throw "Error: macOS SDK discovery failed. Install Apple Command Line Tools and select a macOS SDK. " + (result.error?.message || result.stderr || "");\n'
        '    }\n'
        '    const sdk = result.stdout.trim();\n'
        '    if (!sdk || !fs.existsSync(sdk) || !fs.statSync(sdk).isDirectory()) {\n'
        '      throw "Error: xcrun did not select an available macOS SDK directory. Install Apple Command Line Tools and select a macOS SDK.";\n'
        '    }\n'
        '    sdkFlags.push("-isysroot", sdk);\n'
        '  }\n'
        '  const cpu = [...objc, ...sdkFlags, "-std=c11", "-O3", file, "-lpthread", "-lm",')
    source = replace_once(source, '    ...libs, "-o", path.resolve(bin)];',
                          '    ...libs, ...extraLibs, "-o", path.resolve(bin)];')
    return replace_once(source,
        '    const completed = await Driver.run(directory, [cmd, ...args]);',
        '    const completed = await Driver.run(directory, [cmd, ...args], diagnosticsToStderr ? "stderr" : "stdout");\n'
        '    if (diagnosticsToStderr) process.stderr.write(JSON.stringify({ compilerStep: { command: cmd, arguments: args, status: completed.code, signal: completed.signal } }) + "\\n");')


def stage(source, runtime, runtime_sha256, runtime_notices, destination):
    source, runtime, destination = Path(source), Path(runtime), Path(destination)
    runtime_notices = Path(runtime_notices)
    if source.is_symlink() or not source.is_dir():
        raise RuntimeError('The required REPL compiler source directory is unavailable')
    if runtime.is_symlink() or not runtime.is_file() or not os.access(runtime, os.X_OK):
        raise RuntimeError('The required REPL Bun runtime must be an executable regular file')
    if runtime_notices.is_symlink() or not runtime_notices.is_file() or not runtime_notices.stat().st_size:
        raise RuntimeError('The required REPL Bun distribution notices are unavailable')
    lock_path = COMPILER / 'repl-upstream.lock.json'
    lock = json.loads(lock_path.read_text())
    provenance_path = COMPILER / 'repl-upstream.provenance.json'
    provenance = json.loads(provenance_path.read_text())
    if (provenance.get('schema') != 'baton2-repl-vendored-source-v1'
            or provenance.get('lock_sha256') != sha256(lock_path)
            or any(provenance.get(key) != lock[key] for key in ('compiler_archive_sha256', 'files', 'license'))):
        raise RuntimeError('The REPL compiler source provenance differs from its lock')
    if re.fullmatch('[0-9a-f]{64}', runtime_sha256) is None or sha256(runtime) != runtime_sha256:
        raise RuntimeError('The REPL runtime does not match its selected SHA256')
    license_path = ROOT / lock['license']['path']
    if sha256(license_path) != lock['license']['sha256']:
        raise RuntimeError('The Bend compiler license differs from its pin')
    destination.mkdir(parents=True, exist_ok=False)
    upstream = destination / 'upstream'
    upstream.mkdir()
    for row in lock['files']:
        original = source / row['path']
        if original.is_symlink() or not original.is_file() or sha256(original) != row['sha256']:
            raise RuntimeError('The REPL compiler input differs from its pin: ' + row['path'])
        target = upstream / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    bend = upstream / 'bend.ts'
    bend.write_text(extend_loader(bend.read_text()))
    main = upstream / 'main.ts'
    main.write_text(extend_frontend(main.read_text()))
    shutil.copyfile(COMPILER / 'repl.ts', upstream / 'repl.ts')
    shutil.copyfile(runtime, destination / 'bun')
    (destination / 'bun').chmod(0o755)
    shutil.copyfile(lock_path, destination / 'upstream.lock.json')
    shutil.copyfile(provenance_path, destination / 'upstream.provenance.json')
    notices = destination / 'notices'
    notices.mkdir()
    shutil.copyfile(license_path, notices / 'Bend-LICENSE')
    shutil.copyfile(runtime_notices, notices / 'Bun-NOTICES')
    launcher = destination / 'compiler'
    launcher.write_text('''#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
unset BUN_OPTIONS
export BUN_JSC_maxPerThreadStackUsage=67108864
exec "$directory/bun" --smol "$directory/upstream/repl.ts" "$@"
''')
    launcher.chmod(0o755)
    files = [{'path': path.relative_to(destination).as_posix(), 'sha256': sha256(path),
              'bytes': path.stat().st_size, 'mode': oct(path.stat().st_mode & 0o777)}
             for path in sorted(destination.rglob('*')) if path.is_file()]
    manifest = {'protocol': 1, 'language': 'Bend2', 'upstream': lock['upstream'],
                'compilerArchiveSha256': lock['compiler_archive_sha256'],
                'runtimeSha256': runtime_sha256,
                'frontend': 'upstream/repl.ts', 'nativeLibraries': ['sqlite3'], 'files': files}
    (upstream / 'compiler.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return {'manifest': str((upstream / 'compiler.json').relative_to(destination)),
            'sha256': sha256(upstream / 'compiler.json'), 'files': files}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=COMPILER / 'upstream')
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--runtime-sha256', required=True)
    parser.add_argument('--runtime-notices', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(stage(args.source, args.runtime, args.runtime_sha256,
                           args.runtime_notices, args.output), indent=2))
