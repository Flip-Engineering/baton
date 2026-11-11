"""Generate a source-pinned CPU anatomy adapter for person export commands."""
import ast
import hashlib
import pathlib

VERSION = 'soft-sides-coalesced-v1'
QUALIFIED_LIBRARIES = {
    '8deabfc9cdddc3803e1bf63e82f62a5360b8af94be0e482dfeb81cc99381ec79',
    '13765f988a6d5409d804fd69a460f859eff74d4fca104ddde9eb9f7479cee2d3',
    '433c451d2e2c7bedf0342ace0e0a157b1355a321bac5636f195572193a7b1667',
    '953e94e47560d5a50fe25be42e517b92bb3fe16140038d35c685c9cb336748b4',
    '19281eceda49c2ce167f350a35d896fe5af6e30be45dba932bda71f7e5f6aad6',
}
QUALIFIED_HOOKS = {
    'e948e073a989e5f2111b26435f9424e7c711dd194d9baf823cf4912f01820591',
    '8abd07447349d56d24a06b51706caf94c6e213878e4b87cd1e5f24beb2996315',
    '56ec0270be9094f99345660f4e650f0d0b8170f6dd2ca31c7b663ba401d90980',
}


def library_digest(web):
    h = hashlib.sha256()
    def walk(directory):
        for f in sorted(directory.iterdir()):
            if f.is_symlink():
                raise ValueError('Unexpected source file type: ' + str(f))
            if f.is_dir():
                walk(f)
            elif f.is_file():
                h.update(f.relative_to(web).as_posix().encode())
                h.update(b'\0')
                h.update(f.read_bytes())
                h.update(b'\0')
            else:
                raise ValueError('Unexpected source file type: ' + str(f))
    walk(web / 'lib')
    return h.hexdigest()


def qualified(repo):
    web = pathlib.Path(repo) / 'videos/web'
    hook = web / 'lib/fx/anatomy/soft/hook.js'
    try:
        return (hook.is_file() and hashlib.sha256(hook.read_bytes()).hexdigest() in QUALIFIED_HOOKS
                and library_digest(web) in QUALIFIED_LIBRARIES)
    except (OSError, ValueError):
        return False


HELPER = '''
import threading as farm_anatomy_threading
FARM_ANATOMY_VERSION = 'soft-sides-coalesced-v1'
FARM_ANATOMY_SOURCE = {module_source!r}
farm_anatomy_lock = farm_anatomy_threading.Lock()
def farm_anatomy_command(cmd, env):
    if len(cmd) < 2 or cmd[1] != 'web/labs/human8/export_person.mjs' or DRY:
        return cmd, env
    import hashlib as farm_anatomy_hashlib
    import pathlib as farm_anatomy_pathlib
    import tempfile as farm_anatomy_tempfile
    data = FARM_ANATOMY_SOURCE.encode()
    digest = farm_anatomy_hashlib.sha256(data).hexdigest()
    root = farm_anatomy_pathlib.Path(WORK) / 'farm-anatomy'
    module = root / ('soft-parallel-' + digest + '.mjs')
    with farm_anatomy_lock:
        root.mkdir(parents=True, exist_ok=True)
        if not module.exists() or module.read_bytes() != data:
            descriptor, temporary = farm_anatomy_tempfile.mkstemp(prefix='.soft-', suffix='.mjs', dir=root)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, module)
    environment = dict(os.environ if env is None else env)
    node_options = environment.get('NODE_OPTIONS', os.environ.get('NODE_OPTIONS', ''))
    cache = environment.get('ACP_SOFT_CACHE_DIR') or os.environ.get('ACP_SOFT_CACHE_DIR')
    if not cache:
        persistent = environment.get('XDG_CACHE_HOME') or os.environ.get('XDG_CACHE_HOME')
        if not persistent:
            home = environment.get('GPU_JOB_HOME') or os.environ.get('GPU_JOB_HOME')
            persistent = os.path.join(home, 'cache') if home else os.path.join(VIDEOS, 'out')
        cache = os.path.join(persistent, 'farm-anatomy')
    environment.update(ACP_SOFT_PARALLEL='1', ACP_SOFT_CACHE_DIR=cache,
                       NODE_OPTIONS=(node_options + ' --import=' + module.as_uri()).strip())
    return cmd, environment

def farm_anatomy_log_env(env):
    if not env:
        return env
    return {{key: value for key, value in env.items() if os.environ.get(key) != value}}

'''


def adapt(source, module_source=None):
    if 'FARM_ANATOMY_VERSION = ' in source:
        return source
    if module_source is None:
        module_source = pathlib.Path(__file__).with_name('soft_parallel.mjs').read_text()
    tree = ast.parse(source)
    runs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run']
    if len(runs) != 1 or [arg.arg for arg in runs[0].args.args] != ['cmd', 'cwd', 'fatal', 'tag', 'env']:
        raise ValueError('Person command dispatcher requires qualification')
    run = runs[0]
    for node in ast.walk(run):
        if (isinstance(node, ast.Call) and ast.unparse(node.func) == 'json.dumps'
                and len(node.args) == 1 and isinstance(node.args[0], ast.Name)
                and node.args[0].id == 'env'):
            node.args[0] = ast.Call(func=ast.Name(id='farm_anatomy_log_env', ctx=ast.Load()),
                                   args=[node.args[0]], keywords=[])
    call = ast.parse('cmd, env = farm_anatomy_command(cmd, env)').body[0]
    run.body.insert(0, call)
    replacement = ast.unparse(ast.fix_missing_locations(run)) + '\n'
    lines = source.splitlines(keepends=True)
    lines[run.lineno - 1:run.end_lineno] = [replacement]
    result = HELPER.format(module_source=module_source) + ''.join(lines)
    compile(result, 'person_job.anatomy.py', 'exec')
    return result


DEFORMATION_VERSION = 'anatomy-deformation-v2'


def _deformation_model():
    try:
        import human_anatomy_sim
    except ImportError as error:
        raise RuntimeError('human_anatomy_sim must be bundled beside person_anatomy '
                           'for the farm harness; it is not in person_pipeline.RUNTIME_MODULES') from error
    return human_anatomy_sim


def deformation_preflight(spec):
    """Preflight-only entry point; not a source or production qualification."""
    return _deformation_model().evaluate(spec)


def qualify_deformation(report, require_soft=True, repo=None):
    """Fail closed on shape, pass/fail, soft evidence and source qualification."""
    model = _deformation_model()
    model.validate_report(report)
    if report['passed'] is not True:
        failed = [name for name, ok in report['checks'].items() if not ok]
        raise ValueError('deformation report failed: ' + ','.join(sorted(failed)))
    if require_soft:
        soft = report.get('evidence', {}).get('soft')
        if not isinstance(soft, dict) or not soft.get('count'):
            raise ValueError('deformation qualification requires measured soft evidence')
        if report.get('qualification', {}).get('ready') is not True:
            raise ValueError('deformation report is not qualification-ready')
    if repo is not None and not qualified(repo):
        raise ValueError('anatomy source is not qualified (QUALIFIED_HOOKS/QUALIFIED_LIBRARIES)')
    return report


def production_qualification(spec, repo):
    """Source-qualified, soft-evidenced production gate."""
    if not qualified(repo):
        raise ValueError('anatomy source is not qualified (QUALIFIED_HOOKS/QUALIFIED_LIBRARIES)')
    return qualify_deformation(deformation_preflight(spec), require_soft=True, repo=repo)
