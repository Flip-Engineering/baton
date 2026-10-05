"""Remote-only build and semantic controls for the retained raw buffer helper."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/host/process-read-buffer.h'
FIXTURE = ROOT / 'test/process-read-buffer.c'
DESTINATION = Path(tempfile.mkdtemp(prefix='baton-read-buffer-'))
CC = shlex.split(os.environ.get('CC', 'clang'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(directory, name, argv, timeout):
    (directory / f'{name}.argv.json').write_text(json.dumps(argv))
    try:
        result = subprocess.run(argv, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        (directory / f'{name}.stdout').write_bytes(error.stdout or b'')
        (directory / f'{name}.stderr').write_bytes(error.stderr or b'')
        (directory / f'{name}.outcome.json').write_text(json.dumps({'timeout': error.timeout}))
        raise
    (directory / f'{name}.stdout').write_bytes(result.stdout)
    (directory / f'{name}.stderr').write_bytes(result.stderr)
    (directory / f'{name}.outcome.json').write_text(json.dumps({'returncode': result.returncode}))
    return result


def main():
    print(f'Retained raw buffer evidence: {DESTINATION}', flush=True)
    compiler = run(DESTINATION, 'compiler', CC + ['--version'], 30)
    if compiler.returncode:
        raise RuntimeError('compiler identity command failed')
    source = SOURCE.read_text()
    variants = [
        ('positive', None, None, None),
        ('discard-partial', 'if (!sealed) { *kind = BR_BUFFER_WAITING; return 0; }',
         'if (!sealed) { reader->length = 0; reader->frame_start = reader->scan; *kind = BR_BUFFER_WAITING; return 0; }',
         b'failed: reader.frame_start == 0 && reader.scan == 3 && reader.length == 3'),
        ('omit-delimiter', '(size_t)(newline - chunk) + 1', '(size_t)(newline - chunk)',
         b'failed: frame->length == length'),
        ('eof-before-tail', 'if (!reader->length) { *kind = BR_BUFFER_EOF; return 0; }',
         'if (1) { *kind = BR_BUFFER_EOF; return 0; }',
         b'failed: frame->length == length'),
    ]
    for name, find, replace, expected in variants:
        directory = DESTINATION / name
        (directory / 'src/host').mkdir(parents=True)
        (directory / 'test').mkdir()
        header = directory / 'src/host/process-read-buffer.h'
        if find is not None and source.count(find) != 1:
            raise RuntimeError(f'{name}: mutation target mismatch')
        header.write_text(source if find is None else source.replace(find, replace, 1))
        fixture = directory / 'test/process-read-buffer.c'
        shutil.copyfile(FIXTURE, fixture)
        binary = directory / 'fixture'
        (directory / 'sources.json').write_text(json.dumps({
            'originalHeaderSha256': digest(SOURCE), 'headerSha256': digest(header),
            'fixtureSha256': digest(fixture)}, indent=2))
        built = run(directory, 'build', CC + ['-std=c11', '-Wall', '-Wextra', '-Werror',
                                           str(fixture), '-o', str(binary)], 120)
        if built.returncode != 0:
            raise RuntimeError(f'{name}: compiler failed; no semantic result')
        (directory / 'binary.sha256').write_text(digest(binary) + '\n')
        result = run(directory, 'run', [str(binary)], 30)
        if expected is None:
            if (result.returncode != 0 or result.stderr or
                    result.stdout != b'raw retained buffer cases passed\n'):
                raise RuntimeError('positive raw-buffer fixture failed')
        elif result.returncode != 1 or expected not in result.stderr or result.stdout:
            raise RuntimeError(f'{name}: missing intended semantic failure')
    print('Raw buffer positive and semantic controls passed')


if __name__ == '__main__':
    main()
