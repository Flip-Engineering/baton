"""Qualified context capture and consumption for CPU detail preparation."""
import hashlib
import json
import os
from pathlib import Path
EXPORT_SHA = '62231f55d617ba0d2a02545aa627820b524c79116d80b06a6d860d4c803c4608'
FINE_SHA = 'a85f51a9870a730b8516aa1bf9c8b1181d7dc1b64d463a21cd74bae3b3506193'
HERE = Path(__file__).resolve().parent

def _one(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unqualified detail preparation source: ' + before[:80])
    return text.replace(before, after)

def prepare_fine_context_script(script, helper=None):
    """Patch an isolated detail workspace; original source remains unchanged."""
    script = Path(script)
    source = script.read_text()
    if hashlib.sha256(source.encode()).hexdigest() != FINE_SHA:
        raise ValueError('Unqualified fine7_bake.mjs source')
    helper_url = (Path(helper) if helper else HERE / 'farm_fine_context.mjs').resolve().as_uri()
    source = 'import { readFineContext as farmReadFineContext } from ' + json.dumps(helper_url) + ';\n' + source
    source = _one(source, 'const st = await loadPersonStudio();', 'const farmContext = farmReadFineContext(dir, M, bin, import.meta.url);\nconst st = farmContext ? null : await loadPersonStudio();')
    source = _one(source, 'const P = await X.buildPerson(st, spec.who,', 'const P = farmContext ? farmContext.person : await X.buildPerson(st, spec.who,')
    source = _one(source, 'K = FI.chartOnGeometry(C, g);', 'K = farmContext ? farmContext.chart : FI.chartOnGeometry(C, g);')
    source = _one(source, '{ ...FI.bodySource(P.h), P: bindX }', '{ ...(farmContext ? farmContext.body : FI.bodySource(P.h)), P: bindX }')
    script.write_text(source)
    return hashlib.sha256(source.encode()).hexdigest()

def export_context_env(command, environment=None, helper_directory=None):
    """Keep exporter arguments and compose existing Node preload hooks."""
    command = list(command)
    environment = os.environ if environment is None else environment
    if len(command) < 2 or command[0] != 'node' or command[1] != 'web/labs/human8/export_person.mjs':
        return dict(environment)
    directory = Path(helper_directory) if helper_directory else HERE
    preload = (directory / 'capture_fine_context.mjs').resolve()
    result = dict(environment)
    # Node parses NODE_OPTIONS with its own quoted-string rules.
    option = '--import=' + json.dumps(str(preload))
    result['NODE_OPTIONS'] = (result.get('NODE_OPTIONS', '') + ' ' + option).strip()
    return result

VERSION = 'exact-export-context-v1'

def _patch_source(source, helper_url):
    source = 'import { readFineContext as farmReadFineContext } from ' + json.dumps(helper_url) + ';\n' + source
    source = _one(source, 'const st = await loadPersonStudio();', 'const farmContext = farmReadFineContext(dir, M, bin, import.meta.url);\nconst st = farmContext ? null : await loadPersonStudio();')
    source = _one(source, 'const P = await X.buildPerson(st, spec.who,', 'const P = farmContext ? farmContext.person : await X.buildPerson(st, spec.who,')
    source = _one(source, 'K = FI.chartOnGeometry(C, g);', 'K = farmContext ? farmContext.chart : FI.chartOnGeometry(C, g);')
    source = _one(source, '{ ...FI.bodySource(P.h), P: bindX }', '{ ...(farmContext ? farmContext.body : FI.bodySource(P.h)), P: bindX }')
    return source

RUNTIME = r'''
import threading as farm_fine_context_threading
FARM_FINE_CONTEXT_VERSION = 'exact-export-context-v1'
FARM_FINE_CONTEXT_FILES = __MODULE_FILES__
farm_fine_context_lock = farm_fine_context_threading.Lock()

def farm_fine_context_materialize(root):
    import hashlib
    import tempfile
    from pathlib import Path
    root = Path(root)
    with farm_fine_context_lock:
        root.mkdir(parents=True, exist_ok=True)
        for name, text in FARM_FINE_CONTEXT_FILES.items():
            data = text.encode()
            target = root / name
            if target.is_file() and not target.is_symlink() and target.read_bytes() == data:
                continue
            descriptor, temporary = tempfile.mkstemp(prefix='.context-', suffix='.mjs', dir=root)
            try:
                with os.fdopen(descriptor, 'wb') as stream:
                    stream.write(data); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
    return root / 'farm_fine_context.mjs'

def farm_fine_context_env(cmd, env):
    if len(cmd) < 2 or cmd[1] != 'web/labs/human8/export_person.mjs' or DRY:
        return env
    import hashlib
    from pathlib import Path
    digest = hashlib.sha256(''.join(FARM_FINE_CONTEXT_FILES.values()).encode()).hexdigest()
    root = Path(WORK) / 'farm-fine-context' / digest
    farm_fine_context_materialize(root)
    environment = dict(os.environ if env is None else env)
    node_options = environment.get('NODE_OPTIONS', '')
    environment['NODE_OPTIONS'] = (node_options + ' --import=' + (root / 'capture_fine_context.mjs').as_uri()).strip()
    return environment

def farm_fine_context_private(root, export, directory, script):
    import hashlib
    from pathlib import Path
    for name in ('.farm-fine7-context.v8', '.farm-fine7-context.v8.sha256'):
        original = Path(directory) / name
        if original.is_file():
            (export / name).symlink_to(original)
    data = script.read_text()
    if hashlib.sha256(data.encode()).hexdigest() != __FINE_SHA__:
        print('farm fine context: detail source requires qualification; keeping original rebuild', flush=True)
        return
    helper = farm_fine_context_materialize(root / 'farm-fine-context')
    script.write_text(farm_fine_context_patch_source(data, helper.as_uri()))

'''

def adapt(source, helper_source=None, capture_source=None):
    import ast
    import inspect
    if "FARM_FINE_CONTEXT_VERSION = '" + VERSION + "'" in source:
        return source
    if 'FARM_FINE_CONTEXT_VERSION = ' in source:
        raise ValueError('Unknown fine context adapter version')
    if 'def farm_fine7_workspace(directory):' not in source:
        return source
    tree = ast.parse(source)
    runs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run']
    if len(runs) != 1 or [arg.arg for arg in runs[0].args.args] != ['cmd', 'cwd', 'fatal', 'tag', 'env']:
        raise ValueError('Person command dispatcher requires qualification')
    run = runs[0]
    run.body.insert(0, ast.parse('env = farm_fine_context_env(cmd, env)').body[0])
    lines = source.splitlines(keepends=True)
    lines[run.lineno - 1:run.end_lineno] = [ast.unparse(ast.fix_missing_locations(run)) + '\n']
    source = ''.join(lines)
    anchor = "    guard = root / 'guard.mjs'"
    if source.count(anchor) != 1:
        raise ValueError('Private detail workspace requires qualification')
    source = source.replace(anchor, '    farm_fine_context_private(root, export, directory, script)\n' + anchor, 1)
    modules = {
        'farm_fine_context.mjs': helper_source if helper_source is not None else (HERE / 'farm_fine_context.mjs').read_text(),
        'capture_fine_context.mjs': capture_source if capture_source is not None else (HERE / 'capture_fine_context.mjs').read_text(),
    }
    runtime = RUNTIME.replace('__MODULE_FILES__', repr(modules)).replace('__FINE_SHA__', repr(FINE_SHA))
    patch = inspect.getsource(_one).replace('def _one(', 'def farm_fine_context_one(')
    patch += inspect.getsource(_patch_source).replace('def _patch_source(', 'def farm_fine_context_patch_source(').replace('_one(', 'farm_fine_context_one(')
    result = runtime + patch + '\n' + source
    compile(result, 'person_job.context.py', 'exec')
    return result
