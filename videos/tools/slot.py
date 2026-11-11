"""Render slots from Python / the shell (TOOLING c5): the same lock files as web/render_slot.mjs.

  python3 videos/tools/slot.py status                    # who holds which lane, their age, the load
  python3 videos/tools/slot.py run [--light] -- CMD ...  # wait for a lane, run CMD, give the lane back
      e.g.  python3 videos/tools/slot.py run -- python3 videos/scripts/gate.py out/allpower_17.9-19.5.mp4
            python3 videos/tools/slot.py run --light -- python3 videos/tools/beat_levels.py out/.ready.wav --scene ready
  python3 videos/tools/slot.py --selftest                # node <-> python interop, stale takeover, lanes

  with slot.hold(kind='heavy', label='gate allpower'): ...   # from Python code

Lanes: ACP_RENDER_SLOTS heavy (default 2; 0 = off), ACP_LIGHT_SLOTS light (default 1; a light job may also take a
free heavy lane). Lock dir: $ACP_SLOT_DIR or videos/out/.slots. A lock untouched for 120 s, or one whose pid on this
host is gone, is taken over. So is a lock whose holder reports progress (render.mjs writes `progress` and `stall_ms`) and has
made none for max(30 min, 3 x its own watchdog), ACP_SLOT_PROGRESS_STALE_MIN (backstop for a hung Chromium; render.mjs's
own --stall-min watchdog normally frees the lane first). Only the lock file is taken over; no process is signalled.
render.mjs takes a slot on its own; use this for the gate (tesseract), batch audio runs
and any other command that saturates the cores.
"""
import contextlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
STALE_S = 120.0
BEAT_S = 20.0
PROGRESS_STALE_S = max(1.0, float(os.environ.get('ACP_SLOT_PROGRESS_STALE_MIN', 30))) * 60


def progress_stale_s(info):
    """Seconds without progress after which a holder that reports it counts as hung (never below 3x its own watchdog)."""
    return max(PROGRESS_STALE_S, 3 * float(info.get('stall_ms') or 0) / 1000)


def slot_dir():
    return os.environ.get('ACP_SLOT_DIR') or os.path.join(VIDEOS, 'out', '.slots')


def lanes(kind):
    heavy = max(0, int(float(os.environ.get('ACP_RENDER_SLOTS', 2))))
    light = max(0, int(float(os.environ.get('ACP_LIGHT_SLOTS', 1))))
    h = [f'heavy-{i}' for i in range(heavy)]
    return ([f'light-{i}' for i in range(light)] + h) if kind == 'light' else h


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def read_holder(path):
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None
    try:
        info = json.load(open(path))
    except Exception:  # noqa: BLE001 - half-written: judge by mtime
        info = {}
    age = time.time() - st.st_mtime
    idle = (time.time() - float(info['progress']) / 1000) if info.get('progress') else None   # s since its last frame, if it reports
    hung = idle is not None and idle > progress_stale_s(info)
    stale = age > STALE_S or (info.get('host') == socket.gethostname() and info.get('pid') and not _alive(info['pid'])) or hung
    return {**info, 'age': age, 'idle': idle, 'hung': bool(hung), 'stale': bool(stale), 'file': path}


def status():
    d = slot_dir()
    try:
        names = sorted(f for f in os.listdir(d) if f.endswith('.lock'))
    except FileNotFoundError:
        names = []
    return [{'lane': f[:-5], **(read_holder(os.path.join(d, f)) or {})} for f in names]


def _try_take(lane, info):
    path = os.path.join(slot_dir(), f'{lane}.lock')
    for _ in range(2):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            with os.fdopen(fd, 'w') as f:
                json.dump(info, f)
            return path
        except FileExistsError:
            h = read_holder(path)
            if h is None:
                continue
            if not h['stale']:
                return None
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)
    return None


@contextlib.contextmanager
def hold(kind='heavy', label=None, log=print, poll_s=3.0):
    """Wait for a lane of `kind` ('heavy' | 'light'), hold it for the with-block (heartbeat thread), then release."""
    names = lanes(kind)
    if not names:
        yield None
        return
    os.makedirs(slot_dir(), exist_ok=True)
    info = {'pid': os.getpid(), 'host': socket.gethostname(), 'cmd': (label or ' '.join(sys.argv))[:200], 'kind': kind,
            'started': datetime.now(timezone.utc).isoformat()}
    t0, said, path, lane = time.time(), 0.0, None, None
    while True:
        for n in names:
            path = _try_take(n, info)
            if path:
                lane = n
                break
        if path:
            break
        if time.time() - said > 60:
            said = time.time()
            held = [f"{h['lane']}: {h.get('cmd', '?')} (pid {h.get('pid')}, {h['age']:.0f} s since beat" + (f", last frame {h['idle'] / 60:.0f} min ago" if h.get('idle') is not None else '') + ')'
                    for h in status() if h['lane'] in names and not h.get('stale')]
            log(f"render slot: waiting {time.time() - t0:.0f} s for a {kind} lane; held by {' | '.join(held) or '?'} "
                f"(load {os.getloadavg()[0]:.1f}; ACP_RENDER_SLOTS=0 skips)")
        time.sleep(poll_s)
    stop = threading.Event()

    def beat():
        while not stop.wait(BEAT_S):
            with contextlib.suppress(FileNotFoundError):
                os.utime(path)
    th = threading.Thread(target=beat, daemon=True)
    th.start()
    w = time.time() - t0
    log(f"render slot: {lane} taken{f' after {w:.0f} s' if w > 1.5 else ''} (load {os.getloadavg()[0]:.1f})")
    try:
        yield lane
    finally:
        stop.set()
        with contextlib.suppress(Exception):
            h = json.load(open(path))
            if h.get('pid') == os.getpid() and h.get('host') == socket.gethostname():
                os.unlink(path)


def run(cmd, kind='heavy'):
    with hold(kind, label=' '.join(cmd), log=lambda s: print(s, file=sys.stderr, flush=True)):
        return subprocess.call(cmd)


def selftest():
    ok = []
    with tempfile.TemporaryDirectory() as d:
        os.environ['ACP_SLOT_DIR'] = d
        os.environ['ACP_RENDER_SLOTS'] = '1'
        os.environ['ACP_LIGHT_SLOTS'] = '1'
        ok.append(('lanes: light sees light + heavy, heavy sees heavy only',
                   lanes('light') == ['light-0', 'heavy-0'] and lanes('heavy') == ['heavy-0']))
        # a stale lock from a dead pid on this host is taken over at once
        json.dump({'pid': 999999, 'host': socket.gethostname(), 'cmd': 'dead'}, open(os.path.join(d, 'heavy-0.lock'), 'w'))
        with hold('heavy', 'py-holder', log=lambda s: None) as lane:
            ok.append(('dead holder taken over', lane == 'heavy-0'))
            # node, as render.mjs would: a heavy job must wait (only lane busy); a light job gets the light lane
            js = ("import {acquire} from '%s';"
                  "const k=process.argv[1];const t=Date.now();"
                  "const r=await Promise.race([acquire({kind:k,log:()=>{},pollMs:200}),new Promise(z=>setTimeout(()=>z(null),1500))]);"
                  "console.log(JSON.stringify({lane:r&&r.lane}));process.exit(0);") % os.path.join(VIDEOS, 'web', 'render_slot.mjs')
            env = dict(os.environ, NODE_EXTRA_CA_CERTS=os.environ.get('NODE_EXTRA_CA_CERTS', ''))
            out = lambda k: json.loads(subprocess.run(['node', '--input-type=module', '-e', js, k], capture_output=True,
                                                      text=True, env=env, timeout=30).stdout.strip() or '{}')
            ok.append(('node heavy job waits while python holds the only heavy lane', out('heavy').get('lane') is None))
            ok.append(('node light job takes the light lane', out('light').get('lane') == 'light-0'))
        ok.append(('released on exit (python)', not os.path.exists(os.path.join(d, 'heavy-0.lock'))))
        ok.append(('released on exit (node)', not os.path.exists(os.path.join(d, 'light-0.lock'))))
        # a live lock (this pid, fresh) is respected; an old one from another host is taken over after STALE_S
        json.dump({'pid': os.getpid(), 'host': 'elsewhere', 'cmd': 'remote'}, open(os.path.join(d, 'heavy-0.lock'), 'w'))
        ok.append(('fresh lock from another host is respected', _try_take('heavy-0', {'pid': 1}) is None))
        old = time.time() - STALE_S - 5
        os.utime(os.path.join(d, 'heavy-0.lock'), (old, old))
        ok.append(('silent lock (no heartbeat 120 s) is taken over', _try_take('heavy-0', {'pid': 1}) is not None))
        # progress backstop: alive pid, fresh heartbeat, but no frame for far longer than its watchdog -> stale
        lock = os.path.join(d, 'heavy-0.lock')
        def put(**kw):
            json.dump({'pid': os.getpid(), 'host': socket.gethostname(), 'cmd': 'render', **kw}, open(lock, 'w'))
        now_ms = time.time() * 1000
        put(progress=now_ms - 3 * 3600e3, stall_ms=600000)
        ok.append(('hung holder (alive, heartbeating, no progress for 3 h) is stale', read_holder(lock)['stale']))
        put(progress=now_ms - 20 * 60e3, stall_ms=600000)
        ok.append(('idle 20 min with a 10 min watchdog is NOT yet stale (backstop is 30 min)', not read_holder(lock)['stale']))
        put(progress=now_ms - 40 * 60e3, stall_ms=3600e3)
        ok.append(('a 60 min watchdog is never undercut by the backstop', not read_holder(lock)['stale']))
        put(progress=now_ms - 3 * 3600e3)
        ok.append(('old progress, no stall_ms: 30 min backstop applies', read_holder(lock)['stale']))
        put()
        ok.append(('holder that reports no progress (gate, slot.py, older render) is never judged by it', not read_holder(lock)['stale']))
        put(progress=now_ms - 3 * 3600e3, stall_ms=600000)
        ok.append(('hung lane is taken over by a waiter', _try_take('heavy-0', {'pid': 1}) is not None))
        os.unlink(lock)
        # node side: acquire({stallMs}) records progress + stall_ms, progress() is saved by the heartbeat, release frees it
        js2 = ("import {acquire, readHolder} from '%s';"
               "const r=await acquire({kind:'heavy',log:()=>{},stallMs:600000,label:'t'});"
               "const a=readHolder(process.argv[1]+'/'+r.lane+'.lock');"
               "await new Promise(z=>setTimeout(z,50));r.progress();"
               "console.log(JSON.stringify({stall:a.stall_ms,has:a.progress>0,idle:a.idle<5000,hung:a.hung}));r.release();"
               "console.log(JSON.stringify({gone:!readHolder(process.argv[1]+'/'+r.lane+'.lock')}));process.exit(0);") % os.path.join(VIDEOS, 'web', 'render_slot.mjs')
        o2 = subprocess.run(['node', '--input-type=module', '-e', js2, d], capture_output=True, text=True, timeout=30).stdout.strip().split('\n')
        try:
            r1, r2 = json.loads(o2[0]), json.loads(o2[1])
        except Exception:  # noqa: BLE001
            r1, r2 = {}, {}
        ok.append(('node acquire({stallMs}) records stall_ms and progress; not hung; released', r1.get('stall') == 600000 and r1.get('has') and r1.get('idle') and not r1.get('hung') and r2.get('gone')))
        # node reads a hung python-written lock as stale too (shared protocol)
        put(progress=now_ms - 3 * 3600e3, stall_ms=600000)
        js3 = ("import {readHolder} from '%s';console.log(JSON.stringify(readHolder(process.argv[1]).stale));") % os.path.join(VIDEOS, 'web', 'render_slot.mjs')
        ok.append(('node sees the hung lane as stale', subprocess.run(['node', '--input-type=module', '-e', js3, lock], capture_output=True, text=True, timeout=30).stdout.strip() == 'true'))
        os.unlink(lock)
        os.environ['ACP_RENDER_SLOTS'] = '0'
        with hold('heavy', log=lambda s: None) as lane:
            ok.append(('ACP_RENDER_SLOTS=0 skips', lane is None))
    for k, v in ok:
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    return all(v for _, v in ok)


def main():
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if a[0] == '--selftest':
        return 0 if selftest() else 1
    if a[0] == 'status':
        rows = status()
        print(f"slots in {slot_dir()}: heavy {len(lanes('heavy'))}, light {len(lanes('light')) - len(lanes('heavy'))}; "
              f"load {' '.join(f'{x:.1f}' for x in os.getloadavg())} on {os.cpu_count()} cores")
        for h in rows:
            print(f"  {h['lane']:<8} {'STALE ' if h.get('stale') else ''}pid {h.get('pid')}@{h.get('host')}  "
                  f"since {h.get('started', '?')}  beat {h.get('age', 0):.0f} s ago"
                  + (f"  last frame {h['idle'] / 60:.1f} min ago{' (HUNG: lane may be taken over)' if h.get('hung') else ''}" if h.get('idle') is not None else '')
                  + f"  {h.get('cmd', '')}")
        if not rows:
            print('  (all free)')
        return 0
    if a[0] == 'run':
        kind = 'light' if '--light' in a[:a.index('--') if '--' in a else len(a)] else 'heavy'
        if '--' not in a or a.index('--') == len(a) - 1:
            print('slot.py run [--light] -- CMD ...', file=sys.stderr)
            return 2
        return run(a[a.index('--') + 1:], kind)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
