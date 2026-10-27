"""Qualify the installed DSH worker bridge against the production native pair.

BATON2_NATIVE_DELIVERY_PREFIX selects the staged installation. The DSH process
is controlled by the test and uses a private database without a provider.
"""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest


SPEC = importlib.util.spec_from_file_location('native_lifecycle', Path(__file__).with_name('native-hook-lifecycle.py'))
LIFECYCLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIFECYCLE)
AGENT = r'''import json, os, pathlib, sqlite3, subprocess, sys
config=json.loads(pathlib.Path(sys.argv[0]).with_suffix('.json').read_text())
assert 'Worker context qualification.' in sys.stdin.read()
print(json.dumps({'type':'session','sessionId':config['native'],'cwd':os.getcwd()}),flush=True)
coordinator=os.environ['BATON_COORDINATOR']
database=os.environ['BATON_DATABASE']
def context(changed=None):
    result=subprocess.run([coordinator,database,'agent-worker-context'],env={**os.environ,**(changed or {})},capture_output=True,text=True)
    return {'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
current=context()
assert current['code']==0,current
value=json.loads(current['stdout'])
assert value['session']=='worker' and value['native']==config['native'] and value['harness']=='dsh',value
assert value['directory']==os.environ['BATON_ATTEMPT_DIRECTORY'] and value['workspace']==os.getcwd(),value
other_database=pathlib.Path(config['evidence']).with_suffix('.other-db')
other_database.touch()
for changed in [{'BATON_SESSION':'other-worker'},{'BATON_ATTEMPT_DIRECTORY':os.getcwd()},
                {'BATON_DATABASE':str(other_database)}]:
    assert context(changed)['code']!=0,changed
with sqlite3.connect(database) as db:
    db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('worker-detail','parent','worker','guidance',?)",(config['body'],))
requests=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-03-26'}},
          {'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'read','arguments':{'ids':['worker-detail']}}},
          {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'report','arguments':{'text':'Production worker report.'}}},
          {'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'completion_request','arguments':{'text':'Production worker completion evidence.'}}}]
bridge=subprocess.run([config['node'],os.environ['BATON_DSH_WORKER_BRIDGE']],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True)
assert bridge.returncode==0,(bridge.stdout,bridge.stderr)
answers=[json.loads(line) for line in bridge.stdout.splitlines()]
assert [r['id'] for r in answers]==[1,2,3,4],answers
for answer in answers:
    assert 'error' not in answer and not answer['result'].get('isError'),answer
read=json.loads(answers[1]['result']['content'][0]['text'])
assert read['status']==0,read
assert json.loads(read['stdout'])[0]['delivery']['body']==config['body'],read
with sqlite3.connect(database) as db:
    rows=db.execute("SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message='worker-detail'").fetchall()
    assert len(rows)==1 and rows[0][1:3]==('worker',config['native']) and rows[0][3] and rows[0][4] is None,rows
    db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','worker-stop','Operator stop.','stopped')")
stopped=context()
assert stopped['code']!=0,stopped
evidence={'coordinator':coordinator,'context':value,'read':rows[0],'bridge':answers,'environment':{k:os.environ[k] for k in ['BATON_DATABASE','BATON_SESSION','BATON_ATTEMPT_DIRECTORY']},'stopped':stopped}
pathlib.Path(config['evidence']).write_text(json.dumps(evidence))
print(json.dumps({'type':'final','text':'Worker qualification finished.'}),flush=True)
'''


class NativeWorkerContext(unittest.TestCase):
    setUp = LIFECYCLE.NativeHookLifecycle.setUp
    cli = LIFECYCLE.NativeHookLifecycle.cli
    shutdown = LIFECYCLE.NativeHookLifecycle.shutdown

    def test_worker_admission_reads_and_reports_through_the_installed_pair(self):
        with sqlite3.connect(self.database) as database:
            database.execute("UPDATE sessions SET harness='dsh',model='deepseek-flash',effort='max',workspace=?,branch='worker-branch' WHERE id='worker'", (str(self.directory),))
        agent = self.directory / 'fake-dsh'
        agent.write_text('#!' + sys.executable + '\n' + AGENT)
        agent.chmod(0o755)
        evidence_path = self.directory / 'worker-evidence.json'
        body = 'Complete DSH worker input. λ🙂\nCOMPLETE-TAIL'
        config = {'native': LIFECYCLE.NATIVE, 'body': body, 'evidence': str(evidence_path),
                  'node': os.environ.get('NODE', 'node')}
        agent.with_suffix('.json').write_text(json.dumps(config))
        self.cli('turn-text', 'worker', 'worker-turn', agent, 'deepseek-flash', 'max',
                 self.directory, 'Worker context qualification.', self.directory / 'native.jsonl', LIFECYCLE.NATIVE)
        evidence = json.loads(evidence_path.read_text())
        self.assertEqual(evidence['coordinator'], str(self.focused))
        self.assertEqual(evidence['context']['model'], 'deepseek-flash')
        with sqlite3.connect(self.database) as database:
            messages = database.execute("SELECT recipient,kind,body FROM messages WHERE sender='worker'").fetchall()
            self.assertIn(('parent', 'report', 'Production worker report.'), messages)
            self.assertIn(('parent', 'completion-request', 'Production worker completion evidence.'), messages)
            self.assertEqual(database.execute("SELECT body,receipt FROM messages WHERE id='worker-detail'").fetchone(), (body, None))
            self.assertEqual(database.execute("SELECT id FROM session_stops WHERE session='worker'").fetchall(), [('worker-stop',)])
            self.assertEqual(database.execute("SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message='worker-detail'").fetchall(), [tuple(evidence['read'])])
        environment = {**self.environment, **evidence['environment']}
        for executable in (self.focused, self.full):
            result = subprocess.run([str(executable), str(self.database), 'agent-worker-context'],
                                    env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
