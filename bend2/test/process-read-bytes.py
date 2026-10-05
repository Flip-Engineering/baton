"""Source recipe for Root-admitted remote raw byte reader qualification."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile
from host_control_capture import run

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/host/process-read-bytes.h'
FIXTURE = ROOT / 'test/process-read-bytes.c'
DEPENDENCIES = ['process-read-buffer.h', 'process-read-source.h', 'process-read-offer.h']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    destination = Path(tempfile.mkdtemp(prefix='baton-read-bytes-'))
    print(f'Retained raw byte evidence: {destination}', flush=True)
    compiler = shlex.split(os.environ.get('CC', 'clang'))
    if not compiler:
        raise RuntimeError('missing compiler command')
    executable = shutil.which(compiler[0])
    if executable is None:
        raise RuntimeError('compiler executable unavailable')
    executable = Path(executable).resolve()
    (destination / 'compiler.json').write_text(json.dumps({
        'argv': compiler, 'resolvedExecutable': str(executable),
        'sha256': digest(executable)}, indent=2))
    identity = run(destination, 'compiler-version', compiler + ['--version'], 30)
    if identity.returncode:
        raise RuntimeError('compiler identity command failed')
    source = SOURCE.read_text()
    variants = [
        ('positive', None, None, None),
        ('read-past-captured-end',
         'remaining < capacity ? (size_t)remaining : capacity',
         'remaining > capacity ? (size_t)remaining : capacity',
         'kind == BR_BYTES_OFFER && first.start == 0 && first.next == 4 && first.length == 4'),
        ('open-extent-is-final',
         'sealed ? BR_BYTES_END : BR_BYTES_WAITING', 'BR_BYTES_END',
         'kind == BR_BYTES_WAITING && !retry.bytes'),
        ('replace-pending-bytes', 'if (!held->offered) {', 'if (1) {',
         'retry.bytes == first.bytes && retry.serial == first.serial && retry.length == 4'),
        ('clear-source-fault', 'if (held->fault) return held->fault;', '(void)held->fault;',
         'br_read_bytes_ready(&reader, 4, 0, 64, &kind, &retry) == ENOENT'),
    ]
    for name, find, replace, expected in variants:
        directory = destination / name
        headers = directory / 'src/host'
        headers.mkdir(parents=True)
        (directory / 'test').mkdir()
        spool = directory / 'spool'
        spool.mkdir()
        if find is not None and source.count(find) != 1:
            raise RuntimeError(f'{name}: mutation target mismatch')
        header = headers / SOURCE.name
        header.write_text(source if find is None else source.replace(find, replace, 1))
        for dependency in DEPENDENCIES:
            shutil.copyfile(ROOT / 'src/host' / dependency, headers / dependency)
        fixture = directory / 'test' / FIXTURE.name
        shutil.copyfile(FIXTURE, fixture)
        (directory / 'sources.json').write_text(json.dumps({
            'driverSha256': digest(Path(__file__)),
            'captureSha256': digest(Path(__file__).with_name('host_control_capture.py')),
            'originalSourceSha256': digest(SOURCE), 'sourceSha256': digest(header),
            'fixtureSha256': digest(fixture),
            'dependencies': {p: digest(headers / p) for p in DEPENDENCIES}}, indent=2))
        binary = directory / 'fixture'
        built = run(directory, 'build', compiler + ['-std=c11', '-Wall', '-Wextra', '-Werror',
                                                   str(fixture), '-o', str(binary)], 120)
        if built.returncode:
            raise RuntimeError(f'{name}: build failed; no semantic result')
        (directory / 'binary.sha256').write_text(digest(binary) + '\n')
        result = run(directory, 'run', [str(binary), str(spool)], 30)
        if expected is None:
            if (result.returncode != 0 or result.stderr or
                    result.stdout != b'retained raw byte cases passed\n'):
                raise RuntimeError('positive raw byte fixture failed')
        elif (result.returncode != 1 or result.stdout or
              result.stderr != f'failed: {expected}\n'.encode()):
            raise RuntimeError(f'{name}: missing exact intended failure')
    print('Retained raw byte positive and semantic controls passed')


if __name__ == '__main__':
    main()
