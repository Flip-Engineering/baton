"""Remote source disposal fixture and successful-build semantic controls."""
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
FIXTURE = ROOT / 'test/process-read-disposal.c'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    destination = Path(tempfile.mkdtemp(prefix='baton-reader-disposal-'))
    print(f'Reader disposal evidence: {destination}', flush=True)
    compiler = shlex.split(os.environ.get('CC', 'clang'))
    identity = run(destination, 'compiler', compiler + ['--version'], 30)
    if identity.returncode:
        raise RuntimeError('compiler identity command failed')
    source = SOURCE.read_text()
    variants = [
        ('positive', None, None, None),
        ('forget-spool-close-error', 'source->cleanup.spool_error = errno;',
         'source->cleanup.spool_error = 0;',
         b'failed: br_read_offer_dispose(&reader) == expected'),
        ('forget-directory-close-error', 'source->cleanup.directory_error = errno;',
         'source->cleanup.directory_error = 0;',
         b'failed: br_read_offer_dispose(&reader) == expected'),
        ('retry-spool-descriptor',
         'int descriptor = source->spool;\n    source->spool = -1;',
         'int descriptor = source->spool;\n    (void)source->spool;',
         b'failed: spool_calls == before_spool && directory_calls == before_directory'),
    ]
    for name, find, replace, expected in variants:
        directory = destination / name
        (directory / 'src/host').mkdir(parents=True)
        (directory / 'test').mkdir()
        spool = directory / 'spool'
        spool.mkdir()
        if find is not None and source.count(find) != 1:
            raise RuntimeError(f'{name}: mutation target mismatch')
        header = directory / 'src/host/process-read-source.h'
        header.write_text(source if find is None else source.replace(find, replace, 1))
        for filename in ('process-read-buffer.h', 'process-read-offer.h'):
            shutil.copyfile(ROOT / 'src/host' / filename, directory / 'src/host' / filename)
        fixture = directory / 'test/process-read-disposal.c'
        shutil.copyfile(FIXTURE, fixture)
        files = [header, fixture, directory / 'src/host/process-read-buffer.h',
                 directory / 'src/host/process-read-offer.h']
        (directory / 'sources.json').write_text(json.dumps({
            'originalSourceSha256': digest(SOURCE),
            'driverSha256': digest(Path(__file__)),
            'captureSha256': digest(Path(__file__).with_name('host_control_capture.py')),
            'files': {str(file.relative_to(directory)): digest(file) for file in files}}, indent=2))
        binary = directory / 'fixture'
        built = run(directory, 'build', compiler + ['-std=c11', '-Wall', '-Wextra', '-Werror',
                                                   str(fixture), '-o', str(binary)], 120)
        if built.returncode:
            raise RuntimeError(f'{name}: compiler failed; no semantic result')
        (directory / 'binary.sha256').write_text(digest(binary) + '\n')
        result = run(directory, 'run', [str(binary), str(spool)], 30)
        if expected is None:
            if (result.returncode or result.stderr or
                    result.stdout != b'retained reader disposal cases passed\n'):
                raise RuntimeError('positive reader disposal fixture failed')
        elif result.returncode != 1 or expected not in result.stderr or result.stdout:
            raise RuntimeError(f'{name}: missing intended semantic failure')
    print('Reader disposal positive and semantic controls passed')


if __name__ == '__main__':
    main()
