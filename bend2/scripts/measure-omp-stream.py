#!/usr/bin/env python3
"""Measure native receiver CPU for idle, small, and cumulative OMP frames.

Run each executable separately, using a fresh output directory. The fixture uses
no provider. A get_state response marks completion of each batch. CPU time comes
from ps for the receiver PID and excludes the fixture process. Raw results and
retained frames remain in the output directory.
"""
import argparse
import hashlib
import json
import pathlib
import socket
import sqlite3
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]

FIXTURE = r'''import json,pathlib,socket,sys
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'config.json').read_text())
state=json.loads(sys.stdin.readline())
prompt=json.loads(sys.stdin.readline())
def output(value):
    value=(json.dumps(value,separators=(',',':'))+'\n').encode()
    sys.stdout.buffer.write(value)
    sys.stdout.buffer.flush()
    return len(value)
def marker(value):
    output({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':value}})
marker('native-ready')
client=socket.create_connection(('127.0.0.1',config['port']))
stream=client.makefile('rwb',buffering=0)
stream.write(b'{"ready":true}\n')
while True:
    action=json.loads(stream.readline())
    if action['kind']=='finish':
        output({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'complete'}]}]})
        sys.stdin.read()
        break
    if action['kind']=='raw':
        total=0
        for line in action['lines']:
            data=(line+'\n').encode()
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            total+=len(data)
        marker(action['marker'])
        stream.write((json.dumps({'bytes':total,'frames':len(action['lines'])})+'\n').encode())
        continue
    count=action['count']
    total=0
    for i in range(count):
        size=action['step']*(i+1) if action['kind']=='cumulative' else action['step']
        fragment='model text with apostrophe \' and escaped newline\n '
        text=(fragment*(size//len(fragment)+1))[:size]
        total+=output({'type':'message_update','message':{'role':'assistant','content':[{'type':'text','text':text}]},'assistantMessageEvent':{'type':'text_delta','contentIndex':0,'delta':'more text'}})
    marker(action['marker'])
    stream.write((json.dumps({'bytes':total,'frames':count})+'\n').encode())
stream.close()
client.close()
'''

def cpu(pid):
    value=subprocess.check_output(['ps','-p',str(pid),'-o','time='],text=True).strip()
    parts=value.split(':')
    return sum(float(part)*60**i for i,part in enumerate(reversed(parts)))

def positive(value):
    number=int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError('must be positive')
    return number

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True,help='new evidence directory')
    parser.add_argument('--label',default='measured')
    parser.add_argument('--source-revision',help='revision used to build the executable; recorded as supplied')
    parser.add_argument('--count',type=positive,default=1000)
    parser.add_argument('--step',type=positive,default=51,help='cumulative snapshot growth in characters per frame')
    args=parser.parse_args()
    exe=args.exe.resolve()
    if not exe.is_file():
        parser.error(f'executable does not exist: {exe}')
    directory=args.output.resolve()
    directory.mkdir(parents=True)
    db=directory/'state.db'
    log=directory/'native.jsonl'
    fixture=directory/'fixture'
    fixture.write_text('#!'+sys.executable+'\n'+FIXTURE)
    fixture.chmod(0o755)
    server=socket.socket()
    server.bind(('127.0.0.1',0))
    server.listen()
    (directory/'config.json').write_text(json.dumps({'port':server.getsockname()[1]}))
    def coord(*values):
        return subprocess.run([str(exe),str(db),*map(str,values)],check=True,capture_output=True,text=True)
    coord('attach','root','omp','','')
    coord('role', 'root', 'principal-conductor')
    coord('attach','operator','terminal','','')
    coord('role','operator','operator')
    coord('message','initial','operator','root','task','Run the controlled probe.')
    stdout=(directory/'stdout.log').open('w')
    stderr=(directory/'stderr.log').open('w')
    child=subprocess.Popen([str(exe),str(db),'receive','root',str(fixture),'fixture','low',str(directory),str(log),''],stdout=stdout,stderr=stderr)
    connection,_=server.accept()
    stream=connection.makefile('rwb',buffering=0)
    assert json.loads(stream.readline())['ready']
    def wait_marker(marker):
        while True:
            with sqlite3.connect(db) as conn:
                value=conn.execute("select native from sessions where id='root'").fetchone()[0]
            if value==marker:
                return
            if child.poll() is not None:
                raise RuntimeError('Native receiver exited early')
            time.sleep(.01)
    wait_marker('native-ready')
    coord('ack','initial','root','probe input accepted')
    measures=[]
    start_cpu=cpu(child.pid)
    start=time.monotonic()
    time.sleep(3)
    measures.append({'kind':'silent','wall_seconds':time.monotonic()-start,'native_cpu_seconds':cpu(child.pid)-start_cpu,'bytes':0,'frames':0})
    for kind,step in [('small',128),('cumulative',args.step)]:
        before=log.stat().st_size
        marker='native-'+kind
        action={'kind':kind,'count':args.count,'step':step,'marker':marker}
        start_cpu=cpu(child.pid)
        start=time.monotonic()
        stream.write((json.dumps(action)+'\n').encode())
        emitted=json.loads(stream.readline())
        wait_marker(marker)
        elapsed=time.monotonic()-start
        consumed=cpu(child.pid)-start_cpu
        row={'kind':kind,'wall_seconds':elapsed,'native_cpu_seconds':consumed,'retained_bytes':log.stat().st_size-before,**emitted}
        measures.append(row)
        print(json.dumps(row),flush=True)
    retained=[
        '{"type":null,"probe":"null"}',
        '{"type":123,"probe":"number"}',
        '{"type":["message_update"],"probe":"array"}',
        '{"probe":"message_update"}',
        '{"type":"message_update\\u0000suffix","probe":"nul suffix"}',
        '{invalid JSON containing message_update}',
    ]
    omitted=[
        '  {"message":{"content":"large prefix"},"type":"message_update"}  ',
        '{"typ\\u0065":"message_\\u0075pdate","probe":"escaped"}',
    ]
    action={'kind':'raw','marker':'native-semantics','lines':retained+omitted}
    stream.write((json.dumps(action)+'\n').encode())
    emitted=json.loads(stream.readline())
    wait_marker('native-semantics')
    saved=log.read_text().splitlines()
    semantics={'missing_retained':[line for line in retained if line not in saved], 'unexpected_retained':[line for line in omitted if line in saved],**emitted}
    stream.write(b'{"kind":"finish"}\n')
    child.wait()
    assert child.returncode==0
    stream.close()
    connection.close()
    server.close()
    stdout.close()
    stderr.close()
    evidence={'exe':str(exe),'exe_sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),
              'exe_source_revision_supplied':args.source_revision,'pid':child.pid,
              'driver_source_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'parameters':vars(args)|{'exe':str(exe),'output':str(directory)},
              'measurements':measures,'semantics':semantics,'returncode':child.returncode,
              'retained_log_bytes':log.stat().st_size}
    (directory/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,indent=2),flush=True)
    assert not semantics['missing_retained'], semantics
    assert not semantics['unexpected_retained'], semantics

if __name__=='__main__':
    main()
