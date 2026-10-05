"""Remote-only controls for retained frame allocation and exact offer transfer."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/host/process-read-offer.h'
SPOOL = ROOT / 'src/host/process-read-source.h'
BUFFER = ROOT / 'src/host/process-read-buffer.h'
FIXTURE = ROOT / 'test/process-read-offer.c'


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
    destination = Path(tempfile.mkdtemp(prefix='baton-read-offer-'))
    print(f'Retained frame offer evidence: {destination}', flush=True)
    compiler = shlex.split(os.environ.get('CC', 'clang'))
    identity = run(destination, 'compiler', compiler + ['--version'], 30)
    if identity.returncode:
        raise RuntimeError('compiler identity command failed')
    source = SOURCE.read_text()
    variants = [
        ('positive', None, None, None),
        ('advance-past-pending',
         'if (!reader->offered) {', 'if (1) {',
         b'failed: retry.serial == first.serial && retry.bytes == first.bytes && retry.next == 4'),
        ('take-wrong-offer',
         'if (!reader->offered || !serial || serial != reader->serial) return ESTALE;',
         'if (!reader->offered || !serial) return ESTALE;',
         b'failed: br_read_offer_take(&reader, first.serial + 1, &taken) == ESTALE'),
        ('reuse-exhausted-serial',
         'if (reader->serial == UINT64_MAX) return EOVERFLOW;',
         '(void)reader->serial;',
         b'failed: br_read_offer_ready(&reader, 5, 0, &kind, &retry) == EOVERFLOW'),
        ('discard-pending-at-disposal',
         'if (reader->offered) return EBUSY;',
         'if (reader->offered) { free(reader->pending.bytes); reader->offered = 0; }',
         b'failed: br_read_offer_dispose(&reader) == EBUSY'),
        ('forget-source-fault',
         'if (reader->fault) return reader->fault;', '(void)reader->fault;',
         b'failed: br_read_offer_ready(&reader, 5, 0, &kind, &retry) == ENOENT'),
        ('forget-pending-contradiction',
         'reader->fault = EINVAL;', '(void)reader->fault;',
         b'failed: reader.fault == EINVAL'),
    ]
    for name, find, replace, expected in variants:
        directory = destination / name
        (directory / 'src/host').mkdir(parents=True)
        (directory / 'test').mkdir()
        spool = directory / 'spool'
        spool.mkdir()
        header = directory / 'src/host/process-read-offer.h'
        if find is not None and source.count(find) != 1:
            raise RuntimeError(f'{name}: mutation target mismatch')
        header.write_text(source if find is None else source.replace(find, replace, 1))
        buffer = directory / 'src/host/process-read-buffer.h'
        source_spool = directory / 'src/host/process-read-source.h'
        fixture = directory / 'test/process-read-offer.c'
        shutil.copyfile(BUFFER, buffer)
        shutil.copyfile(SPOOL, source_spool)
        shutil.copyfile(FIXTURE, fixture)
        (directory / 'sources.json').write_text(json.dumps({
            'originalSourceSha256': digest(SOURCE), 'sourceSha256': digest(header),
            'spoolSha256': digest(source_spool), 'bufferSha256': digest(buffer),
            'fixtureSha256': digest(fixture)}, indent=2))
        binary = directory / 'fixture'
        built = run(directory, 'build', compiler + ['-std=c11', '-Wall', '-Wextra', '-Werror',
                                                   str(fixture), '-o', str(binary)], 120)
        if built.returncode:
            raise RuntimeError(f'{name}: compiler failed; no semantic result')
        (directory / 'binary.sha256').write_text(digest(binary) + '\n')
        result = run(directory, 'run', [str(binary), str(spool)], 30)
        if expected is None:
            if (result.returncode != 0 or result.stderr or
                    result.stdout != b'retained frame offer cases passed\n'):
                raise RuntimeError('positive retained frame offer fixture failed')
        elif result.returncode != 1 or expected not in result.stderr or result.stdout:
            raise RuntimeError(f'{name}: missing intended semantic failure')
    print('Retained frame offer positive and semantic controls passed')


if __name__ == '__main__':
    main()
