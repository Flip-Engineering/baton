"""Embed exact pelvis solve coalescing in generated person dispatch."""
import ast
import pathlib

VERSION = 'pelvis-exact-coalesced-v1'

HELPER = r'''
import threading as farm_pelvis_threading
FARM_PELVIS_VERSION = 'pelvis-exact-coalesced-v1'
farm_pelvis_lock = farm_pelvis_threading.Lock()

def farm_pelvis_env(cmd, env):
    if DRY or len(cmd) < 2 or cmd[1] != 'web/labs/human8/export_person.mjs':
        return env
    import hashlib
    from pathlib import Path
    import tempfile
    data = FARM_PELVIS_SOURCE.encode()
    digest = hashlib.sha256(data).hexdigest()
    root = Path(WORK) / 'farm-pelvis'
    module = root / ('pelvis-coalesce-' + digest + '.mjs')
    with farm_pelvis_lock:
        root.mkdir(parents=True, exist_ok=True)
        if not module.exists() or module.read_bytes() != data:
            descriptor, temporary = tempfile.mkstemp(prefix='.pelvis-', suffix='.mjs', dir=root)
            try:
                with os.fdopen(descriptor, 'wb') as stream:
                    stream.write(data); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, module)
            finally:
                try: os.unlink(temporary)
                except FileNotFoundError: pass
    environment = dict(os.environ if env is None else env)
    node_options = environment.get('NODE_OPTIONS', os.environ.get('NODE_OPTIONS', ''))
    cache = environment.get('ACP_PELVIS_CACHE_DIR') or os.environ.get('ACP_PELVIS_CACHE_DIR')
    if not cache:
        persistent = environment.get('XDG_CACHE_HOME') or os.environ.get('XDG_CACHE_HOME')
        if not persistent:
            home = environment.get('GPU_JOB_HOME') or os.environ.get('GPU_JOB_HOME')
            persistent = os.path.join(home, 'cache') if home else os.path.join(VIDEOS, 'out')
        cache = os.path.join(persistent, 'farm-pelvis')
    environment.update(ACP_PELVIS_COALESCE='1', ACP_PELVIS_CACHE_DIR=cache,
        NODE_OPTIONS=(node_options + ' --import=' + module.as_uri()).strip())
    return environment

def farm_pelvis_log_env(env):
    if not env:
        return env
    return {key: value for key, value in env.items() if os.environ.get(key) != value}

'''

def adapt(source, module_source=None):
    if 'FARM_PELVIS_VERSION = ' in source:
        if "FARM_PELVIS_VERSION = '" + VERSION + "'" not in source:
            raise ValueError('Unknown pelvis adapter version')
        return source
    tree = ast.parse(source)
    runs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run']
    if len(runs) != 1 or [arg.arg for arg in runs[0].args.args] != ['cmd','cwd','fatal','tag','env']:
        raise ValueError('Pelvis command dispatcher requires qualification')
    run = runs[0]
    for node in ast.walk(run):
        if (isinstance(node, ast.Call) and ast.unparse(node.func) == 'json.dumps'
                and len(node.args) == 1 and isinstance(node.args[0], ast.Name) and node.args[0].id == 'env'):
            node.args[0] = ast.Call(func=ast.Name(id='farm_pelvis_log_env',ctx=ast.Load()),
                args=[node.args[0]],keywords=[])
    run.body.insert(0, ast.parse('env = farm_pelvis_env(cmd, env)').body[0])
    lines = source.splitlines(keepends=True)
    lines[run.lineno-1:run.end_lineno] = [ast.unparse(ast.fix_missing_locations(run)) + '\n']
    if module_source is None:
        module_source = pathlib.Path(__file__).with_name('pelvis_coalesce.mjs').read_text()
    result = 'FARM_PELVIS_SOURCE = ' + repr(module_source) + '\n' + HELPER + ''.join(lines)
    compile(result,'person_job.pelvis.py','exec')
    return result


PELVIS_DEFORMATION_VERSION = 'pelvis-deformation-v1'


def deformation_metrics(report):
    """S1 entry point: aggregate a pelvis solve report (solve_i16 schema)."""
    import human_anatomy_sim
    return human_anatomy_sim.pelvis_metrics(report)
