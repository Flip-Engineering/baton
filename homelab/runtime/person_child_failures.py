"""Aggregate source-qualified critical person child failures after a driver completes."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

VERSION = 'qualified-person-child-failures-v1'
QUALIFIED_DRIVERS = {
    '6e9bd25c17ca9043b2c25bbe82de1a9df76e0b4093fa5d901580e2547e6bd824': {
        'person_job.py': 'bac02e41a7e7ed08aca5c8d91a3ad1aec3fd06c6676eb4efe482b1b4417eb7d0',
        'render_person.py': '715ee9d2efe0c0d7f62780c9a6671422bbdc4dca124659edc75eb12a4c7c55cb',
        'gpujob/boot.py': 'a471f492e33e1247ef12d74426290cea8f9a7bb2ac5053d3a64dd1a5b5784ebc',
    },
}
_OBSERVER_NAME = '_farm_qualified_person_child_run_v1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def qualify(data, original_path):
    """Return exact dependencies or leave an unknown driver unchanged."""
    dependencies = QUALIFIED_DRIVERS.get(digest(data))
    if dependencies is None:
        return None
    original = Path(original_path)
    if original.is_symlink() or original.read_bytes() != data:
        raise ValueError('Qualified person driver bytes changed')
    for name, expected in dependencies.items():
        member = original.parent/name
        if member.is_symlink() or not member.is_file() or digest(member.read_bytes()) != expected:
            raise ValueError('Qualified person child source changed: ' + name)
    return dependencies


class CriticalChildFailures(SystemExit):
    """A continued driver completed with at least one failed critical child."""
    def __init__(self, failures):
        self.failures = tuple(failures)
        super().__init__(1)


class Observer:
    def __init__(self, original_path, namespace, dependencies, runner=None):
        self.folder = Path(os.path.abspath(original_path)).parent
        self.namespace = namespace
        self.dependencies = dict(dependencies)
        self.runner = subprocess.run if runner is None else runner
        self.failures = []

    def critical(self, command):
        if not isinstance(command, (list, tuple)) or not all(isinstance(v, str) for v in command):
            return None
        try:
            boundary = command.index('--')
        except ValueError:
            return None
        blender = self.namespace.get('BLENDER')
        prefix = [blender, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1']
        head = list(command[:boundary])
        for name in ('person_job.py', 'render_person.py'):
            target = str(self.folder/name)
            expected = prefix + ['--python', target]
            boot = prefix + ['--python', str(self.folder/'gpujob/boot.py'), '--python', target]
            if head == expected or (name == 'render_person.py' and head == boot):
                member = self.folder/name
                if member.is_symlink() or digest(member.read_bytes()) != self.dependencies[name]:
                    raise ValueError('Critical person child changed before execution: ' + name)
                if head == boot:
                    member = self.folder/'gpujob/boot.py'
                    if member.is_symlink() or digest(member.read_bytes()) != self.dependencies['gpujob/boot.py']:
                        raise ValueError('Critical person boot helper changed before execution')
                return name
        return None

    def run(self, command, *args, **kwargs):
        name = self.critical(command)
        try:
            result = self.runner(command, *args, **kwargs)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            if name is not None:
                self.failures.append(dict(child=name, error_type=type(error).__name__,
                    code=getattr(error, 'returncode', None)))
            raise
        if name is not None and result.returncode != 0:
            self.failures.append(dict(child=name, code=result.returncode))
        return result

    def finish(self):
        if self.failures:
            # Record only source names and status; commands and environments stay private.
            print('farm person: critical child failures ' + json.dumps(self.failures, sort_keys=True),
                  file=sys.stderr, flush=True)
            raise CriticalChildFailures(self.failures)


def _instrument(data, original_path):
    tree = ast.parse(data, filename=str(original_path))
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == 'run'
             and isinstance(node.func.value, ast.Name) and node.func.value.id == 'subprocess']
    if len(calls) != 1:
        raise ValueError('Qualified person subprocess layout changed')
    calls[0].func = ast.copy_location(ast.Name(id=_OBSERVER_NAME, ctx=ast.Load()), calls[0].func)
    return compile(ast.fix_missing_locations(tree), str(original_path), 'exec')


def _execute_qualified(data, original_path, namespace, dependencies):
    if _OBSERVER_NAME in namespace:
        raise ValueError('Person failure observer namespace is occupied')
    compiled = _instrument(data, original_path)
    observer = Observer(original_path, namespace, dependencies)
    namespace[_OBSERVER_NAME] = observer.run
    try:
        try:
            exec(compiled, namespace, namespace)
        except SystemExit as error:
            if error.code not in (None, 0):
                raise
            observer.finish()
            raise
        observer.finish()
    finally:
        del namespace[_OBSERVER_NAME]


def exec_driver(data, original_path, namespace):
    """Execute original pinned bytes with a scoped critical-child observer."""
    dependencies = qualify(data, original_path)
    if dependencies is None:
        exec(compile(data, str(original_path), 'exec'), namespace, namespace)
        return
    _execute_qualified(data, original_path, namespace, dependencies)
