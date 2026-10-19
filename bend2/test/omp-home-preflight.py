"""Regression for the OMP HOME writability preflight (#839).

The preflight reads permission state. It must not create, truncate, remove or
follow a fixed probe path, and concurrent launch checks must not interfere.
"""
import concurrent.futures
import os
import pathlib
import subprocess
import sys
import tempfile

EXE = pathlib.Path(os.environ.get('BATON2_EXE', '')).resolve()
UNWRITABLE = pathlib.Path(os.environ.get('BATON2_UNWRITABLE_HOME', '/proc'))


def run(home):
    return subprocess.run([str(EXE), str(home)], capture_output=True, text=True)


def main():
    if not EXE.is_file():
        raise SystemExit(f'BATON2_EXE is not a file: {EXE}')
    with tempfile.TemporaryDirectory() as temporary:
        root = pathlib.Path(temporary)
        home = root / 'home'
        home.mkdir()
        marker = home / '.omp' / '.baton-preflight'
        marker.parent.mkdir()
        marker.write_bytes(b'pre-existing marker\n')
        result = run(home)
        if result.returncode != 0:
            raise SystemExit(f'writable home refused: {result.stdout}{result.stderr}')
        if marker.read_bytes() != b'pre-existing marker\n':
            raise SystemExit('pre-existing marker changed')

        target = root / 'target'
        target.write_bytes(b'pre-existing target\n')
        symlink_home = root / 'symlink-home'
        (symlink_home / '.omp').mkdir(parents=True)
        symlink_marker = symlink_home / '.omp' / '.baton-preflight'
        symlink_marker.symlink_to(target)
        result = run(symlink_home)
        if result.returncode != 0:
            raise SystemExit(f'writable symlink home refused: {result.stdout}{result.stderr}')
        if not symlink_marker.is_symlink():
            raise SystemExit('pre-existing symlink replaced')
        if target.read_bytes() != b'pre-existing target\n':
            raise SystemExit('symlink target changed')

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(run, [home] * 8))
        if any(result.returncode != 0 for result in results):
            raise SystemExit('concurrent writable home refusal')
        if marker.read_bytes() != b'pre-existing marker\n':
            raise SystemExit('concurrent launch changed the marker')

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(run, [UNWRITABLE] * 8))
        if any(result.returncode != 2 for result in results):
            raise SystemExit('concurrent read-only home was not refused')

        fresh = root / 'fresh'
        fresh.mkdir()
        result = run(fresh)
        if result.returncode != 0:
            raise SystemExit(f'fresh writable home refused: {result.stdout}{result.stderr}')
        if (fresh / '.omp').exists():
            raise SystemExit('preflight created .omp')

    print('omp-home-preflight: ok')


if __name__ == '__main__':
    main()
