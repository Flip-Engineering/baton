#!/usr/bin/env python3
"""Exercise queue launchers and bootstrap with disposable compiler processes."""
import json
import importlib.util
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ['BATON2_COMPILE_QUEUE_BIN']).resolve()
T = Path(tempfile.mkdtemp(prefix='compile-queue-custody-'))
STATE = T / 'queue'
STATE.mkdir()
STATE.chmod(0o2770)
SOURCE = T / 'source'
SCRIPTS = SOURCE / 'bend2/scripts'
SCRIPTS.mkdir(parents=True)
ENTRY = SOURCE / 'bend2/src/host/compile-queue.bend'
ENTRY.parent.mkdir(parents=True)
ENTRY.write_text('import Base\ndef main() -> IO(Unit): IO.pure(Unit,Unit{})\n')
for name in ('bootstrap-compile-queue.sh', 'compile-queue.sh'):
    shutil.copyfile(ROOT / 'bend2/scripts' / name, SCRIPTS / name)
REFERENCE = T / 'ref-compile-queue.sh'
shutil.copyfile(SCRIPTS / 'compile-queue.sh', REFERENCE)
FAKE = T / 'compiler'
FAKE.write_text('''#!/usr/bin/env python3
import json,os,pathlib,subprocess,sys,time
if sys.argv[1:] in (['version'], ['--version']):
 print('bend 2.0.25');sys.exit(0)
if sys.argv[1:] == ['-print-prog-name=ld']:
 print(sys.argv[0]);sys.exit(0)
root=pathlib.Path(os.environ['CUSTODY_TEST_ROOT'])
tag=os.environ.get('CUSTODY_TEST_TAG','fake')
phase='link' if '-O1' in sys.argv else 'compile'
active=root/'active'
try: fd=os.open(active,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
except FileExistsError:
 with (root/'events').open('a') as f:f.write(json.dumps({'event':'overlap','tag':tag})+'\\n')
 sys.exit(91)
os.close(fd)
def event(name):
 row={'event':name,'tag':tag,'phase':phase,'pid':os.getpid(),'ns':time.time_ns()}
 try: row['lock_identity']='%s:%s'%(os.fstat(8).st_dev,os.fstat(8).st_ino)
 except OSError: pass
 with (root/'events').open('a') as f:f.write(json.dumps(row)+'\\n')
event('start')
time.sleep(float(os.environ.get('CUSTODY_TEST_DELAY','0.15')))
if os.environ.get('CUSTODY_TEST_NESTED') == '1':
 event('cgen-end');active.unlink()
 pathlib.Path(os.environ['BATON_COMPILE_QUEUE_COMPILED']).touch()
 env=dict(os.environ,CUSTODY_TEST_NESTED='0',CUSTODY_TEST_TAG=tag+'-cc')
 args=[os.environ['BATON2_COMPILE_QUEUE_BIN'],'--','run','--kind','cc',
  '--cwd',str(root),'--source-root',str(root),
  '--compiler',sys.argv[0],'--linker',sys.argv[0],'--version','bend 2.0.25',
  '--input',sys.argv[0],'--artifact','binary='+str(root/(tag+'-cc.out')),
  '--option','test='+tag,'--',sys.argv[0],'-o',str(root/(tag+'-cc.out'))]
 rc=subprocess.run(args,env=env).returncode
 if rc:sys.exit(rc)
 event('nested-completed')
 if '-o' in sys.argv:pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text('int main(void) { return 0; }\\n')
 sys.exit(0)
rc=int(os.environ.get('CUSTODY_TEST_FAIL','0')) if phase==os.environ.get('CUSTODY_TEST_FAIL_PHASE','compile') else 0
if not rc and '-o' in sys.argv:pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text('int main(void) { return 0; }\\n')
if rc:print('synthetic '+phase+' failure',file=sys.stderr)
event('end');active.unlink();sys.exit(rc)
''')
FAKE.chmod(0o755)
BASE = dict(os.environ, BATON2_COMPILE_QUEUE_BIN=str(BINARY),
            BATON_COMPILE_QUEUE_ROOT=str(STATE), BEND=str(FAKE), CC=str(FAKE),
            CUSTODY_TEST_ROOT=str(T))
BASE.pop('BATON2_COMPILE_QUEUE', None)
BASE.pop('BATON_COMPILE_QUEUE_TELEMETRY', None)

def compile_cc_helper():
    spec = importlib.util.spec_from_file_location('compile_queue', ROOT / 'bend2/test/compile_queue.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = os.environ.copy()
    try:
        os.environ.clear()
        os.environ.update(BASE, CUSTODY_TEST_TAG='python-direct-native')
        module.compile_cc([str(FAKE), '-o', str(T / 'python-direct-native.bin')],
                          [FAKE], T / 'python-direct-native.bin', T)
    finally:
        os.environ.clear()
        os.environ.update(original)

def events():
    return [json.loads(line) for line in (T / 'events').read_text().splitlines()] if (T / 'events').exists() else []

def launch(tag, bootstrap=False, launcher=None, separated=False, **extra):
    env = dict(BASE, CUSTODY_TEST_TAG=tag, **extra)
    if bootstrap:
        args = ['sh', str(SCRIPTS / 'bootstrap-compile-queue.sh'), str(T / tag)]
    else:
        args = ['sh', str(launcher or SCRIPTS / 'compile-queue.sh'), 'run', '--kind', 'cgen',
                '--cwd', str(SOURCE), '--root', str(SOURCE), '--source-root', str(SOURCE),
                '--entry', 'bend2/src/host/compile-queue.bend', '--compiler', str(FAKE),
                '--artifact', 'output.c=' + str(T / (tag + '.c')), '--option', 'test=' + tag,
                '--', str(FAKE), '-o', str(T / (tag + '.c'))]
    if separated:
        args.insert(2, '--')
    out = (T / (tag + '.out')).open('w')
    err = (T / (tag + '.err')).open('w')
    p = subprocess.Popen(args, env=env, stdout=out, stderr=err)
    out.close(); err.close()
    return p

def wait(p, expected=0):
    rc = p.wait()
    assert rc == expected, (p.args, rc, expected, T)

def records():
    return list((STATE / 'bootstrap-runs').glob('*/telemetry'))

def wait_event(tag, name):
    # This deadline detects a broken disposable fixture; it does not run a compiler.
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if any(r['event'] == name and r['tag'] == tag for r in events()):
            return
        time.sleep(0.02)
    raise AssertionError(('stub event missing', tag, name, T))

def wait_started(tag):
    wait_event(tag, 'start')

try:
    for state in ('', 'relative'):
        p = launch('bad-root-' + (state or 'empty'), True, BATON_COMPILE_QUEUE_ROOT=state)
        wait(p, 2)
    assert not events()
    print('PASS bootstrap requires the configured absolute state root')

    a = launch('native')
    b = launch('retained-reference', launcher=REFERENCE)
    c = launch('bootstrap', True)
    for p in (a, b, c): wait(p)
    assert all((T / name).is_file() for name in ('native.c', 'retained-reference.c', 'bootstrap'))
    assert not any(r['event'] == 'overlap' for r in events())
    print('PASS native, maintained retained launcher and bootstrap serialize')

    wait(launch('explicit-runtime-separator', separated=True))
    prefix = T / 'prefix'
    (prefix / 'bin').mkdir(parents=True)
    (prefix / 'bin/baton-compile-queue').symlink_to(BINARY)
    wait(launch('retained-self-selection', launcher=REFERENCE,
                BATON2_COMPILE_QUEUE_BIN='', BATON2_COMPILE_QUEUE=str(REFERENCE),
                BATON2_PREFIX=str(prefix)))
    print('PASS caller separator and retained launcher selection reach the native queue')
    compile_cc_helper()
    print('PASS Python fixture helper invokes the native queue with its runtime separator')

    for phase, code in (('compile', 3), ('link', 7)):
        export = T / (phase + '-telemetry')
        prior = set(records())
        p = launch('failure-' + phase, True, CUSTODY_TEST_FAIL=str(code),
                   CUSTODY_TEST_FAIL_PHASE=phase, BATON_COMPILE_QUEUE_TELEMETRY=str(export))
        wait(p, code)
        record, = set(records()) - prior
        text = record.read_text()
        assert 'terminal_status=' + str(code) + '\n' in text
        assert 'last_phase=' + phase + '\n' in text
        assert 'child_starttime=' in text
        assert (record.parent / (phase + '.stderr')).read_text() == 'synthetic ' + phase + ' failure\n'
        assert export.read_text() == text
    wait(launch('after-failures'))
    print('PASS compile/link failures retain logs and release custody')

    p = launch('retained-child', True, CUSTODY_TEST_DELAY='1')
    wait_started('retained-child')
    os.kill(p.pid, signal.SIGKILL)
    wait(p, -signal.SIGKILL)
    wait(launch('after-parent-exit'))
    rows = events()
    end = next(r['ns'] for r in rows if r['tag'] == 'retained-child' and r['event'] == 'end')
    start = next(r['ns'] for r in rows if r['tag'] == 'after-parent-exit' and r['event'] == 'start')
    assert end <= start
    assert not any(r['event'] == 'overlap' for r in rows)
    print('PASS a surviving bootstrap compiler retains the lock after caller exit')

    lock = STATE / 'heavy.lock'
    identity = f'{lock.stat().st_dev}:{lock.stat().st_ino}'
    for record in records():
        assert 'lock_identity=' + identity + '\n' in record.read_text()
    print('PASS bootstrap records the actual shared lock device and inode')

    def exit_supervisor(tag, **extra):
        p = launch(tag, CUSTODY_TEST_DELAY='1', **extra)
        wait_started(tag)
        event = next(r for r in events() if r['tag'] == tag and r['event'] == 'start')
        stat = Path('/proc') / str(event['pid']) / 'stat'
        supervisor = int(stat.read_text().rsplit(')', 1)[1].split()[1])
        active = [r for r in (STATE / 'keys').glob('*/active')
                  if ('pid=' + str(supervisor) + '\n') in r.read_text()]
        assert len(active) == 1, ('fixture supervisor identity', supervisor, T)
        os.kill(supervisor, signal.SIGKILL)
        # The killed process is the active supervisor of this fixture's stub.
        return p

    if '--native-supervisor-exit' in sys.argv[1:]:
        p = exit_supervisor('native-retained-child')
        wait(launch('after-native-supervisor-exit', True))
        assert not any(r['event'] == 'overlap' for r in events())
        p.wait()
        print('PASS native compiler retains custody after its supervisor exits')

    if '--native-supervisor-marker' in sys.argv[1:]:
        p = exit_supervisor('native-marker-child', CUSTODY_TEST_NESTED='1')
        wait_started('native-marker-child-cc')
        wait_event('native-marker-child', 'nested-completed')
        wait(launch('after-orphan-marker'))
        p.wait()
        assert not any(r['event'] == 'overlap' for r in events())
        print('PASS surviving compiler releases its marker and completes nested queued C work')
    print('evidence=' + str(T))
except BaseException:
    print('evidence=' + str(T), file=sys.stderr)
    raise
