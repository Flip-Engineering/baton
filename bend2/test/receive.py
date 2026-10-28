"""Native inbox delivery with controlled harness processes and real coordinator state."""
import errno
import fcntl
import hashlib
import json
import os
import pathlib
import select
import shlex
import shutil
import signal
import socket
import sqlite3
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

def require_candidate():
    """Require the bound candidate when qualification sets its SHA256."""
    expected = os.environ.get('BATON_TEST_EXPECT_SHA256', '')
    if not EXE.exists():
        if expected:
            raise AssertionError(f'Coordinator missing at {EXE}; expected sha256 {expected}')
        return False
    if expected:
        actual = hashlib.sha256(EXE.read_bytes()).hexdigest()
        if actual != expected:
            raise AssertionError(f'Coordinator sha256 mismatch at {EXE}: {actual} != {expected}')
    return True


def write_public_queue_codex(directory, calls):
    executable = pathlib.Path(directory) / 'codex'
    executable.write_text('#!' + sys.executable + '\n' + r'''
import base64,hashlib,json,pathlib,struct,sys
if sys.argv[1:2]==['queue']:
    args=sys.argv[2:]
    thread=args[args.index('--thread')+1]
    message=args[args.index('--message')+1]
    with pathlib.Path(__CALLS__).open('a') as output:
        output.write(json.dumps({'method':'codex queue','threadId':thread,'message':message})+chr(10))
    print('Queued message fixture-queue for thread '+thread+'.')
    raise SystemExit(0)
assert sys.argv[1:]==['app-server','proxy'], sys.argv
def exact(n):
    data=b''
    while len(data)<n:
        part=sys.stdin.buffer.read(n-len(data))
        if not part: raise EOFError('fixture input closed')
        data+=part
    return data
def reply(value):
    payload=json.dumps(value).encode()
    n=len(payload)
    size=bytes([n]) if n<126 else bytes([126])+struct.pack('!H',n) if n<65536 else bytes([127])+struct.pack('!Q',n)
    sys.stdout.buffer.write(bytes([129])+size+payload)
    sys.stdout.buffer.flush()
header=b''
while not header.endswith(b'\r\n\r\n'):header+=exact(1)
key=next(line.split(b':',1)[1].strip() for line in header.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
sys.stdout.buffer.write(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
sys.stdout.buffer.flush()
while True:
    a,b=exact(2)
    n=b&127
    if n==126:n=struct.unpack('!H',exact(2))[0]
    elif n==127:n=struct.unpack('!Q',exact(8))[0]
    mask=exact(4) if b&128 else None
    data=exact(n)
    if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
    if a&15==8:break
    request=json.loads(data)
    method=request['method']
    if 'id' not in request:continue
    if method=='initialize':result={}
    elif method=='thread/read':
        status='notLoaded' if __import__('os').environ.get('BATON_FIXTURE_RESUME_CONFLICT')=='1' else 'active'
        if status=='notLoaded':
            with pathlib.Path(__CALLS__).open('a') as output:
                output.write(json.dumps({'method':method,'threadId':request['params']['threadId']})+chr(10))
        result={'thread':{'id':request['params']['threadId'],'status':{'type':status}}}
    elif method=='thread/resume' and __import__('os').environ.get('BATON_FIXTURE_RESUME_CONFLICT')=='1':
        with pathlib.Path(__CALLS__).open('a') as output:
            output.write(json.dumps({'method':method,'threadId':request['params']['threadId']})+chr(10))
        reply({'id':request['id'],'error':{'code':-32000,'message':'thread '+request['params']['threadId']+' already has an active writer'}})
        continue
    elif method=='thread/turns/list':result={'data':[{'id':'fixture-turn','status':'inProgress'}],'nextCursor':None}
    elif method=='turn/steer':
        with pathlib.Path(__CALLS__).open('a') as output:
            output.write(json.dumps(request)+chr(10))
        result={'turnId':'fixture-turn'}
    else:raise AssertionError(request)
    reply({'id':request['id'],'result':result})
'''.replace('__CALLS__', repr(str(calls))))
    executable.chmod(0o700)


def install_public_queue_codex(testcase, directory):
    directory = pathlib.Path(directory)
    calls = directory / 'public-queue-calls.jsonl'
    write_public_queue_codex(directory, calls)
    previous = os.environ.get('PATH')
    if previous is None:
        testcase.addCleanup(os.environ.pop, 'PATH', None)
        os.environ['PATH'] = str(directory)
    else:
        testcase.addCleanup(os.environ.__setitem__, 'PATH', previous)
        os.environ['PATH'] = str(directory) + os.pathsep + previous
    return calls


def process_table(pid=None, names=None):
    """Every process, or the selected one, as pid, ppid, status, start and
    command. On Linux it reads /proc because ps stalls on a loaded host. The
    command line of another process is read only when its owner is this user
    and its name is in NAMES, since that read waits on the process's memory
    lock. A zombie reports its command as ps does. Other platforms run ps."""
    if not sys.platform.startswith('linux'):
        selection = ['-p', str(pid)] if pid is not None else ['-ax']
        result = subprocess.run(['ps', *selection, '-o', 'pid=,ppid=,lstart=,stat=,command='],
                                capture_output=True, text=True)
        found = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 8)
            if len(fields) >= 8:
                found.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                              'start': ' '.join(fields[2:7]), 'status': fields[7],
                              'command': fields[8] if len(fields) == 9 else ''})
        return found
    found = []
    for entry in [str(pid)] if pid is not None else os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            record = pathlib.Path('/proc', entry, 'stat').read_text()
            name = record[record.index('(') + 1:record.rindex(')')]
            if pid is None and (os.stat(pathlib.Path('/proc', entry)).st_uid != os.getuid()
                                or name not in names):
                continue
            command = pathlib.Path('/proc', entry, 'cmdline').read_bytes()
        except OSError:
            continue
        fields = record[record.rindex(')') + 1:].split()
        text = command.rstrip(b'\0').replace(b'\0', b' ').decode(errors='replace')
        found.append({'pid': int(entry), 'ppid': int(fields[1]), 'start': fields[19], 'status': fields[0],
                      'command': text if text else '[' + name + '] <defunct>' if fields[0] == 'Z' else ''})
    return found


def _session_lock_path(db, session):
    info = os.stat(db)
    key = 'owner-%x-%x' % (info.st_dev, info.st_ino)
    return os.path.join('/tmp', 'baton2-%u' % os.geteuid(),
                        key + '.lock-' + session.encode().hex())

def message_reads(db, ident, recipient=None):
    """Stored complete reads for one message, read-only from the fixture database."""
    with sqlite3.connect(f'{pathlib.Path(db).as_uri()}?mode=ro', uri=True) as database:
        database.row_factory = sqlite3.Row
        if recipient is None:
            rows = database.execute(
                'SELECT attempt,message,recipient,native,identity,handled '
                'FROM message_reads WHERE message=? ORDER BY attempt,identity', (ident,))
        else:
            rows = database.execute(
                'SELECT attempt,message,recipient,native,identity,handled '
                'FROM message_reads WHERE message=? AND recipient=? ORDER BY attempt,identity',
                (ident, recipient))
        return [dict(row) for row in rows]


def read_recorded(db, ident, recipient=None):
    return bool(message_reads(db, ident, recipient))


COMPLETION_EXCHANGE = r'''import pathlib,sqlite3
session=os.environ.get('BATON_SESSION',model)
def coordinator(*arguments):
    return json.loads(subprocess.check_output([config['exe'],config['db'],*arguments],text=True))
def confirm_finished_fixture_task(body):
    state=coordinator('session',session)
    completion=state['taskCompletion']
    if not completion['open']: return
    parent=completion['coordinator']
    request=completion['requestId'] or ('fixture-completion-'+str(os.getpid()))
    if not completion['requestId']:
        # The scripted coordinator reviews this request synchronously. Explicit
        # lifecycle cases below exercise public request delivery and wake.
        with sqlite3.connect(config['db']) as database:
            database.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                             (request,session,parent,'completion-request',body))
            reviewed=database.execute('SELECT sender,recipient,kind,body FROM messages WHERE id=?',
                                      (request,)).fetchone()
            assert reviewed==(session,parent,'completion-request',body),reviewed
    reviewed=coordinator('delivery',request)
    assert reviewed['sender']==session and reviewed['recipient']==parent,reviewed
    confirmation=request+':confirmed'
    coordinator('message',confirmation,parent,session,'completion-confirmed',request)
    reviewed=coordinator('delivery',confirmation)
    assert reviewed['body']==request,reviewed
'''

FIXTURE = r'''import json,os,pathlib,re,socket,sqlite3,subprocess,sys,time
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'fixture.json').read_text())
args=sys.argv[1:]
if '--profile' in args and config.get('dsh_public_read'):
    # Controlled DSH headless native for the public-read regression. The task
    # arrives on stdin; each referenced input is read through the public CLI
    # with the launch's BATON_DATABASE/BATON_SESSION/BATON_ATTEMPT_DIRECTORY
    # context, so the coordinator records the complete read itself.
    session=os.environ.get('BATON_SESSION','')
    print(json.dumps({'type':'session','sessionId':'dsh-native-'+str(os.getpid()),'cwd':os.getcwd()},separators=(',',':')),flush=True)
    task=sys.stdin.read()
    identifiers=list(dict.fromkeys(re.findall(r'\[id: ([^\]]+)\]',task)))
    late=config.get('dsh_late_read','')
    if late:
        # The test delivers this input after admission, so only the public read
        # below can record it.
        (home/'dsh-ready').write_text('ready\n')
        while not (home/'dsh-release').exists(): time.sleep(.01)
        identifiers=[late] if config.get('dsh_read_prompt',True) is False else list(dict.fromkeys(identifiers+[late]))
    database=config['db']
    environment=None
    snapshot=config.get('dsh_readonly_snapshot')
    if snapshot:
        # The public read runs against a read-only snapshot of the live attempt
        # state, reproducing a recipient whose database cannot accept the read
        # record. The read body is still returned; the recording write fails.
        source=sqlite3.connect('file:'+config['db']+'?mode=ro',uri=True)
        target=sqlite3.connect(snapshot)
        source.backup(target)
        if identifiers:
            target.execute('DELETE FROM message_reads WHERE message IN (' +
                           ','.join('?' for _ in identifiers) + ')', identifiers)
            target.commit()
        target.close();source.close()
        os.chmod(snapshot,0o444)
        database=snapshot
        environment=dict(os.environ,BATON_DATABASE=snapshot)
    for ident in identifiers:
        result=subprocess.run([config['exe'],database,'read',ident],capture_output=True,text=True,env=environment)
        with (home/'dsh-reads.jsonl').open('a') as recorded:
            recorded.write(json.dumps({'id':ident,'code':result.returncode,
                                       'stdout':result.stdout,'stderr':result.stderr})+'\n')
        if result.returncode: sys.exit(result.returncode)
    print(json.dumps({'type':'final','text':'read recorded' if identifiers else 'no input'},separators=(',',':')),flush=True)
    sys.exit(0)
if args[:1]==['legacy_keeper']:
    import array,ctypes,fcntl,select,struct
    legacy=config['legacy_keeper']
    directory=pathlib.Path(legacy['directory'])
    recovery=legacy['recovery']
    frame=struct.Struct('=IiQQq')
    guard=open(legacy['guard'],'a+b')
    fcntl.flock(guard,fcntl.LOCK_EX)
    listener=socket.socket(socket.AF_UNIX)
    listener.bind(legacy['control']);listener.listen()
    fields=[('\0'.join(legacy['native'])+'\0').encode(),str(home).encode(),
            str(directory/'native.stderr').encode(),legacy['initial'].encode(),
            ('\0'.join(recovery)+'\0').encode(),legacy['control'].encode()]
    (directory/'manifest').write_bytes(struct.pack('=8s6Q2I',b'BATONRP1',
                                                *map(len,fields),1,0)+b''.join(fields))
    spool=open(directory/'stdout','ab',buffering=0)
    with open(directory/'native.stderr','ab') as diagnostic:
        native=subprocess.Popen(legacy['native'],cwd=home,stdin=subprocess.PIPE,
                                stdout=spool,stderr=diagnostic,start_new_session=True)
    if sys.platform=='darwin':
        library=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
        library.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,
                                      ctypes.c_void_p,ctypes.c_int]
        info=ctypes.create_string_buffer(136)
        assert library.proc_pidinfo(native.pid,3,0,info,len(info))==len(info)
        birth=struct.unpack_from('=QQ',info.raw,120)
    else:
        ticks=int(pathlib.Path('/proc',str(native.pid),'stat').read_text().rsplit(')',1)[1].split()[19])
        boot=next(int(line.split()[1]) for line in pathlib.Path('/proc/stat').read_text().splitlines()
                  if line.startswith('btime '))
        birth=(ticks,boot)
    (directory/'native.birth').write_bytes(struct.pack('=i4xQQ',native.pid,*birth))
    (directory/'native.pid').write_text(str(native.pid)+'\n')
    (directory/'launch').write_text('launch\n')
    native.stdin.write(fields[3]);native.stdin.flush()
    client=None;status=None;closed=False;released=False;size=0
    def exact(connection,length):
        data=b''
        while len(data)<length:
            part=connection.recv(length-len(data))
            if not part: raise EOFError()
            data+=part
        return data
    def disconnected():
        global client
        client.close();client=None
        with open(directory/'observer.log','ab') as output:
            recovered=subprocess.Popen(recovery,cwd=home,stdout=output,stderr=output)
        with open(directory/'legacy-recoveries.jsonl','a') as launches:
            launches.write(json.dumps({'pid':recovered.pid,'argv':recovery})+'\n')
    def send(operation,serial=0,error=0,value=0):
        try: client.sendall(frame.pack(operation,error,serial,0,value))
        except (BrokenPipeError,ConnectionResetError): disconnected()
    while True:
        result=native.poll()
        if result is not None and status is None:
            status=result<<8 if result>=0 else -result
            (directory/'status').write_text(str(status)+'\n')
            if client is not None: send(3,value=status)
        current=os.fstat(spool.fileno()).st_size
        if current!=size:
            size=current
            if client is not None: send(2)
        ready,_,_=select.select([listener]+([client] if client is not None else []),[],[],.01)
        for connection in ready:
            if connection is listener:
                candidate,_=listener.accept()
                operation,error,serial,length,value=frame.unpack(exact(candidate,frame.size))
                assert (operation,serial,value)==(11,0,0)
                assert exact(candidate,length)==str(directory).encode()+b'\0'
                if client is not None:
                    candidate.sendall(frame.pack(1,16,0,0,0));candidate.close()
                else:
                    client=candidate
                    state=struct.pack('=5i',native.pid,status is not None,status or 0,released,closed)
                    client.sendmsg([frame.pack(1,0,0,len(state),2)],
                                   [(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[guard.fileno()]))])
                    client.sendall(state)
                continue
            if connection is not client: continue
            try:
                operation,error,serial,length,value=frame.unpack(exact(client,frame.size))
                payload=exact(client,length)
            except (EOFError,ConnectionResetError):
                disconnected()
                continue
            with open(directory/'legacy-wire.jsonl','a') as wire:
                wire.write(json.dumps({'operation':operation,'serial':serial})+'\n')
            if operation==14:
                # The retained ecfb keeper accepts serial-zero READY.
                assert serial==0 and not payload
                continue
            if operation==5:
                native.stdin.write(payload);native.stdin.flush()
            elif operation==6:
                if not closed:
                    native.stdin.close();closed=True;send(10)
            elif operation==7:
                os.killpg(native.pid,value)
            elif operation==8:
                assert status is not None
                guard.close();released=True
                (directory/'released').write_text('released\n')
            elif operation==9:
                assert status is not None and released
                (directory/'acknowledged').write_text('acknowledged\n')
                (directory/'stdout').unlink()
                send(4,serial);client.close();listener.close();spool.close()
                sys.exit(0)
            else: raise AssertionError(operation)
            send(4,serial)
if args[:1] in (['parent_endpoint'],['answering_parent']):
    messages=json.loads(subprocess.check_output([config['exe'],config['db'],'inbox','root'],text=True))
    if args[0]=='answering_parent': messages=[message for message in messages if message['id']==args[1]]
    if args[0]=='parent_endpoint' and config.get('hold_parent_delivery'):
        with socket.create_connection(('127.0.0.1',config['port'])) as client:
            with client.makefile('rwb',buffering=0) as control:
                control.write((json.dumps({'session':'parent-delivery','pid':os.getpid(),'messages':messages})+'\n').encode())
                assert json.loads(control.readline())=={'continue_delivery':True}
    for message in messages:
        if args[0]=='answering_parent' and message['kind']=='question':
            request=json.loads(message['body'])
            result=subprocess.run([config['exe'],config['db'],'native-reply','root',request['requestId'],json.dumps(config['native_answer'])],capture_output=True,text=True)
            with (home/'parent-answers.jsonl').open('a') as answered:
                answered.write(json.dumps({'request':request,'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})+'\n')
            if result.returncode: sys.exit(result.returncode)
            if config.get('read_root',True):
                subprocess.run([config['exe'],config['db'],'as','root','read',message['id']],check=True,stdout=subprocess.DEVNULL)
            (home/'parent-awaiting-delivery').write_text(str(os.getpid()))
            while not (home/'parent-report-delivered').exists(): time.sleep(.01)
            (home/'parent-question-complete').write_text('report received\n')
        if config.get('read_root',True):
            subprocess.run([config['exe'],config['db'],'as','root','read',message['id']],check=True,stdout=subprocess.DEVNULL)
        if args[0]=='answering_parent' and message['kind']=='report':
            (home/'parent-report-delivered').write_text(json.dumps(message))
        with (home/'parent-deliveries.jsonl').open('a') as delivered:
            delivered.write(json.dumps(message)+'\n')
    print(json.dumps({'received':args[1]}))
    sys.exit(0)
def configured_home(store):
    text=pathlib.Path(store)/'config.toml'
    if not store or not text.exists(): return ''
    for line in text.read_text().splitlines():
        if line.strip().startswith('sqlite_home'):
            return line.split('=',1)[1].strip().strip('"')
    return ''
def effective_history_home(arguments):
    override=''
    for index,argument in enumerate(arguments[:-1]):
        if argument=='-c' and arguments[index+1].startswith('sqlite_home='):
            override=arguments[index+1].split('=',1)[1].strip('"')
    return override or configured_home(os.environ.get('CODEX_HOME','')) or os.environ.get('CODEX_SQLITE_HOME','') or os.environ.get('CODEX_HOME','')
if 'app-server' in args:
    def answer(request):
        identifier=request.get('id')
        if identifier is None: return
        method=request.get('method','')
        if method=='initialize': print(json.dumps({'id':identifier,'result':{'userAgent':'fixture','capabilities':{}}}),flush=True)
        elif method=='config/read': print(json.dumps({'id':identifier,'result':{'config':{'sqlite_home':effective_history_home(args)},'sqlite_home':effective_history_home(args)}}),flush=True)
        elif method=='thread/read':
            thread=(request.get('params') or {}).get('threadId','')
            rollout=str(pathlib.Path(os.environ.get('CODEX_HOME',''))/'sessions'/(thread+'.jsonl'))
            print(json.dumps({'id':identifier,'result':{'thread':{'id':thread,'path':rollout,'rolloutPath':rollout}}}),flush=True)
        else: print(json.dumps({'id':identifier,'error':{'code':-32601,'message':'unsupported method'}}),flush=True)
    for request_line in sys.stdin:
        request_line=request_line.strip()
        if not request_line: continue
        try: answer(json.loads(request_line))
        except ValueError: continue
    sys.exit(0)
omp='--mode' in args
claude='--input-format' in args
muse='--prompt-file' in args
# DSH takes its model from the second --patch overlay (harness/dsh-player.bend).
dsh=args[:2]==['--profile','headless']
if dsh:
    patches=[args[index+1] for index,argument in enumerate(args[:-1]) if argument=='--patch']
    model=re.search(r"^    model: '([^']*)'$",pathlib.Path(patches[1]).read_text(),re.M).group(1)
else:
    model=args[args.index('--model')+1]
session=os.environ.get('BATON_SESSION',model)
native_args=args[:]
while native_args[:1]==['-c'] and len(native_args)>1: native_args=native_args[2:]
resume=(args[args.index('--session-id')+1] if '--session-id' in args else
        args[args.index('--resume')+1] if '--resume' in args else
        native_args[2] if native_args[:2]==['exec','resume'] else '')
if config.get('record_launches'):
    with (home/'native-launches.jsonl').open('a') as launches:
        launches.write(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'resume':resume,'args':args,'home':os.environ.get('HOME',''),'piAgentDir':os.environ.get('PI_CODING_AGENT_DIR',''),'xdgConfigHome':os.environ.get('XDG_CONFIG_HOME','')})+'\n')
if omp and resume and resume==config.get('missing_resume'):
    print('Error: Session '+resume+' not found',file=sys.stderr,flush=True)
    sys.exit(1)
if config.get('early_failure'):
    print(config['early_failure'],file=sys.stderr,flush=True)
    sys.exit(1)
native='native-'+model
if omp:
    json.loads(sys.stdin.readline())
    state=json.loads(sys.stdin.readline())
    prompt=json.loads(sys.stdin.readline())['message']
    storage=pathlib.Path(args[args.index('--session-dir')+1])
    storage.mkdir(parents=True,exist_ok=True)
    if resume:
        selected=pathlib.Path(resume) if '/' in resume else storage/('2026-09-28_'+resume+'.jsonl')
        native=json.loads(selected.read_text().splitlines()[0])['id']
    else:
        (storage/('2026-09-28_'+native+'.jsonl')).write_text(json.dumps({'type':'session','id':native})+'\n')
    print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':native,'model':{'provider':'fixture','id':model}}}),flush=True)
elif dsh:
    # DSH reads the task from stdin to EOF and keeps each conversation under
    # DSH_HOME. A --session-id it does not hold is refused on stderr.
    prompt=sys.stdin.read()
    conversations=pathlib.Path(os.environ['DSH_HOME'])/'sessions'
    native=resume or 'session-'+model
    if resume and not (conversations/resume).exists():
        print('dsh: session '+resume+' not found',file=sys.stderr,flush=True)
        sys.exit(1)
    prior=(conversations/native).read_text() if resume else ''
    if config.get('record_launches'):
        with (home/'native-history.jsonl').open('a') as recorded:
            recorded.write(json.dumps({'native':native,'resume':resume,'home':os.environ['DSH_HOME'],'content':prior,'origin':''})+'\n')
    conversations.mkdir(parents=True,exist_ok=True)
    with (conversations/native).open('a') as conversation: conversation.write(json.dumps({'role':'user','content':prompt})+'\n')
    # DSH writes compact frames; Baton classifies them by their leading bytes.
    print(json.dumps({'type':'session','sessionId':native,'cwd':os.getcwd()},separators=(',',':')),flush=True)
elif muse:
    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
    native=resume or native
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.model.configured',
                      'payload':{'kind':'run_model_configured','model_id':model}}),flush=True)
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user',
                      'payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}),flush=True)
else:
    prompt=sys.stdin.read()
    if claude: prompt=json.loads(prompt)['message']['content']
    native=resume or native
    store=os.environ.get('CLAUDE_CONFIG_DIR' if claude else 'CODEX_HOME','')
    history_home=store if claude else effective_history_home(args)
    thread=resume or native
    candidates=([pathlib.Path(store)/'projects'/'fixture-project'/(thread+'.jsonl')] if claude else
                [pathlib.Path(store)/'sessions'/(thread+'.jsonl')])
    prior=''
    origin=''
    if resume:
        for candidate in candidates:
            if candidate.exists():
                retained=[json.loads(line) for line in candidate.read_text().splitlines() if line.strip()][-1]
                prior=retained.get('message',{}).get('content','') if claude else retained.get('content','')
                origin=str(candidate)
                break
    if config.get('record_launches'):
        with (home/'native-history.jsonl').open('a') as recorded:
            recorded.write(json.dumps({'native':native,'resume':resume,'home':history_home,'content':prior,'origin':origin})+'\n')
    if not resume:
        rollout=candidates[0]
        rollout.parent.mkdir(parents=True,exist_ok=True)
        if claude:
            rollout.write_text(json.dumps({'type':'user','sessionId':native,'message':{'role':'user','content':prompt}})+'\n')
            subagent=rollout.parent/native/'subagents'/'agent-fixture.jsonl'
            subagent.parent.mkdir(parents=True,exist_ok=True)
            subagent.write_text(json.dumps({'type':'assistant','sessionId':native,'message':{'role':'assistant','content':[{'type':'text','text':'Retained subagent work for '+prompt}]}})+'\n')
        else:
            rollout.write_text(json.dumps({'type':'session','id':native})+'\n'+json.dumps({'type':'message','role':'user','content':prompt})+'\n')
    if not (claude and config.get('hold_claude_init')):
        print(json.dumps({'type':'system','subtype':'init','session_id':native} if claude else
                         {'type':'thread.started','thread_id':native}),flush=True)
client=socket.create_connection(('127.0.0.1',config['port']))
stream=client.makefile('rwb',buffering=0)
def reply(value): stream.write((json.dumps(value)+'\n').encode())
''' + COMPLETION_EXCHANGE + r'''if omp:
    while True:
        with sqlite3.connect(pathlib.Path(config['db']).as_uri()+'?mode=ro',uri=True) as database:
            binding=database.execute(
                "SELECT 1 FROM sessions s JOIN executions e ON e.session=s.id "
                "WHERE s.id=? AND s.native=? AND (? IS NULL OR e.directory=?) AND e.phase='running' "
                "AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id)",
                (session,native,os.environ.get('BATON_ATTEMPT_DIRECTORY'),
                 os.environ.get('BATON_ATTEMPT_DIRECTORY'))).fetchone()
        if binding: break
        time.sleep(.01)
def progress(action):
    print(json.dumps({'type':'fixture_progress','marker':action['progress'],'native_pid':os.getpid()}),flush=True)
    reply({'progress_written':action['progress']})
def session_lock_path(db,session):
    info=os.stat(db)
    key='owner-%x-%x'%(info.st_dev,info.st_ino)
    return '/tmp/baton2-%u/'%os.geteuid()+key+'.lock-'+session.encode().hex()
guard_descriptors=None
if config.get('inspect_session_guard'):
    guard=os.stat(session_lock_path(config['db'],session))
    guard_descriptors=[]
    for descriptor in os.listdir('/dev/fd'):
        try: info=os.fstat(int(descriptor))
        except (ValueError,OSError): continue
        if (info.st_dev,info.st_ino)==(guard.st_dev,guard.st_ino): guard_descriptors.append(int(descriptor))
reply({'pid':os.getpid(),'ppid':os.getppid(),'session':session,'native':native,'resume':resume,'args':args,'prompt':prompt,
       'cwd':os.getcwd(),'codexHome':os.environ.get('CODEX_HOME',''),'apiKeyVariablesPresent':[key for key in ('OPENAI_API_KEY','CODEX_API_KEY') if key in os.environ],
       'claudeAuthVariablesPresent':[key for key in ('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN') if key in os.environ],
       'sessionGuardDescriptors':guard_descriptors})
while True:
    line=stream.readline()
    if not line: break
    action=json.loads(line)
    if action.get('emit_claude_init'):
        assert claude
        print(json.dumps({'type':'system','subtype':'init','session_id':native}),flush=True)
        reply({'initialized':native})
        continue
    if action.get('emit_nul_tail'):
        count=int(action['emit_nul_tail'])
        os.write(1,b'\x00'*count)
        sys.stdout.flush()
        reply({'nul_tail_written':count})
        if action.get('exit_after_nul_tail',False): break
        continue
    if action.get('exit_fixture'):
        if action.get('complete_task',False):
            confirm_finished_fixture_task('Completed the controlled native observation task.')
        break
    if action.get('emit_delta_batch'):
        batch=action['emit_delta_batch']
        count=int(batch['count'])
        payload='x'*int(batch['bytes'])
        frame=json.dumps({'type':'message_update','assistantMessageEvent':{'type':'text_delta','delta':payload}})
        for _ in range(count): print(frame)
        sys.stdout.flush()
        reply({'delta_frames_written':count,'batch':batch['id']})
        continue
    if action.get('emit_checkpoint_message'):
        ident=action['emit_checkpoint_message']
        frame={'type':'message_end','message':{'id':ident,'role':'assistant','content':[{'type':'text','text':'checkpoint '+ident}]}}
        print(json.dumps(frame),flush=True)
        reply({'checkpoint_message_written':ident})
        continue
    if action.get('progress'):
        progress(action)
        continue
    if action.get('append_file'):
        name,text=action['append_file']
        with pathlib.Path(name).open('a') as target: target.write(text)
        reply({'appended':name})
        continue
    if action.get('stdout_fragment'):
        print(action['stdout_fragment'],end='',flush=True)
        reply({'fragment_written':action['stdout_fragment']})
        continue
    if action.get('read_steer'):
        if action.get('signal_steer_wait'): reply({'waiting_for_steer':True})
        if action.get('require_ready'):
            import select
            if not select.select([sys.stdin],[],[],0)[0]:
                reply({'steer_missing':True})
                continue
        frame=json.loads(sys.stdin.readline())
        assert frame['type']=='steer',frame
        if action.get('check_steer_read'):
            with sqlite3.connect(config['db']) as database:
                recorded=database.execute('SELECT count(*) FROM message_reads WHERE message=? AND recipient=?',(frame['id'],session)).fetchone()[0]
            assert recorded>0,frame
        if action.get('finish_fragment'): print(action['finish_fragment'],flush=True)
        print(json.dumps({'type':'response','command':'steer','success':True,'id':frame['id']}),flush=True)
        reply({'steer_received':frame})
        continue
    if action.get('native_request'):
        print(json.dumps(action['native_request']),flush=True)
        reply({'request_written':action['native_request']})
        continue
    if action.get('read_native_reply'):
        frame=json.loads(sys.stdin.readline())
        assert frame['type']=='extension_ui_response',frame
        print(json.dumps({'type':'fixture_progress','marker':'native continued after reply','reply_id':frame['id']}),flush=True)
        reply({'native_reply':frame})
        continue
    if action.get('turn'):
        task=home/'self-turn-task'
        task.write_text('Synchronous task for the active session.')
        command=[config['exe'],config['db'],'turn',session,action['turn'],sys.argv[0],model,'low',str(home),str(task),str(home/'self-turn.jsonl'),'']
        result=subprocess.run(command,capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('message'):
        ident,recipient,body=action['message']
        result=subprocess.run([config['exe'],config['db'],'message',ident,session,recipient,'guidance',body],capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('completion_request'):
        ident,body=action['completion_request']
        parent=coordinator('session',session)['parent']
        reply(coordinator('message',ident,session,parent,'completion-request',body))
        continue
    if action.get('promote'):
        result=subprocess.run([config['exe'],config['db'],'promote',*action['promote']],capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    reference_inputs=re.findall(r'^Message \(report\) from [^\n]* \[id: ([^\]]+)\] retained [0-9]+ bytes; read the complete body with baton read \1\.$',prompt,re.M)
    read_inputs=action.get('read',reference_inputs)
    for ident in dict.fromkeys(read_inputs):
        read=coordinator('read',ident)
        with (home/'native-reads.jsonl').open('a') as reads:
            reads.write(json.dumps({'id':ident,'read':read})+ '\n')
    failure=action.get('fail',False)
    body=action.get('body','native review complete')
    if not failure and 'fail_status' not in action and action.get('complete_task',True):
        confirm_finished_fixture_task(body)
    if omp:
        if 'fail_status' in action:
            assistant={'role':'assistant','stopReason':'error',
                       'errorMessage':action.get('fail_message','fixture provider failed'),
                       'content':[]}
            if action['fail_status'] is not None: assistant['errorStatus']=action['fail_status']
            print(json.dumps({'type':'agent_end','isTerminal':True,
                              'messages':[assistant]}),flush=True)
        else:
            print(json.dumps({'type':'agent_end','isTerminal':True,'is_error':failure,'messages':[{'role':'assistant','content':[{'type':'text','text':body}]}]}),flush=True)
        remaining_input='' if action.get('exit_after_terminal') else sys.stdin.read()
    elif claude:
        print(json.dumps({'type':'result','subtype':'error_during_execution' if failure else 'success',
                          'session_id':native,'is_error':failure,
                          'result':action.get('fail_message','fixture provider failed') if failure else body}),flush=True)
    elif dsh:
        print(json.dumps({'type':'error','message':action.get('fail_message','fixture provider failed')} if failure else
                         {'type':'final','text':body},separators=(',',':')),flush=True)
    elif muse:
        payload={'kind':'run_terminal','terminal':'failed' if failure else 'completed',
                 'command_id':'fixture-primary',
                 'text':action.get('fail_message','fixture provider failed') if failure else body}
        if 'fail_reason' in action: payload['reason']=action['fail_reason']
        print(json.dumps({'stream':{'kind':'session','id':native},
                          'payload_type':'run.terminal.failed' if failure else 'run.terminal.completed',
                          'payload':payload}),flush=True)
    elif failure:
        print(json.dumps({'type':'turn.failed','error':{'message':action.get('fail_message','fixture provider failed')}}),flush=True)
    else:
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':body}}),flush=True)
        print(json.dumps({'type':'turn.completed'}),flush=True)
    if action.get('hold_exit'):
        terminal={'terminal_written':True}
        if action.get('report_input'): terminal['input_after_prompt']=remaining_input if omp else ''
        reply(terminal)
        while True:
            line=stream.readline()
            if not line: break
            action=json.loads(line)
            if action.get('native_request'):
                print(json.dumps(action['native_request']),flush=True)
                reply({'request_written':action['native_request']})
                continue
            if action.get('stdout_line'):
                print(action['stdout_line'],flush=True)
                reply({'line_written':action['stdout_line']})
                continue
            if not action.get('progress'): break
            progress(action)
    break
stream.close()
client.close()
'''


class Receive(unittest.TestCase):
    def setUp(self):
        if not require_candidate():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix="receive ' paths ", dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.environment = None
        self.ipc = tempfile.TemporaryDirectory(prefix='baton2-receive-ipc-', dir='/tmp')
        self.addCleanup(self.ipc.cleanup)
        original_runtime = os.environ.get('XDG_RUNTIME_DIR')
        if original_runtime is None:
            self.addCleanup(os.environ.pop, 'XDG_RUNTIME_DIR', None)
        else:
            self.addCleanup(os.environ.__setitem__, 'XDG_RUNTIME_DIR', original_runtime)
        os.environ['XDG_RUNTIME_DIR'] = self.ipc.name
        (pathlib.Path(self.ipc.name) / 'baton2').mkdir(mode=0o700)
        self.original_path = os.environ.get('PATH')
        if self.original_path is None:
            self.addCleanup(os.environ.pop, 'PATH', None)
        else:
            self.addCleanup(os.environ.__setitem__, 'PATH', self.original_path)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Receive fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.db = self.directory / 'state.db'
        self.codex_calls = self.directory / 'codex-calls.jsonl'
        write_public_queue_codex(self.directory, self.codex_calls)
        os.environ['PATH'] = str(self.directory) + os.pathsep + (self.original_path or '')
        self.fixture = self.directory / 'native fixture'
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.fixture.chmod(0o755)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.addCleanup(self.server.close)
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db),
        }))
        self.children = []
        self.controls = []
        self.addCleanup(self.close_children)
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')

    def close_children(self):
        for stream, connection in self.controls:
            try:
                stream.write(b'{"exit_fixture":true}\n')
            except (OSError, ValueError):
                pass
            try:
                stream.close()
            except OSError:
                pass
            connection.close()
        # A killed observer leaves its keeper and recovery outside Popen's tree.
        # Stop this fixture's processes together so cleanup cannot spawn recovery.
        while True:
            owned = self.owned_processes()
            if not owned:
                break
            for action in (signal.SIGSTOP, signal.SIGKILL):
                for process in owned:
                    try:
                        os.kill(process['pid'], action)
                    except ProcessLookupError:
                        pass
            time.sleep(.01)
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.communicate()

    def process_names(self):
        """Process names of this run: the coordinator, its sibling entries and
        the executables the run writes."""
        return {path.name[:15] for path in [*EXE.parent.iterdir(), *self.directory.iterdir()]}

    def owned_processes(self):
        return [{key: process[key] for key in ('pid', 'ppid', 'status', 'command')}
                for process in process_table(names=self.process_names())
                if str(self.directory) in process['command'] and not process['status'].startswith('Z')]

    def eventually(self, observation, description):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(.01)

    def shutdown_idle_database_owner(self, description, reject_start=False):
        database = str(self.db.resolve())
        def idle_processes():
            if reject_start:
                self.assert_no_start()
            processes = self.owned_processes()
            if not processes:
                return (processes,)
            if len(processes) == 1:
                command = processes[0]['command']
                if ' --instance-owner ' in command and database in command:
                    return (processes,)
            return None
        processes, = self.eventually(idle_processes, description)
        if processes:
            stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                     capture_output=True, text=True)
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.eventually(lambda: not self.owned_processes(), description)

    def coord(self, *args, ok=True, executable=None, environment=None):
        selected = self.environment if environment is None else environment
        result = subprocess.run([str(executable or EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, env=selected)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        return result

    def spawn(self, *args, executable=None, environment=None):
        selected = self.environment if environment is None else environment
        child = subprocess.Popen([str(executable or EXE), str(self.db), *map(str, args)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 env=selected)
        self.children.append(child)
        return child

    def player(self, name='parent', harness='codex'):
        """Recruit the session into a fixture repository of this run."""
        return self.coord('recruit', name, 'root', harness, name, 'low', str(self.repo),
                          name + '-branch', str(self.checkouts / name), self.base)

    def receive_args(self, session, executable=None):
        return ['receive', session, str(executable or self.fixture), session, 'low',
                str(self.directory), str(self.directory / (session + '.jsonl')), '']

    def private_candidate(self):
        """Copy the candidate into a fixture package whose helper can be removed."""
        package = self.directory / 'candidate-package'
        (package / 'bin').mkdir(parents=True)
        (package / 'libexec' / 'baton2').mkdir(parents=True)
        candidate = package / 'bin' / 'baton2'
        shutil.copy2(EXE, candidate)
        candidate.chmod(0o755)
        helper = package / 'libexec' / 'baton2' / 'git-series.mjs'
        for source in (ROOT / 'bend2' / 'harness').glob('*.mjs'):
            shutil.copy2(source, package / 'libexec' / 'baton2' / source.name)
        self.assertEqual(hashlib.sha256(candidate.read_bytes()).hexdigest(),
                         hashlib.sha256(EXE.read_bytes()).hexdigest(),
                         'the private candidate copy differs from the bound candidate')
        return package, candidate, helper

    def output_log(self, session):
        """Return the path registered for the session's current receive attempt."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT g.log FROM log_generations g WHERE g.session=? "
                "ORDER BY CASE WHEN g.attempt=(SELECT id FROM executions WHERE session=g.session) "
                "THEN 0 ELSE 1 END, g.rowid DESC LIMIT 1", (session,)).fetchone()
        if row is None:
            self.fail(f'{session} has no registered output log generation')
        return pathlib.Path(row[0])

    def reference_startup_stderr(self, executable, session):
        """Read the complete platform diagnostic for the harness's fresh launch.

        The argv matches harness/codex-player.bend and runs in the fixture's
        directory with its inherited environment.
        """
        argv = ['/usr/bin/env', '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY', str(executable),
                '-c', 'forced_login_method="chatgpt"', 'exec', '--json', '--model', session,
                '-c', 'model_reasoning_effort="low"', '--dangerously-bypass-approvals-and-sandbox', '-']
        diagnostic = self.directory / 'reference-env.stderr'
        with open(diagnostic, 'wb') as stream:
            reference = subprocess.run(argv, cwd=str(self.directory), stdout=subprocess.DEVNULL,
                                       stderr=stream)
        data = diagnostic.read_bytes()
        self.assertEqual(reference.returncode, 127,
                         'the reference launch did not report the missing program')
        self.assertTrue(data, 'the reference launch produced no diagnostic')
        return data

    def endpoint(self, session, executable=None):
        return json.dumps([str(executable or EXE), str(self.db), *self.receive_args(session)[:-1]])

    def connect(self, session, executable=None):
        native = self.coord('player', session)['native']
        self.coord('connect', session, native, self.endpoint(session, executable))

    def prepare_input(self, ident, recipient, body='Review this input.', kind='guidance'):
        sender = 'operator' if recipient == 'root' else 'root'
        result = self.coord('message', ident, sender, recipient, kind, body, ok=False)
        if result.returncode == 0:
            return json.loads(result.stdout)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('records no native session identity', result.stderr)
        delivery = self.coord('delivery', ident)
        self.assertEqual((delivery['id'], delivery['sender'], delivery['recipient'],
                          delivery['kind'], delivery['body'], delivery['receipt']),
                         (ident, sender, recipient, kind, body, None))
        self.assertIn(ident, [row['id'] for row in self.coord('inbox', recipient)])
        return delivery

    def message(self, ident, recipient, body='Review this input.'):
        return self.coord('message', ident, 'operator' if recipient == 'root' else 'root',
                          recipient, 'guidance', body)

    def accept_any(self):
        connection, _ = self.server.accept()
        stream = connection.makefile('rwb', buffering=0)
        self.controls.append((stream, connection))
        started = json.loads(stream.readline())
        return stream, started

    def accept(self, session):
        stream, started = self.accept_any()
        self.assertEqual(started['session'], session)
        return stream, started

    def accept_child(self, child, session, description=None, failure_stream=None):
        description = description or f'{session} native did not connect'
        stream, started = self.accept_or_child_exit(child, description, failure_stream)
        self.assertEqual(started['session'], session)
        return stream, started

    def accept_delivery(self, admission, session):
        stdout, stderr = self.finish(admission)
        return self.accept_detached(session, stdout + stderr)

    def accept_detached(self, session, diagnostic):
        owner = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        while True:
            if select.select([self.server], [], [], 0)[0]:
                return self.accept(session)
            producers = [process for process in self.owned_processes()
                         if process['command'] != owner]
            if not producers:
                self.fail(f'{session} native did not connect after admission; '
                          f'execution={self.execution(session)!r}; {diagnostic}')
            time.sleep(.01)

    def accept_recovered_direct(self, session):
        owner = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        while True:
            if select.select([self.server], [], [], 0)[0]:
                return self.accept(session)
            execution = self.execution(session)
            if execution and execution[0] == 'exited':
                directory = pathlib.Path(execution[2])
                terminal = all((directory / name).is_file()
                               for name in ['acknowledged', 'released', 'status'])
                producers = [process for process in self.owned_processes()
                             if process['command'] != owner]
                if terminal and not producers:
                    self.fail('Recovered direct attempt settled before the next native connected; '
                              f'execution={execution!r}; '
                              f'wait_status={(directory / "status").read_text()!r}; '
                              f'observer={(directory / "observer.log").read_text()!r}')
            time.sleep(.01)

    def accept_or_child_exit(self, child, description, failure_stream=None, allow_exit=False):
        stream = failure_stream if failure_stream is not None else child.stdout
        streams = [stream, child.stderr] if child.stderr is not stream else [stream]
        while True:
            if select.select([self.server], [], [], 0)[0]:
                return self.accept_any()
            if child.poll() is not None:
                if allow_exit:
                    return None
                stdout, stderr = self.child_communication(child)
                self.fail(f'{description}; receive exited {child.returncode}: {stdout}{stderr}')
            if not streams:
                time.sleep(.01)
                continue
            ready, _, _ = select.select([self.server, *streams], [], [])
            if self.server in ready:
                return self.accept_any()
            for output in ready:
                if not self.capture_child_output(child, output):
                    streams.remove(output)
            if child.poll() is not None:
                if allow_exit:
                    return None
                stdout, stderr = self.child_communication(child)
                self.fail(f'{description}; receive exited {child.returncode}: {stdout}{stderr}')

    def capture_child_output(self, child, stream):
        captured = getattr(child, 'fixture_output', None)
        if captured is None:
            captured = child.fixture_output = [bytearray(), bytearray()]
        chunk = os.read(stream.fileno(), 65536)
        captured[1 if stream is child.stderr else 0].extend(chunk)
        return bool(chunk)

    def child_communication(self, child):
        captured = getattr(child, 'fixture_output', None)
        if captured is None:
            return child.communicate()
        streams = [child.stdout, child.stderr]
        while streams:
            ready, _, _ = select.select(streams, [], [])
            for stream in ready:
                if not self.capture_child_output(child, stream):
                    streams.remove(stream)
        child.wait()
        return tuple(bytes(output).decode(errors='replace') for output in captured)

    def finish_observer_during_recovery(self, observer, recovery, drain=True):
        streams = {child.stdout: child for child in (observer, recovery)}
        streams.update({child.stderr: child for child in (observer, recovery)})
        exited, notification = socket.socketpair()

        def notify_exit(child):
            child.wait()
            try:
                notification.sendall(b'x')
            except OSError:
                pass

        for child in (observer, recovery):
            threading.Thread(target=notify_exit, args=(child,), daemon=True).start()
        try:
            while observer.poll() is None:
                if recovery.poll() is not None:
                    stdout, stderr = self.child_communication(recovery)
                    observed = getattr(observer, 'fixture_output', [bytearray(), bytearray()])
                    observer_output = b''.join(observed).decode(errors='replace')
                    self.fail(f'Recovery exited {recovery.returncode} before the selected observer '
                              f'exited: {stdout}{stderr}\nObserver output: {observer_output}')
                ready, _, _ = select.select([exited, *streams], [], [])
                for stream in ready:
                    if stream is exited:
                        exited.recv(2)
                    elif not self.capture_child_output(streams[stream], stream):
                        del streams[stream]
            if drain:
                return self.finish(observer, ok=False)
        finally:
            exited.close()
            notification.close()

    def action(self, stream, **value):
        stream.write((json.dumps(value) + '\n').encode())

    def finish(self, child, ok=True):
        stdout, stderr = self.child_communication(child)
        if ok:
            self.assertEqual(child.returncode, 0, stderr)
        else:
            self.assertNotEqual(child.returncode, 0, stdout)
        return stdout, stderr

    def finish_without_start(self, child, ok=True):
        unexpected = self.accept_or_child_exit(
            child, 'The settled invocation did not exit.', allow_exit=True)
        self.assertIsNone(unexpected, 'The settled invocation admitted another native process: '
                          + json.dumps(unexpected[1] if unexpected else None, ensure_ascii=False))
        return self.finish(child, ok=ok)

    def assert_no_start(self):
        self.assertEqual(select.select([self.server], [], [], 0)[0], [],
                         'another native process started while its session was active')

    def native_requests(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            if not database.execute("SELECT 1 FROM sqlite_master WHERE name='native_requests'").fetchone():
                return []
            return [dict(row) for row in database.execute('SELECT * FROM native_requests ORDER BY rowid')]

    def native_question(self, stream, event):
        self.action(stream, native_request=event)
        self.assertEqual(json.loads(stream.readline()), {'request_written': event})
        return self.eventually(lambda: next((row for row in self.native_requests()
                                            if row['native_id'] == event['id']), None),
                               'native request was not retained')

    def start_question_player(self, answering=False):
        self.player(harness='omp')
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.fixture), 'answering_parent' if answering else 'parent_endpoint']))
        self.prepare_input('question-task', 'parent',
                           'Ask for the required input and complete the task.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Question observer exited before native startup')
        return observer, stream, started

    def test_native_question_parent_answers_and_waits_for_full_report(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['native_answer'] = {'value': 'Keep the existing work.\nUse the selected branch.'}
        config_path.write_text(json.dumps(config))
        observer, stream, started = self.start_question_player(answering=True)
        event = {'type': 'extension_ui_request', 'id': 'input request Ω', 'method': 'input',
                 'title': 'Which work should continue?', 'placeholder': 'A complete answer'}
        request = self.native_question(stream, event)
        answers = self.directory / 'parent-answers.jsonl'
        self.eventually(lambda: answers.exists() and answers.read_text(), 'parent did not answer its native question')
        answer = json.loads(answers.read_text().splitlines()[0])
        self.assertEqual(answer['request']['nativeRequest'], event)
        self.assertEqual(answer['request']['requestId'], request['id'])
        self.assertEqual(answer['code'], 0, answer['stderr'])
        self.assertEqual(json.loads(answer['stdout'])['status'], 'stdin-written')
        self.assertIsNone(observer.poll())
        self.eventually(lambda: (self.directory / 'parent-awaiting-delivery').exists(),
                        'answering parent did not wait for actual report delivery')
        self.assertFalse((self.directory / 'parent-question-complete').exists())
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], **config['native_answer']}})
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        body = 'The requested input was applied.\nThe complete native report is retained.'
        self.action(stream, body=body)
        self.finish(observer)
        self.shutdown_idle_database_owner('question worker did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertTrue(read_recorded(self.db, request['id']))
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])
        self.assertEqual(json.loads((self.directory / 'parent-report-delivered').read_text())['body'], body)
        self.assertTrue((self.directory / 'parent-question-complete').exists())

    def test_large_pending_reports_are_referenced_not_expanded(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['read_root'] = False
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player()
        self.prepare_input('task-836', 'parent', 'Complete the assignment.', kind='task')
        body = 'R' * 200_000
        with sqlite3.connect(self.db) as database:
            for index in range(12):
                database.execute(
                    'INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                    (f'report-{index}', 'root', 'parent', 'report',
                     body + f' marker-{index}'))
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        native, started = self.accept('parent')
        prompt = started['prompt']
        self.assertIn('[id: task-836]', prompt)
        self.assertIn('Complete the assignment.', prompt)
        for index in range(12):
            self.assertIn(f'[id: report-{index}]', prompt)
        self.assertIn('baton read report-0', prompt)
        self.assertNotIn('marker-0', prompt)
        self.assertNotIn('R' * 1000, prompt)
        self.assertLess(len(prompt), 100_000,
                        'pending report bodies were expanded into the prompt')
        self.action(native, body='First turn complete.', read=[], complete_task=False)
        self.assertEqual(native.readline(), b'')
        pending = [row['id'] for row in self.coord('inbox', 'parent')]
        self.assertIn('report-0', pending)
        self.assertIn('report-1', pending)
        self.assertNotIn('task-836', pending)
        self.assertTrue(read_recorded(self.db, 'task-836'))
        self.assertFalse(read_recorded(self.db, 'report-0'))

        continuation, resumed = self.accept_child(observer, 'parent')
        self.assertIn('baton read report-0', resumed['prompt'])
        self.action(continuation, body='Read one report.', read=['report-0'], complete_task=False)
        self.assertEqual(continuation.readline(), b'')
        report0 = self.coord('delivery', 'report-0')
        self.assertTrue(read_recorded(self.db, report0['id']))
        self.assertEqual(report0['nativeInputStatus']['read'], 'recorded')
        report1 = self.coord('delivery', 'report-1')
        self.assertFalse(read_recorded(self.db, report1['id']))
        self.assertEqual(report1['nativeInputStatus']['read'], 'unrecorded')
        self.assertEqual(self.coord('delivery', 'report-0')['body'], body + ' marker-0')
        reads = [json.loads(line) for line in
                 (self.directory / 'native-reads.jsonl').read_text().splitlines()]
        self.assertIn('marker-0', json.dumps(reads))

        last, final = self.accept_child(observer, 'parent')
        self.assertIn('baton read report-1', final['prompt'])
        self.action(last, body='Read the remaining reports.',
                    read=[f'report-{index}' for index in range(1, 12)], complete_task=False)
        self.assertEqual(last.readline(), b'')
        self.finish(observer)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['First turn complete.', 'Read one report.',
                          'Read the remaining reports.'])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        report1 = self.coord('delivery', 'report-1')
        self.assertTrue(read_recorded(self.db, report1['id']))
        self.assertEqual(report1['nativeInputStatus']['read'], 'recorded')

    def test_large_pending_guidance_is_referenced_not_expanded(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['read_root'] = False
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player()
        self.prepare_input('task-836-guidance', 'parent', 'Complete the assignment.', kind='task')
        body = 'G' * 200_000
        with sqlite3.connect(self.db) as database:
            for index in range(12):
                database.execute(
                    'INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                    (f'guidance-{index}', 'root', 'parent', 'guidance',
                     body + f' marker-{index}'))
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        native, started = self.accept('parent')
        prompt = started['prompt']
        self.assertIn('[id: task-836-guidance]', prompt)
        self.assertIn('Complete the assignment.', prompt)
        for index in range(12):
            self.assertIn(f'[id: guidance-{index}]', prompt)
            self.assertIn(f'baton read guidance-{index}', prompt)
        self.assertNotIn('marker-0', prompt)
        self.assertNotIn('G' * 1000, prompt)
        self.assertLess(len(prompt), 100_000,
                        'pending guidance bodies were expanded into the prompt')
        self.action(native, exit_fixture=True)
        self.finish(observer, ok=False)
        pending = [row['id'] for row in self.coord('inbox', 'parent')]
        self.assertIn('guidance-0', pending)
        self.assertEqual(self.coord('delivery', 'guidance-0')['body'], body + ' marker-0')

    def test_completed_attempt_acknowledged_while_continuation_live(self):
        self.player()
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, _ = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.coord('message', 'second', 'root', 'parent', 'task', 'The exact queued input.')
        self.action(original, body='Original result complete.', complete_task=False)
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept_child(observer, 'parent')
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        # The completed attempt settles independently of the live continuation.
        self.eventually(lambda: (attempt / 'acknowledged').exists(),
                        'completed attempt was not acknowledged while its continuation ran')
        reports = [turn['reportBody'] for turn in self.coord('turns', 'parent')]
        self.assertIn('Original result complete.', reports)
        self.assertIsNone(observer.poll())
        self.action(continuation, body='Queued result complete.')
        self.assertEqual(continuation.readline(), b'')
        self.finish(observer)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Original result complete.', 'Queued result complete.'])

    def test_worker_settlement_continues_open_assignment_with_reminder(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))

        def unchanged_wakes(name):
            state = self.coord('session', name)['taskCompletion']
            pending = self.coord('inbox', 'root')
            turns = self.coord('turns', name)
            launches = (self.directory / 'native-launches.jsonl').read_bytes()
            output = self.output_log(name)
            retained_output = output.read_bytes()
            for _ in range(2):
                answer = self.coord(*self.receive_args(name))
                self.assertEqual(answer['receive'], 'none')
                self.assertEqual(answer['attempt'], '')
                self.assertEqual(answer['pending'], 0)
                self.assertEqual(self.coord('inbox', 'root'), pending)
                self.assertEqual(self.coord('inbox', name), [])
                self.assertEqual(self.coord('turns', name), turns)
                self.assertEqual(self.coord('session', name)['taskCompletion'], state)
                self.assertEqual((self.directory / 'native-launches.jsonl').read_bytes(), launches)
                self.assertEqual(output.read_bytes(), retained_output)
            self.assert_no_start()

        for harness in ('codex', 'omp', 'muse', 'claude-code'):
            for entry in ('receive', 'direct'):
                with self.subTest(harness=harness, entry=entry):
                    name = harness + '-' + entry
                    self.player(name=name, harness=harness)
                    if entry == 'receive':
                        self.prepare_input(name + '-task', name, 'Complete this assignment.', kind='task')
                        self.connect(name)
                        observer = self.spawn(*self.receive_args(name))
                        assignment = name + '-task'
                    else:
                        self.connect(name)
                        task = self.directory / (name + '-task.txt')
                        task.write_text('Complete this retained direct assignment.')
                        observer = self.spawn('turn', name, name + '-turn', self.fixture, name, 'low',
                                              self.directory, task, self.directory / (name + '.jsonl'), '')
                        assignment = name + '-turn:task-input'
                    first, started = self.accept_child(observer, name)
                    self.action(first, body='Intermediate work is retained.', complete_task=False)
                    self.assertEqual(first.readline(), b'')
                    self.finish_without_start(observer)
                    self.assertTrue(read_recorded(self.db, assignment))
                    state = self.coord('session', name)['taskCompletion']
                    self.assertTrue(state['open'])
                    self.assertEqual(state['assignmentId'], assignment)
                    self.assertIsNone(state['requestId'])
                    self.assertFalse(state['confirmed'])
                    self.eventually(lambda: len(self.coord('turns', name)) == 1,
                                    'the first turn was not recorded')
                    report, = self.coord('turns', name)
                    self.assertEqual(report['reportBody'], 'Intermediate work is retained.')
                    self.assertTrue(read_recorded(self.db, report['id']))
                    delivered = [json.loads(line) for line in
                                 (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
                    self.assertIn(self.coord('delivery', report['id'])['id'],
                                  [message['id'] for message in delivered])
                    self.assertFalse(any(message['sender'] == name and message['kind'] == 'completion-request'
                                         for message in self.coord('inbox', 'root')))
                    second, continued = self.accept(name)
                    self.assertEqual(continued['native'], started['native'])
                    with sqlite3.connect(self.db) as database:
                        reminders = database.execute(
                            "SELECT id,body,receipt FROM messages WHERE recipient=? AND kind='task-continuation'",
                            (name,)).fetchall()
                    self.assertEqual(len(reminders), 1, reminders)
                    self.assertIn('completion-request', reminders[0][1])
                    self.assertIn('[id: ' + reminders[0][0] + ']', continued['prompt'])
                    self.assertIn('baton read ' + reminders[0][0], continued['prompt'])

                    request = name + '-ready'
                    self.action(second, completion_request=[request, 'The task result is ready.'])
                    requested = json.loads(second.readline())
                    self.assertEqual((requested['sender'], requested['recipient'], requested['kind']),
                                     (name, 'root', 'completion-request'))
                    self.assertTrue(self.coord('session', name)['taskCompletion']['open'])
                    self.action(second, body='The task result is ready.',
                                read=[reminders[0][0]], complete_task=False)
                    self.assertEqual(second.readline(), b'')
                    self.shutdown_idle_database_owner(
                        'The explicit continuation did not settle naturally.', reject_start=True)
                    state = self.coord('session', name)['taskCompletion']
                    self.assertEqual(state['requestId'], request)
                    self.assertTrue(state['open'])
                    self.assertFalse(state['confirmed'])
                    self.assertEqual(self.coord('inbox', name), [])
                    turns = self.coord('turns', name)
                    self.assertEqual([turn['reportBody'] for turn in turns],
                                     ['Intermediate work is retained.', 'The task result is ready.'])
                    self.assertTrue(all(read_recorded(self.db, turn['id']) for turn in turns))
                    unchanged_wakes(name)
                    self.assertIsNone(self.coord('continue-task', name, name + '-ready-review')['continuationId'])
                    confirmation = self.spawn('message', name + '-confirmed', 'root', name,
                                              'completion-confirmed', request)
                    confirmed, delivered = self.accept_delivery(confirmation, name)
                    self.assertIn('[id: ' + name + '-confirmed]', delivered['prompt'])
                    self.assertEqual(delivered['native'], started['native'])
                    self.action(confirmed, body='The coordinator confirmed this task.',
                                ack_inbox=True, complete_task=False)
                    self.assertEqual(confirmed.readline(), b'')
                    self.finish_without_start(confirmation)
                    self.shutdown_idle_database_owner(
                        'The confirmed worker did not settle naturally.', reject_start=True)
                    self.assertEqual(self.coord('inbox', name), [])
                    state = self.coord('session', name)['taskCompletion']
                    self.assertTrue(state['confirmed'])
                    self.assertFalse(state['open'])
                    reports = self.coord('turns', name)
                    self.assertEqual([report['reportBody'] for report in reports],
                                     ['Intermediate work is retained.', 'The task result is ready.',
                                      'The coordinator confirmed this task.'])
                    self.assertTrue(read_recorded(self.db, name + '-confirmed'))
                    self.assertTrue(read_recorded(self.db, request))


    def test_missing_identity_helper_continuation_reports_setup_failure(self):
        package, candidate, helper = self.private_candidate()
        private_home = self.directory / 'private-home'
        registry = private_home / '.config' / 'baton' / 'github-apps' / 'series.json'
        registry.parent.mkdir(parents=True)
        environment = os.environ.copy()
        environment.pop('BATON2_GIT_REGISTRY', None)
        environment['HOME'] = str(private_home)
        self.environment = environment
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config['ack_root'] = False
        config_path.write_text(json.dumps(config))
        self.player()
        self.prepare_input('identity-task', 'parent', 'Complete the original input.', kind='task')
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.connect('parent', executable=candidate)
        observer = self.spawn(*self.receive_args('parent'), executable=candidate)
        first, started = self.accept_child(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original native identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            original_id, original_directory = database.execute(
                "SELECT id,directory FROM executions "
                "WHERE session='parent' AND mode='retained' ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
        launches = self.directory / 'native-launches.jsonl'
        before = launches.read_bytes()
        self.assertTrue(helper.exists())
        registry.write_text('{}\n')
        helper.unlink()
        self.assertFalse((package / 'libexec' / 'baton2' / 'git-series.mjs').exists())
        self.assertFalse((package.parent / 'bend2' / 'harness' / 'git-series.mjs').exists())
        self.action(first, body='Original result completed before the continuation.',
                    complete_task=False)
        self.assertEqual(first.readline(), b'')
        stdout, stderr = self.finish(observer, ok=False)
        original_failure = 'Native control setup failed; inspect the registered session and retained input.'
        self.assertNotEqual(observer.returncode, 0, stdout + stderr)
        self.assertIn(original_failure, stdout + stderr)
        self.assertEqual(launches.read_bytes(), before,
                         'the failed continuation launched another native')
        self.assert_no_start()
        self.shutdown_idle_database_owner(
            'The failed setup left an owner process.', reject_start=True)
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT id,directory,phase,status FROM executions "
                "WHERE session='parent' ORDER BY rowid DESC LIMIT 1").fetchone()
        self.assertIsNotNone(row)
        attempt_id, directory, phase, status = row
        self.assertNotEqual(attempt_id, original_id)
        self.assertEqual((phase, status), ('starting', ''), row)
        attempt = pathlib.Path(directory)
        for name in ('native.pid', 'native.stderr', 'stdout', 'manifest', 'native.birth'):
            self.assertFalse((attempt / name).exists(),
                             f'{name} exists in the failed setup attempt')
        initialization = self.initial_inputs('parent')
        self.assertEqual(len(initialization), 2, initialization)
        self.assertEqual(initialization[0]['attempt'], str(original_directory))
        self.assertEqual(initialization[1]['attempt'], str(directory))
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        report_id = original_id + ':continuation-failure'

        def report_row():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                return database.execute(
                    "SELECT id,recipient,kind,body FROM messages WHERE id=?",
                    (report_id,)).fetchone()

        report = self.eventually(report_row,
                                 'The conductor did not receive the continuation setup failure report')
        self.assertEqual(report[1:3], ('root', 'report'))
        self.assertEqual(report[0], report_id)
        self.assertIn('2: ' + original_failure, report[3])
        self.assertIn(str(original_directory), report[3])

        def delivered_report():
            path = self.directory / 'parent-deliveries.jsonl'
            if not path.exists():
                return None
            for line in path.read_text().splitlines():
                message = json.loads(line)
                if message['id'] == report_id:
                    return message
            return None

        witness = self.eventually(delivered_report,
                                  'The conductor endpoint did not receive the setup failure')
        self.assertEqual(witness['body'], report[3])
        self.assertEqual(self.coord('delivery', report_id)['body'], report[3])

    def test_recovery_observer_acquisition_failure_reports_and_does_not_launch(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config['ack_root'] = False
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player('parent', harness='omp')
        self.prepare_input('recovery-task', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        first, started = self.accept_child(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original native identity was not recorded.')
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            attempt_id, directory = database.execute(
                "SELECT id,directory FROM executions "
                "WHERE session='parent' AND mode='retained' ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            cursor = database.execute(
                "SELECT seq FROM messages WHERE id='recovery-task'").fetchone()[0]
        attempt = pathlib.Path(directory)
        retained = {name: (attempt / name).read_bytes() for name in ('manifest', 'native.birth')
                    if (attempt / name).exists()}
        before_execution = self.execution('parent')
        launches = self.directory / 'native-launches.jsonl'
        before_launches = launches.read_bytes()
        log = self.output_log('parent')
        recovery = [str(EXE.resolve()), '--recover-receive', str(self.db.resolve()), 'parent',
                    attempt_id, str(cursor) + '\n', str(self.fixture), 'parent', 'low',
                    str(self.directory), str(log), 'omp\n', str(attempt), native_id]
        failed = subprocess.run(recovery, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0, failed.stdout + failed.stderr)
        self.assertIn(os.strerror(errno.EBUSY), failed.stderr)
        self.assertEqual(self.execution('parent'), before_execution)
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        for name, content in retained.items():
            self.assertEqual((attempt / name).read_bytes(), content)
        self.assertEqual(launches.read_bytes(), before_launches,
                         'the refused recovery launched another native')
        self.assert_no_start()
        report_id = attempt_id + ':recovery-failure'

        def report_row():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                return database.execute(
                    "SELECT id,recipient,kind,body FROM messages WHERE id=?",
                    (report_id,)).fetchone()

        report = self.eventually(report_row, 'The conductor did not receive the recovery failure report')
        self.assertEqual(report[1:3], ('root', 'report'))
        self.assertEqual(report[0], report_id)
        self.assertIn('Recovery of retained attempt', report[3])
        self.assertIn(os.strerror(errno.EBUSY), report[3])

        def delivered_report():
            path = self.directory / 'parent-deliveries.jsonl'
            if not path.exists():
                return None
            for line in path.read_text().splitlines():
                message = json.loads(line)
                if message['id'] == report_id:
                    return message
            return None

        witness = self.eventually(delivered_report,
                                  'The conductor endpoint did not receive the recovery failure')
        self.assertEqual(witness['body'], report[3])
        self.assertEqual(self.coord('delivery', report_id)['body'], report[3])
        self.action(first, body='Recovery acquisition refusal left the live native intact.')
        self.assertEqual(first.readline(), b'')
        self.finish(observer)
        self.shutdown_idle_database_owner('The refused recovery left an owner process.')

    def test_ready_request_preserves_new_input_reports_and_physical_failure(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['read_root'] = False
        config_path.write_text(json.dumps(config))
        self.player()
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.prepare_input('ready-input-task', 'parent', 'Complete this work.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        first, started = self.accept_child(observer, 'parent')
        text = 'The retained result is ready for review.\nFull output: λ🙂.'
        self.action(first, completion_request=['ready-input-request', text])
        requested = json.loads(first.readline())
        self.assertEqual(requested['body'], text)
        self.action(first, body=text, complete_task=False)
        self.assertEqual(first.readline(), b'')
        self.finish_without_start(observer)
        original = self.coord('turns', 'parent')[0]
        self.coord('as', 'root', 'read', original['id'])
        self.coord('as', 'root', 'read', 'ready-input-request')

        receipt = 'The coordinator retained an independent review receipt.\nThe source result remains unchanged.'
        delivery = self.spawn('message', 'ready-input-review', 'root', 'parent', 'report', receipt)
        reviewed, incoming = self.accept_delivery(delivery, 'parent')
        self.assertIn('[id: ready-input-review]', incoming['prompt'])
        self.assertIn('baton read ready-input-review', incoming['prompt'])
        self.assertEqual(incoming['native'], started['native'])
        self.action(reviewed, body=text, complete_task=False)
        self.assertEqual(reviewed.readline(), b'')
        self.finish_without_start(delivery)
        self.shutdown_idle_database_owner('The independent review did not settle.', reject_start=True)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [text, text])
        self.assertNotEqual(turns[0]['id'], turns[1]['id'])
        self.assertTrue(read_recorded(self.db, turns[0]['id']))
        self.assertTrue(read_recorded(self.db, 'ready-input-review'))
        self.assertTrue(read_recorded(self.db, 'ready-input-request'))
        self.assertEqual(self.coord('inbox', 'parent'), [])
        state = self.coord('session', 'parent')['taskCompletion']
        self.assertEqual(state['requestId'], 'ready-input-request')
        self.assertTrue(state['open'])
        self.assertFalse(state['confirmed'])

        failure = self.spawn('message', 'ready-input-diagnostic', 'root', 'parent', 'report',
                             'Inspect the new provider outcome.')
        failed, incoming = self.accept_delivery(failure, 'parent')
        self.assertIn('[id: ready-input-diagnostic]', incoming['prompt'])
        cause = 'A distinct fixture provider failure while reading the new input.'
        self.action(failed, fail=True, fail_message=cause, complete_task=False)
        self.assertEqual(failed.readline(), b'')
        self.finish_without_start(failure)
        self.shutdown_idle_database_owner(
            'Ready worker did not settle after its physical failure.', reject_start=True)
        self.assertEqual(self.execution('parent')[:2], ('exited', 'exit 0'))
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns[:2]], [text, text])
        self.assertEqual(len(turns), 3)
        terminal = json.loads(turns[2]['reportBody'])
        self.assertTrue(terminal['is_error'])
        self.assertIn(cause, json.dumps(terminal, ensure_ascii=False))
        self.assertIn(cause, self.output_log('parent').read_text())
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            event = database.execute('SELECT event FROM turns WHERE id=?',
                                     (turns[2]['id'],)).fetchone()[0]
        self.assertIn(cause, event)
        self.assertTrue(read_recorded(self.db, original['id']))
        self.assertEqual(self.coord('session', 'parent')['taskCompletion'], state)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_ack_failure_still_joins_queued_continuation(self):
        self.player()
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, _ = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'").fetchone()[0])
        # Stage an actual host ACK failure: the acknowledgment marker path
        # exists as a directory, so the real marker write fails at the
        # filesystem layer while the wrapper stays the production path.
        (attempt / 'acknowledged').mkdir()
        self.coord('message', 'second', 'root', 'parent', 'task', 'The exact queued input.')
        self.action(original, body='Original result complete.', complete_task=False)
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept_child(observer, 'parent')
        self.assertIn('[id: second]', resumed['prompt'])
        # Keep the continuation live while checking the observer remains
        # available to join it after the first attempt's ACK failure.
        self.action(continuation, body='Queued result complete.', hold_exit=True)
        self.assertEqual(json.loads(continuation.readline()), {'terminal_written': True})
        self.assertIsNone(observer.poll(),
                         'observer died on ACK failure instead of joining its live continuation')
        self.action(continuation)
        self.assertEqual(continuation.readline(), b'')
        output, error = self.finish(observer, ok=False)
        self.assertFalse((attempt / 'acknowledged').is_file(),
                         'a fabricated acknowledged marker appeared after an ACK failure')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Original result complete.', 'Queued result complete.'])
        self.assertIn('File exists', output + error)

    def test_native_root_question_reports_unsupported_without_answering(self):
        self.coord('attach', 'root', 'omp', '', '')
        self.prepare_input('root-question-task', 'root', 'Inspect the native request.', kind='task')
        observer = self.spawn(*self.receive_args('root'))
        stream, started = self.accept('root')
        event = {'type': 'extension_ui_request', 'id': 'root-needs-input',
                 'method': 'input', 'title': 'No registered parent'}
        self.action(stream, native_request=event)
        self.assertEqual(json.loads(stream.readline()), {'request_written': event})
        log = self.output_log('root')
        self.eventually(lambda: log.is_file() and event['id'] in log.read_text(),
                        'unsupported root request was not retained')
        self.action(stream, body='The fixture ends its request without an answer.',
                    hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()),
                         {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        output, _ = self.finish(observer, ok=False)
        self.assertIn('unsupported for a session without a registered parent', output)
        self.assertEqual(self.native_requests(), [])
        self.shutdown_idle_database_owner('root fixture did not exit naturally')

    def test_native_question_survives_observer_loss_and_matches_one_reply(self):
        observer, stream, started = self.start_question_player()
        event = {'type': 'extension_ui_request', 'id': 'choose-branch', 'method': 'select',
                 'title': 'Choose a branch', 'options': ['preserve current', 'new branch']}
        request = self.native_question(stream, event)
        self.eventually(lambda: read_recorded(self.db, request['id']), 'question did not reach parent')
        observer.kill()
        observer.wait()
        marker = 'original native waiting for its answer after observer loss'
        self.action(stream, progress=marker)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(), 'recovered observer did not consume surviving output')
        self.assertEqual([row['id'] for row in self.native_requests()], [request['id']])
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assert_no_start()
        for parent, response in [('parent', {'value': 'preserve current'}),
                                 ('root', {'value': 'unlisted branch'}),
                                 ('root', {'confirmed': True}),
                                 ('root', {'value': 'preserve current', 'cancelled': True})]:
            refused = self.coord('native-reply', parent, request['id'], json.dumps(response), ok=False)
            self.assertNotEqual(refused.returncode, 0)
        for malformed in ['not JSON', '{"value":42}']:
            self.assertNotEqual(self.coord('native-reply', 'root', request['id'], malformed, ok=False).returncode, 0)
        reply_path = self.directory / 'native answer.json'
        reply_path.write_text(json.dumps({'value': 'preserve current'}))
        result = self.coord('native-reply-file', 'root', request['id'], str(reply_path))
        self.assertEqual(result['status'], 'stdin-written')
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], 'value': 'preserve current'}})
        recovered = self.eventually(lambda: [p for p in self.owned_processes()
                                             if p['ppid'] == started['ppid'] and '--recover-receive' in p['command']],
                                   'keeper did not attach a replacement observer')[0]
        os.kill(recovered['pid'], signal.SIGKILL)
        marker = 'native output after the delivered answer and second observer loss'
        self.action(stream, progress=marker)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': marker})
        self.eventually(lambda: marker in log.read_text(), 'second observer did not resume the original native output')
        self.assertEqual(self.coord('native-reply-file', 'root', request['id'], str(reply_path))['status'],
                         'stdin-written')
        conflicting = self.coord('native-reply', 'root', request['id'], '{"value":"new branch"}', ok=False)
        self.assertNotEqual(conflicting.returncode, 0)
        self.assertIn('Native reply refused', conflicting.stderr)
        self.assertNotIn('NOT NULL constraint failed', conflicting.stderr)
        retained = self.native_requests()[0]
        self.assertEqual(json.loads(retained['reply']), {'type': 'extension_ui_response',
                                                       'id': event['id'], 'value': 'preserve current'})
        self.assertEqual(retained['written'], 1)
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        body = 'The original native completed after the selected reply.'
        self.action(stream, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        self.shutdown_idle_database_owner('recovered question worker did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])

    def test_native_request_conflict_preserves_original_question_and_reply(self):
        observer, stream, started = self.start_question_player()
        event = {'type': 'extension_ui_request', 'id': 'retained-request', 'method': 'select',
                 'title': 'Keep the original question', 'options': ['original answer', 'other answer']}
        request = self.native_question(stream, event)
        self.eventually(lambda: read_recorded(self.db, request['id']),
                        'parent did not handle the original question')
        original_question = self.coord('delivery', request['id'])
        conflicting = dict(event, title='A conflicting question under the same native identity')
        for repeated in (event, conflicting):
            self.action(stream, native_request=repeated)
            self.assertEqual(json.loads(stream.readline()), {'request_written': repeated})
        barrier = 'native continued after the conflicting request'
        self.action(stream, progress=barrier)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': barrier})
        log = self.output_log('parent')
        self.eventually(lambda: barrier in log.read_text(),
                        'observer did not continue past the conflicting request')
        self.assertEqual(self.native_requests(), [request])
        self.assertEqual(self.coord('delivery', request['id']), original_question)
        self.assertEqual(self.coord('native-reply', 'root', request['id'],
                                    '{"value":"original answer"}')['status'], 'stdin-written')
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], 'value': 'original answer'}})
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.action(stream, body='The original native continued with its original answer.',
                    hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()),
                         {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        output, error = self.finish(observer, ok=False)
        self.assertNotIn('NOT NULL constraint failed', output + error)
        self.assertEqual(self.native_requests()[0]['event'], json.dumps(event))
        self.assertEqual(self.native_requests()[0]['id'], request['id'])
        self.assertEqual(json.loads(self.native_requests()[0]['reply'])['value'], 'original answer')
        delivered = [json.loads(line) for line in
                     (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
        self.assertEqual([row['id'] for row in delivered if row['kind'] == 'question'],
                         [request['id']])
        diagnosis = [row['body'] for row in delivered if row['id'].endswith(':observation')]
        self.assertEqual(len(diagnosis), 1)
        self.assertIn('native-request-id-conflict', diagnosis[0])
        self.assertNotIn('NOT NULL constraint failed', diagnosis[0])
        self.assertIn(conflicting['title'], log.read_text())
        self.shutdown_idle_database_owner('conflicting request fixture did not exit naturally')

    def test_native_reply_saved_before_write_is_sent_by_recovered_observer(self):
        observer, stream, started = self.start_question_player()
        event = {'type': 'extension_ui_request', 'id': 'pending-answer', 'method': 'input',
                 'title': 'Answer after reconnecting the keeper'}
        request = self.native_question(stream, event)
        self.eventually(lambda: read_recorded(self.db, request['id']), 'parent did not receive request')
        manifest = (pathlib.Path(request['attempt']) / 'manifest').read_bytes()
        self.assertIn(manifest[:8], (b'BATONRP1', b'BATONRP2'))
        count = 8 if manifest[:8] == b'BATONRP2' else 6
        header = struct.Struct(f'=8s{count}Q2I')
        magic, *fields = header.unpack_from(manifest)
        self.assertEqual(magic, manifest[:8])
        lengths = fields[:count]
        self.assertEqual(len(manifest), header.size + sum(lengths))
        offset = header.size + sum(lengths[:5])
        address = pathlib.Path(os.fsdecode(manifest[offset:offset + lengths[5]]))
        unavailable = address.with_name('controlled-unavailable-socket')
        self.assertFalse(unavailable.exists())
        address.rename(unavailable)
        try:
            failed = self.coord('native-reply', 'root', request['id'], '{"value":"retained answer"}', ok=False)
            self.assertNotEqual(failed.returncode, 0)
            saved = self.native_requests()[0]
            self.assertEqual(json.loads(saved['reply']), {'type': 'extension_ui_response',
                                                         'id': event['id'], 'value': 'retained answer'})
            self.assertEqual(saved['written'], 0)
        finally:
            unavailable.rename(address)
        observer.kill()
        observer.wait()
        marker = 'Recovered observer consumed output after the stored native answer.'
        self.action(stream, progress=marker)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(),
                        'recovered observer did not consume the pending-answer recovery marker')
        self.assertEqual(self.native_requests()[0]['written'], 1,
                         'recovered observer consumed new output before sending the stored native answer')
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], 'value': 'retained answer'}})
        self.eventually(lambda: self.native_requests()[0]['written'] == 1,
                        'recovery did not record transport completion')
        self.assertEqual(self.native_requests()[0]['id'], request['id'])
        self.assertEqual(self.native_requests()[0]['attempt'], request['attempt'])
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assert_no_start()
        body = 'The same native continued with its durable pending answer.'
        self.action(stream, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        self.shutdown_idle_database_owner('recovered reply processes did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])

    def test_native_question_cancellation_and_confirmation_keep_native_identity(self):
        observer, stream, started = self.start_question_player()
        for ident, method, response in [('confirm-no', 'confirm', {'confirmed': False}),
                                        ('editor-value', 'editor', {'value': 'Keep existing work.\nFinish Ω and 雨.'}),
                                        ('editor-cancel', 'editor', {'cancelled': True})]:
            event = {'type': 'extension_ui_request', 'id': ident, 'method': method, 'title': ident}
            request = self.native_question(stream, event)
            self.assertEqual(self.coord('native-reply', 'root', request['id'], json.dumps(response))['status'],
                             'stdin-written')
            self.action(stream, read_native_reply=True)
            self.assertEqual(json.loads(stream.readline()), {'native_reply': {
                'type': 'extension_ui_response', 'id': ident, **response}})
        event = {'type': 'extension_ui_request', 'id': 'cancelled-input', 'method': 'input', 'title': 'Dismissed'}
        request = self.native_question(stream, event)
        cancel = {'type': 'extension_ui_request', 'method': 'cancel', 'targetId': event['id']}
        self.action(stream, native_request=cancel)
        self.assertEqual(json.loads(stream.readline()), {'request_written': cancel})
        self.eventually(lambda: next(row for row in self.native_requests() if row['id'] == request['id'])['closed'],
                        'native cancellation did not close its request')
        refused = self.coord('native-reply', 'root', request['id'], '{"value":"too late"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        late = self.native_question(stream, {'type': 'extension_ui_request', 'id': 'closed-input',
                                            'method': 'input', 'title': 'Input closes before this answer'})
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.action(stream, body='Native cancellations and confirmations completed.', hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        refused = self.coord('native-reply', 'root', late['id'], '{"value":"after input closed"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(next(row for row in self.native_requests() if row['id'] == late['id'])['written'], 0)
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        self.shutdown_idle_database_owner('native question keeper did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])

    def receive_answers(self, stdout, stderr):
        lines = [line for line in stdout.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, stdout + stderr)
        answer = json.loads(stdout)
        self.assertIsInstance(answer, dict)
        self.assertIn('receive', answer)
        return answer

    def receive_answer(self, child, ok=True):
        stdout, stderr = self.finish(child, ok=ok)
        return self.receive_answers(stdout, stderr)

    def assert_receive_has_no_attempt(self, answer):
        self.assertEqual(answer['receive'], 'none')
        self.assertEqual(answer['attempt'], '')

    def test_supported_receive_answers_one_structured_result(self):
        self.player('parent', harness='omp')
        self.prepare_input('initial-task', 'parent', 'Complete the controlled task.', kind='task')
        receiver = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(receiver, 'parent')
        self.action(stream)
        answer = self.receive_answer(receiver)
        self.assertEqual(answer['receive'], 'accepted')
        self.assertEqual(answer['session'], 'parent')
        self.assertTrue(answer['attempt'])
        self.assertEqual(answer['state'], 'exited')
        self.assertTrue(read_recorded(self.db, 'initial-task'))
        self.assertEqual(answer['pending'], 0)
        self.assertEqual(answer['error'], '')

    def test_repeated_receive_admissions_report_each_new_attempt(self):
        self.player('parent', harness='omp')
        attempts = []
        for index in (1, 2):
            self.prepare_input(f'task-{index}', 'parent',
                               f'Complete controlled task {index}.', kind='task')
            receiver = self.spawn(*self.receive_args('parent'))
            stream, started = self.accept_child(receiver, 'parent')
            self.action(stream)
            answer = self.receive_answer(receiver)
            self.assertEqual(answer['receive'], 'accepted')
            self.assertEqual(answer['state'], 'exited')
            self.assertTrue(read_recorded(self.db, f'task-{index}'))
            self.assertEqual(answer['error'], '')
            attempts.append(answer['attempt'])
        self.assertEqual(len(set(attempts)), 2)

    def test_repeated_receive_errors_keep_their_admitted_attempts(self):
        self.player('parent', harness='omp')
        attempts = []
        for index in (1, 2):
            self.prepare_input(f'error-{index}', 'parent',
                               f'Fail controlled task {index}.', kind='task')
            receiver = self.spawn(*self.receive_args('parent'))
            stream, started = self.accept_child(receiver, 'parent')
            self.action(stream, fail=True, ack=False)
            self.action(stream, exit_fixture=True)
            answer = self.receive_answer(receiver, ok=False)
            self.assertEqual(answer['receive'], 'accepted')
            self.assertEqual(answer['state'], 'exited')
            self.assertTrue(answer['error'])
            self.assertTrue(read_recorded(self.db, f'error-{index}'))
            attempts.append(answer['attempt'])
        self.assertEqual(len(set(attempts)), 2)

    def test_receive_refusal_before_dispatch_names_no_attempt(self):
        self.player('parent', harness='omp')
        self.coord('stop', 'parent', 'stop-before', 'Preserve the operator stop.')
        receiver = self.spawn(*self.receive_args('parent'))
        answer = self.receive_answer(receiver, ok=False)
        self.assertEqual(answer['receive'], 'refused')
        self.assertEqual(answer['attempt'], '')
        self.assertEqual(answer['state'], '')
        self.assertTrue(answer['error'])

    def test_receive_refusal_does_not_report_a_stale_execution(self):
        self.player('parent', harness='omp')
        stale = 'receive:parent:1:stale'
        with sqlite3.connect(self.db) as database:
            database.execute(
                'INSERT INTO executions(session,id,mode,directory,phase,status) '
                'VALUES(?,?,?,?,?,?)',
                ('parent', stale, 'retained', str(self.directory / 'stale-attempt'),
                 'exited', 'exit 0'))
        self.coord('stop', 'parent', 'stop-stale', 'Preserve the operator stop.')
        receiver = self.spawn(*self.receive_args('parent'))
        answer = self.receive_answer(receiver, ok=False)
        self.assertEqual(answer['receive'], 'refused')
        self.assertEqual(answer['attempt'], '')
        self.assertNotEqual(answer['attempt'], stale)
        self.assertTrue(answer['error'])

    def test_terminal_start_failure_allows_the_next_retained_attempt(self):
        """A recorded start failure has no native birth to recover. The next
        receive starts a fresh attempt and keeps the failed attempt directory."""
        self.player('parent', harness='omp')
        self.prepare_input('after-failed-start', 'parent',
                           'Continue after the failed start.', kind='task')
        failed_id = 'receive:parent:1:failed-start'
        failed = self.directory / 'failed-start-attempt'
        failed.mkdir()
        fields = [
            b'/bin/true\0',
            os.fsencode(str(self.directory)),
            os.fsencode(str(failed / 'native.stderr')),
            b'',
            b'recovery\0',
            os.fsencode(str(failed / 'missing-owner.sock')),
        ]
        header = struct.pack('=8s6Q2I', b'BATONRP1',
                             *(len(value) for value in fields), 0, 0)
        (failed / 'manifest').write_bytes(header + b''.join(fields))
        (failed / 'launch').write_bytes(b'launch\n')
        with sqlite3.connect(self.db) as database:
            database.execute(
                'INSERT OR REPLACE INTO executions(session,id,mode,directory,phase,status) '
                'VALUES(?,?,?,?,?,?)',
                ('parent', failed_id, 'retained', str(failed),
                 'exited', 'start failed'))
        receiver = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(receiver, 'parent')
        self.assertIn('[id: after-failed-start]', started['prompt'])
        self.action(stream)
        answer = self.receive_answer(receiver)
        self.assertEqual(answer['receive'], 'accepted')
        self.assertNotEqual(answer['attempt'], failed_id)
        self.assertEqual(answer['state'], 'exited')
        self.assertTrue(read_recorded(self.db, 'after-failed-start'))
        new_directory = pathlib.Path(self.execution('parent')[2])
        self.assertNotEqual(new_directory, failed)
        self.assertTrue((failed / 'launch').is_file(),
                        'the failed attempt directory must be retained')
        self.assertFalse((failed / 'native.birth').exists(),
                         'the failed attempt never recorded a native birth')
        self.shutdown_idle_database_owner(
            'the replacement receive did not leave an idle database owner')

    def test_queued_receive_does_not_report_another_admission(self):
        self.player('parent', harness='omp')
        self.prepare_input('first', 'parent', 'Complete the first task.', kind='task')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_child(first, 'parent')
        self.prepare_input('second', 'parent', 'Complete the second task.', kind='task')
        queued = self.coord(*self.receive_args('parent'))
        self.assertEqual(queued['receive'], 'none')
        self.assertEqual(queued['attempt'], '')
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            active = database.execute(
                "SELECT id FROM executions WHERE session='parent'").fetchone()[0]
        self.assertTrue(active)
        self.assertNotEqual(queued['attempt'], active)
        self.action(control)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: second]', resumed['prompt'])
        self.action(continuation)
        self.finish(first)

    def initial_inputs(self, session):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute(
                'SELECT * FROM native_initial_inputs WHERE session=? ORDER BY rowid', (session,))]

    def assert_retry_initialization(self, session, prompts):
        rows = self.initial_inputs(session)
        self.assertEqual(len(rows), len(prompts), rows)
        seed = rows[0]['seed']
        self.assertRegex(seed, r'^[0-9a-f]{128}$')
        for row, prompt in zip(rows, prompts):
            self.assertEqual(row['seed'], seed, rows)
            self.assertNotIn('\0', row['guidance'])
            self.assertNotIn('\0', prompt)
            self.assertEqual(prompt, seed + '\n\n' + row['instruction'] + '\n\n' + row['guidance'])
            self.assertEqual(pathlib.Path(row['attempt'], 'prompt.txt').read_text(), prompt)
        return rows

    def test_claude_attachment_initializes_before_native_identity_frame(self):
        self.player('parent', harness='claude-code')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['hold_claude_init'] = True
        config_path.write_text(json.dumps(config))
        task = 'Review complete task text caféλ🙂\nPreserve both lines.\n'
        self.prepare_input('initial-task', 'parent', task, kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent')
        self.assertEqual(self.coord('player', 'parent')['native'], '')
        initialization = self.initial_inputs('parent')
        self.assertEqual(len(initialization), 1)
        original = initialization[0]
        self.assertIn(task, original['guidance'])
        self.assertNotIn('\0', started['prompt'])
        self.assertIn('Use baton inbox to read complete input', original['guidance'])
        self.assertNotIn(str(self.db), original['guidance'])
        self.assertNotIn('Use acknowledge', original['guidance'])
        self.assertEqual(self.coord('delivery', 'initial-task')['body'], task)
        guidance = '\ufeffUse semantic actions and retain all evidence. caféλ🙂\n'
        argv = [str(EXE), str(self.db), 'native-attachment-input', 'parent', 'mcp-instructions']
        attached = subprocess.run(argv, input=guidance, capture_output=True, text=True)
        self.assertEqual(attached.returncode, 0, attached.stdout + attached.stderr)
        self.assertEqual(attached.stdout, original['seed'] + '\n\n' + original['instruction'] + '\n\n' + guidance)
        repeated = subprocess.run(argv, input=guidance, capture_output=True, text=True)
        self.assertEqual((repeated.returncode, repeated.stdout), (0, attached.stdout), repeated.stderr)
        records = self.initial_inputs('parent')
        self.assertEqual(len(records), 2)
        self.assertEqual(records[1]['guidance'], guidance)
        self.assertEqual(records[1]['turn'], original['turn'])
        self.assertEqual(records[1]['seed'], original['seed'])
        self.assertTrue(records[1]['attempt'].startswith('attachment:'))
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertEqual(database.execute('SELECT count(*) FROM executions').fetchone()[0], 1)
        refused = subprocess.run(argv, input=guidance + 'Changed.', capture_output=True, text=True)
        self.assertEqual(refused.returncode, 2, refused.stdout + refused.stderr)
        self.assertIn('unchanged component guidance', refused.stderr)
        self.assertEqual(self.initial_inputs('parent'), records)
        self.assertEqual(self.coord('player', 'parent')['native'], '')
        self.action(stream, emit_claude_init=True)
        self.assertEqual(json.loads(stream.readline()), {'initialized': started['native']})
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'actual Claude initialization frame did not bind its native conversation')
        self.action(stream)
        self.finish(observer)
        self.assertEqual(self.coord('delivery', 'initial-task')['body'], task)
        self.assertTrue(read_recorded(self.db, 'initial-task'))

    def exercise_missing_omp_fallback(self, observer_losses):
        self.player(harness='omp')
        workspace = self.checkouts / 'parent'
        journal = workspace / 'seed.txt'
        partial = 'seed\nWork completed before the conversation was lost.\n'
        journal.write_text(partial)
        missing = 'missing-omp-conversation'
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update({'missing_resume': missing, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'parent', missing, '')
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        task = 'Keep seed.txt and append the final step after reading the existing work. caféλ🙂\n'
        self.prepare_input('original-task', 'parent', task, kind='task')
        receive = self.receive_args('parent')
        receive[5] = str(workspace)
        observer = self.spawn(*receive)
        fresh, started = self.accept('parent')
        self.assertEqual(started['resume'], '')
        self.assertNotIn('--resume', started['args'])
        self.assertNotEqual(started['native'], missing)
        self.assertIn('[id: original-task]', started['prompt'])
        self.assertIn(task, started['prompt'])
        self.assertIn('fresh conversation', started['prompt'])
        self.assertIn(' M seed.txt', started['prompt'])
        self.assertEqual(journal.read_text(), partial)
        launches_path = self.directory / 'native-launches.jsonl'
        launches = [json.loads(line) for line in launches_path.read_text().splitlines()]
        self.assertEqual([row['resume'] for row in launches], [missing, ''])
        initialization = self.initial_inputs('parent')
        self.assertEqual(len(initialization), 2)
        self.assertEqual(initialization[0]['seed'], initialization[1]['seed'])
        self.assertRegex(initialization[0]['seed'], r'^[0-9a-f]{128}$')
        self.assertIn(task, initialization[0]['guidance'])
        self.assertIn(task, initialization[1]['guidance'])
        self.assertNotEqual(initialization[0]['guidance'], initialization[1]['guidance'])
        self.assertEqual(started['prompt'], initialization[1]['seed'] + '\n\n'
                         + initialization[1]['instruction'] + '\n\n' + initialization[1]['guidance'])
        for row in initialization:
            self.assertNotIn('\0', row['guidance'])
            self.assertEqual(pathlib.Path(row['attempt'], 'prompt.txt').read_text(),
                             row['seed'] + '\n\n' + row['instruction'] + '\n\n' + row['guidance'])
        self.assertEqual(self.coord('delivery', 'original-task')['body'], task)
        self.assertFalse(any(p['pid'] == launches[0]['pid'] for p in self.owned_processes()))
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'fresh conversation identity was not recorded')

        def recovery_reports():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                database.row_factory = sqlite3.Row
                return [dict(row) for row in database.execute(
                    "SELECT * FROM messages WHERE sender='parent' AND kind='report' AND id LIKE '%:recovery'")]

        diagnostic = self.eventually(recovery_reports, 'missing conversation produced no recovery report')[0]
        self.assertIn('conversation', diagnostic['body'])
        log = self.output_log('parent')
        for loss in range(observer_losses):
            if loss == 0:
                observer.kill()
                observer.wait()
            else:
                recovered = self.eventually(
                    lambda: [p for p in self.owned_processes()
                             if p['ppid'] == started['ppid'] and '--recover-receive' in p['command']],
                    'fresh native keeper did not replace its observer')[0]
                os.kill(recovered['pid'], signal.SIGKILL)
            marker = 'fresh fallback native output after observer loss ' + str(loss)
            self.action(fresh, progress=marker)
            self.assertEqual(json.loads(fresh.readline()), {'progress_written': marker})
            self.eventually(lambda: log.exists() and marker in log.read_text(),
                            'fresh native output was lost with its observer')
            self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
            self.assert_receive_has_no_attempt(self.coord(*receive))
            self.assert_no_start()
            self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
            self.assertIn('original-task', [m['id'] for m in self.coord('inbox', 'parent')])
            self.assertEqual([row['id'] for row in recovery_reports()], [diagnostic['id']])
            actual = [json.loads(line) for line in launches_path.read_text().splitlines()]
            self.assertEqual([row['pid'] for row in actual], [row['pid'] for row in launches],
                             'observer recovery launched another native process')
            self.assertEqual(self.initial_inputs('parent'), initialization)

        completed = 'Final step completed in the fresh conversation.\n'
        self.action(fresh, append_file=['seed.txt', completed])
        self.assertEqual(json.loads(fresh.readline()), {'appended': 'seed.txt'})
        body = 'Fresh conversation completed the original task.\nExisting workspace work was preserved.'
        self.action(fresh, body=body)
        self.assertEqual(fresh.readline(), b'')
        if observer_losses == 0:
            self.finish(observer)
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'fresh fallback did not drain the original task and notify its parent')
        self.shutdown_idle_database_owner('fallback keeper or observer did not exit naturally')
        self.assertEqual(journal.read_text(), partial + completed)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [body])
        self.assertNotEqual(turns[0]['id'], diagnostic['id'].removesuffix(':recovery'))
        self.assertTrue(read_recorded(self.db, turns[0]['id']))
        self.assertEqual([row['id'] for row in recovery_reports()], [diagnostic['id']])
        self.assertTrue(read_recorded(self.db, recovery_reports()[0]['id']))
        delivered = [json.loads(line) for line in (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
        delivered_bodies = {message['id']: message['body'] for message in delivered}
        self.assertEqual(delivered_bodies[diagnostic['id']], diagnostic['body'])
        self.assertEqual(delivered_bodies[turns[0]['id']], body)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        actual = [json.loads(line) for line in launches_path.read_text().splitlines()]
        self.assertEqual([row['pid'] for row in actual], [row['pid'] for row in launches])
        self.assertEqual(self.initial_inputs('parent'), initialization)

    def test_missing_omp_conversation_restarts_pending_receive_with_workspace_state(self):
        self.exercise_missing_omp_fallback(observer_losses=0)

    def test_missing_omp_fresh_fallback_survives_repeated_observer_loss(self):
        self.exercise_missing_omp_fallback(observer_losses=2)

    def test_missing_omp_root_conversation_drains_task_and_recovery_context(self):
        missing = 'missing-root-conversation'
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update({'missing_resume': missing, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        self.coord('attach', 'root', 'omp', missing, '')
        partial = 'seed\nRoot work completed before conversation loss.\n'
        journal = self.repo / 'seed.txt'
        journal.write_text(partial)
        self.prepare_input('root-task', 'root', 'Keep existing root work and finish seed.txt.',
                           kind='task')
        receive = self.receive_args('root')
        receive[5] = str(self.repo)
        observer = self.spawn(*receive)
        fresh, started = self.accept('root')
        self.assertEqual(started['resume'], '')
        self.assertNotEqual(started['native'], missing)
        self.assertIn('[id: root-task]', started['prompt'])
        self.assertIn('fresh conversation', started['prompt'])
        self.assertIn(' M seed.txt', started['prompt'])
        self.action(fresh, append_file=['seed.txt', 'Root task completed.\n'])
        self.assertEqual(json.loads(fresh.readline()), {'appended': 'seed.txt'})
        body = 'Root task completed in a fresh conversation.'
        self.action(fresh, body=body)
        self.finish(observer)
        self.assertEqual(self.coord('inbox', 'root'), [])
        turns = self.coord('turns', 'root')
        self.assertEqual([(turn['player'], turn['eventType'], turn['reportBody']) for turn in turns],
                         [('root', 'agent_end', body)])
        reports = self.coord('inbox', 'operator')
        self.assertEqual([report['body'] for report in reports], [
            "The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.",
            body])
        self.assertTrue(reports[0]['id'].endswith(':recovery'))
        self.assertNotEqual(turns[0]['id'], reports[0]['id'].removesuffix(':recovery'))
        self.assertEqual(reports[1]['id'], turns[0]['id'])
        self.assertTrue(read_recorded(self.db, 'root-task'))
        recovery_input = reports[0]['id'].removesuffix(':recovery') + ':recovery-input'
        self.assertTrue(read_recorded(self.db, recovery_input))
        for report in reports:
            delivered = self.coord('delivery', report['id'])
            self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind'], delivered['body']),
                             ('root', 'operator', 'report', report['body']))
            self.assertFalse(read_recorded(self.db, delivered['id']))
            self.coord('as', 'operator', 'read', report['id'])
            self.assertTrue(read_recorded(self.db, report['id']))
        self.assertEqual(self.coord('inbox', 'operator'), [])
        self.assertTrue(read_recorded(self.db, self.coord('turns', 'root')[0]['id']))
        self.assertEqual(self.coord('player', 'root')['native'], started['native'])
        self.assertEqual(journal.read_text(), partial + 'Root task completed.\n')
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertEqual(database.execute("SELECT id FROM messages WHERE kind='report' ORDER BY seq").fetchall(),
                             [(report['id'],) for report in reports])
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([row['resume'] for row in launches], [missing, ''])
        self.shutdown_idle_database_owner('root fallback processes did not exit naturally')

    def test_stale_shared_omp_refusal_does_not_restart_an_unrelated_failure(self):
        self.player(harness='omp')
        native = 'existing-omp-conversation'
        storage = pathlib.Path(str(self.db) + '.session-' + 'parent'.encode().hex())
        storage.mkdir()
        (storage / ('2026-09-28_' + native + '.jsonl')).write_text(json.dumps({'type': 'session', 'id': native}) + '\n')
        self.coord('connect', 'parent', native, '')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        cause = 'Error: Provider unavailable for this fixture'
        config.update({'early_failure': cause, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        (self.directory / 'parent.jsonl.stderr').write_text('Error: Session from a prior attempt not found\n')
        self.coord('message', 'task', 'root', 'parent', 'task', 'Input must remain available after provider failure.')
        result = self.coord(*self.receive_args('parent'), ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['task'])
        self.assertEqual(self.coord('player', 'parent')['native'], native)
        reports = self.coord('inbox', 'root')
        self.assertFalse(any(m['id'].endswith(':recovery') for m in reports))
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 1, 'an unrelated provider failure started a fresh native conversation')
        self.assertIn(native, launches[0]['resume'])
        diagnostics = [path for path in self.directory.glob('state.db.attempt-*/native.stderr')
                       if cause in path.read_text()]
        self.assertTrue(diagnostics, 'the real provider failure was not retained')
        self.assertTrue(any(str(path) in report['body'] for path in diagnostics for report in reports),
                        'parent diagnostic did not name a readable file containing the provider failure')
        self.shutdown_idle_database_owner('failed attempt processes did not exit naturally')

    def exercise_observer_loss(self, harness, retry, terminal_before_loss=False, evidence=None):
        evidence = evidence if evidence is not None else {}
        evidence.update({'harness': harness, 'retryRequested': retry,
                         'terminalBeforeObserverLoss': terminal_before_loss})
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness=harness)
        self.prepare_input('first', 'parent', 'The original input must be sent once.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        evidence.update({'firstSupervisor': observer.pid, 'firstNative': started['pid'],
                         'keeper': started['ppid'], 'originalPrompt': started['prompt']})
        native = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                 'original native identity was not recorded')
        self.assertEqual(native, started['native'])
        evidence['recordedNativeId'] = native
        # Reports remain queued while OMP is active; guidance may be steered live.
        self.coord('message', 'second', 'root', 'parent', 'report', 'Queued before observer loss.')
        original_body = 'Original completion retained through observer loss: ' + harness
        log = self.output_log('parent')
        if terminal_before_loss:
            self.action(original, body=original_body, hold_exit=True, report_input=True)
            self.assertEqual(json.loads(original.readline()),
                             {'terminal_written': True, 'input_after_prompt': ''})
            self.eventually(lambda: log.exists() and original_body in log.read_text(),
                            'terminal event was not observed before killing the observer')
            evidence['turnsBeforeLoss'] = self.coord('turns', 'parent')
        observer.kill()
        observer.wait()
        evidence['supervisorExit'] = observer.returncode
        evidence['survivingNative'] = [p for p in self.owned_processes() if p['pid'] == started['pid']]
        self.assertTrue(evidence['survivingNative'], 'original native exited with its observer')
        if retry:
            queued = self.coord(*self.receive_args('parent'))
            evidence['retryReceive'] = queued['receive']
            self.assertEqual(queued['receive'], 'none')
        self.coord('message', 'third', 'root', 'parent', 'report', 'Queued after observer loss.')
        marker = 'output from original native after observer loss: ' + harness
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        self.eventually(lambda: log.exists() and marker in log.read_text(),
                        'automatic recovery did not retain output from the original native')
        evidence['postLossOutputRetained'] = True
        if not terminal_before_loss:
            self.action(original, body=original_body, hold_exit=True, report_input=True)
            self.assertEqual(json.loads(original.readline()),
                             {'terminal_written': True, 'input_after_prompt': ''})
        evidence['originalPromptRepeated'] = False
        self.eventually(lambda: original_body in log.read_text(), 'original terminal output was lost')
        evidence['duplicateNativeSession'] = bool(select.select([self.server], [], [], 0)[0])
        self.assertFalse(evidence['duplicateNativeSession'],
                         'another native started before the original process exited')
        if retry:
            after_terminal = self.coord(*self.receive_args('parent'))
            evidence['retryAfterTerminalReceive'] = after_terminal['receive']
            self.assertEqual(after_terminal['receive'], 'none')
            self.assert_no_start()
        evidence['pendingBeforeNativeExit'] = self.coord('inbox', 'parent')
        self.assertEqual([m['id'] for m in evidence['pendingBeforeNativeExit']], ['second', 'third'])
        self.action(original)
        self.assertEqual(original.readline(), b'')

        arrivals = {}
        for _ in range(2):
            control, event = self.accept_any()
            self.assertNotIn(event['session'], arrivals, 'duplicate session launched during recovery')
            arrivals[event['session']] = (control, event)
        self.assertEqual(set(arrivals), {'parent', 'root'})
        continuation, resumed = arrivals['parent']
        parent, notified = arrivals['root']
        evidence['continuation'] = resumed
        evidence['parentNotification'] = notified
        evidence['originalExitedBeforeContinuation'] = not any(
            p['pid'] == started['pid'] for p in self.owned_processes())
        self.assertTrue(evidence['originalExitedBeforeContinuation'])
        self.assertEqual(resumed['native'], native)
        self.assertNotEqual(resumed['pid'], started['pid'])
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertIn('[id: third]', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        self.assertNotIn(original_body, notified['prompt'])
        self.assertIn('baton read', notified['prompt'])
        evidence['parentNotified'] = True
        follow_up_body = 'Queued inputs completed after recovery: ' + harness
        self.action(continuation, body=follow_up_body)
        self.assertEqual(continuation.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, next_notification = self.accept('root')
        self.assertNotIn(follow_up_body, next_notification['prompt'])
        self.assertIn('baton read', next_notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'recovered work or its parent notification remained pending')
        evidence['pendingInputDrained'] = True
        turns = self.coord('turns', 'parent')
        evidence['turnsAfterRecovery'] = turns
        self.assertEqual([t['reportBody'] for t in turns], [original_body, follow_up_body])
        self.assertTrue(all(read_recorded(self.db, t['id']) for t in turns))
        if evidence.get('turnsBeforeLoss'):
            self.assertEqual(turns[0]['id'], evidence['turnsBeforeLoss'][0]['id'])
        evidence['originalCompletionRetained'] = turns[0]['reportBody'] == original_body
        evidence['retainedNativeFrames'] = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(self.coord('player', 'parent')['native'], native)
        self.shutdown_idle_database_owner('fixture keeper or recovery did not exit')
        return evidence

    def test_observer_loss_retry_preserves_native_and_drains_pending_messages(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                # Each harness needs a separate database and native identity.
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=True)
                finally:
                    fixture.doCleanups()

    def test_observer_loss_recovers_without_a_retry(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=False)
                finally:
                    fixture.doCleanups()

    def exercise_missing_output_generation(self, remove_parent, refuse_replay_write=False):
        self.player(harness='omp')
        configuration = self.directory / 'fixture.json'
        configuration.write_text(json.dumps({**json.loads(configuration.read_text()), 'record_launches': True}))
        self.coord('message', 'missing-output-task', 'root', 'parent', 'task', 'Retain this native result through output-file loss.')
        output_directory = self.directory / 'removed output' / 'nested'
        output_directory.mkdir(parents=True)
        arguments = self.receive_args('parent')
        arguments[6] = str(output_directory / 'parent.jsonl')
        observer = self.spawn(*arguments)
        original, started = self.accept_child(observer, 'parent')
        marker = 'Complete output retained before projection loss: café Ω 🙂'
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        generation = self.output_log('parent')

        def progress_projected():
            if not generation.exists():
                return False
            complete = generation.read_bytes().rpartition(b'\n')[0]
            return any(frame.get('type') == 'fixture_progress' and frame.get('marker') == marker
                       for frame in (json.loads(line) for line in complete.splitlines()))

        self.eventually(progress_projected, 'original output was not projected')
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            ident, directory = database.execute("SELECT id,directory FROM executions WHERE session='parent'").fetchone()
        attempt = pathlib.Path(directory)
        if remove_parent:
            shutil.rmtree(output_directory.parent)
        else:
            selected = self.selected_process(observer.pid)
            self.signal_selected(selected, signal.SIGSTOP)
            generation.unlink()
            if refuse_replay_write:
                output_directory.chmod(0o555)
            self.signal_selected(selected, signal.SIGKILL)
            observer.wait()
        body = 'Original native result after projection loss: café Ω 🙂'
        self.action(original, body=body, ack=False, complete_task=False)
        self.assertEqual(original.readline(), b'')
        self.finish(observer, ok=False)

        if refuse_replay_write:
            try:
                failure_log = attempt / 'observer.log'
                permission_cause = '13: Log ' + str(generation) + ': Could not write file at output position.'
                self.eventually(lambda: failure_log.exists() and permission_cause in failure_log.read_text(),
                                'the reconstruction write did not retain its filesystem refusal')
                checkpoint = (attempt / 'checkpoint').read_bytes()
                state_at = checkpoint.index(b'{"schema":1,')
                reset = json.loads(checkpoint[state_at:])
                self.assertEqual(reset['output'], '0')
                self.assertFalse(reset['output_done'])
            finally:
                output_directory.chmod(0o755)

        def recovered():
            error = attempt / 'observer-error'
            if not refuse_replay_write:
                self.assertFalse(error.exists(), error.read_text() if error.exists() else '')
            return (attempt / 'acknowledged').exists()

        self.eventually(recovered, 'same retained attempt did not reconstruct its output')
        self.shutdown_idle_database_owner('recovered output attempt did not retire')
        output = generation.read_bytes()
        self.assertNotIn(b'\0', output)
        frames = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([frame['marker'] for frame in frames
                          if frame.get('type') == 'fixture_progress'], [marker])
        self.assertEqual([text for frame in frames
                          if frame.get('type') == 'agent_end'
                          for text in ([frame['text']] if frame.get('compacted') else
                                       [content['text'] for message in frame['messages']
                                        for content in message['content']])],
                         [body])
        self.assertEqual(self.coord('delivery', 'missing-output-task')['receipt'], 'native-turn:' + ident)
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 1, launches)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertEqual(len(self.codex_calls.read_text().splitlines()), 1)

    def test_missing_output_directory_reconstructs_original_native_projection(self):
        self.exercise_missing_output_generation(remove_parent=True)

    def test_missing_output_file_reconstructs_original_native_projection(self):
        self.exercise_missing_output_generation(remove_parent=False)

    def test_missing_output_recovery_commits_reset_before_projection_failure(self):
        self.exercise_missing_output_generation(remove_parent=False, refuse_replay_write=True)

    def test_observer_loss_after_terminal_keeps_lock_until_native_exit(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=True, terminal_before_loss=True)
                finally:
                    fixture.doCleanups()

    def test_fourteen_argument_inbox_inspection_preserves_filters_and_read_state(self):
        self.player()
        self.prepare_input('filtered-earlier', 'parent', 'Earlier guidance.')
        self.prepare_input('filtered-other-kind', 'parent', 'A separate report.', kind='report')
        body = '\ufeffComplete selected guidance.\nλ🙂\nFinal spaces  \n'
        self.prepare_input('filtered-selected', 'parent', body)
        self.prepare_input('filtered-later', 'parent', 'Later guidance.')
        self.coord('as', 'parent', 'read', 'filtered-selected')
        self.assertTrue(read_recorded(self.db, 'filtered-selected'))
        with sqlite3.connect(self.db) as database:
            earlier = database.execute("SELECT seq FROM messages WHERE id='filtered-earlier'").fetchone()[0]
            selected = database.execute("SELECT seq FROM messages WHERE id='filtered-selected'").fetchone()[0]
        result = self.coord('inbox', 'parent', '--index', '--sender', 'root', '--kind', 'guidance',
                            '--state', 'all', '--after-seq', earlier, '--through-seq', selected)
        self.assertEqual([{field: row[field] for field in
                           ('seq', 'id', 'sender', 'recipient', 'kind', 'receipt')} for row in result],
                         [{'seq': selected, 'id': 'filtered-selected', 'sender': 'root',
                           'recipient': 'parent', 'kind': 'guidance', 'receipt': None}])
        self.assertNotIn('body', result[0])
        delivery = self.coord('delivery', 'filtered-selected')
        self.assertEqual((delivery['body'], delivery['receipt']), (body, None))
        self.assertEqual(self.coord('turns', 'parent'), [])
        self.assert_no_start()

    def test_legacy_keeper_recovers_fourteen_arguments_and_closes_terminal_input(self):
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness='omp')
        self.prepare_input('legacy-original', 'parent', 'Finish the original legacy input.', kind='task')
        self.coord('connect', 'parent', 'native-parent', '')
        attempt = self.directory / 'legacy-attempt'
        attempt.mkdir()
        log = self.directory / 'parent.jsonl'
        with sqlite3.connect(self.db) as database:
            cutoff = database.execute("SELECT seq FROM messages WHERE id='legacy-original'").fetchone()[0]
            identity = f'receive:parent:{cutoff}:legacy-keeper'
            database.execute('INSERT INTO executions(session,id,mode,directory,phase,status) VALUES(?,?,?,?,?,?)',
                             ('parent', identity, 'retained', str(attempt), 'running', ''))
        recovery = [str(EXE.resolve()), '--recover-receive', str(self.db.resolve()), 'parent',
                    identity, str(cutoff) + '\n', str(self.fixture), 'parent', 'low',
                    str(self.directory), str(log), 'omp\n', str(attempt), 'native-parent']
        self.assertEqual(len(recovery), 14)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        prompt = 'Message (task) from root [id: legacy-original]:\nFinish the original legacy input.\n'
        config.update(record_launches=True, legacy_keeper={
            'directory': str(attempt), 'control': str(pathlib.Path(self.ipc.name) / 'legacy-control'),
            'guard': _session_lock_path(self.db, 'parent'), 'recovery': recovery,
            'native': [str(self.fixture), '--mode', 'rpc', '--model', 'parent',
                       '--session-dir', str(self.db) + '.sessions'],
            'initial': '\n'.join(json.dumps(value) for value in [
                {'type': 'set_event_filter'}, {'type': 'get_state', 'id': 'baton:session'},
                {'type': 'prompt', 'message': prompt}]) + '\n',
        })
        config_path.write_text(json.dumps(config))
        keeper = subprocess.Popen([str(self.fixture), 'legacy_keeper'], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        self.children.append(keeper)
        native, started = self.accept_child(keeper, 'parent')
        retained = {name: (attempt / name).read_bytes() for name in ('manifest', 'native.birth')}
        observer = subprocess.Popen(recovery, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(observer)
        self.action(native, progress='legacy observer attached')
        self.assertEqual(json.loads(native.readline()), {'progress_written': 'legacy observer attached'})
        def legacy_marker_written(marker):
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                registered = database.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='log_generations'").fetchone()
                if registered is None:
                    return False
                row = database.execute(
                    'SELECT session,attempt,base,log FROM log_generations WHERE session=? AND attempt=?',
                    ('parent', identity)).fetchone()
            if row is None:
                return False
            self.assertEqual(row[:3], ('parent', identity, str(log)))
            generation = pathlib.Path(row[3])
            return generation.exists() and marker in generation.read_text()
        def attached():
            if observer.poll() is not None:
                self.fail('Legacy receive recovery exited: ' + ''.join(self.child_communication(observer)))
            if keeper.poll() is not None:
                self.fail('Legacy keeper exited: ' + ''.join(self.child_communication(keeper)))
            return legacy_marker_written('legacy observer attached')
        self.eventually(attached, 'Current recovery did not attach to the legacy keeper.')
        self.assertFalse(self.session_guard_available('parent'))
        duplicate = subprocess.run(recovery, capture_output=True, text=True)
        self.assertEqual(duplicate.returncode, 16, duplicate.stderr)
        self.assertIn(os.strerror(errno.EBUSY), duplicate.stderr)
        observer.kill()
        observer.wait()
        self.coord('message', 'legacy-second', 'root', 'parent', 'report', 'Queued after legacy observer loss.')
        marker = 'original native output after legacy observer loss'
        self.action(native, progress=marker)
        self.assertEqual(json.loads(native.readline()), {'progress_written': marker})
        self.eventually(lambda: legacy_marker_written(marker), 'Keeper recovery did not resume the legacy stream.')
        launches = [json.loads(line) for line in (attempt / 'legacy-recoveries.jsonl').read_text().splitlines()]
        self.assertEqual([launch['argv'] for launch in launches], [recovery])
        self.assertIsNotNone(self.selected_process(started['pid']))
        for name, content in retained.items():
            self.assertEqual((attempt / name).read_bytes(), content)
        self.assertFalse(self.session_guard_available('parent'))
        self.assert_no_start()
        body = 'Original legacy work completed through the same native process.'
        self.action(native, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(native.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.assertFalse((attempt / 'status').exists())
        self.assertIsNotNone(self.selected_process(started['pid']))
        self.assertFalse(self.session_guard_available('parent'))
        self.action(native)
        self.assertEqual(native.readline(), b'')
        continuation, resumed = self.accept('parent')
        self.assertIsNone(self.selected_process(started['pid']))
        self.assertNotEqual(resumed['ppid'], keeper.pid)
        owner_command = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        self.assertTrue(any(process['pid'] == resumed['ppid'] and process['command'] == owner_command
                            for process in self.owned_processes()))
        self.assertEqual(resumed['native'], started['native'])
        self.assertIn('[id: legacy-second]', resumed['prompt'])
        self.assertNotIn('[id: legacy-original]', resumed['prompt'])
        self.action(continuation, body='Queued input completed under the current database owner.')
        self.assertEqual(continuation.readline(), b'')
        self.finish(keeper)
        self.eventually(lambda: len(self.coord('turns', 'parent')) == 2, 'Legacy completion was not retained once.')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         [body, 'Queued input completed under the current database owner.'])
        self.assertEqual((attempt / 'status').read_text(), '0\n')
        self.assertTrue((attempt / 'released').exists())
        self.assertTrue((attempt / 'acknowledged').exists())
        wire = [json.loads(line) for line in (attempt / 'legacy-wire.jsonl').read_text().splitlines()]
        self.assertEqual([item['serial'] for item in wire if item['operation'] == 14], [0, 0])
        completion = [item for item in wire if item['operation'] in (6, 8, 9)]
        operations = [item['operation'] for item in completion]
        self.assertEqual(operations[-2:], [8, 9])
        self.assertTrue(operations[:-2])
        self.assertTrue(all(operation == 6 for operation in operations[:-2]))
        self.assertTrue(all(item['serial'] > 0 for item in completion))
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.shutdown_idle_database_owner('Legacy recovery and current continuation did not settle.')
        self.assertTrue(self.session_guard_available('parent'))

    def selected_process(self, pid):
        found = process_table(pid)
        if not found:
            return None
        process, = found
        return {'pid': process['pid'], 'ppid': process['ppid'], 'start': process['start'],
                'state': process['status'], 'command': process['command']}

    def signal_selected(self, selected, action):
        current = self.selected_process(selected['pid'])
        self.assertIsNotNone(current, 'The selected process ended before loss injection.')
        for field in ('pid', 'start', 'command'):
            self.assertEqual(current[field], selected[field])
        self.assertFalse(current['state'].startswith('Z'))
        self.assertGreater(selected['pid'], 1)
        self.assertNotEqual(selected['pid'], os.getpid())
        os.kill(selected['pid'], action)

    def session_guard_available(self, session):
        path = pathlib.Path(_session_lock_path(self.db, session))
        with path.open('r+b') as stream:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except BlockingIOError:
                return False

    def suspend_observer_without_database_reader(self, selected):
        with sqlite3.connect(self.db) as writer:
            writer.execute('BEGIN EXCLUSIVE')
            self.signal_selected(selected, signal.SIGSTOP)
            self.eventually(lambda: (self.selected_process(selected['pid']) or {}).get('state', '').startswith('T'),
                            'The selected observer did not suspend before native completion.')

    def exercise_keeper_loss(self, harness, observer_loss):
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness=harness)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(record_launches=True, inspect_session_guard=True)
        config_path.write_text(json.dumps(config))
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        self.assertEqual(started['sessionGuardDescriptors'], [])
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original native identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        self.coord('message', 'second', 'root', 'parent', 'report', 'The exact queued input.')
        self.assertFalse(self.session_guard_available('parent'))
        owner_command = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        owners = [process for process in self.owned_processes()
                  if process['command'] == owner_command]
        self.assertEqual(len(owners), 1, f'Expected this fixture DB owner: {owners}')
        selected = {name: self.selected_process(pid) for name, pid in
                    [('observer', observer.pid), ('owner', owners[0]['pid']), ('native', started['pid'])]}
        self.assertTrue(all(selected.values()))
        self.assertEqual(selected['observer']['ppid'], os.getpid())
        self.assertEqual(selected['owner']['command'], owner_command)
        self.assertEqual(selected['native']['ppid'], selected['owner']['pid'])
        self.assertIn(str(self.db), selected['observer']['command'])
        self.assertIn(str(self.fixture), selected['native']['command'])
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.assertEqual(int((attempt / 'native.pid').read_text()), started['pid'])
        if observer_loss:
            self.signal_selected(selected['observer'], signal.SIGSTOP)
        self.signal_selected(selected['owner'], signal.SIGKILL)
        producer = observer
        if observer_loss:
            self.signal_selected(selected['observer'], signal.SIGKILL)
            observer.wait()
            self.assertEqual(observer.returncode, -signal.SIGKILL)
            before_direct = (self.directory / 'native-launches.jsonl').read_bytes()
            with sqlite3.connect(self.db) as database:
                execution = database.execute("SELECT * FROM executions WHERE session='parent'").fetchone()
            task = self.directory / 'direct-before-recovery.txt'
            task.write_text('A direct task before adopting the surviving original.')
            direct = self.spawn('turn', 'parent', 'direct-before-recovery', self.fixture, 'parent', 'low',
                                self.directory, task, self.directory / 'direct-before-recovery.jsonl', native_id)
            _, stderr = self.finish(direct, ok=False)
            self.assertEqual(direct.returncode, 2)
            self.assertIn('run receive', stderr)
            self.assertEqual((self.directory / 'native-launches.jsonl').read_bytes(), before_direct)
            with sqlite3.connect(self.db) as database:
                self.assertEqual(database.execute("SELECT * FROM executions WHERE session='parent'").fetchone(),
                                 execution, 'Direct admission replaced the unreleased Receive attempt.')
            producer = self.spawn(*self.receive_args('parent'))
        current = self.selected_process(started['pid'])
        self.assertIsNotNone(current)
        self.assertEqual(current['start'], selected['native']['start'])
        self.assertFalse(current['state'].startswith('Z'))
        marker = 'Surviving original stdout after keeper loss.'
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: log.exists() and marker in log.read_text(),
                        'The observer did not retain surviving native stdout.')
        self.assertFalse(self.session_guard_available('parent'))
        launches = self.directory / 'native-launches.jsonl'
        before_retry = launches.read_bytes()
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assertEqual(launches.read_bytes(), before_retry)
        body = 'Original result retained after keeper loss: ' + harness
        self.action(original, body=body, hold_exit=True)
        self.assertEqual(json.loads(original.readline()), {'terminal_written': True})
        self.eventually(lambda: body in log.read_text(), 'The original terminal frame was not retained.')
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assertEqual(launches.read_bytes(), before_retry)
        self.assertFalse(self.session_guard_available('parent'))
        self.action(original)
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept('parent')
        original_birth = self.selected_process(started['pid'])
        self.assertTrue(original_birth is None or original_birth['start'] != selected['native']['start']
                        or original_birth['state'].startswith('Z'),
                        'Pending continuation overlapped the original native lifetime.')
        self.assertEqual(resumed['sessionGuardDescriptors'], [])
        self.assertEqual(resumed['native'], native_id)
        if harness == 'codex':
            self.assertEqual(resumed['resume'], native_id)
        else:
            self.assertEqual(json.loads(pathlib.Path(resumed['resume']).read_text().splitlines()[0])['id'],
                             native_id)
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertIn('baton read second', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        pending_body = 'Pending result after keeper loss: ' + harness
        self.action(continuation, body=pending_body)
        self.assertEqual(continuation.readline(), b'')
        self.finish(producer, ok=False)
        self.assertEqual(producer.returncode, 2)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        turns = self.coord('turns', 'parent')
        self.assertEqual([row['reportBody'] for row in turns], [body, pending_body])
        self.assertTrue(all(read_recorded(self.db, row['id']) for row in turns))
        with sqlite3.connect(self.db) as database:
            accepted = database.execute(
                "SELECT m.id,m.body,(SELECT count(*) FROM message_reads r "
                "WHERE r.message=m.id AND r.recipient=m.recipient) "
                "FROM messages m WHERE m.id IN ('first','second') ORDER BY m.seq").fetchall()
        self.assertEqual([row[:2] for row in accepted],
                         [('first', 'Complete the original input.'),
                          ('second', 'The exact queued input.')])
        self.assertTrue(all(row[2] > 0 for row in accepted), accepted)
        deliveries = [json.loads(line) for line in (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
        self.assertTrue(any(row['body'] == body for row in deliveries))
        self.assertTrue(any(row['body'] == pending_body for row in deliveries))
        self.assertTrue(any('unknown after keeper loss' in row['body'] for row in deliveries))
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        self.shutdown_idle_database_owner('A fixture owner did not exit naturally.')
        self.assertTrue(self.session_guard_available('parent'))
        task = self.directory / 'direct-after-recovery.txt'
        task.write_text('A direct task after the retained Receive completed.')
        direct = self.spawn('turn', 'parent', 'direct-after-recovery', self.fixture, 'parent', 'low',
                            self.directory, task, self.directory / 'direct-after-recovery.jsonl', native_id)
        current, started_direct = self.accept('parent')
        self.assertEqual(started_direct['native'], native_id)
        self.assertEqual(started_direct['sessionGuardDescriptors'], [])
        self.action(current, body='Direct work after the retained Receive completed.')
        self.assertEqual(current.readline(), b'')
        self.finish(direct)
        self.shutdown_idle_database_owner('A direct owner did not exit naturally.')
        self.assertTrue(self.session_guard_available('parent'))

    def test_keeper_loss_preserves_original_and_drains_pending_input(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_keeper_loss(harness, observer_loss=False)
                finally:
                    fixture.doCleanups()

    def test_keeper_and_observer_loss_adopts_original_before_pending_input(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_keeper_loss(harness, observer_loss=True)
                finally:
                    fixture.doCleanups()

    def exercise_completed_observer(self, stopped, keeper_loss=True, device_renumbered=False,
                                    released=False, missing_output=False):
        print(f'Completed observer recovery: stopped={stopped}, keeper_loss={keeper_loss}, '
              f'device_renumbered={device_renumbered}, released={released}', file=sys.stderr, flush=True)
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config['hold_parent_delivery'] = released
        config_path.write_text(json.dumps(config))
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        print('WAIT: original native connection', file=sys.stderr, flush=True)
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept_child(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original native identity was not recorded.')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.eventually(lambda: (attempt / 'checkpoint').exists(),
                        'The original observer did not record its checkpoint.')
        if not released:
            self.coord('message', 'second', 'root', 'parent', 'task', 'Retain this queued input.')
        owner_command = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        owner = [process for process in self.owned_processes()
                 if process['command'] == owner_command]
        self.assertEqual(len(owner), 1)
        selected_observer = self.selected_process(observer.pid)
        selected_owner = self.selected_process(owner[0]['pid'])
        if not released:
            self.suspend_observer_without_database_reader(selected_observer)
        body = ('Original result after native exit.\nComplete Unicode result caféλ🙂.'
                if released else 'Original result after native exit.')
        self.action(original, body=body, exit_after_terminal=True)
        print('WAIT: original native exit and retained status', file=sys.stderr, flush=True)
        self.assertEqual(original.readline(), b'')
        self.eventually(lambda: (attempt / 'status').exists(),
                        'The keeper did not record actual native exit.')
        self.assertEqual((attempt / 'status').read_text(), '0\n')
        held_delivery = None
        original_report = None
        original_output = None
        if released:
            held_delivery, delivery = self.accept_child(observer, 'parent-delivery')
            self.assertTrue(any(message['sender'] == 'parent' and message['recipient'] == 'root'
                                and message['kind'] == 'report' and message['body'] == body
                                for message in delivery['messages']), delivery)
            self.eventually(lambda: (attempt / 'released').exists(),
                            'The completed receive did not release its native custody.')
            self.assertFalse((attempt / 'acknowledged').exists())
            terminal_frames = [json.loads(line) for line in (attempt / 'stdout').read_text().splitlines()]
            self.assertEqual([content['text'] for frame in terminal_frames
                              if frame.get('type') == 'agent_end'
                              for message in frame['messages'] for content in message['content']],
                             [body])
            self.suspend_observer_without_database_reader(selected_observer)
            if missing_output:
                checkpoint = (attempt / 'checkpoint').read_bytes()
                state_at = checkpoint.index(b'{"schema":1,')
                self.assertTrue(json.loads(checkpoint[state_at:])['output_done'])
                generation = self.output_log('parent')
                original_output = generation.read_bytes()
                projected_frames = [json.loads(line) for line in original_output.splitlines()]
                self.assertEqual([text for frame in projected_frames
                                  if frame.get('type') == 'agent_end'
                                  for text in ([frame['text']] if frame.get('compacted') else
                                               [content['text'] for message in frame['messages']
                                                for content in message['content']])],
                                 [body])
                generation.unlink()
            with sqlite3.connect(self.db) as database:
                self.assertEqual(database.execute(
                    "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
                ).fetchone(), (str(attempt),))
            original_report = self.coord('turns', 'parent')[0]
            self.coord('message', 'second', 'root', 'parent', 'task', 'Retain this queued input.')
            config['hold_parent_delivery'] = False
            config_path.write_text(json.dumps(config))
        if device_renumbered:
            # The retained logging attempt kept its path and inodes after its
            # device number changed. Its device-qualified guard was recreated.
            historical_guard = self.directory / 'pre-remount-session-guard'
            historical_guard.write_bytes(b'')
            self.assertNotEqual(historical_guard.stat().st_ino,
                                pathlib.Path(_session_lock_path(self.db, 'parent')).stat().st_ino)
            for name, device_offsets in (('admission', (16, 32, 48)), ('checkpoint', (40,))):
                path = attempt / name
                record = bytearray(path.read_bytes())
                self.assertEqual(record[:8], b'BATONAD1' if name == 'admission' else b'BATONC03')
                for offset in device_offsets:
                    device = struct.unpack_from('=Q', record, offset)[0]
                    struct.pack_into('=Q', record, offset, device ^ 1)
                if name == 'admission':
                    struct.pack_into('=Q', record, 40, historical_guard.stat().st_ino)
                digest = 0xcbf29ce484222325
                for byte in record[:72] + record[80:]:
                    digest = ((digest ^ byte) * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
                struct.pack_into('=Q', record, 72, digest)
                path.write_bytes(record)
            self.assertFalse((attempt / 'checkpoint-error').exists())
        if stopped:
            self.coord('stop', 'parent', 'operator-stop', 'Preserve the operator stop.')
        if keeper_loss:
            self.signal_selected(selected_owner, signal.SIGKILL)
            self.eventually(lambda: (self.selected_process(selected_owner['pid']) or {}).get('state', 'Z').startswith('Z'),
                            'The selected keeper did not exit.')
        retained = {name: (attempt / name).read_bytes() for name in ('manifest', 'native.birth', 'status')}
        self.assertEqual(self.session_guard_available('parent'), released)
        # Recovery must retire the suspended observer while a database writer
        # remains open. Replaying its retained output can write after retirement.
        with sqlite3.connect(self.db) as writer:
            writer.execute('BEGIN IMMEDIATE')
            if not stopped and not released:
                self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
            print('WAIT: recovering the completed attempt and retiring the selected observer', file=sys.stderr, flush=True)
            recovery = self.spawn('recover-observer', 'parent', observer.pid)
            self.finish_observer_during_recovery(observer, recovery, drain=not released)
            self.assertEqual(observer.returncode, -signal.SIGTERM)
            if held_delivery is not None:
                self.action(held_delivery, continue_delivery=True)
        if held_delivery is not None:
            self.assertEqual(held_delivery.readline(), b'')
            self.finish(observer, ok=False)
        print('Selected observer exited; awaiting recovery completion', file=sys.stderr, flush=True)
        if stopped:
            self.finish(recovery)
            self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['second'])
            self.assertTrue(read_recorded(self.db, 'second'))
            with sqlite3.connect(self.db) as database:
                self.assertEqual(database.execute(
                    "SELECT id,reason FROM session_stops WHERE session='parent'"
                ).fetchone(), ('operator-stop', 'Preserve the operator stop.'))
            self.assert_no_start()
        else:
            print('WAIT: pending input in the original native conversation', file=sys.stderr, flush=True)
            continuation, resumed = self.accept_child(recovery, 'parent')
            if not keeper_loss:
                current_owner = self.selected_process(selected_owner['pid'])
                self.assertIsNotNone(current_owner, 'The original keeper exited during observer handoff.')
                self.assertEqual(current_owner['start'], selected_owner['start'])
                self.assertEqual(current_owner['command'], selected_owner['command'])
            self.assertEqual(resumed['native'], native_id)
            self.assertIn('[id: second]', resumed['prompt'])
            self.assertIn('Retain this queued input.', resumed['prompt'])
            self.assertNotIn('[id: first]', resumed['prompt'])
            self.action(continuation, body='Pending input completed in the original conversation.')
            self.assertEqual(continuation.readline(), b'')
            print('WAIT: recovery reports and acknowledgment after native continuation', file=sys.stderr, flush=True)
            self.finish(recovery)
            self.assertEqual(self.coord('inbox', 'parent'), [])
        turns = self.coord('turns', 'parent')
        self.assertEqual(sum(row['reportBody'] == body for row in turns), 1)
        if original_report is not None:
            self.assertEqual([(row['id'], row['reportBody']) for row in turns
                              if row['id'] == original_report['id']],
                             [(original_report['id'], body)])
        self.assertTrue(all(read_recorded(self.db, row['id']) for row in turns))
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        for name, content in retained.items():
            self.assertEqual((attempt / name).read_bytes(), content)
        self.assertTrue((attempt / 'released').exists())
        self.assertTrue((attempt / 'acknowledged').exists())
        if original_output is not None:
            self.assertEqual(generation.read_bytes(), original_output)
        if released:
            launches = (self.directory / 'native-launches.jsonl').read_bytes()
            self.assertEqual(len(launches.splitlines()), 2)
            refused = self.coord('recover-observer', 'parent', observer.pid, ok=False)
            self.assertEqual(refused.returncode, 2, refused.stdout + refused.stderr)
            self.assertIn('no unfinished retained receive attempt', refused.stderr)
            self.assertEqual((self.directory / 'native-launches.jsonl').read_bytes(), launches)
            self.assertEqual(self.coord('turns', 'parent'), turns)
        if device_renumbered:
            self.assertFalse((attempt / 'admission-error').exists())
            self.assertFalse((attempt / 'checkpoint-error').exists(),
                             'Device renumbering discarded the retained observation checkpoint.')
        self.shutdown_idle_database_owner('The recovered fixture owner did not exit naturally.')
        self.assertTrue(self.session_guard_available('parent'))

    def test_completed_orphan_observer_recovers_original_and_pending_input(self):
        self.exercise_completed_observer(stopped=False, device_renumbered=True)

    def test_completed_orphan_observer_recovery_preserves_explicit_stop(self):
        self.exercise_completed_observer(stopped=True)

    def test_completed_live_keeper_observer_handoff_recovers_original_and_pending_input(self):
        self.exercise_completed_observer(stopped=False, keeper_loss=False)

    def test_released_unacknowledged_observer_recovers_original_and_pending_input(self):
        self.exercise_completed_observer(stopped=False, keeper_loss=False, released=True)

    def test_released_observer_reconstructs_completed_missing_output(self):
        self.exercise_completed_observer(stopped=False, keeper_loss=False, released=True,
                                        missing_output=True)

    def test_completed_omp_attempt_replay_leaves_guidance_for_current_native(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.prepare_input('first', 'parent', 'Original work.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, first = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.coord('message', 'second', 'root', 'parent', 'task', 'Work queued before original completion.')
        self.action(original, body='Original report survives completed-attempt replay.')
        self.assertEqual(original.readline(), b'')
        arrivals = {}
        for _ in range(2):
            stream, started = self.accept_any()
            self.assertNotIn(started['session'], arrivals)
            arrivals[started['session']] = (stream, started)
        self.assertEqual(set(arrivals), {'root', 'parent'})
        parent, notification = arrivals['root']
        current, second = arrivals['parent']
        self.assertIn('Original report survives completed-attempt replay.', notification['prompt'])
        self.assertEqual(second['native'], first['native'])
        marker = 'current native state observed before observer loss'
        self.action(current, progress=marker)
        self.assertEqual(json.loads(current.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: log.exists() and marker in log.read_text(), 'current native state was not observed')
        original_report = self.coord('turns', 'parent')[0]
        self.coord('message', 'later-guidance', 'root', 'parent', 'guidance',
                   'Guidance belongs to the current native process.')
        observer.kill()
        observer.wait()
        # The owner settles the old attempt while the current native process
        # keeps its task and accepts pending guidance.
        self.eventually(lambda: (attempt / 'acknowledged').exists(),
                        'completed OMP attempt was not acknowledged while guidance was pending')
        self.assertTrue(any(p['pid'] == second['pid'] for p in self.owned_processes()))
        self.assertIn('later-guidance', [m['id'] for m in self.coord('inbox', 'parent')])
        marker = 'recovery processed the current native response'
        barrier = {'type': 'response', 'command': 'fixture_barrier', 'success': True,
                   'id': marker}
        self.action(current, native_request=barrier)
        self.assertEqual(json.loads(current.readline()), {'request_written': barrier})
        current_attempt = pathlib.Path(self.execution('parent')[2])
        def recovered_barrier():
            output = log.read_bytes()
            position = output.find(marker.encode())
            if position < 0:
                return False
            end = output.find(b'\n', position)
            checkpoint = current_attempt / 'checkpoint'
            if end < 0 or not checkpoint.exists():
                return False
            record = checkpoint.read_bytes()
            state_at = record.find(b'{"schema":1,')
            if state_at < 0:
                return False
            state = json.loads(record[state_at:])
            return int(state['output']) >= end + 1
        self.eventually(recovered_barrier, 'recovery did not commit the native response')
        self.action(current, read_steer=True, require_ready=True)
        steered = json.loads(current.readline())
        self.assertIn('steer_received', steered,
                      'recovery processed the native response without forwarding pending guidance')
        accepted = steered['steer_received']
        self.assertEqual(accepted['id'], 'later-guidance')
        self.assertEqual(accepted['message'], 'Guidance belongs to the current native process.')
        marker = 'guidance accepted before recipient handling'
        self.action(current, progress=marker)
        self.assertEqual(json.loads(current.readline()), {'progress_written': marker})
        self.eventually(lambda: marker in log.read_text(),
                        'the observer did not read past the steer response')
        self.assertFalse(read_recorded(self.db, 'later-guidance'))
        self.action(current, body='Current task completed after accepting guidance.')
        self.assertEqual(current.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, notification = self.accept('root')
        self.assertIn('Current task completed after accepting guidance.', notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'replayed completion or current work remained pending')
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [
            'Original report survives completed-attempt replay.',
            'Current task completed after accepting guidance.',
        ])
        self.assertEqual(turns[0]['id'], original_report['id'])
        self.assertTrue(all(read_recorded(self.db, turn['id']) for turn in turns))
        self.shutdown_idle_database_owner('keeper or recovery did not exit after replay')

    def test_omp_recovery_after_input_closes_defers_guidance_until_native_exit(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.prepare_input('original', 'parent', 'Original work.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        original_body = ('Original OMP result before observer loss.\n'
                         'The second line must reach the parent unchanged.')
        self.action(original, body=original_body, hold_exit=True, report_input=True)
        # The fixture reports this only after reading EOF from native stdin.
        self.assertEqual(json.loads(original.readline()),
                         {'terminal_written': True, 'input_after_prompt': ''})
        original_report = self.eventually(lambda: self.coord('turns', 'parent'),
                                          'OMP terminal was not recorded before observer loss')[0]
        self.assertEqual(original_report['reportBody'], original_body)
        self.message('pending-guidance', 'parent', 'Work for the next native invocation.')
        observer.kill()
        observer.wait()
        marker = 'original native output after observer loss with stdin already closed'
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(),
                        'recovery could not read post-loss output while native stdin was closed')
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assert_no_start()
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['pending-guidance'])
        self.assertEqual(list(self.directory.glob('state.db.attempt-*/observer-error')), [])
        for recovery_log in self.directory.glob('state.db.attempt-*/observer.log'):
            self.assertNotIn('Broken pipe', recovery_log.read_text())
        self.action(original)
        self.assertEqual(original.readline(), b'')

        arrivals = {}
        for _ in range(2):
            control, event = self.accept_any()
            self.assertNotIn(event['session'], arrivals)
            arrivals[event['session']] = (control, event)
        self.assertEqual(set(arrivals), {'parent', 'root'})
        continuation, resumed = arrivals['parent']
        parent, notification = arrivals['root']
        self.assertFalse(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.assertEqual(resumed['native'], started['native'])
        self.assertIn('[id: pending-guidance]', resumed['prompt'])
        self.assertNotIn('[id: original]', resumed['prompt'])
        self.assertIn(original_body, notification['prompt'])
        follow_up_body = 'Pending guidance completed by the next native invocation.'
        self.action(continuation, body=follow_up_body)
        self.assertEqual(continuation.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, notification = self.accept('root')
        self.assertIn(follow_up_body, notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'pending guidance or its parent notification was not acknowledged')
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [original_body, follow_up_body])
        self.assertEqual(turns[0]['id'], original_report['id'])
        self.assertTrue(all(read_recorded(self.db, turn['id']) for turn in turns))
        self.shutdown_idle_database_owner('keeper or recovery did not exit naturally')
        self.assertEqual(list(self.directory.glob('state.db.attempt-*/observer-error')), [])
        for recovery_log in self.directory.glob('state.db.attempt-*/observer.log'):
            self.assertNotIn('Broken pipe', recovery_log.read_text())

    def test_codex_principal_receive_uses_subscription_and_saved_native_thread(self):
        self.coord('attach','root','codex','','')
        observed=[]
        for ident, body in [('subscription-initial','First Principal input.\n'),
                            ('subscription-followup','Review the saved Principal conversation.\n')]:
            self.prepare_input(ident, 'root', body, kind='task')
            with patch.dict(os.environ, {'OPENAI_API_KEY':'controlled-unused-key', 'CODEX_API_KEY':'controlled-unused-key'}):
                observer=self.spawn(*self.receive_args('root'))
                control, started=self.accept_child(observer, 'root')
                owned=self.owned_processes()
                self.action(control, body=body)
                self.finish(observer)
            observed.append((started,owned,ident,body))
        native=observed[0][0]['native']
        for (started,owned,ident,body), subcommand in zip(observed,[['exec'],['exec','resume',native]]):
            self.assertEqual(started['args'][:2],['-c','forced_login_method="chatgpt"'])
            self.assertEqual(started['args'][2:2+len(subcommand)],subcommand)
            configs=[started['args'][i+1] for i,arg in enumerate(started['args']) if arg=='-c']
            self.assertEqual(configs,['forced_login_method="chatgpt"','model_reasoning_effort="low"'])
            self.assertEqual(started['args'][started['args'].index('--model')+1],'root')
            self.assertEqual(started['apiKeyVariablesPresent'],[])
            self.assertEqual(started['cwd'],str(self.directory))
            self.assertIn('[id: '+ident+']',started['prompt'])
            self.assertIn(body,started['prompt'])
            self.assertEqual(started['native'],native)
            self.assertTrue(any(p['pid']==started['pid'] and p['ppid']==started['ppid'] for p in owned))
        self.assertEqual(observed[0][0]['resume'],'')
        self.assertEqual(observed[1][0]['resume'],native)
        self.assertEqual(self.coord('player','root')['native'],native)
        self.assertEqual(self.coord('inbox','root'),[])

    def test_codex_receive_hands_off_to_the_next_profile_and_resumes_the_same_native(self):
        self.codex_profile_handoff(ack_before_exhaustion=False)

    def test_codex_receive_resumes_acknowledged_work_after_profile_exhaustion(self):
        self.codex_profile_handoff(ack_before_exhaustion=True)

    def codex_profile_handoff(self, ack_before_exhaustion):
        # Root's #702 fallback order inside one receive invocation: profile A refuses with the
        # provider's own usage-exhaustion message, the record advances to profile B, the same
        # invocation's continuation spawns B with its own store on the recorded native conversation,
        # and B acknowledges the retained original task. Every assertion reads coordinator state.
        self.coord('attach', 'root', 'codex', '', '')
        store_a = self.directory / 'store-a'
        store_b = self.directory / 'store-b'
        store_a.mkdir()
        store_b.mkdir()
        home_a = self.directory / 'history-a'
        home_b = self.directory / 'history-b'
        home_a.mkdir()
        home_b.mkdir()
        (store_a / 'config.toml').write_text('model = "gpt-5.6-codex"\nsqlite_home = "' + str(home_a) + '"\n')
        (store_b / 'config.toml').write_text('# profile B names a different history root\nsqlite_home = "' + str(home_b) + '"\n')
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'codex A ' + str(store_a) + '\ncodex B ' + str(store_b) + '\n')
        record.write_text('A ' + str(store_a) + '\n')
        document = json.loads((self.directory / 'fixture.json').read_text())
        document['record_launches'] = True
        (self.directory / 'fixture.json').write_text(json.dumps(document))
        body = 'Retained task for the handoff.\n'
        self.prepare_input('fallback', 'root', body, kind='task')
        cause = 'You’ve hit your usage limit for gpt-5.6-codex. Switch to another model now, or try again later.'
        # The fake app-server resolves the original transcript under A's sessions directory.
        # The helper copies it into B's sessions directory, and B reads the retained task
        # content before its own acknowledgment.
        observer = self.spawn(*self.receive_args('root'))
        first, started = self.accept_child(observer, 'root')
        self.assertEqual(started['codexHome'], str(store_a))
        self.action(first, fail=True, ack=ack_before_exhaustion, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept_child(observer, 'root',
                                           'The next Codex profile did not launch after exhaustion.')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 2)
        self.assertEqual(launches[0]['resume'], '')
        self.assertEqual(launches[1]['resume'], started['native'])
        self.assertEqual(resumed['codexHome'], str(store_b))
        initialization = self.assert_retry_initialization('root', [started['prompt'], resumed['prompt']])
        self.assertNotEqual(initialization[0]['turn'], initialization[1]['turn'])
        self.assertEqual(self.coord('delivery', 'fallback')['body'], body)
        # Profile B names its own history root in its own configuration, and the preserved
        # home is profile A's configured root: the continuation resolves A's history through
        # the recorded override, so a contrary configuration in B does not win.
        self.assertIn('sqlite_home="' + str(home_a) + '"', resumed['args'])
        self.assertNotIn('sqlite_home="' + str(home_b) + '"', resumed['args'])
        sidecar = self.directory / ('state.db.history-' + 'root'.encode().hex())
        recorded_home = json.loads(sidecar.read_text().splitlines()[-1])
        # The sidecar carries the fields a prepared helper answer and this deployment's own
        # line share; the profile record's last line is what proves profile B.
        self.assertEqual(recorded_home['harness'], 'codex')
        self.assertEqual(recorded_home['sourceStore'], str(store_a))
        self.assertEqual(recorded_home['store'], str(store_b))
        self.assertEqual(recorded_home['home'], str(home_a))
        rollout = store_a / 'sessions' / (started['native'] + '.jsonl')
        copied = store_b / 'sessions' / (started['native'] + '.jsonl')
        self.assertEqual(recorded_home['rolloutPath'], str(rollout))
        self.assertEqual(recorded_home['historyPath'], str(copied))
        self.assertEqual(copied.read_text(), rollout.read_text())
        history = [json.loads(line) for line in
                   (self.directory / 'native-history.jsonl').read_text().splitlines()]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['home'], str(home_a))
        self.assertEqual(history[0]['content'], '')
        self.assertEqual(history[1]['resume'], started['native'])
        self.assertEqual(history[1]['native'], started['native'])
        self.assertEqual(history[1]['home'], str(home_a))
        self.assertEqual(history[1]['content'], started['prompt'])
        self.assertIn(body, history[1]['content'])
        self.assertIn('[id: fallback]', history[1]['content'])
        self.assertEqual(history[1]['origin'], str(copied))
        self.assertTrue(read_recorded(self.db, 'fallback'))
        # The provider's own app-server surface answers with the same retained transcript the
        # resume path loaded, which is what the packaged history helper reads under the
        # original account.
        app_server = subprocess.run(
            [str(self.fixture), 'app-server', '--listen', 'stdio://'],
            input=json.dumps({'id': 1, 'method': 'initialize', 'params': {}}) + '\n'
                  + json.dumps({'id': 2, 'method': 'config/read', 'params': {}}) + '\n'
                  + json.dumps({'id': 3, 'method': 'thread/read', 'params': {'threadId': started['native']}}) + '\n',
            capture_output=True, text=True, cwd=str(self.directory),
            env={**os.environ, 'CODEX_HOME': str(store_a)})
        answers = [json.loads(line) for line in app_server.stdout.splitlines()]
        self.assertEqual(answers[1]['result']['config']['sqlite_home'], str(home_a))
        self.assertEqual(answers[2]['result']['thread']['rolloutPath'], str(rollout))
        self.assertEqual(answers[2]['result']['thread']['path'], str(rollout))
        self.assertIn(body, json.loads(rollout.read_text().splitlines()[-1])['content'])
        self.assertEqual(resumed['args'][resumed['args'].index('--model') + 1], 'root')
        if ack_before_exhaustion:
            self.assertIn(':handoff-guidance]', resumed['prompt'])
            self.assertIn('Continue the original retained attempt', resumed['prompt'])
            self.assertNotIn('[id: fallback]', resumed['prompt'])
        else:
            self.assertIn('[id: fallback]', resumed['prompt'])
            self.assertIn(body, resumed['prompt'])
        self.action(second)
        self.finish(observer)
        self.assertTrue(read_recorded(self.db, 'fallback'))
        self.assertEqual(record.read_text().splitlines()[-1], ' codex B ' + str(store_b))
        handoff = [message for message in self.coord('inbox', 'operator')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(len(handoff), 1)
        self.assertIn(cause, handoff[0]['body'])
        self.assertIn('refused profile=A', handoff[0]['body'])
        self.assertIn('bound profile=B', handoff[0]['body'])
        self.assertFalse(read_recorded(self.db, handoff[0]['id']))
        failed = [turn for turn in self.coord('turns', 'root') if cause in turn['reportBody']]
        self.assertEqual(len(failed), 1)
        self.assertEqual(json.loads(failed[0]['reportBody']),
                         {'type': 'result', 'is_error': 1,
                          'nativeEvent': {'type': 'turn.failed', 'error': {'message': cause}},
                          'result': cause})
        self.coord('as', 'operator', 'read', handoff[0]['id'])
        independent = 'Review a new independent task caféλ🙂\n'
        self.prepare_input('independent-task', 'root', independent, kind='task')
        next_observer = self.spawn(*self.receive_args('root'))
        third, next_started = self.accept_child(next_observer, 'root')
        next_initialization = [row for row in self.initial_inputs('root')
                               if row['attempt'].startswith(str(self.db) + '.attempt-')]
        self.assertEqual(len(next_initialization), 3)
        self.assertNotEqual(next_initialization[-1]['seed'], initialization[0]['seed'])
        self.assertIn(independent, next_initialization[-1]['guidance'])
        self.assertEqual(next_started['prompt'], next_initialization[-1]['seed'] + '\n\n'
                         + next_initialization[-1]['instruction'] + '\n\n' + next_initialization[-1]['guidance'])
        self.action(third)
        self.finish(next_observer)
        self.assertEqual(self.coord('delivery', 'independent-task')['body'], independent)
        self.assertTrue(read_recorded(self.db, 'independent-task'))

    def test_claude_receive_preserves_transcript_and_subagent_history_on_profile_handoff(self):
        self.coord('attach', 'root', 'claude-code', '', '')
        store_a = self.directory / 'claude account A'
        store_b = self.directory / 'claude account B'
        store_a.mkdir()
        store_b.mkdir()
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        record.write_text('A ' + str(store_a) + '\n')
        (self.directory / 'state.db.profiles').write_text(
            'claude-code A ' + str(store_a) + '\nclaude-code B ' + str(store_b) + '\n')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        body = 'Continue the retained Claude task and its subagent work.\n'
        self.prepare_input('claude-fallback', 'root', body, kind='task')
        cause = "You've hit your session limit. Try again later."
        overrides = {key: 'controlled-unused-credential' for key in
                     ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN')}
        with patch.dict(os.environ, overrides):
            observer = self.spawn(*self.receive_args('root'))
            first, started = self.accept_child(observer, 'root')
            self.assertEqual(started['claudeAuthVariablesPresent'], [])
            self.action(first, fail=True, ack=False, fail_message=cause)
            self.action(first, exit_fixture=True)
            second, resumed = self.accept_child(observer, 'root',
                                               'The next Claude profile did not launch after exhaustion.')
            self.assertEqual(resumed['claudeAuthVariablesPresent'], [])
            self.assertEqual(resumed['native'], started['native'])
            self.assertEqual(resumed['resume'], started['native'])
            self.assertIn(body, resumed['prompt'])
            self.assertFalse(read_recorded(self.db, 'claude-fallback'))
            transcript_a = store_a / 'projects' / 'fixture-project' / (started['native'] + '.jsonl')
            transcript_b = store_b / 'projects' / 'fixture-project' / (started['native'] + '.jsonl')
            self.assertEqual(transcript_b.read_text(), transcript_a.read_text())
            self.assertEqual(json.loads(transcript_b.read_text())['message']['content'], started['prompt'])
            subagent_a = transcript_a.parent / started['native'] / 'subagents' / 'agent-fixture.jsonl'
            subagent_b = transcript_b.parent / started['native'] / 'subagents' / 'agent-fixture.jsonl'
            self.assertEqual(subagent_b.read_text(), subagent_a.read_text())
            self.assertIn(body, json.loads(subagent_b.read_text())['message']['content'][0]['text'])
            history = [json.loads(line) for line in
                       (self.directory / 'native-history.jsonl').read_text().splitlines()]
            self.assertEqual(history[-1]['content'], started['prompt'])
            self.assertEqual(history[-1]['origin'], str(transcript_b))
            sidecar = self.directory / ('state.db.history-' + 'root'.encode().hex())
            prepared = json.loads(sidecar.read_text().splitlines()[-1])
            self.assertEqual(prepared['harness'], 'claude-code')
            self.assertEqual(prepared['sourceStore'], str(store_a))
            self.assertEqual(prepared['store'], str(store_b))
            self.assertEqual(prepared['rolloutPath'], str(transcript_a))
            self.assertEqual(prepared['historyPath'], str(transcript_b))
            self.assertEqual(record.read_text().splitlines()[-1], ' claude-code B ' + str(store_b))
            self.action(second)
            self.finish(observer)
        self.assertTrue(read_recorded(self.db, 'claude-fallback'))
        handoff = [message for message in self.coord('inbox', 'operator')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(len(handoff), 1)
        self.assertIn(cause, handoff[0]['body'])

    def test_codex_receive_keeps_non_exhaustion_causes_without_a_profile_change(self):
        # Non-exhaustion causes that must keep their own cause: three contract wordings (rate-limit,
        # context-window, stream-disconnect) plus an auth placeholder with no established source string.
        # The record does not advance and no handoff report appears, whatever the failed terminal says.
        store_a = self.directory / 'store-a'
        store_b = self.directory / 'store-b'
        store_a.mkdir()
        store_b.mkdir()
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'codex A ' + str(store_a) + '\ncodex B ' + str(store_b) + '\n')
        record.write_text('A ' + str(store_a) + '\n')
        causes = ['refresh token rejected',
                  'rate limit exceeded: too many requests',
                  "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
                  'stream disconnected before completion: Incomplete response returned']
        for index, cause in enumerate(causes):
            ident = 'kept-' + str(index)
            body = 'Cause probe.\n'
            admitted = subprocess.run([str(EXE), str(self.db), 'message-batch-file', 'operator', '-'],
                                      input=json.dumps([{'id': ident, 'recipient': 'root',
                                                         'kind': 'task', 'body': body}]),
                                      capture_output=True, text=True)
            self.assertEqual(admitted.returncode, 0, admitted.stderr)
            self.assertEqual(json.loads(admitted.stdout)[0]['admission']['status'], 'admitted')
            delivery = self.coord('delivery', ident)
            self.assertEqual((delivery['id'], delivery['sender'], delivery['recipient'],
                              delivery['kind'], delivery['body'], delivery['receipt']),
                             (ident, 'operator', 'root', 'task', body, None))
            observer = self.spawn(*self.receive_args('root'))
            control, started = self.accept_child(observer, 'root')
            self.action(control, fail=True, ack=False, fail_message=cause)
            self.action(control, exit_fixture=True)
            self.finish(observer, ok=False)
            self.assertEqual(record.read_text().splitlines()[-1], 'A ' + str(store_a))
            self.assertEqual([message for message in self.coord('inbox', 'operator')
                              if 'subscription profile handoff' in message['body']], [])
            failed = [turn for turn in self.coord('turns', 'root') if cause in turn['reportBody']]
            self.assertEqual(len(failed), 1)

    def test_codex_direct_hands_off_to_the_next_profile_and_resumes_the_same_native(self):
        # Direct-turn #702 fallback inside one turn invocation: profile A refuses with the
        # provider's own usage-exhaustion message, the record advances to profile B, the same
        # turn invocation relaunches B with its own store on the recorded native conversation,
        # and B completes the same task file prompt. Every assertion reads coordinator state.
        # The first report retains the exhausted attempt's cause. The successful
        # continuation is retained in the native log under the same turn identity.
        self.coord('attach', 'root', 'codex', '', '')
        store_a = self.directory / 'store-a'
        store_b = self.directory / 'store-b'
        store_a.mkdir()
        store_b.mkdir()
        home_a = self.directory / 'history-a'
        home_b = self.directory / 'history-b'
        home_a.mkdir()
        home_b.mkdir()
        (store_a / 'config.toml').write_text('model = "gpt-5.6-codex"\nsqlite_home = "' + str(home_a) + '"\n')
        (store_b / 'config.toml').write_text('# profile B names a different history root\nsqlite_home = "' + str(home_b) + '"\n')
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'codex A ' + str(store_a) + '\ncodex B ' + str(store_b) + '\n')
        record.write_text('A ' + str(store_a) + '\n')
        document = json.loads((self.directory / 'fixture.json').read_text())
        document['record_launches'] = True
        (self.directory / 'fixture.json').write_text(json.dumps(document))
        body = 'Direct task for the handoff.\n'
        task = self.directory / 'direct-handoff.txt'
        task.write_text(body)
        cause = 'You’ve hit your usage limit for gpt-5.6-codex. Switch to another model now, or try again later.'
        direct = self.spawn('turn', 'root', 'direct-handoff', str(self.fixture), 'root', 'low',
                            str(self.directory), str(task),
                            str(self.directory / 'direct-handoff.jsonl'), '')
        first, started = self.accept_child(direct, 'root')
        self.assertEqual(started['codexHome'], str(store_a))
        self.assertIn(body, started['prompt'])
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept_child(direct, 'root')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 2)
        self.assertEqual(launches[0]['resume'], '')
        self.assertEqual(launches[1]['resume'], started['native'])
        self.assertEqual(resumed['native'], started['native'])
        self.assertEqual(resumed['codexHome'], str(store_b))
        # Profile B names its own history root in its own configuration, and the preserved
        # home is profile A's configured root: the continuation resolves A's history through
        # the recorded override, so a contrary configuration in B does not win.
        self.assertIn('sqlite_home="' + str(home_a) + '"', resumed['args'])
        self.assertNotIn('sqlite_home="' + str(home_b) + '"', resumed['args'])
        self.assertIn(body, resumed['prompt'])
        sidecar = self.directory / ('state.db.history-' + 'root'.encode().hex())
        recorded_home = json.loads(sidecar.read_text().splitlines()[-1])
        self.assertEqual(recorded_home['harness'], 'codex')
        self.assertEqual(recorded_home['sourceStore'], str(store_a))
        self.assertEqual(recorded_home['store'], str(store_b))
        self.assertEqual(recorded_home['home'], str(home_a))
        history = [json.loads(line) for line in
                   (self.directory / 'native-history.jsonl').read_text().splitlines()]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[1]['resume'], started['native'])
        self.assertEqual(history[1]['native'], started['native'])
        self.assertEqual(history[1]['home'], str(home_a))
        self.action(second, body=body)
        self.finish(direct)
        self.assertEqual(record.read_text().splitlines()[-1], ' codex B ' + str(store_b))
        handoff = [message for message in self.coord('inbox', 'operator')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(len(handoff), 1)
        self.assertIn(cause, handoff[0]['body'])
        self.assertIn('refused profile=A', handoff[0]['body'])
        self.assertIn('bound profile=B', handoff[0]['body'])
        self.assertFalse(read_recorded(self.db, handoff[0]['id']))
        self.assert_direct_retry_result('direct-handoff', body, cause, 'codex')

    def test_codex_direct_chains_two_handoffs_with_distinct_reports(self):
        # Three-profile direct-turn #702 chain: profiles A and B both refuse with the
        # provider's own usage-exhaustion message, the record advances A -> B -> C, and C
        # completes the same task on the recorded native conversation. Each handoff keeps
        # its own report: the message id names the newly bound profile, so the second
        # handoff is not ignored as a duplicate of the first. Every assertion reads
        # coordinator state.
        self.coord('attach', 'root', 'codex', '', '')
        store_a = self.directory / 'store-a'
        store_b = self.directory / 'store-b'
        store_c = self.directory / 'store-c'
        store_a.mkdir()
        store_b.mkdir()
        store_c.mkdir()
        home_a = self.directory / 'history-a'
        home_b = self.directory / 'history-b'
        home_c = self.directory / 'history-c'
        home_a.mkdir()
        home_b.mkdir()
        home_c.mkdir()
        (store_a / 'config.toml').write_text('model = "gpt-5.6-codex"\nsqlite_home = "' + str(home_a) + '"\n')
        (store_b / 'config.toml').write_text('sqlite_home = "' + str(home_b) + '"\n')
        (store_c / 'config.toml').write_text('sqlite_home = "' + str(home_c) + '"\n')
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'codex A ' + str(store_a) + '\ncodex B ' + str(store_b) + '\ncodex C ' + str(store_c) + '\n')
        record.write_text('A ' + str(store_a) + '\n')
        document = json.loads((self.directory / 'fixture.json').read_text())
        document['record_launches'] = True
        (self.directory / 'fixture.json').write_text(json.dumps(document))
        body = 'Direct task for the chained handoff.\n'
        task = self.directory / 'direct-handoff-chain.txt'
        task.write_text(body)
        cause = 'You’ve hit your usage limit for gpt-5.6-codex. Switch to another model now, or try again later.'
        direct = self.spawn('turn', 'root', 'direct-handoff-chain', str(self.fixture), 'root', 'low',
                            str(self.directory), str(task),
                            str(self.directory / 'direct-handoff-chain.jsonl'), '')
        first, started = self.accept_child(direct, 'root')
        self.assertEqual(started['codexHome'], str(store_a))
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed_b = self.accept_child(direct, 'root')
        self.assertEqual(resumed_b['codexHome'], str(store_b))
        self.assertEqual(resumed_b['native'], started['native'])
        self.assertIn(body, resumed_b['prompt'])
        self.action(second, fail=True, ack=False, fail_message=cause)
        self.action(second, exit_fixture=True)
        third, resumed_c = self.accept_child(direct, 'root')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 3)
        self.assertEqual(launches[1]['resume'], started['native'])
        self.assertEqual(launches[2]['resume'], started['native'])
        self.assertEqual(resumed_c['native'], started['native'])
        self.assertEqual(resumed_c['codexHome'], str(store_c))
        # Both continuations use the original history home recorded by the first handoff.
        self.assertIn('sqlite_home="' + str(home_a) + '"', resumed_c['args'])
        self.assertNotIn('sqlite_home="' + str(home_c) + '"', resumed_c['args'])
        self.assertIn(body, resumed_c['prompt'])
        sidecar = self.directory / ('state.db.history-' + 'root'.encode().hex())
        recorded_home = json.loads(sidecar.read_text().splitlines()[-1])
        self.assertEqual(recorded_home['sourceStore'], str(store_b))
        self.assertEqual(recorded_home['store'], str(store_c))
        self.assertEqual(recorded_home['home'], str(home_a))
        self.action(third, body=body)
        self.finish(direct)
        self.assertEqual(record.read_text().splitlines()[-1], ' codex C ' + str(store_c))
        handoff = sorted((message for message in self.coord('inbox', 'operator')
                          if 'subscription profile handoff' in message['body']),
                         key=lambda message: message['id'])
        self.assertEqual(len(handoff), 2)
        self.assertEqual(handoff[0]['id'], 'direct-handoff-chain:profile-handoff-B')
        self.assertEqual(handoff[1]['id'], 'direct-handoff-chain:profile-handoff-C')
        self.assertIn('refused profile=A', handoff[0]['body'])
        self.assertIn('bound profile=B', handoff[0]['body'])
        self.assertIn('refused profile=B', handoff[1]['body'])
        self.assertIn('bound profile=C', handoff[1]['body'])
        self.assertIn(cause, handoff[0]['body'])
        self.assertIn(cause, handoff[1]['body'])
        self.assertFalse(read_recorded(self.db, handoff[0]['id']))
        self.assertFalse(read_recorded(self.db, handoff[1]['id']))
        self.assert_direct_retry_result('direct-handoff-chain', body, cause, 'codex')

    def test_codex_recovered_direct_hands_off_to_the_next_profile(self):
        # The same shared direct handoff seam reached through Turn.recover: the turn driver
        # dies after the native child connects, the keeper runs the recorded recovery command,
        # recovery observes the failed terminal, advances the profile, and relaunches the same
        # task and conversation. The keeper owns the recovery process, so this case asserts
        # end state rather than driving a second turn process of its own.
        self.coord('attach', 'root', 'codex', '', '')
        store_a = self.directory / 'store-a'
        store_b = self.directory / 'store-b'
        store_a.mkdir()
        store_b.mkdir()
        home_a = self.directory / 'history-a'
        home_b = self.directory / 'history-b'
        home_a.mkdir()
        home_b.mkdir()
        (store_a / 'config.toml').write_text('model = "gpt-5.6-codex"\nsqlite_home = "' + str(home_a) + '"\n')
        (store_b / 'config.toml').write_text('# profile B names a different history root\nsqlite_home = "' + str(home_b) + '"\n')
        record = self.directory / ('state.db.profile-' + 'root'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'codex A ' + str(store_a) + '\ncodex B ' + str(store_b) + '\n')
        record.write_text('A ' + str(store_a) + '\n')
        document = json.loads((self.directory / 'fixture.json').read_text())
        document['record_launches'] = True
        (self.directory / 'fixture.json').write_text(json.dumps(document))
        body = 'Recovered direct task for the handoff.\n'
        task = self.directory / 'direct-handoff-recovered.txt'
        task.write_text(body)
        cause = 'You’ve hit your usage limit for gpt-5.6-codex. Switch to another model now, or try again later.'
        direct = self.spawn('turn', 'root', 'direct-handoff-recovered', str(self.fixture), 'root',
                            'low', str(self.directory), str(task),
                            str(self.directory / 'direct-handoff-recovered.jsonl'), '')
        first, started = self.accept('root')
        self.assertEqual(started['codexHome'], str(store_a))
        direct.kill()
        direct.wait()
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept_recovered_direct('root')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 2)
        self.assertEqual(launches[1]['resume'], started['native'])
        self.assertEqual(resumed['native'], started['native'])
        self.assertEqual(resumed['codexHome'], str(store_b))
        self.assertIn('sqlite_home="' + str(home_a) + '"', resumed['args'])
        self.assertNotIn('sqlite_home="' + str(home_b) + '"', resumed['args'])
        self.assertIn(body, resumed['prompt'])
        self.action(second, body=body)
        # The keeper owns the recovery process. Observe its exited execution
        # before checking the pending inbox and successful native terminal.
        self.assertEqual(record.read_text().splitlines()[-1], ' codex B ' + str(store_b))
        handoff = [message for message in self.coord('inbox', 'operator')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(len(handoff), 1)
        self.assertIn(cause, handoff[0]['body'])
        self.assert_direct_retry_result('direct-handoff-recovered', body, cause, 'codex',
                                        observe_recovery=True)

    def test_omp_direct_retries_the_same_conversation_after_a_rate_refusal(self):
        cause = '429 Rate limit reached for requests\nRate limit reached for requests (type=1302)'
        self.omp_direct_transient(cause, 429)

    def test_omp_direct_continues_after_a_settled_socket_closure(self):
        cause = 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
        self.omp_direct_transient(cause, None)

    def omp_direct_transient(self, cause, status):
        # Direct-turn transient continuation: the first attempt ends with the provider's
        # settled OMP error, no profile advances, and the same turn invocation
        # relaunches the same conversation in a retry directory the keeper accepts. The
        # retry completes the same task. The first report keeps the provider failure;
        # the exited execution and native log establish the successful continuation.
        self.coord('attach', 'root', 'omp', '', '')
        body = 'Direct OMP task interrupted by a provider failure.\n'
        task = self.directory / 'direct-provider-retry.txt'
        task.write_text(body)
        direct = self.spawn('turn', 'root', 'direct-provider-retry', str(self.fixture), 'root', 'low',
                            str(self.directory), str(task),
                            str(self.directory / 'direct-provider-retry.jsonl'), '')
        first, started = self.accept('root')
        self.assertIn(body, started['prompt'])
        self.action(first, ack=False, fail_status=status, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept('root')
        self.assertEqual(resumed['native'], started['native'])
        self.assertIn(body, resumed['prompt'])
        attempt = self.directory / ('state.db.direct-' + 'direct-provider-retry'.encode().hex())
        self.assertTrue(pathlib.Path(str(attempt) + '.retry').is_dir())
        self.action(second, body=body)
        self.finish(direct)
        handoff = [message for message in self.coord('inbox', 'operator')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(handoff, [])
        self.assert_direct_retry_result('direct-provider-retry', body, cause, 'omp', status)

    def assert_recovery_observer_result(self, ident):
        def current_execution():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                database.row_factory = sqlite3.Row
                row = database.execute(
                    "SELECT * FROM executions WHERE session='root' AND id=? AND mode='direct'",
                    (ident,)).fetchone()
            return dict(row) if row is not None else None

        execution = current_execution()
        if execution is None or execution['phase'] == 'exited':
            return
        directory = pathlib.Path(execution['directory'])
        try:
            errors = (directory / 'observer-error').read_bytes()
            output = (directory / 'observer.log').read_bytes()
        except FileNotFoundError:
            return
        failed = False
        for line in errors.decode(errors='replace').splitlines(keepends=True):
            fields = line.split()
            if (line.endswith('\n') and len(fields) == 8 and fields[0] == 'pid'
                    and fields[2:7] == ['exited', 'before', 'attach:', 'wait', 'status']):
                try:
                    wait_status = int(fields[7])
                except ValueError:
                    continue
                failed = failed or (os.WIFEXITED(wait_status) and os.WEXITSTATUS(wait_status) != 0)
        if not failed:
            return
        conflict = False
        for line in output.decode(errors='replace').splitlines(keepends=True):
            if not line.endswith('\n'):
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                continue
            conflict = conflict or (isinstance(frame, dict)
                                    and frame.get('error') == 'message-id-conflict'
                                    and frame.get('id') == ident)
        if not conflict:
            return
        current = current_execution()
        if (current is None or current['phase'] == 'exited'
                or current['directory'] != execution['directory']):
            return
        retained = {}
        for name in ('status', 'stdout', 'native.stderr', 'keeper-error'):
            try:
                retained[name] = (directory / name).read_bytes()
            except FileNotFoundError:
                retained[name] = None
        report = self.coord('delivery', ident)
        self.fail('The recovered direct observer exited while projecting a different result '
                  'under the retained report identity.\nExecution: '
                  + json.dumps(current, ensure_ascii=False)
                  + '\nStored report: ' + json.dumps(report, ensure_ascii=False)
                  + '\nObserver wait evidence: ' + repr(errors)
                  + '\nObserver output: ' + repr(output)
                  + '\nRetained native evidence: ' + repr(retained))

    def assert_direct_retry_result(self, ident, body, cause, harness, status=None,
                                   observe_recovery=False):
        def settled_execution():
            execution = next(row for row in self.coord('players')
                             if row['id'] == 'root')['execution']
            if observe_recovery:
                self.assert_recovery_observer_result(ident)
            return execution if execution is not None and execution['phase'] == 'exited' else None
        execution = self.eventually(settled_execution,
                                    'The direct continuation did not exit naturally.')
        self.assertEqual(execution, {'attempt': ident, 'mode': 'direct',
                                     'phase': 'exited', 'status': 'exit 0'})
        state = self.coord('session', 'root')
        self.assertIsNone(state['parent'])
        self.assertIsNone(state['taskCompletion']['assignmentId'])
        self.assertIs(state['taskCompletion']['open'], False)
        self.assertEqual(self.coord('inbox', 'root'), [])
        turns = self.coord('turns', 'root')
        self.assertEqual(len(turns), 1)
        self.assertEqual((turns[0]['id'], turns[0]['player'], turns[0]['eventType']),
                         (ident, 'root', 'result' if harness == 'codex' else 'agent_end'))
        report = self.coord('delivery', ident)
        self.assertEqual((report['sender'], report['recipient'], report['kind']),
                         ('root', 'operator', 'report'))
        self.assertFalse(read_recorded(self.db, ident))
        self.assertEqual(report['body'], turns[0]['reportBody'])
        frames = [json.loads(line) for line in self.output_log('root').read_text().splitlines()]
        if harness == 'codex':
            self.assertEqual(json.loads(report['body']),
                             {'type': 'result', 'is_error': 1,
                              'nativeEvent': {'type': 'turn.failed', 'error': {'message': cause}},
                              'result': cause})
            messages = [frame['item']['text'] for frame in frames
                        if frame['type'] == 'item.completed'
                        and frame['item']['type'] == 'agent_message']
            self.assertEqual(messages, [body])
            completed = [frame for frame in frames if frame['type'] == 'turn.completed']
            self.assertEqual(completed, [{'type': 'turn.completed'}])
            terminals = [frame for frame in frames
                         if frame['type'] in ('turn.failed', 'turn.completed')]
            self.assertEqual(terminals[-1], {'type': 'turn.completed'})
        else:
            failure = ('OMP provider failure: stopReason=error, errorStatus='
                       + ('unknown' if status is None else str(status)) + '; ' + cause)
            self.assertEqual(report['body'], failure)
            terminals = [frame for frame in frames if frame['type'] == 'agent_end']
            self.assertTrue(terminals)
            self.assertEqual(terminals[-1]['text'], body)
            self.assertIs(terminals[-1]['compacted'], True)
            self.assertIs(terminals[-1]['isTerminal'], True)
            self.assertNotIn('error', terminals[-1])

    def test_busy_direct_receive_drains_new_input_and_preserves_native_session(self):
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.message('second', 'parent')
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assert_no_start()
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: second]', next_turn['prompt'])
        self.assertEqual(next_turn['resume'], started['native'])
        self.action(control2)
        self.finish(first)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(len(self.coord('turns', 'parent')), 2)

    def test_distinct_sessions_start_before_either_finishes(self):
        for name in ['left', 'right']:
            self.player(name)
            self.prepare_input(name + '-input', name)
        left = self.spawn(*self.receive_args('left'))
        left_control, _ = self.accept('left')
        right = self.spawn(*self.receive_args('right'))
        right_control, _ = self.accept('right')
        self.action(left_control)
        self.action(right_control)
        self.finish(left)
        self.finish(right)

    def test_native_self_message_is_refused_without_disrupting_the_active_turn(self):
        self.player()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.action(control, message=['self-message', 'parent', 'follow up'])
        response = json.loads(control.readline())
        self.assertEqual(response['code'], 2, response['stderr'])
        self.assertIn('message-route-denied', response['stderr'])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['first'])
        self.assert_no_start()
        self.action(control)
        self.finish(first)
        self.shutdown_idle_database_owner('The active native did not settle after its refused self-message.',
                                          reject_start=True)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_a_native_self_promotion_returns_and_continues_with_its_notice(self):
        self.player()
        self.coord('report', 'self-evidence', 'parent', 'Evidence reviewed by this session.')
        self.coord('record', 'self-finding', 'parent', 'Reviewed finding',
                   'message:self-evidence', 'fixture')
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, original = self.accept('parent')
        self.action(control, promote=['self-share', 'parent', 'parent', 'parent', 'self-finding'])
        response = json.loads(control.readline())
        self.assertEqual(response['code'], 0, response['stderr'])
        self.assertEqual(json.loads(response['stdout'])['id'], 'self-share')
        self.assert_no_start()
        notice = self.coord('delivery', 'self-share:promotion-notice')
        self.assertFalse(read_recorded(self.db, notice['id']))
        self.action(control)
        second, started = self.accept('parent')
        self.assertEqual(started['native'], original['native'])
        self.assertIn('[id: self-share:promotion-notice]', started['prompt'])
        self.assertIn(notice['body'], started['prompt'])
        self.action(second)
        self.finish(first)
        self.shutdown_idle_database_owner('Self-promotion continuation did not settle.',
                                          reject_start=True)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertTrue(read_recorded(self.db, 'self-share:promotion-notice'))

    def test_synchronous_self_turn_reports_busy_and_native_work_continues(self):
        self.player()
        self.prepare_input('first', 'parent')
        child = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control, turn='self-turn')
        response = json.loads(control.readline())
        self.assertNotEqual(response['code'], 0)
        self.assertIn('active native turn', response['stderr'].lower())
        self.assert_no_start()
        self.action(control)
        self.finish(child)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertNotIn('self-turn', [report['id'] for report in self.coord('inbox', 'root')])
        retried = self.spawn('turn', 'parent', 'self-turn', self.fixture, 'parent', 'low',
                             self.directory, self.directory / 'self-turn-task',
                             self.directory / 'self-turn.jsonl', '')
        retry_control, _ = self.accept('parent')
        self.action(retry_control)
        self.finish(retried)
        self.assertIn('self-turn', [report['id'] for report in self.coord('inbox', 'root')])

    def test_upward_failure_preserves_queued_input_processing(self):
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.directory / 'missing receiver')]))
        self.player()
        self.prepare_input('first', 'parent', 'first input')
        self.connect('parent')
        first = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept_child(first, 'parent')
        self.message('second', 'parent')
        self.action(control)
        second, started = self.accept('parent')
        self.assertIn('[id: second]', started['prompt'])
        self.action(second)
        self.finish(first, ok=False)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertTrue(self.coord('inbox', 'root'))

    def test_queued_failure_joins_concurrent_ancestor_delivery(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player()
        self.prepare_input('first', 'parent', 'first input')
        self.connect('parent')
        first = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept_child(first, 'parent')
        self.message('second', 'parent')
        self.action(control)
        started = {}
        for _ in range(2):
            connection, _ = self.server.accept()
            stream = connection.makefile('rwb', buffering=0)
            self.controls.append((stream, connection))
            event = json.loads(stream.readline())
            started[event['session']] = stream
        self.assertEqual(set(started), {'root', 'parent'})
        self.action(started['parent'], fail=True, ack=False)
        while True:
            if first.poll() is not None:
                self.fail(f'first delivery exited before the queued failure was reported: {first.returncode}')
            if any('fixture provider failed' in m['body'] for m in self.coord('inbox', 'root')):
                break
            time.sleep(.01)
        self.assertIsNone(first.poll(), 'first delivery exited while root review was pending')
        self.action(started['root'])
        # The failed second turn produces a new report while root was reviewing the first.
        root_again, _ = self.accept('root')
        self.action(root_again)
        self.finish(first, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['second'])
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_startup_and_terminal_failures_leave_input_available_for_retry(self):
        self.player()
        self.prepare_input('input', 'parent')
        missing = self.coord(*self.receive_args('parent', self.directory / 'missing executable'), ok=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        startup_report = next(m for m in self.coord('inbox', 'root') if 'without a native result (exit 127)' in m['body'])
        self.assertIn('Output: '+str(self.output_log('parent')), startup_report['body'])
        startup_stderr = pathlib.Path(startup_report['body'].split(' Stderr: ', 1)[1]).read_bytes()
        reference = self.reference_startup_stderr(self.directory / 'missing executable', 'parent')
        self.assertEqual(startup_stderr, reference)
        failed = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control, fail=True, ack=False)
        self.finish(failed, ok=False)
        failed_report = next(m for m in self.coord('inbox', 'root') if 'fixture provider failed' in m['body'])
        retry = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control)
        self.finish(retry)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        reports = self.coord('inbox', 'root')
        success_report = next(m for m in reports if m['body'] == 'native review complete')
        self.assertNotEqual(startup_report['id'], failed_report['id'])
        self.assertNotEqual(failed_report['id'], success_report['id'])
        self.assertNotEqual(startup_report['id'], success_report['id'])

    def test_receive_startup_failure_notifies_parent_and_retains_input(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player()
        self.prepare_input('input', 'parent', 'Input for a missing executable.', kind='task')
        failed = self.spawn(*self.receive_args('parent', self.directory / 'missing executable'))
        parent, notified = self.accept_or_child_exit(failed, 'startup failure did not notify parent')
        self.assertEqual(notified['session'], 'root')
        startup_report = next(m for m in self.coord('inbox', 'root') if 'without a native result (exit 127)' in m['body'])
        self.assertIn(startup_report['body'], notified['prompt'])
        self.assertIn('Output: '+str(self.output_log('parent')), startup_report['body'])
        startup_stderr = pathlib.Path(startup_report['body'].split(' Stderr: ', 1)[1]).read_bytes()
        reference = self.reference_startup_stderr(self.directory / 'missing executable', 'parent')
        self.assertEqual(startup_stderr, reference)
        self.action(parent)
        self.finish(failed, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_root_failure_after_success_retains_failure_and_quoted_commands(self):
        self.message('first', 'root')
        first = self.spawn(*self.receive_args('root'))
        control, started = self.accept('root')
        self.assertIn('Use baton inbox to read complete input', started['prompt'])
        self.assertIn('You are session root in a Baton Orchestra.', started['prompt'])
        self.assertNotIn(str(self.db.resolve()), started['prompt'])
        self.assertNotIn('Use acknowledge', started['prompt'])
        self.action(control)
        self.finish(first)
        self.message('second', 'root')
        second = self.spawn(*self.receive_args('root'))
        control, started = self.accept('root')
        self.assertEqual(started['resume'], 'native-root')
        self.action(control, fail=True, ack=False)
        stdout, _ = self.finish(second, ok=False)
        self.assertIn('fixture provider failed', stdout)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['second'])
        turns = self.coord('turns', 'root')
        self.assertEqual([(turn['player'], turn['eventType']) for turn in turns],
                         [('root', 'result'), ('root', 'result')])
        self.assertNotEqual(turns[0]['id'], turns[1]['id'])
        self.assertEqual(turns[0]['reportBody'], 'native review complete')
        self.assertEqual(json.loads(turns[1]['reportBody']), {
            'type': 'result', 'is_error': 1,
            'nativeEvent': {'type': 'turn.failed', 'error': {'message': 'fixture provider failed'}},
            'result': 'fixture provider failed'})
        reports = self.coord('inbox', 'operator')
        self.assertEqual([report['id'] for report in reports], [turn['id'] for turn in turns])
        self.assertEqual([report['body'] for report in reports], [turn['reportBody'] for turn in turns])
        for report in reports:
            delivered = self.coord('delivery', report['id'])
            self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind']),
                             ('root', 'operator', 'report'))
            self.assertFalse(read_recorded(self.db, delivered['id']))
            self.coord('as', 'operator', 'read', report['id'])
            self.assertTrue(read_recorded(self.db, report['id']))
        self.assertEqual(self.coord('inbox', 'operator'), [])
        self.assertTrue(all(read_recorded(self.db, turn['id']) for turn in self.coord('turns', 'root')))
        self.assertTrue(read_recorded(self.db, 'first'))
        self.assertFalse(read_recorded(self.db, 'second'))
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['second'])
        self.shutdown_idle_database_owner('root success or failure processes did not exit naturally')

    def test_root_failed_receive_can_retry_the_same_pending_input(self):
        self.message('input', 'root')
        failed = self.spawn(*self.receive_args('root'))
        control, original = self.accept('root')
        self.action(control, fail=True, ack=False)
        self.finish(failed, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['input'])
        retry = self.spawn(*self.receive_args('root'))
        control, resumed = self.accept_or_child_exit(retry, 'root retry exited before native start')
        self.assertEqual(resumed['session'], 'root')
        self.assertEqual(resumed['native'], original['native'])
        self.assertIn('[id: input]', resumed['prompt'])
        self.action(control)
        self.finish(retry)
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_muse_failed_terminal_with_exit_zero_keeps_input_owed(self):
        """A Muse primary run_terminal failed frame with host exit zero is a provider
        failure: the receive exits nonzero, the input stays owed, the failed turn stays
        visible, and the same actor retries it after recovery."""
        self.player('parent', harness='muse')
        self.message('input', 'parent')
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        self.action(control, fail=True, ack=False, fail_message='Muse provider refused request')
        self.finish(failed, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        turns = self.coord('turns', 'parent')
        self.assertEqual(len(turns), 1)
        self.assertIn('Muse provider refused request', turns[0]['reportBody'])
        retry = self.spawn(*self.receive_args('parent'))
        control, resumed = self.accept_or_child_exit(retry, 'muse retry exited before native start')
        self.assertEqual(resumed['session'], 'parent')
        self.assertEqual(resumed['native'], original['native'])
        self.assertIn('[id: input]', resumed['prompt'])
        self.action(control)
        self.finish(retry)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_omp_rate_error_continues_same_conversation_without_new_account(self):
        """A failed OMP HTTP 429 terminal resumes the accepted task in the same conversation."""
        cause = '429 Rate limit reached for requests\nRate limit reached for requests (type=1302)'
        self.receive_transient('omp', cause, 429)

    def test_omp_socket_closure_continues_the_accepted_task(self):
        cause = 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
        self.receive_transient('omp', cause)

    def test_omp_socket_closure_continues_unacknowledged_original_input(self):
        cause = 'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
        self.receive_transient('omp', cause, ack_before_failure=False)

    def test_muse_transport_timeout_continues_the_accepted_task(self):
        cause = 'transport error [net-timeout]: timed out waiting for response data (meta stream)'
        self.receive_transient('muse', cause)

    def receive_transient(self, harness, cause, status=None, ack_before_failure=True):
        self.player('parent', harness=harness)
        self.message('input', 'parent')
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        if harness == 'muse':
            self.action(control, fail=True, fail_reason=cause, ack=ack_before_failure,
                        fail_message='Partial report before the transport failure.')
        else:
            self.action(control, fail_status=status, fail_message=cause, ack=ack_before_failure)
        self.action(control, exit_fixture=True)
        second, resumed = self.accept_or_child_exit(
            failed, 'recoverable provider failure closed with unfinished input')
        self.assertEqual(resumed['session'], original['session'])
        self.assertEqual(resumed['native'], original['native'])
        initialization = self.assert_retry_initialization('parent', [original['prompt'], resumed['prompt']])
        self.assertNotEqual(initialization[0]['turn'], initialization[1]['turn'])
        if ack_before_failure:
            self.assertIn('transient provider error', resumed['prompt'])
            self.assertTrue(read_recorded(self.db, 'input'))
        else:
            self.assertIn('[id: input]', resumed['prompt'])
            self.assertNotIn(':transient-guidance]', resumed['prompt'])
            self.assertFalse(read_recorded(self.db, 'input'))
        self.assertEqual([message for message in self.coord('inbox', 'root')
                          if 'subscription profile handoff' in message['body']], [])
        self.assertFalse((self.directory / ('state.db.profile-' + 'parent'.encode().hex())).exists())
        self.action(second)
        self.finish(failed)
        turns = self.coord('turns', 'parent')
        self.assertEqual(len(turns), 2)
        failed_turns = [turn for turn in turns if cause in turn['reportBody']]
        self.assertEqual(len(failed_turns), 1)
        if status is not None: self.assertIn('errorStatus=' + str(status), failed_turns[0]['reportBody'])
        if harness == 'muse': self.assertIn('Partial report before the transport failure.', failed_turns[0]['reportBody'])
        self.assertTrue(read_recorded(self.db, 'input'))
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_omp_usage_window_exhaustion_keeps_its_account_failure(self):
        self.player('parent', harness='omp')
        self.message('input', 'parent')
        cause = ('429 Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52\n'
                 'Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52 (type=1308)')
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        self.action(control, fail_status=429, fail_message=cause)
        self.action(control, exit_fixture=True)
        self.finish(failed, ok=False)
        self.assert_no_start()
        turns = self.coord('turns', 'parent')
        self.assertEqual(len(turns), 1)
        self.assertIn(cause, turns[0]['reportBody'])
        account_reports = [message for message in self.coord('inbox', 'root')
                           if message['id'].endswith(':profile-exhausted')]
        self.assertEqual(len(account_reports), 1)
        self.assertIn('provider-reported usage exhaustion: ' + cause, account_reports[0]['body'])
        self.assertTrue(read_recorded(self.db, 'input'))
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_omp_insufficient_balance_exhaustion_keeps_its_account_failure(self):
        self.player('parent', harness='omp')
        self.message('input', 'parent')
        cause = ('402 Insufficient Balance '
                 '(request_id: 4d0c2819-79e8-492c-b9d5-823ee49dc538), '
                 'repeated Insufficient Balance, '
                 'type=unknown_error param=invalid_request_error')
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        self.action(control, fail_status=402, fail_message=cause)
        self.action(control, exit_fixture=True)
        self.finish(failed, ok=False)
        self.assert_no_start()
        turns = self.coord('turns', 'parent')
        self.assertEqual(len(turns), 1)
        self.assertIn(cause, turns[0]['reportBody'])
        account_reports = [message for message in self.coord('inbox', 'root')
                           if message['id'].endswith(':profile-exhausted')]
        self.assertEqual(len(account_reports), 1)
        self.assertIn('provider-reported usage exhaustion: ' + cause, account_reports[0]['body'])
        self.assertTrue(read_recorded(self.db, 'input'))
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_omp_profile_handoff_skips_the_unsupported_history_helper(self):
        self.player('parent', harness='omp')
        store_a = self.directory / 'omp-a'
        store_b = self.directory / 'omp-b'
        store_a.mkdir()
        store_b.mkdir()
        record = self.directory / ('state.db.profile-' + 'parent'.encode().hex())
        (self.directory / 'state.db.profiles').write_text(
            'omp A ' + str(store_a) + '\nomp B ' + str(store_b) + '\n')
        record.write_text(' omp A ' + str(store_a) + '\n')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.message('input', 'parent')
        cause = ("You've reached your 5-hour usage limit. Your quota will reset when "
                 "the current 5-hour window ends.")
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(launches[0]['piAgentDir'], str(store_a))
        self.assertEqual(launches[0]['home'], os.environ.get('HOME', ''))
        self.assertFalse([arg for arg in launches[0]['args'] if arg.startswith('HOME=')])
        self.action(control, fail_status=429, fail_message=cause)
        self.action(control, exit_fixture=True)
        second, resumed = self.accept_or_child_exit(
            failed, 'OMP profile handoff did not relaunch')
        launches = [json.loads(line) for line in
                    (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 2)
        self.assertEqual(launches[1]['piAgentDir'], str(store_b))
        self.assertEqual(launches[1]['home'], os.environ.get('HOME', ''))
        resume_path = pathlib.Path(launches[1]['resume'])
        self.assertTrue(resume_path.is_file())
        self.assertIn(original['native'], resume_path.name)
        self.assertEqual(resumed['native'], original['native'])
        self.assertFalse((self.directory / 'native-history.jsonl').exists())
        self.assertEqual(record.read_text().splitlines()[-1], ' omp B ' + str(store_b))
        self.action(second, body="Continued under the selected OMP profile.",
                    exit_after_terminal=True, read=['input'], ack_inbox=True)
        self.finish(failed)
        self.assertTrue(read_recorded(self.db, 'input'))
        handoff = [message for message in self.coord('inbox', 'root')
                   if 'subscription profile handoff' in message['body']]
        self.assertEqual(len(handoff), 1)
        self.assertIn(cause, handoff[0]['body'])

    def test_omp_exhaustion_continues_on_operator_listed_route(self):
        """All accounts refused with no .profiles file: the :profile-exhausted report is
        recorded, the first viable operator-listed route in state.db.routes is selected,
        the session is reconfigured to it, route guidance names the new route, and the same
        receive invocation relaunches the retained original task under it. The refused omp
        pair is recorded in the per-session route lineage. Every assertion reads coordinator
        state or the relaunched native start; no source SQL text is asserted."""
        self.player('parent', harness='omp')
        self.message('input', 'parent')
        (self.directory / 'state.db.routes').write_text(
            'omp parent ' + str(self.fixture) + '\n'
            'muse muse-main ' + str(self.fixture) + '\n')
        cause = ('429 Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52\n'
                 'Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52 (type=1308)')
        failed = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        self.action(control, fail_status=429, fail_message=cause)
        self.action(control, exit_fixture=True)
        second, resumed = self.accept_or_child_exit(failed, 'route continuation did not relaunch')
        self.assertEqual(resumed['session'], 'parent')
        self.assertNotEqual(resumed['native'], original['native'])
        rerouted = self.coord('player', 'parent')
        self.assertEqual((rerouted['harness'], rerouted['model']), ('muse', 'muse-main'))
        initialization = self.assert_retry_initialization('parent', [original['prompt'], resumed['prompt']])
        self.assertNotEqual(initialization[0]['turn'], initialization[1]['turn'])
        account_reports = [message for message in self.coord('inbox', 'root')
                           if message['id'].endswith(':profile-exhausted')]
        self.assertEqual(len(account_reports), 1)
        self.assertIn('provider-reported usage exhaustion: ' + cause, account_reports[0]['body'])
        chosen = [message for message in self.coord('inbox', 'root')
                  if message['id'].endswith(':route-chosen')]
        self.assertEqual(len(chosen), 1)
        self.assertIn('harness=muse', chosen[0]['body'])
        self.assertIn('model=muse-main', chosen[0]['body'])
        self.assertIn(cause, chosen[0]['body'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            guidance = database.execute(
                "SELECT body FROM messages WHERE id LIKE '%:route-guidance'").fetchall()
        self.assertEqual(len(guidance), 1)
        self.assertIn('harness=muse', guidance[0][0])
        self.assertIn('model=muse-main', guidance[0][0])
        self.assertIn('original retained attempt', guidance[0][0])
        self.assertIn('previous native conversation lineage is ' + original['native'], guidance[0][0])
        self.assertNotIn('acknowledged', guidance[0][0])
        self.assertNotIn('SELECT', guidance[0][0])
        lineage = self.directory / ('state.db.route-' + 'parent'.encode().hex())
        self.assertEqual(lineage.read_text().splitlines()[-1].split()[-2:], ['omp', 'parent'])
        self.action(second)
        self.finish(failed)
        turns = self.coord('turns', 'parent')
        self.assertEqual(len(turns), 2)
        failed_turns = [turn for turn in turns if cause in turn['reportBody']]
        self.assertEqual(len(failed_turns), 1)
        self.assertTrue(read_recorded(self.db, 'input'))
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_direct_exhaustion_continues_on_operator_listed_route(self):
        """A raw turn on a parentless actor that fails with provider-reported usage
        exhaustion and no .profiles file records :profile-exhausted, selects the
        operator-listed route, reconfigures the session, and writes continuation
        guidance carrying the saved complete task and the original native lineage.
        The refused omp pair is recorded in the per-session route lineage and the
        original cause travels on the chosen report. The reconfiguration also stores
        the new receiver endpoint, so the ordinary wake launches the continuation
        receive for the still-owed follow-up input on the new route: the case accepts
        that resumed native, completes it, and then inspects the failed cause and both
        turns. Every assertion reads coordinator state, native starts, or message
        bodies; no source SQL text is asserted."""
        self.coord('attach', 'routed', 'omp', 'saved-routed', '')
        self.coord('role', 'routed', 'principal-conductor')
        self.coord('start-setup', 'routed', 'omp', self.fixture, 'routed', 'low',
                   self.directory, self.directory / 'routed.jsonl')
        self.coord('connect', 'routed', 'saved-routed', '')
        self.assertIsNone(self.coord('player', 'routed')['parent'])
        self.coord('message', 'follow', 'operator', 'routed', 'guidance',
                   'Follow-up work after the route change.')
        self.connect('routed')
        sessions = pathlib.Path(str(self.db) + '.sessions')
        sessions.mkdir()
        saved_session = sessions / '2026-09-28_saved-routed.jsonl'
        saved_session.write_text(json.dumps({'type': 'session', 'id': 'saved-routed'}) + '\n')
        (self.directory / 'state.db.routes').write_text(
            'muse muse-main ' + str(self.fixture) + '\n')
        task = self.directory / 'direct task'
        task.write_text('Direct retained work. caféλ🙂\n')
        child = self.spawn('turn', 'routed', 'routed-turn', self.fixture, 'routed', 'low',
                           self.directory, task, self.directory / 'routed.jsonl', 'saved-routed')
        control, started = self.accept_child(child, 'routed')
        self.assertEqual(started['resume'], str(saved_session))
        self.assertEqual(started['native'], 'saved-routed')
        cause = ('429 Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52\n'
                 'Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52 (type=1308)')
        self.action(control, fail_status=429, fail_message=cause)
        self.action(control, exit_fixture=True)
        second, resumed = self.accept_or_child_exit(child, 'route continuation did not relaunch')
        self.assertEqual(resumed['session'], 'routed')
        initialization = self.assert_retry_initialization('routed', [started['prompt'], resumed['prompt']])
        self.assertEqual(initialization[0]['turn'], 'routed-turn')
        self.assertNotEqual(initialization[0]['turn'], initialization[1]['turn'])
        self.assertIn('Use baton inbox to read complete input', initialization[0]['guidance'])
        self.assertNotIn(str(self.db), initialization[0]['guidance'])
        self.assertNotIn('Use acknowledge', initialization[0]['guidance'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertEqual(database.execute(
                "SELECT task FROM direct_turn_requests WHERE session='routed' AND id='routed-turn'").fetchone()[0],
                task.read_text())
        self.assertIn('[id: follow]', resumed['prompt'])
        self.assertIn('Direct retained work.', resumed['prompt'])
        self.assertIn('previous native conversation lineage is saved-routed', resumed['prompt'])
        self.action(second)
        self.finish(child)
        turns = self.coord('turns', 'routed')
        self.assertEqual(len(turns), 2)
        failed_turns = [turn for turn in turns if cause in turn['reportBody']]
        self.assertEqual(len(failed_turns), 1)
        rerouted = self.coord('player', 'routed')
        self.assertEqual((rerouted['harness'], rerouted['model']), ('muse', 'muse-main'))
        self.assertNotEqual(rerouted['native'], '')
        account_reports = [message for message in self.coord('inbox', 'operator')
                           if message['id'].endswith(':profile-exhausted')]
        self.assertEqual(len(account_reports), 1)
        self.assertIn('provider-reported usage exhaustion: ' + cause, account_reports[0]['body'])
        chosen = [message for message in self.coord('inbox', 'operator')
                  if message['id'].endswith(':route-chosen')]
        self.assertEqual(len(chosen), 1)
        self.assertIn('harness=muse', chosen[0]['body'])
        self.assertIn('model=muse-main', chosen[0]['body'])
        self.assertIn(cause, chosen[0]['body'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            guidance = database.execute(
                "SELECT body FROM messages WHERE id LIKE '%:route-guidance'").fetchall()
        self.assertEqual(len(guidance), 1)
        self.assertIn('Direct retained work.', guidance[0][0])
        self.assertIn('previous native conversation lineage is saved-routed', guidance[0][0])
        self.assertIn('harness=muse', guidance[0][0])
        self.assertNotIn('SELECT', guidance[0][0])
        self.assertTrue(read_recorded(self.db, 'follow'))
        lineage = self.directory / ('state.db.route-' + 'routed'.encode().hex())
        refused = lineage.read_text().splitlines()[-1].split()
        self.assertTrue(refused[0].isdigit() and refused[1].isdigit())
        self.assertEqual(refused[2:], ['omp', 'routed'])

    def test_turn_and_receive_share_ownership_and_omp_session_file(self):
        self.player(harness='omp')
        self.prepare_input('preexisting', 'parent', 'Already pending before turn.', kind='report')
        self.connect('parent')
        task = self.directory / 'initial task'
        task.write_text('Initial work without an inbox batch.')
        alias = self.directory / 'database alias.db'
        alias.symlink_to(self.db)
        child = subprocess.Popen([str(EXE), str(alias), 'turn', 'parent', 'initial-turn',
                                  str(self.fixture), 'parent', 'low', str(self.directory),
                                  str(task), str(self.directory / 'initial.jsonl'), ''],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        control, initial = self.accept('parent')
        self.message('follow-up', 'parent')
        self.assert_no_start()
        self.action(control)
        follow_up, started = self.accept('parent')
        self.assertIn('[id: preexisting]', started['prompt'])
        self.assertIn('[id: follow-up]', started['prompt'])
        self.assertEqual(started['native'], initial['native'])
        self.assertEqual(pathlib.Path(started['resume']).parent, pathlib.Path(str(self.db) + '.sessions'))
        self.action(follow_up)
        self.finish(child)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_terminal_event_retains_ownership_until_native_process_exit(self):
        self.player()
        self.connect('parent')
        task = self.directory / 'task'
        task.write_text('Initial work.')
        child = self.spawn('turn', 'parent', 'initial-turn', self.fixture, 'parent', 'low',
                           self.directory, task, self.directory / 'initial.jsonl', '')
        control, _ = self.accept('parent')
        self.action(control, hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.message('follow-up', 'parent')
        self.assert_no_start()
        self.action(control)
        resumed, started = self.accept('parent')
        self.assertIn('[id: follow-up]', started['prompt'])
        self.action(resumed)
        self.finish(child)

    def test_replayed_turn_wakes_input_queued_while_returning_saved_report(self):
        self.player()
        report = self.directory / 'large report'
        report.write_text('retained report\n' * 30000)
        recorded_parent = self.coord('player', 'parent')['parent']
        self.assertEqual(recorded_parent, 'root')
        task = self.directory / 'saved task'
        task.write_text('Complete the retained direct work.')
        log = self.directory / 'saved log'
        initial = self.spawn('turn', 'parent', 'saved-turn', self.fixture, 'parent', 'low',
                             self.directory, task, log, '')
        control, _ = self.accept_child(initial, 'parent')
        self.action(control, body=report.read_text())
        self.finish(initial)
        retained = self.coord('delivery', 'saved-turn')
        self.assertEqual(retained['id'], 'saved-turn')
        self.assertEqual(retained['sender'], 'parent')
        self.assertEqual(retained['recipient'], recorded_parent)
        self.assertEqual(retained['kind'], 'report')
        self.assertEqual(retained['body'], report.read_text())
        self.assertFalse(read_recorded(self.db, retained['id']))
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            request = database.execute(
                "SELECT task,output FROM direct_turn_requests WHERE id='saved-turn' AND session='parent'"
            ).fetchone()
        self.assertEqual(request, (task.read_text(), str(log)))
        self.connect('parent')
        child = self.spawn('turn', 'parent', 'saved-turn', self.fixture, 'parent', 'low',
                           self.directory, task, log, '')
        # A retained report fills stdout while the replay still owns the session.
        self.assertEqual(child.stdout.read(1), '{')
        self.message('queued-during-replay', 'parent')
        self.assert_no_start()
        output = []
        drain = threading.Thread(target=lambda: output.append(child.stdout.read()))
        drain.start()
        control, started = self.accept('parent')
        self.assertIn('[id: queued-during-replay]', started['prompt'])
        self.action(control)
        drain.join(10)
        self.assertFalse(drain.is_alive())
        self.finish(child)
        self.assertIn('retained report', output[0])
        returned = json.loads('{' + output[0])
        self.assertEqual(returned['id'], 'saved-turn')
        self.assertEqual(returned['sender'], 'parent')
        self.assertEqual(returned['recipient'], recorded_parent)
        self.assertEqual(returned['kind'], 'report')
        self.assertEqual(returned['body'], report.read_text())
        self.assertEqual(self.coord('inbox', 'parent'), [])


    # Canonical claim-table definition, kept identical to
    # Store.claim_schema_sql in bend2/src/coordinator/store.bend. Staging a
    # claim ensures the table exactly as the product does; reading claims
    # from a database that never held any returns no rows.
    CLAIM_SCHEMA = ("CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL "
                    "REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', "
                    "owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);")

    def claims(self, session=None):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            try:
                rows = database.execute('SELECT session, state FROM wake_claims ORDER BY session').fetchall()
            except sqlite3.OperationalError:
                return []
        return [row for row in rows if session is None or row[0] == session]

    def claim_rows(self, session=None):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            try:
                rows = database.execute('SELECT session, state, owner, generation FROM wake_claims'
                                        ' ORDER BY session').fetchall()
            except sqlite3.OperationalError:
                return []
        return [row for row in rows if session is None or row[0] == session]

    def execution(self, session):
        """The session's recorded attempt row: phase, status and directory."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
            row = database.execute('SELECT phase, status, directory FROM executions'
                                   ' WHERE session=?', (session,)).fetchone()
        return row

    def set_phase(self, session, phase):
        with sqlite3.connect(str(self.db)) as database:
            database.execute('UPDATE executions SET phase=? WHERE session=?',
                             (phase, session))

    def claim(self, session, state='claimed', owner='', generation=0):
        with sqlite3.connect(str(self.db)) as database:
            database.execute(self.CLAIM_SCHEMA)
            database.execute('INSERT OR REPLACE INTO wake_claims(session, state, owner, generation)'
                             ' VALUES (?, ?, ?, ?)',
                             (session, state, owner, generation))

    def session_lock_path(self, session):
        return _session_lock_path(self.db, session)

    def hold_session_lock(self, session):
        held = os.open(self.session_lock_path(session), os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.addCleanup(lambda: (fcntl.flock(held, fcntl.LOCK_UN), os.close(held)))
        return held

    def test_stop_clears_the_wake_claim(self):
        """A terminal stop is the operator resolution: the session's claim goes with it
        while the retained input stays in the inbox."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent')
        self.assertEqual(self.claims('parent'), [('parent', 'claimed')])
        stopped = self.coord('stop', 'parent', 'stop-claim', 'operator resolution')
        self.assertEqual(stopped['status'], 'stopped')
        self.assertEqual(self.claims('parent'), [])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_owned_read_clears_the_wake_claim(self):
        """A recorded owned read clears the obligation, and the claim row is deleted with it."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent')
        self.coord('as', 'parent', 'read', 'owed')
        self.assertTrue(read_recorded(self.db, 'owed', 'parent'))
        self.assertEqual(self.claims('parent'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_an_unclaimed_session_with_owed_input_never_starts_a_turn_by_itself(self):
        """The obligation is durable and passive: with no driver and no admission, an idle
        session with owed input starts nothing, keeps its unclaimed row, and retains the
        input in its inbox."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'unclaimed')
        self.assert_no_start()
        self.assertEqual(self.claims('parent'), [('parent', 'unclaimed')])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])


    def test_read_of_an_absent_id_records_nothing_and_preserves_the_claim(self):
        """An absent read writes nothing: the live claim row stays exactly as it was."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        self.coord('as', 'parent', 'read', 'no-such-message')
        self.assertFalse(read_recorded(self.db, 'no-such-message'))
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_read_by_a_foreign_recipient_records_nothing_and_preserves_the_claim(self):
        self.player()
        self.player('other')
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        self.coord('as', 'other', 'read', 'owed')
        self.assertFalse(read_recorded(self.db, 'owed', 'other'))
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual(self.claim_rows('other'), [])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_owned_read_with_remaining_input_keeps_the_claim(self):
        """The read clears the claim only when no unread input remains; one of two
        owned reads leaves the claim row in place."""
        self.player()
        self.prepare_input('first', 'parent')
        self.prepare_input('second', 'parent')
        self.claim('parent', 'claimed', 'first', 2)
        self.coord('as', 'parent', 'read', 'first')
        self.assertTrue(read_recorded(self.db, 'first', 'parent'))
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'first', 2)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['second'])

    def test_stop_with_an_unsupported_harness_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        with sqlite3.connect(str(self.db)) as database:
            database.execute("UPDATE sessions SET harness='unsupported-fixture-harness' WHERE id='parent'")
        refused = self.coord('stop', 'parent', 'stop-unsupported', 'operator resolution', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stop_with_a_legacy_direct_execution_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        with sqlite3.connect(str(self.db)) as database:
            database.execute("INSERT INTO executions(session, id, mode, directory, phase, status)"
                             " VALUES ('parent', 'direct-1', 'direct', '', 'running', '')")
        refused = self.coord('stop', 'parent', 'stop-direct', 'operator resolution', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stop_with_a_conflicting_identity_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        stopped = self.coord('stop', 'parent', 'stop-first', 'operator resolution')
        self.assertEqual(stopped['status'], 'stopped')
        self.assertEqual(self.claim_rows('parent'), [])
        self.claim('parent', 'claimed', 'owed', 9)
        refused = self.coord('stop', 'parent', 'stop-second', 'changed reason', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('identity', refused.stderr)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 9)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_queued_non_owner_cannot_clear_a_live_claim(self):
        """While another driver holds the session lock, the queued sweep returns
        without touching the live claim row: owner and generation survive intact."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 6)
        self.hold_session_lock('parent')
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 6)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stale_claim_from_a_dead_driver_is_taken_over_with_a_fenced_generation(self):
        """A claim row left by a driver that died before launch never suppresses the
        wake: the next driver takes the obligation over under the lock, names the
        head message as owner, and fences the takeover past the stale generation."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'dead-attempt', 7)
        child = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: owed]', started['prompt'])
        taken = self.eventually(
            lambda: next((row for row in self.claim_rows('parent')
                          if row[2] == 'owed' and row[3] > 7), None),
            'a live driver never took over the stale claim')
        self.assertEqual(taken[2:], ('owed', taken[3]))
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])
        self.action(control)
        self.finish(child)
        self.assertEqual(self.claim_rows('parent'), [])

    def test_message_adopts_an_unreaped_dead_attempt_and_continues_same_native(self):
        """Message admission adopts the retained attempt after observer and
        native loss, then continues both owed inputs in the same conversation.
        The original unknown exit and recipient-owned receipts remain recorded.
        """
        self.player()
        fixture_config_path = self.directory / 'fixture.json'
        fixture_config = json.loads(fixture_config_path.read_text())
        fixture_config['record_launches'] = True
        fixture_config_path.write_text(json.dumps(fixture_config))
        self.prepare_input('first', 'parent')
        self.connect('parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        native = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                 'The original native identity was not recorded.')
        self.assertEqual(native, started['native'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        self.assertEqual(before[0][2], 'first')
        self.freeze_owned()
        first.kill()
        first.wait()
        self.kill_fixture()
        self.kill_keeper(first)
        self.drain_owned()
        directory = self.execution('parent')[2]
        self.assertTrue(os.path.isfile(os.path.join(directory, 'manifest')))
        self.assertTrue(os.path.isfile(os.path.join(directory, 'launch')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'acknowledged')),
                         'keeper recovered the killed observer before it died')
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')),
                         'keeper reaped the killed native before it died')
        self.assertEqual(self.claim_rows('parent'), before)
        self.message('second', 'parent')
        continued, resumed = self.accept('parent')
        self.assertEqual(resumed['native'], native)
        self.assertEqual(resumed['resume'], native)
        self.assertIn('[id: first]', resumed['prompt'])
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])
        self.assertFalse(read_recorded(self.db, 'first'))
        self.assertFalse(read_recorded(self.db, 'second'))
        self.action(continued)
        self.assertEqual(continued.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent')
                        and self.execution('parent')[0] == 'exited'
                        and os.path.exists(os.path.join(directory, 'released')),
                        'Public delivery did not finish the retained continuation.')
        self.assertTrue(read_recorded(self.db, 'first'))
        self.assertTrue(read_recorded(self.db, 'second'))
        self.assertEqual(self.coord('player', 'parent')['native'], native)
        exits = [row for row in self.coord('inbox', 'root') if row['id'].endswith(':exit')]
        self.assertTrue(any('unknown after keeper loss' in row['body'] for row in exits))
        self.assertTrue(os.path.exists(os.path.join(directory, 'acknowledged')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')))
        launches = (self.directory / 'native-launches.jsonl').read_text().splitlines()
        self.assertEqual(len(launches), 2)
        self.assert_no_start()

    def kill_fixture(self):
        """Kill the fixture native processes of this run, leaving keepers."""
        for process in process_table(names=self.process_names()):
            if str(self.directory) in process['command'] and 'native fixture' in process['command']:
                try:
                    os.kill(process['pid'], signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def freeze_owned(self, spare_fixture=False):
        """SIGSTOP run processes so a killed observer cannot be recovered
        before the keepers die. The keeper reaps a dead observer within
        milliseconds, so killing without freezing lets keeper-side recovery
        finish first and leaves receive-side adoption nothing to adopt.
        With spare_fixture the live native keeps running so the test can
        still drive it while the frozen observer cannot observe."""
        for process in self.owned_processes():
            if spare_fixture and 'native fixture' in process['command']:
                continue
            try:
                os.kill(process['pid'], signal.SIGSTOP)
            except ProcessLookupError:
                pass

    @staticmethod
    def spared(command):
        """The live fixture's own command. Receivers name the fixture path
        as an argument, keepers and recoveries supervise it: only the bare
        fixture process itself is spared."""
        return ('native fixture' in command
                and 'receive parent' not in command
                and '--host-process-keeper' not in command
                and '--recover-receive' not in command
                and '--dispatch-message' not in command)

    def drain_others(self):
        """Kill every run process except the live fixture and wait until
        only it remains. A keeper-side recover orphan inherits the session
        lock; leaving it alive lets a second driver queue vacuously
        instead of deciding on custody."""
        for process in self.owned_processes():
            if self.spared(process['command']):
                continue
            try:
                os.kill(process['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.eventually(lambda: all(self.spared(process['command'])
                                    for process in self.run_processes()),
                        'run strays never drained')

    def assert_native_alive(self, directory, message):
        """The recorded native is a live non-zombie process. A test about a
        live child proves nothing if the child died unnoticed."""
        try:
            pid = int(pathlib.Path(directory, 'native.pid').read_text().split()[0])
            state = pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[0]
        except (FileNotFoundError, ValueError, IndexError):
            self.fail(message)
        self.assertNotEqual(state, 'Z', message)

    def drain_owned(self):
        """Kill run stragglers and wait until none hold attempt pipes. A
        half-reaped keeper keeps the native's stdout open, so an adopter
        would block on read instead of reaching EOF; the status file alone
        does not prove the pipes are free. Zombies count too: an unreaped
        native still answers liveness probes, so adoption must wait for
        init to reap it."""
        for process in self.owned_processes():
            try:
                os.kill(process['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.eventually(lambda: not self.run_processes(),
                        'run processes never drained')

    def run_processes(self):
        """Every process of this run, including unreaped zombies."""
        return [{key: process[key] for key in ('pid', 'ppid', 'status', 'command')}
                for process in process_table(names=self.process_names()) if str(self.directory) in process['command']]

    def kill_keeper(self, leader):
        """Kill the keeper processes of this run, freeing an inherited
        session lock. The leader driver is already dead; fixtures stay."""
        for process in process_table(names=self.process_names()):
            pid, command = process['pid'], process['command']
            if pid == leader.pid or 'native fixture' in command:
                continue
            if str(self.directory) in command:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_wake_with_stale_running_phase_and_dead_native_takes_over_and_repairs_metadata(self):
        """A failed terminal attempt retains its input. A later admission reads
        its reaped status and repairs the stale execution phase under the lock.
        """
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        self.action(control, fail=True, ack=False)
        self.finish(first, ok=False)
        self.assertEqual(self.execution('parent')[0], 'exited')
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        self.set_phase('parent', 'running')
        self.message('second', 'parent')
        self.assert_no_start()
        taken = self.claim_rows('parent')
        self.assertEqual(len(taken), 1)
        self.assertEqual(taken[0][2], 'first')
        self.assertGreater(taken[0][3], before[0][3])
        self.assertEqual(self.execution('parent')[:2], ('exited', 'owner-death'))
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])

    def test_direct_receive_recovers_a_dead_attempt_behind_a_stale_running_phase(self):
        """A direct receive reads terminal output after observer and owner loss.
        The adopted attempt records its report and observation markers, clears
        the satisfied claim, and retains the unknown native exit status.
        """
        self.player()
        fixture_config_path = self.directory / 'fixture.json'
        fixture_config = json.loads(fixture_config_path.read_text())
        fixture_config['record_launches'] = True
        fixture_config_path.write_text(json.dumps(fixture_config))
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        directory = self.execution('parent')[2]
        self.suspend_observer_without_database_reader(self.selected_process(first.pid))
        self.action(control, body='Adopted result complete.', hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.eventually(lambda: 'Adopted result complete.' in
                        pathlib.Path(directory, 'stdout').read_text(),
                        'shared owner never spooled the driven native completion')
        self.freeze_owned()
        first.kill()
        first.wait()
        self.kill_keeper(first)
        self.kill_fixture()
        self.drain_owned()
        self.assertTrue(os.path.isfile(os.path.join(directory, 'manifest')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'acknowledged')),
                         'keeper recovered the killed observer before it died')
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')),
                         'keeper reaped the killed native before it died')
        second = self.spawn(*self.receive_args('parent'))
        _, error = self.finish(second, ok=False)
        self.assertIn('Native receive failed', error)
        self.assertEqual(self.execution('parent')[0], 'exited')
        self.assertEqual(self.claim_rows('parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Adopted result complete.'])
        exits = [row for row in self.coord('inbox', 'root') if row['id'].endswith(':exit')]
        self.assertEqual(len(exits), 1)
        self.assertIn('unknown after keeper loss', exits[0]['body'])
        attempts = sorted(path for path in self.directory.glob('*.attempt-*') if path.is_dir())
        launches_path = self.directory / 'native-launches.jsonl'
        launches = launches_path.read_text().splitlines() if launches_path.exists() else []
        attempt_evidence = [{
            'path': str(path),
            'files': sorted(item.name for item in path.iterdir()),
            'manifest': (path / 'manifest').read_text(errors='replace')
            if (path / 'manifest').is_file() else None,
        } for path in attempts]
        evidence = {
            'attempts': attempt_evidence,
            'execution': self.execution('parent'),
            'session': self.coord('player', 'parent'),
            'nativeLaunches': launches,
        }
        self.assertEqual(len(attempts), 1, json.dumps(evidence, sort_keys=True))
        self.assertEqual(len(launches), 1, json.dumps(evidence, sort_keys=True))
        self.assertEqual(self.execution('parent')[2], str(attempts[0]))
        self.assertTrue(os.path.isfile(os.path.join(directory, 'acknowledged')))
        self.assertTrue(os.path.isfile(os.path.join(directory, 'released')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')))

    def test_dead_native_nul_spool_recovery_preserves_reads_until_new_owner(self):
        """A missing native status and NUL in retained stdout do not consume inbox input."""
        self.player()
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('first', 'parent')
        original_receiver = self.spawn(*self.receive_args('parent'))
        original_control, original_started = self.accept_child(
            original_receiver, 'parent', 'original receiver exited before stub startup')
        self.assertIn('[id: first]', original_started['prompt'])
        original_native = original_started['native']
        original_attempt = pathlib.Path(self.execution('parent')[2])
        self.message('second', 'parent')

        self.suspend_observer_without_database_reader(self.selected_process(original_receiver.pid))
        self.action(original_control, body='This response is retained but cannot be decoded.', hold_exit=True)
        self.assertEqual(json.loads(original_control.readline()), {'terminal_written': True})
        self.eventually(
            lambda: b'This response is retained but cannot be decoded.'
            in (original_attempt / 'stdout').read_bytes(),
            'the original response was not spooled')
        self.freeze_owned()
        original_receiver.kill()
        original_receiver.wait()
        self.kill_keeper(original_receiver)
        self.kill_fixture()
        self.drain_owned()
        self.assertFalse((original_attempt / 'status').exists())
        self.assertFalse((original_attempt / 'acknowledged').exists())

        raw_spool = original_attempt / 'stdout'
        with raw_spool.open('ab') as output:
            output.write(b'\x00unframed interrupted tail')
        preserved = raw_spool.read_bytes()
        self.assertIn(b'\x00', preserved)
        with sqlite3.connect(self.db) as database:
            reads_before = database.execute(
                "SELECT id,(SELECT count(*) FROM message_reads r WHERE r.message=messages.id "
                "AND r.recipient=messages.recipient) FROM messages WHERE recipient='parent' ORDER BY seq"
            ).fetchall()
        self.assertEqual(reads_before, [('first', 0), ('second', 0)])

        recovery = self.spawn(*self.receive_args('parent'))
        resumed, recovery_started = self.accept_child(
            recovery, 'parent', 'recovery receiver exited before new stub startup')
        self.assertEqual(recovery_started['native'], original_native)
        self.assertNotEqual(recovery_started['pid'], original_started['pid'])
        self.assertIn('[id: first]', recovery_started['prompt'])
        self.assertIn('[id: second]', recovery_started['prompt'])
        self.assertEqual(raw_spool.read_bytes(), preserved)
        self.assertNotIn('This response is retained but cannot be decoded.',
                         [row['reportBody'] for row in self.coord('turns', 'parent')])
        with sqlite3.connect(self.db) as database:
            self.assertEqual(database.execute(
                "SELECT id,(SELECT count(*) FROM message_reads r WHERE r.message=messages.id "
                "AND r.recipient=messages.recipient) FROM messages WHERE recipient='parent' ORDER BY seq"
            ).fetchall(), reads_before)
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 2)

        self.action(resumed, body='The new owner completed both retained inputs.', read=['first', 'second'], ack=False)
        _, recovery_error = self.finish(recovery, ok=False)
        self.assertIn('Native receive failed', recovery_error)
        report_bodies = [row['reportBody'] for row in self.coord('turns', 'parent')]
        self.assertEqual(report_bodies.count('The new owner completed both retained inputs.'), 1)
        self.assertNotIn('This response is retained but cannot be decoded.', report_bodies)
        with sqlite3.connect(self.db) as database:
            reads = database.execute(
                "SELECT message,attempt,native,handled FROM message_reads "
                "WHERE recipient='parent' ORDER BY message"
            ).fetchall()
            receipts = database.execute(
                "SELECT id,receipt FROM messages WHERE recipient='parent' ORDER BY seq"
            ).fetchall()
        self.assertEqual([row[0] for row in reads], ['first', 'second'])
        self.assertEqual({row[1] for row in reads}, {reads[0][1]})
        self.assertEqual({row[2] for row in reads}, {original_native})
        self.assertEqual({row[3] for row in reads}, {None})
        self.assertEqual(receipts, [('first', None), ('second', None)])
        self.assertEqual(raw_spool.read_bytes(), preserved)

    def lose_host_runtime(self, receiver):
        """End every process of this run and remove its runtime sockets, as a
        host reboot does. Attempt directories and the database remain."""
        self.freeze_owned()
        receiver.kill()
        receiver.wait()
        self.drain_owned()
        removed = []
        for directory, _, names in os.walk(self.ipc.name):
            for name in names:
                path = pathlib.Path(directory, name)
                if stat.S_ISSOCK(path.lstat().st_mode):
                    path.unlink()
                    removed.append(path)
        self.assertTrue(removed, 'the run left no runtime socket to remove')

    def test_dsh_resume_after_keeper_loss_continues_the_recorded_conversation(self):
        """A DSH seat whose keeper, owner and native ended with the host (#1067):
        resume records the ended attempt and continues the recorded DSH
        conversation with every owed input."""
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness='dsh')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(record_launches=True, read_root=False)
        config_path.write_text(json.dumps(config))
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        original_receiver = self.spawn(*self.receive_args('parent'))
        _, original_started = self.accept_child(
            original_receiver, 'parent', 'original receiver exited before the dsh stub started')
        self.assertEqual(original_started['args'][:2], ['--profile', 'headless'])
        self.assertNotIn('--session-id', original_started['args'])
        self.assertIn('[id: first]', original_started['prompt'])
        original_native = original_started['native']
        self.eventually(lambda: self.coord('player', 'parent')['native'] == original_native,
                        'the DSH session frame was not recorded as the native identity')
        original_attempt = pathlib.Path(self.execution('parent')[2])
        self.coord('message', 'second', 'root', 'parent', 'report', 'The exact queued input.')

        self.lose_host_runtime(original_receiver)
        self.assertTrue((original_attempt / 'launch').exists())
        self.assertFalse((original_attempt / 'status').exists())
        with sqlite3.connect(self.db) as database:
            self.assertEqual(database.execute(
                "SELECT id,receipt FROM messages WHERE recipient='parent' ORDER BY seq").fetchall(),
                [('first', None), ('second', None)])

        resume = self.spawn('resume', 'parent')
        resumed, recovery_started = self.accept_child(
            resume, 'parent', 'resume exited before the new dsh process started')
        self.assertNotEqual(recovery_started['pid'], original_started['pid'])
        self.assertEqual(recovery_started['resume'], original_native)
        self.assertEqual(recovery_started['native'], original_native)
        self.assertIn('[id: first]', recovery_started['prompt'])
        self.assertIn('[id: second]', recovery_started['prompt'])
        history = [json.loads(line) for line in
                   (self.directory / 'native-history.jsonl').read_text().splitlines()]
        self.assertEqual([row['resume'] for row in history], ['', original_native])
        self.assertEqual(history[0]['home'], history[1]['home'])
        self.assertIn('Complete the original input.', history[1]['content'])

        body = 'The resumed DSH conversation completed both inputs.'
        self.action(resumed, body=body, read=['first', 'second'], ack=False, complete_task=False)
        self.assertEqual(resumed.readline(), b'')
        # The recovering receive reports the ended attempt's unknown outcome in
        # its exit status after the continuation completes, as the #986 recovery
        # test records. The completed turn is read from the database.
        self.child_communication(resume)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertIn(body, [row['reportBody'] for row in self.coord('turns', 'parent')])
        self.assertTrue(read_recorded(self.db, 'first', 'parent'))
        self.assertTrue(read_recorded(self.db, 'second', 'parent'))
        with sqlite3.connect(self.db) as database:
            self.assertEqual(database.execute(
                "SELECT id,receipt FROM messages WHERE recipient='parent' ORDER BY seq").fetchall(),
                [('first', None), ('second', None)])
            ended = database.execute(
                "SELECT count(*) FROM messages WHERE sender='parent' "
                "AND body LIKE '%unknown after keeper loss%'").fetchone()[0]
        self.assertGreater(ended, 0, 'the ended attempt was not recorded')
        self.assertEqual(self.coord('player', 'parent')['native'], original_native)
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 2)

    def test_dsh_resume_of_an_unstarted_attempt_starts_a_conversation_with_owed_input(self):
        """A DSH seat that never started a conversation and holds an attempt in
        `starting` with only DSH patch files, the state left by a receiver that
        wrote its patches into the custody directory (#1067): resume admits a
        new attempt, starts a fresh DSH conversation and delivers the open task
        and the other owed input."""
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness='dsh')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(record_launches=True, read_root=False)
        config_path.write_text(json.dumps(config))
        self.prepare_input('assignment', 'parent', 'Complete the assignment.', kind='task')
        self.prepare_input('note', 'parent', 'Use the shared worktree.')
        self.connect('parent')
        stale = 'receive:parent:2:' + '0' * 32
        stale_directory = pathlib.Path(str(self.db.resolve()) + '.attempt-' + stale.encode().hex())
        stale_directory.mkdir(mode=0o700)
        for name in ('dsh-tools.patch.yml', 'dsh-model.patch.yml'):
            (stale_directory / name).write_text('# retained patch\n')
        with sqlite3.connect(self.db) as database:
            database.execute("INSERT OR REPLACE INTO executions(session,id,mode,directory,phase,status) "
                             "VALUES('parent',?,'retained',?,'starting','')", (stale, str(stale_directory)))
        self.assertEqual(self.coord('player', 'parent')['native'], '')

        resume = self.spawn('resume', 'parent')
        control, started = self.accept_child(resume, 'parent', 'resume exited before the dsh stub started')
        self.assertNotIn('--session-id', started['args'])
        self.assertEqual(started['resume'], '')
        self.assertIn('[id: assignment]', started['prompt'])
        self.assertIn('Complete the assignment.', started['prompt'])
        self.assertIn('[id: note]', started['prompt'])
        current = pathlib.Path(self.execution('parent')[2])
        self.assertNotEqual(current, stale_directory)
        self.assertTrue((current / 'launch').exists())
        self.assertEqual(sorted(path.name for path in stale_directory.iterdir()),
                         ['dsh-model.patch.yml', 'dsh-tools.patch.yml'])

        body = 'A fresh DSH conversation completed the assignment.'
        self.action(control, body=body, read=['assignment', 'note'], ack=False, complete_task=False)
        self.assertEqual(control.readline(), b'')
        self.finish(resume)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertIn(body, [row['reportBody'] for row in self.coord('turns', 'parent')])
        self.assertTrue(read_recorded(self.db, 'assignment', 'parent'))
        self.assertTrue(read_recorded(self.db, 'note', 'parent'))
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 1)

    def test_direct_receive_behind_a_live_child_starts_no_second_turn(self):
        """A live retained child outlives its dead observer with the session
        lock free: a direct receive adopts rather than duplicating, so no
        second native conversation starts and the live claim row is intact.
        Adoption also clears stale owner-death execution metadata.
        """
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        first.kill()
        first.wait()
        self.drain_others()
        directory = self.execution('parent')[2]
        self.assert_native_alive(directory, 'retained child died; the live-child premise is void')
        self.assertFalse((pathlib.Path(directory) / 'status').exists())
        self.assertFalse((pathlib.Path(directory) / 'acknowledged').exists())
        self.connect('parent')
        with sqlite3.connect(str(self.db)) as database:
            database.execute("UPDATE executions SET phase='exited',status='owner-death'"
                             " WHERE session=?", ('parent',))
        self.assertEqual(self.coord('player', 'parent')['blockedCause'], 'provider-failure')
        second = self.spawn(*self.receive_args('parent'))
        marker = 'original native observed by the adopted direct receiver'
        self.action(control, progress=marker)
        self.assertEqual(json.loads(control.readline()), {'progress_written': marker})
        log = self.output_log('parent')

        def adopted_output():
            if second.poll() is not None:
                self.fail(f'direct receiver exited before observing the retained child: {second.returncode}')
            return log.exists() and marker in log.read_text()

        self.eventually(adopted_output, 'direct receiver did not observe the retained child')
        self.assertEqual(self.execution('parent')[:2], ('running', ''))
        self.assertEqual(self.coord('player', 'parent')['blockedCause'], '')
        self.assert_no_start()
        self.assertIsNone(second.poll(),
                          'direct receive exited instead of adopting the live attempt')
        self.assert_native_alive(directory, 'retained child died during adoption')
        self.assertFalse((pathlib.Path(directory) / 'acknowledged').exists())
        self.assertEqual(self.claim_rows('parent'), before)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['first'])

    def test_racing_wake_behind_a_live_child_launches_nothing_and_reclaims_nothing(self):
        """Two-driver launch handoff with a real live child: the winner holds
        a live native with the lock free, and the loser's admission wake
        stands down, so exactly one native conversation exists and the
        winner's claim row keeps its owner and generation."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        first.kill()
        first.wait()
        self.drain_others()
        directory = self.execution('parent')[2]
        self.assert_native_alive(directory, 'retained child died; the live-child premise is void')
        self.message('second', 'parent')
        self.assert_no_start()
        self.assert_native_alive(directory, 'retained child died during the racing wake')
        self.assertEqual(self.claim_rows('parent'), before)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])

    def test_idle_arrival_starts_one_turn_and_leaves_no_duplicate(self):
        """A message admitted to an idle session with a recorded receiver starts one turn
        carrying that input, and the completed turn leaves no second turn behind."""
        self.player()
        self.connect('parent')
        delivery = self.spawn('message', 'idle-input', 'root', 'parent', 'guidance', 'Idle arrival.')
        control, started = self.accept('parent')
        self.assertIn('[id: idle-input]', started['prompt'])
        self.action(control)
        self.finish(delivery)
        self.shutdown_idle_database_owner('Idle input did not settle in its native turn.', reject_start=True)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 1)

    def test_guidance_arrives_while_retained_native_is_silent(self):
        """A retained OMP reader forwards committed guidance during a silent
        native wait and preserves a stdout line split across the notice.
        """
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('original', 'parent', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'The retained startup frame was not observed.')
        fragment = '{"type":"fixture_progress","marker":"silent-λ'
        self.action(control, stdout_fragment=fragment)
        self.assertEqual(json.loads(control.readline()), {'fragment_written': fragment})
        self.action(control, read_steer=True, signal_steer_wait=True,
                    check_steer_read=True, finish_fragment='-completed"}')
        self.assertEqual(json.loads(control.readline()), {'waiting_for_steer': True})
        body = 'Guidance received during the silent wait λ.'
        self.message('silent-guidance', 'parent', body)
        accepted = json.loads(control.readline())['steer_received']
        self.assertEqual((accepted['type'], accepted['id'], accepted['message']),
                         ('steer', 'silent-guidance', body))
        marker = 'silent guidance accepted before recipient handling'
        self.action(control, progress=marker)
        self.assertEqual(json.loads(control.readline()), {'progress_written': marker})
        self.eventually(lambda: marker in self.output_log('parent').read_text(),
                        'the observer did not read past the steer response')
        self.assertFalse(read_recorded(self.db, 'silent-guidance'))
        self.assert_no_start()
        self.action(control, body=body)
        self.finish(observer)
        self.assertTrue(read_recorded(self.db, 'silent-guidance'))
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        frames = [json.loads(line) for line in self.output_log('parent').read_text().splitlines()]
        self.assertEqual([frame for frame in frames if frame.get('type') == 'fixture_progress'],
                         [{'type': 'fixture_progress', 'marker': 'silent-λ-completed'},
                          {'type': 'fixture_progress', 'marker': marker, 'native_pid': started['pid']}])
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 1)
        self.assert_no_start()

    def test_output_only_frames_replay_from_durable_checkpoint(self):
        self.player(harness='omp')
        self.prepare_input('output-replay-task', 'parent', 'Replay output from the last semantic checkpoint.')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original OMP identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        attempt = pathlib.Path(self.execution('parent')[2])
        checkpoint = attempt / 'checkpoint'
        log = self.output_log('parent')

        self.action(control, emit_checkpoint_message='durable-output-cursor')
        self.assertEqual(json.loads(control.readline()),
                         {'checkpoint_message_written': 'durable-output-cursor'})
        def checkpoint_state():
            if not checkpoint.is_file():
                return None
            record = checkpoint.read_bytes()
            state_at = record.find(b'{"schema":1,')
            if state_at < 0:
                return None
            try:
                return record, json.loads(record[state_at:])
            except json.JSONDecodeError:
                return None

        def durable_semantic_checkpoint():
            saved = checkpoint_state()
            return saved is not None and 'durable-output-cursor' in saved[1].get('last_message', '')

        self.eventually(durable_semantic_checkpoint,
                        'The semantic frame was not included in the durable checkpoint.')
        durable_checkpoint, durable_state = checkpoint_state()
        state_at = durable_checkpoint.find(b'{"schema":1,')
        self.assertGreaterEqual(state_at, 0, 'Checkpoint has no schema-1 observer state.')
        self.assertIn('durable-output-cursor', durable_state['last_message'])
        durable_output = int(durable_state['output'])

        self.action(control, emit_delta_batch={'id': 'uncommitted', 'count': 3, 'bytes': 128})
        self.assertEqual(json.loads(control.readline()),
                         {'delta_frames_written': 3, 'batch': 'uncommitted'})
        expected_lines = 3
        def output_batch_written():
            if not log.exists():
                return False
            with log.open() as stream:
                return sum(json.loads(line).get('type') == 'message_update' for line in stream) >= expected_lines
        self.eventually(output_batch_written, 'The output-only frames were not written before interruption.')
        self.assertEqual(checkpoint.read_bytes(), durable_checkpoint,
                         'Output-only changes advanced the durable checkpoint.')
        self.assertEqual(int(json.loads(checkpoint.read_bytes()[state_at:])['output']), durable_output)
        self.assertGreater(log.stat().st_size, durable_output,
                           'Output-only frames did not extend beyond the durable cursor.')

        observer.kill()
        observer.wait()
        self.assertTrue(any(process['pid'] == started['pid'] for process in self.owned_processes()),
                        'The native process did not survive observer recovery.')
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        recovered = self.spawn(*self.receive_args('parent'))
        self.assertIsNone(recovered.poll(), 'Same-attempt receiver did not adopt the live native.')

        marker = 'semantic checkpoint after output replay'
        self.action(control, emit_checkpoint_message=marker)
        self.assertEqual(json.loads(control.readline()), {'checkpoint_message_written': marker})
        self.eventually(lambda: marker.encode() in log.read_bytes(),
                        'The recovered observer did not consume frames after its saved cursor.')
        def replay_checkpointed():
            saved = checkpoint_state()
            return saved is not None and marker in saved[1].get('last_message', '')

        self.eventually(replay_checkpointed,
                        'The recovered observer did not checkpoint the next semantic change.')
        replay_state = checkpoint_state()[1]
        self.assertGreaterEqual(int(replay_state['output']), log.stat().st_size,
                                'The recovered checkpoint cursor does not cover replayed output.')
        self.assert_no_start()
        with log.open() as stream:
            updates = [json.loads(line) for line in stream
                       if json.loads(line).get('type') == 'message_update']
        self.assertEqual(sum(update.get('assistantMessageEvent', {}).get('delta') == 'x' * 128
                             for update in updates), 3,
                         'Replay duplicated or lost output-only frames.')
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        self.action(control, body='Output replay completed.', hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.action(control, exit_fixture=True)
        self.assertEqual(control.readline(), b'')
        self.finish(recovered)

    def test_successful_turn_handles_complete_initial_input_without_explicit_ack(self):
        """A successful native result settles the complete initial input read
        by that turn and preserves its native conversation and custody.
        """
        for harness in ('codex', 'omp', 'muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'owed-' + harness
                ident = session + '-input'
                self.player(session, harness=harness)
                self.prepare_input(ident, session)
                first = self.spawn(*self.receive_args(session))
                control, original = self.accept(session)
                self.assertIn('[id: ' + ident + ']', original['prompt'])
                self.assertIn('read the complete body with baton read ' + ident, original['prompt'])
                with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                    attempt, = database.execute('SELECT id FROM executions WHERE session=?',
                                                (session,)).fetchone()
                directory = pathlib.Path(self.execution(session)[2])
                self.action(control, read=[ident], ack=False, complete_task=False)
                self.finish_without_start(first)
                self.assertEqual(self.coord('inbox', session), [])
                self.assertTrue(read_recorded(self.db, ident))
                with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                    read = database.execute(
                        'SELECT attempt,native FROM message_reads WHERE message=? AND recipient=?',
                        (ident, session)).fetchall()
                self.assertEqual(read, [(attempt, original['native'])])
                turns = self.coord('turns', session)
                self.assertEqual(len(turns), 1)
                self.assertEqual(turns[0]['reportBody'], 'native review complete')
                self.assertEqual(self.coord('player', session)['native'], original['native'])
                self.assertTrue((directory / 'acknowledged').exists())
                self.assert_no_start()

    def test_failed_continuation_retains_queued_guidance_for_retry(self):
        """Accepted steering remains owed through a provider failure, and the
        same actor handles it during an explicit retry.
        """
        self.player(harness='omp')
        self.prepare_input('original', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, original = self.accept('parent')
        self.assertIn('[id: original]', original['prompt'])
        self.message('owed', 'parent', 'Guidance queued after the original prompt.')
        self.assertNotIn('[id: owed]', original['prompt'])
        self.action(control, ack=False, complete_task=False)
        continued, resumed = self.accept_or_child_exit(
            first, 'successful turn did not continue the newly queued input')
        self.assertEqual(resumed['native'], original['native'])
        self.assertIn('[id: owed]', resumed['prompt'])
        self.assertNotIn('[id: original]', resumed['prompt'])
        self.assertTrue(read_recorded(self.db, 'original'))
        self.action(continued, read_steer=True, check_steer_read=True)
        accepted = json.loads(continued.readline())['steer_received']
        self.assertEqual(accepted['id'], 'owed')
        marker = 'steer accepted before provider failure'
        self.action(continued, progress=marker)
        self.assertEqual(json.loads(continued.readline()), {'progress_written': marker})
        self.eventually(lambda: marker in self.output_log('parent').read_text(),
                        'the observer did not read past the accepted steer')
        self.assertFalse(read_recorded(self.db, 'owed'))
        self.action(continued, fail=True, ack=False)
        self.finish(first, ok=False)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])
        self.assertFalse(read_recorded(self.db, 'owed'))
        self.assertEqual(len(self.coord('turns', 'parent')), 2)
        self.assert_no_start()
        retry = self.spawn(*self.receive_args('parent'))
        retried, replay = self.accept('parent')
        self.assertEqual(replay['native'], original['native'])
        self.assertIn('[id: owed]', replay['prompt'])
        self.action(retried, body='Original guidance handled after provider recovery.')
        self.finish(retry)
        self.assertTrue(read_recorded(self.db, 'owed'))
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(len(self.coord('turns', 'parent')), 3)
        self.assert_no_start()

    def test_concurrent_sends_preserve_both_inputs_and_start_one_continuation(self):
        """Two arrivals against one live session are both carried by a single continuation
        turn, and no third turn or second native process appears."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.message('second', 'parent')
        self.message('third', 'parent')
        self.assert_receive_has_no_attempt(self.coord(*self.receive_args('parent')))
        self.assert_no_start()
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: second]', next_turn['prompt'])
        self.assertIn('[id: third]', next_turn['prompt'])
        self.action(control2)
        self.finish(first)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 2)
        self.assertEqual(self.coord('inbox', 'parent'), [])


    def inject(self, ident, recipient, kind='guidance', body='Injected input.'):
        with sqlite3.connect(str(self.db)) as database:
            database.execute('INSERT INTO messages(id, sender, recipient, kind, body) VALUES (?, ?, ?, ?, ?)',
                             (ident, 'root', recipient, kind, body))

    def test_input_behind_the_live_owner_is_woken_when_the_owner_exits(self):
        """A row inserted behind the live turn's cursor is never carried by that turn, and
        the wake driver hands it to a subsequent turn once the owner exits, once."""
        self.player()
        self.connect('parent')
        delivery = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'Carried input.')
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        self.inject('late', 'parent')
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: late]', next_turn['prompt'])
        self.action(control2)
        self.finish(delivery)
        self.shutdown_idle_database_owner('The input behind the live owner did not settle.', reject_start=True)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 2)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.claims('parent'), [])


    def explicit_native_endpoint(self, session='root'):
        wrapper = self.directory / 'explicit receiver.py'
        launches = self.directory / 'explicit-receiver-launches.jsonl'
        wrapper.write_text('import json,os,pathlib,subprocess,sys\n'
                           f'config=json.loads(pathlib.Path({str(self.directory / "fixture.json")!r}).read_text())\n'
                           f'with pathlib.Path({str(launches)!r}).open("a") as output:\n'
                           ' output.write(json.dumps({"message":sys.argv[-1],"pid":os.getpid(),'
                           '"parent":subprocess.check_output(["ps","-p",str(os.getppid()),'
                           '"-o","command="],text=True).strip()})+"\\n")\n'
                           f'argv=[config["exe"],config["db"],*{self.receive_args(session)[:-1]!r},sys.argv[-1]]\n'
                           'os.execv(argv[0],argv)\n')
        self.coord('connect', session, self.coord('player', session)['native'],
                   json.dumps([sys.executable, str(wrapper)]))
        return launches

    def explicit_running_attempt(self, native):
        def running():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
                return database.execute(
                    "SELECT e.id,e.directory FROM executions e JOIN sessions s ON s.id=e.session "
                    "WHERE e.session='root' AND e.phase='running' AND s.native=? "
                    "AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session)",
                    (native,)).fetchone()
        attempt, directory = self.eventually(running, 'The explicit receiver did not bind its native attempt.')
        return attempt, pathlib.Path(directory)

    def explicit_endpoint_launch(self, child, launches, ident):
        def launched():
            lines = launches.read_bytes().split(b'\n')[:-1] if launches.exists() else []
            launch = next((row for row in map(json.loads, lines) if row['message'] == ident), None)
            if launch:
                return launch
            owner = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
            producers = [process for process in self.owned_processes() if process['command'] != owner]
            if child.poll() is not None and not producers:
                stdout, stderr = self.child_communication(child)
                self.fail(f'Explicit endpoint exited before launch: {child.returncode}; {stdout}{stderr}')
            return None
        return self.eventually(launched, 'The explicit endpoint did not record its launch.')

    def explicit_native_admission(self, child, launches, ident, body):
        launch = self.explicit_endpoint_launch(child, launches, ident)
        self.assertEqual(launch['parent'],
                         f'{EXE.resolve()} --dispatch-message {self.db.resolve()} {ident}')
        stdout, stderr = self.finish(child)
        control, started = self.accept_detached('root', stdout + stderr)
        self.assertIn('[id: ' + ident + ']', started['prompt'])
        self.assertIn(body, started['prompt'])
        self.assertEqual(started['native'], 'native-root')
        self.assertEqual(self.coord('delivery', ident)['body'], body)
        self.assertIsNone(self.coord('delivery', ident)['receipt'])
        attempt, directory = self.explicit_running_attempt(started['native'])
        self.assertFalse((directory / 'status').exists(), 'native completed before its controlled release')
        self.eventually(lambda: self.complete_owned_read(ident, attempt, started['native']),
                        'The native initial prompt was not recorded as a complete owned read.')
        return control, started, attempt, directory, stdout

    def complete_owned_read(self, ident, attempt, native):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
            return database.execute(
                'SELECT 1 FROM message_reads WHERE message=? AND recipient=? AND attempt=? '
                'AND native=? AND handled IS NULL', (ident, 'root', attempt, native)).fetchone()

    def settle_explicit_native(self, control, ident, attempt, directory, native):
        self.action(control, ack=False, complete_task=False)
        self.assertEqual(control.readline(), b'')
        self.eventually(lambda: self.execution('root')[:2] == ('exited', 'exit 0')
                        and (directory / 'acknowledged').exists(),
                        'The detached delivery did not retain its completed native wait.')
        receipt = 'native-turn:' + attempt
        self.assertEqual(self.coord('delivery', ident)['receipt'], receipt)
        with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
            self.assertEqual(database.execute(
                'SELECT attempt,native,handled FROM message_reads WHERE message=? AND recipient=?',
                (ident, 'root')).fetchall(), [(attempt, native, receipt)])
        self.assertEqual((directory / 'status').read_text(), '0\n')
        self.assertTrue((directory / 'released').exists())
        self.shutdown_idle_database_owner('Explicit endpoint delivery did not settle.', reject_start=True)

    def test_ordinary_explicit_endpoint_accepts_cli_input_before_native_completion(self):
        self.player(harness='claude-code')
        self.coord('connect', 'parent', 'native-parent', json.dumps(['/usr/bin/true']))
        launches = self.explicit_native_endpoint()
        for verb in ('message', 'message-file', 'report', 'report-file', 'ask', 'ask-file'):
            ident = 'held-' + verb
            body = f'{verb}: full input λ🙂 with path /tmp/work tree/資料\nSecond line.\n'
            argument = body
            if verb.endswith('-file'):
                argument = self.directory / ('authored ' + verb + ' λ.txt')
                argument.write_text(body)
            args = [verb, ident, 'parent']
            if verb in ('message', 'message-file'):
                args += ['root', 'report']
            child = self.spawn(*args, argument)
            control, started, attempt, directory, stdout = self.explicit_native_admission(
                child, launches, ident, body)
            admitted = json.loads(stdout)
            self.assertEqual((admitted['id'], admitted['sender'], admitted['recipient'],
                              admitted['kind'], admitted['body'], admitted['receipt']),
                             (ident, 'parent', 'root', 'question' if verb.startswith('ask')
                              else 'report', body, None))
            self.settle_explicit_native(control, ident, attempt, directory, started['native'])

    def test_ordinary_explicit_endpoint_accepts_mcp_input_before_native_completion(self):
        self.player(harness='claude-code')
        self.coord('connect', 'parent', 'native-parent', json.dumps(['/usr/bin/true']))
        launches = self.explicit_native_endpoint()
        script = ROOT / 'bend2/scripts/mcp-conductor.mjs'
        for action in ('send', 'report', 'ask'):
            ident = 'held-mcp-' + action
            body = f'{action}: complete MCP input λ🙂\nPath /tmp/work tree/資料\n'
            arguments = ['--id', ident, '--text', body]
            if action == 'send':
                arguments = ['root', '--kind', 'report', *arguments]
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                 'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                            'clientInfo': {'name': 'ordinary-delivery-fixture', 'version': '0'}}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                 'params': {'name': 'baton2_action',
                            'arguments': {'action': action, 'arguments': arguments}}},
            ]
            child = subprocess.Popen(['node', str(script), str(self.db), str(EXE),
                                      '--session', 'parent'], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.children.append(child)
            child.stdin.write(''.join(json.dumps(request) + '\n' for request in requests))
            child.stdin.close()
            child.stdin = None
            control, started, attempt, directory, stdout = self.explicit_native_admission(
                child, launches, ident, body)
            replies = {reply['id']: reply for reply in map(json.loads, stdout.splitlines())
                       if 'id' in reply}
            self.assertNotIn('error', replies[1])
            self.assertNotIn('error', replies[2])
            result = replies[2]['result']
            self.assertFalse(result.get('isError', False), result)
            answer, = json.loads(result['content'][0]['text'])
            if action == 'send':
                self.assertEqual(answer['admission']['status'], 'admitted')
                self.assertEqual(answer['wake']['status'], 'accepted')
                self.assertEqual(answer['receiptStatus'], 'pending')
                admitted = answer['delivery']
            else:
                self.assertEqual(answer['status'], 'completed')
                self.assertEqual(answer['waitStatus'], 'exit 0')
                self.assertEqual(answer['cause'], '')
                admitted = json.loads(answer['stdout'])
            self.assertEqual((admitted['id'], admitted['sender'], admitted['recipient'],
                              admitted['kind'], admitted['body'], admitted['receipt']),
                             (ident, 'parent', 'root', 'question' if action == 'ask'
                              else 'report', body, None))
            self.settle_explicit_native(control, ident, attempt, directory, started['native'])

    def test_explicit_endpoint_failure_retains_input_for_attached_public_resume(self):
        self.player(harness='claude-code')
        launches = self.explicit_native_endpoint()
        self.coord('attach', 'other-root', 'fixture', '', json.dumps(['/usr/bin/true']))
        self.coord('role', 'other-root', 'principal-conductor')
        refused = self.coord('message', 'denied-held', 'parent', 'other-root', 'report',
                             'A refused route must not launch an endpoint.', ok=False)
        self.assertEqual(refused.returncode, 2, refused.stdout + refused.stderr)
        self.assertIn('message-route-denied', refused.stderr)
        self.assertFalse(launches.exists())
        with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
            self.assertIsNone(database.execute("SELECT 1 FROM messages WHERE id='denied-held'").fetchone())
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.directory / 'missing endpoint')]))
        body = 'Retain complete work λ🙂\nRecover it through the recorded root receiver.\n'
        accepted = self.coord('report', 'failed-explicit-launch', 'parent', body)
        self.assertEqual((accepted['body'], accepted['receipt']), (body, None))
        self.shutdown_idle_database_owner('Failed explicit endpoint did not finish its detached handoff.')
        diagnostic = pathlib.Path(str(self.db) + '.dispatch-' +
                                  'failed-explicit-launch'.encode().hex() + '.stderr')
        self.assertIn('Message committed; session delivery failed', diagnostic.read_text())
        self.assertIn('retry delivery from the pending inbox', diagnostic.read_text())
        self.assertIn('delivery error', pathlib.Path(str(self.db) + '.root.log').read_text())
        self.assertEqual(self.coord('delivery', 'failed-explicit-launch')['body'], body)
        self.assertIsNone(self.coord('delivery', 'failed-explicit-launch')['receipt'])
        self.assertFalse(launches.exists())
        self.explicit_native_endpoint()
        recovery = self.spawn('resume', 'root')
        control, started = self.accept_child(recovery, 'root')
        self.assertIsNone(recovery.poll(), 'explicit resume returned before its native completed')
        self.assertIn(body, started['prompt'])
        self.assertIn('[id: failed-explicit-launch]', started['prompt'])
        self.assertIsNone(self.coord('delivery', 'failed-explicit-launch')['receipt'])
        attempt, directory = self.explicit_running_attempt(started['native'])
        self.eventually(lambda: self.complete_owned_read('failed-explicit-launch', attempt, started['native']),
                        'The resumed receiver did not record its complete owned input.')
        self.action(control, ack=False, complete_task=False)
        self.assertEqual(control.readline(), b'')
        output, _ = self.finish(recovery)
        answer = json.loads(output)
        self.assertEqual(answer['session'], 'root')
        self.assertEqual(answer['message'], 'failed-explicit-launch')
        self.assertEqual(answer['delivery']['receipt'], 'native-turn:' + attempt)
        directory = pathlib.Path(directory)
        self.assertEqual((directory / 'status').read_text(), '0\n')
        self.assertTrue((directory / 'acknowledged').exists())
        self.assertIn('session delivery failed', diagnostic.read_text())
        self.shutdown_idle_database_owner('Public resume did not finish its attached native delivery.')

    def test_stopped_report_handoff_accepts_before_parent_native_completion(self):
        self.player(harness='claude-code')
        launches = self.explicit_native_endpoint()
        self.coord('stop', 'parent', 'held-parent-stop', 'Retain this stopped receiver.')
        ident = 'report-to-stopped-parent'
        body = 'Retained result for the stopped parent λ🙂\nComplete source material.\n'
        sender = self.spawn('message', ident, 'root', 'parent', 'report', body)
        forwarded = 'stopped-input:' + ident.encode().hex()
        launch = self.explicit_endpoint_launch(sender, launches, forwarded)
        self.assertEqual(launch['parent'],
                         f'{EXE.resolve()} --dispatch-message {self.db.resolve()} {ident}')
        stdout, stderr = self.finish(sender)
        control, started = self.accept_detached('root', stdout + stderr)
        forwarded_body = self.coord('delivery', forwarded)['body']
        self.assertIn(forwarded_body, started['prompt'])
        handoff = json.loads(forwarded_body)
        self.assertEqual((handoff['originalMessage'], handoff['originalBody'], handoff['retainedWorkSession']),
                         (ident, body, 'root'))
        self.assertIsNone(self.coord('delivery', ident)['receipt'])
        self.assertEqual(self.coord('session', 'parent')['stop']['id'], 'held-parent-stop')
        attempt, directory = self.explicit_running_attempt(started['native'])
        self.assertFalse((directory / 'status').exists())
        self.eventually(lambda: self.complete_owned_read(forwarded, attempt, started['native']),
                        'Forwarded report did not become a complete owned read.')
        self.settle_explicit_native(control, forwarded, attempt, directory, started['native'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=rw', uri=True) as database:
            self.assertEqual(database.execute('SELECT body,receipt FROM messages WHERE id=?',
                                              (ident,)).fetchone(), (body, None))


if __name__ == '__main__':
    unittest.main()
