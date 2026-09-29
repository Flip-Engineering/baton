"""Isolated EMFILE probe for the retained keeper's control-accept path (extended).

Provider-free. The only descriptor limit changed is the fixture child's own
RLIMIT_NOFILE (set in preexec_fn); no host, resident or global limit is touched.
Runs the process-test binary built from 0dcea66e.
"""
import json, os, pathlib, resource, shutil, signal, socket, struct, subprocess, sys, tempfile, threading, time

EXE = pathlib.Path('/Users/wahargis/Development/Experiments/baton-bend2-native-replies-641/.scratch/bend2/process-test')
LIMIT = int(os.environ.get('PROBE_NOFILE', '64'))
FLOOD = int(os.environ.get('PROBE_FLOOD', '120'))

FIXTURE = r'''import json,os,pathlib,signal,socket,sys
port=int(sys.argv[1])
def connect(role):
    sock=socket.create_connection(('127.0.0.1',port))
    stream=sock.makefile('rwb',buffering=0)
    def send(value): stream.write((json.dumps(value)+'\n').encode())
    signal.signal(signal.SIGUSR1,lambda sig,frame: send({'signal':sig,'pid':os.getpid()}))
    send({'role':role,'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp()})
    return sock,stream,send
sock,stream,send=connect('native')
for line in stream:
    action=json.loads(line)
    if action.get('finish'): break
'''

def stat_of(pid):
    out = subprocess.run(['ps','-o','stat=','-p',str(pid)], text=True, capture_output=True).stdout.strip()
    return out

def alive(pid):
    s = stat_of(pid)
    if not s:
        return False
    return not s.startswith('Z')

def limiter():
    resource.setrlimit(resource.RLIMIT_NOFILE, (LIMIT, LIMIT))

def main():
    home = pathlib.Path(tempfile.mkdtemp(prefix='git11-emfile-'))
    report = {'limit': LIMIT, 'flood_requested': FLOOD}
    children, connections = [], []
    server = socket.socket(); server.bind(('127.0.0.1', 0)); server.listen(); server.settimeout(10)
    try:
        db = home/'session.db'; db.touch()
        attempt = home/'attempt'
        fixture = home/'native.py'; fixture.write_text(FIXTURE)
        payload = home/'initial.input'; payload.write_bytes(b'{"label":"observer","body":""}\n')
        observer = subprocess.Popen(
            [str(EXE), 'retain', str(db), str(attempt), str(home), str(payload), 'open',
             sys.executable, str(fixture), str(server.getsockname()[1]), 'frames'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            preexec_fn=limiter)
        children.append(observer)
        lines = []
        threading.Thread(target=lambda: [lines.append(l.rstrip('\n')) for l in observer.stdout], daemon=True).start()
        conn, _ = server.accept(); conn.settimeout(10)
        native = json.loads(conn.makefile('rwb', buffering=0).readline())
        deadline = time.monotonic()+15
        while time.monotonic() < deadline and 'observer-write-start' not in lines:
            time.sleep(.05)
        report['native'] = native
        report['observer_ready'] = 'observer-write-start' in lines
        keeper_pid = native['ppid']; report['keeper_pid'] = keeper_pid
        manifest = (attempt/'manifest').read_bytes()
        header = struct.Struct('=8s6Q2I'); magic, *fields = header.unpack_from(manifest)
        lengths = fields[:6]; off = header.size + sum(lengths[:5])
        address = manifest[off:off+lengths[5]].decode(); report['control_address'] = address

        report['lock_before_flood'] = run_lock(db)

        opened = 0
        for _ in range(FLOOD):
            try:
                c = socket.socket(socket.AF_UNIX); c.settimeout(5); c.connect(address)
                connections.append(c); opened += 1
            except OSError as e:
                report['flood_stopped_at'] = {'opened': opened, 'errno': e.errno, 'error': str(e)}
                break
        report['opened'] = opened
        time.sleep(3)
        report['keeper_after_flood'] = {'ps': stat_of(keeper_pid), 'alive': alive(keeper_pid)}
        report['observer_after_flood'] = {'returncode': observer.poll()}
        report['native_after_flood'] = {'ps': stat_of(native['pid']), 'alive': alive(native['pid'])}
        report['attempt_files'] = sorted(p.name for p in attempt.iterdir())
        for name in ('keeper.log','keeper-error','observer-error','status','launch','native.pid'):
            p = attempt/name
            report[f'file:{name}'] = p.read_text(errors='replace')[:500] if p.exists() else None
        report['lock_after_flood'] = run_lock(db)
        late = home/'late.input'; late.write_bytes(b'{"label":"late"}\n')
        result = subprocess.run([str(EXE),'control-write',str(attempt),str(late)],
                                text=True, capture_output=True, timeout=15)
        report['late_control'] = {'rc': result.returncode, 'stdout': result.stdout.strip(),
                                  'stderr': result.stderr.strip()[:300]}
        report['observer_stdout_tail'] = lines[-8:]
        report['observer_stderr'] = observer.stderr.read()[:400] if observer.poll() is not None else ''
        report['native_still_orphan'] = {'ps': stat_of(native['pid'])}
    except Exception as e:
        report['probe_error'] = f'{type(e).__name__}: {e}'
    finally:
        for c in connections:
            try: c.close()
            except OSError: pass
        try: server.close()
        except OSError: pass
        for ch in children:
            if ch.stdin and not ch.stdin.closed: ch.stdin.close()
            if ch.poll() is None:
                ch.terminate()
                try: ch.wait(timeout=5)
                except subprocess.TimeoutExpired: ch.kill()
        for row in subprocess.run(['ps','-axo','pid=,command='], text=True, capture_output=True).stdout.splitlines():
            if str(home) in row:
                try: os.kill(int(row.split()[0]), signal.SIGKILL)
                except (ProcessLookupError, ValueError): pass
        shutil.rmtree(home, ignore_errors=True)
    print(json.dumps(report, indent=1))

def run_lock(db):
    r = subprocess.run([str(EXE),'lock-try',str(db)], text=True, capture_output=True, timeout=15)
    return {'rc': r.returncode, 'stdout': r.stdout.strip(), 'stderr': r.stderr.strip()[:200]}

main()
