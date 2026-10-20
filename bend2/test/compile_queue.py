"""Test support: admit fixture C compilations through the shared host queue.

The queue is the product compilation boundary. Fixture tests use this helper
instead of spawning a compiler directly. A missing queue executable or an
unconfigured state root is a skipped prerequisite.
"""
import os
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / 'bend2/scripts/compile-queue.sh'
IDENTITIES = {}


def queue_entry():
    for name in ('BATON2_COMPILE_QUEUE_BIN', 'BATON2_COMPILE_QUEUE'):
        value = os.environ.get(name)
        if value:
            path = pathlib.Path(value)
            if path.is_file() and os.access(path, os.X_OK):
                return str(path)
            raise AssertionError('the configured compile queue entry is unavailable: ' + value)
    prefix = os.environ.get('BATON2_PREFIX')
    if prefix:
        candidate = pathlib.Path(prefix) / 'bin' / 'baton-compile-queue'
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(LAUNCHER)
    return None


def state_root():
    value = os.environ.get('BATON_COMPILE_QUEUE_ROOT')
    if not value or not pathlib.Path(value).is_absolute():
        raise unittest.SkipTest('BATON_COMPILE_QUEUE_ROOT is not configured')
    return pathlib.Path(value)


def compiler_identity(compiler):
    if compiler not in IDENTITIES:
        version = subprocess.run([compiler, '--version'], capture_output=True, text=True)
        if version.returncode != 0 or not version.stdout.strip():
            raise AssertionError('compiler --version failed: ' + compiler + '\n' + version.stderr)
        linker = subprocess.run([compiler, '-print-prog-name=ld'], capture_output=True, text=True)
        if linker.returncode != 0 or not linker.stdout.strip():
            raise AssertionError('compiler linker identity failed: ' + compiler + '\n' + linker.stderr)
        IDENTITIES[compiler] = (linker.stdout.strip(), ' '.join(version.stdout.split()))
    return IDENTITIES[compiler]


def compile_cc(argv, inputs, output, cwd, compiler=None, options=()):
    """Run one cc request through the queue and return the completed result."""
    queue = queue_entry()
    if queue is None:
        raise unittest.SkipTest('the shared compile queue executable is unavailable')
    compiler = str(compiler if compiler is not None else argv[0])
    linker, version = compiler_identity(compiler)
    request = [queue, 'run', '--kind', 'cc',
               '--state-root', str(state_root()),
               '--cwd', str(cwd),
               '--source-root', str(pathlib.Path(cwd).resolve()),
               '--compiler', compiler,
               '--linker', linker,
               '--version', version]
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
