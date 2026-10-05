"""Remote-only validation of the pinned retained source and semantic mutants."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile
from host_control_capture import run

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/host/process-read-source.h'
BUFFER = ROOT / 'src/host/process-read-buffer.h'
FIXTURE = ROOT / 'test/process-read-source.c'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    destination = Path(tempfile.mkdtemp(prefix='baton-read-source-'))
    print(f'Retained source evidence: {destination}', flush=True)
    compiler = shlex.split(os.environ.get('CC', 'clang'))
    identity = run(destination, 'compiler', compiler + ['--version'], 30)
    if identity.returncode:
        raise RuntimeError('compiler identity command failed')
    source = SOURCE.read_text()
    variants = [
        ('positive', None, None, None),
        ('skip-buffered-validation',
         'int error = br_read_source_validate(source, end, sealed);',
         'int error = source->buffer.scan == end ? 0 : br_read_source_validate(source, end, sealed);',
         b'failed: br_read_source_ready(&source, 4, 1, &kind, &frame) == ENOENT'),
        ('allow-other-inode',
         'named.st_dev != source->device || named.st_ino != source->inode',
         '0',
         b'failed: br_read_source_ready(&source, 4, 1, &kind, &frame) == ESTALE'),
        ('conceal-post-seal-bytes',
         'if (sealed && (uint64_t)held.st_size != end) return EIO;',
         '(void)sealed;',
         b'failed: br_read_source_ready(&source, 4, 1, &kind, &frame) == EIO'),
    ]
    for name, find, replace, expected in variants:
        directory = destination / name
        (directory / 'src/host').mkdir(parents=True)
        (directory / 'test').mkdir()
        spool = directory / 'spool'
        spool.mkdir()
        header = directory / 'src/host/process-read-source.h'
        if find is not None and source.count(find) != 1:
            raise RuntimeError(f'{name}: mutation target mismatch')
        header.write_text(source if find is None else source.replace(find, replace, 1))
        buffer = directory / 'src/host/process-read-buffer.h'
        fixture = directory / 'test/process-read-source.c'
        shutil.copyfile(BUFFER, buffer)
        shutil.copyfile(FIXTURE, fixture)
        (directory / 'sources.json').write_text(json.dumps({
            'driverSha256': digest(Path(__file__)),
            'captureSha256': digest(Path(__file__).with_name('host_control_capture.py')),
            'originalSourceSha256': digest(SOURCE), 'sourceSha256': digest(header),
            'bufferSha256': digest(buffer), 'fixtureSha256': digest(fixture)}, indent=2))
        binary = directory / 'fixture'
        built = run(directory, 'build', compiler + ['-std=c11', '-Wall', '-Wextra', '-Werror',
                                                   str(fixture), '-o', str(binary)], 120)
        if built.returncode:
            raise RuntimeError(f'{name}: compiler failed; no semantic result')
        (directory / 'binary.sha256').write_text(digest(binary) + '\n')
        result = run(directory, 'run', [str(binary), str(spool)], 30)
        if expected is None:
            if (result.returncode != 0 or result.stderr or
                    result.stdout != b'retained source validation cases passed\n'):
                raise RuntimeError('positive retained source fixture failed')
        elif result.returncode != 1 or expected not in result.stderr or result.stdout:
            raise RuntimeError(f'{name}: missing intended semantic failure')
    print('Retained source positive and semantic controls passed')


if __name__ == '__main__':
    main()
