"""Test support: admit fixture C compilations through the shared host queue.

The queue is the product compilation boundary. Fixture tests use this helper
instead of spawning a compiler directly. A missing queue executable is a
skipped prerequisite, consistent with the other optional compiler fixtures.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / 'bend2/scripts/compile-queue.sh'
SCRATCH = (ROOT / '.scratch/bend2/compile-queue',
           ROOT / '.scratch/bend2/baton-compile-queue')


def queue_entry():
    for value in (os.environ.get('BATON2_COMPILE_QUEUE_BIN'),
                  os.environ.get('BATON2_COMPILE_QUEUE')):
        if value and pathlib.Path(value).exists():
            return value
    if LAUNCHER.exists() and any(path.exists() for path in SCRATCH):
        return str(LAUNCHER)
    return None


def state_root(explicit=None):
    if explicit is not None:
        return pathlib.Path(explicit)
    path = ROOT / '.scratch/bend2/compile-queue-test-state'
    path.mkdir(parents=True, exist_ok=True)
    return path


def compile_cc(argv, inputs, output, cwd, compiler=None, state=None, options=()):
    """Run one cc request through the queue and return the completed result."""
    queue = queue_entry()
    if queue is None:
        raise unittest.SkipTest('the shared compile queue executable is unavailable')
    request = [queue, 'run', '--kind', 'cc',
               '--state-root', str(state_root(state)),
               '--cwd', str(cwd),
               '--compiler', str(compiler if compiler is not None else argv[0])]
    for item in inputs:
        request += ['--input', str(item)]
    request += ['--artifact', 'binary=' + str(output)]
    for item in options:
        request += ['--option', str(item)]
    request += ['--', *map(str, argv)]
    result = subprocess.run(request, capture_output=True, text=True)
    if result.returncode != 0:
        raise AssertionError(
            'compile queue failed: %s\nstdout:\n%s\nstderr:\n%s'
            % (' '.join(request), result.stdout, result.stderr))
    return result
