"""Generate a reviewable adapter for the pinned GPU helper; never gate jobs on elapsed time."""
import ast

def apply(source):
    tree=ast.parse(source)
    target=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run_children')
    body='''def run_children(cmds, limit_s, mem_bytes):
    """Observe progress and RAM; await every child naturally. Elapsed time is metadata only."""
    kids = [Child(c, e, lp, tag) for c, e, lp, tag in cmds]
    t0, peak, reason = time.time(), 0, None
    while any(k.p.poll() is None for k in kids):
        rss = group_rss({k.p.pid for k in kids})
        peak = max(peak, rss)
        if reason is None and rss > mem_bytes:
            reason = (6, "RAM request exceeded: %.1f GB held, --mem %.1f GB; SIGTERM only" % (rss / 2**30, mem_bytes / 2**30))
            for k in kids:
                k.signal(signal.SIGTERM)
        time.sleep(1.0)
    for k in kids:
        k.p.wait()
        k.t.join()
    return [k.p.returncode for k in kids], reason, time.time() - t0, peak, kids
'''
    lines=source.splitlines(keepends=True)
    source=''.join(lines[:target.lineno-1])+body+''.join(lines[target.end_lineno:])
    old="    if not 0 < o['time'] <= max_time:\n        raise Fail(2, '--time %g min: the limit here is %d min (GPU_JOB_MAX_TIME)' % (o['time'], max_time))\n"
    if source.count(old)!=1: raise ValueError('GPU helper changed: time-option adapter needs review')
    source=source.replace(old,'    # --time is retained as requested metadata, never an execution gate.\n',1)
    source=source.replace('def sh(cmd, timeout=60, env=None):','def sh(cmd, timeout=None, env=None):')
    # Keep bounded nvidia-smi diagnostic probes. Setup, Blender and Python have no time gates.
    import re
    source=re.sub(r'timeout=env_int\(\x27GPU_JOB_VENV_TIMEOUT\x27, 2400\)', 'timeout=None', source)
    source=re.sub(r'timeout=(120|300)', 'timeout=None', source)
    source=source.replace("receipt['gpus'] = gpus", "receipt['worker_policy'] = {'elapsed_time_gates': False, 'force_kill': False}\n    receipt['gpus'] = gpus")
    source=source.replace('limits %g min, %g GB', 'requested %g min (metadata only), %g GB RAM')
    source=source.replace('run %.0f s of %.0f s', 'run %.0f s; total %.0f s')
    source=source.replace("taken = {'receipt.json'}", "taken = {'receipt.json', 'farm-dependencies.json'}")
    if 'signal.SIGKILL' in source: raise ValueError('Unsafe signal remains in adapted helper')
    compile(source,'gpu_job.farm.py','exec')
    return source
