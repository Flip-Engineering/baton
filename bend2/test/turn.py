"""Integration checks with a controlled native-process protocol fixture."""
import json
import hashlib
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

class Turn(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd=pathlib.Path(self.temp.name)
        self.db=self.cwd/'state.db'
        self.task=self.cwd/'task.txt'
        self.task.write_text('Useful task with "quotes", unicode λ🙂,\nand multiple lines.')
        self.log=self.cwd/'turn.jsonl'
        self.player=self.cwd/'fixture-harness'
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
line=sys.stdin.readline()
prompt=json.loads(line)["message"]["content"]
pathlib.Path("received.txt").write_text(prompt)
print(json.dumps({"type":"system","subtype":"init","session_id":"native-fixture","model":"actual-model"}))
print(json.dumps({"type":"assistant","message":{"content":"text containing \\\"type\\\":\\\"result\\\""}}))
print(json.dumps({"type":"result","result":"Task recorded.","session_id":"native-fixture","is_error":False}))
''')
        self.player.chmod(0o700)
        self.repo = self.cwd / 'repository'
        self.repo.mkdir()
        self.checkouts = self.cwd / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Turn fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach','root','native-fixture','root-session','root-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.register('worker','root','claude-code','model','high',str(self.cwd),'branch','base')

    def register(self, name, parent, harness, model, effort, workspace=None, branch=None, base=None):
        """Recruit the session into this suite's fixture repository."""
        return self.call('recruit', name, parent, harness, model, effort, str(self.repo),
                          branch or (name + '-branch'), str(self.checkouts / name), self.base)

    def tearDown(self): self.temp.cleanup()

    def call(self,*args):
        p=subprocess.run([str(EXE),str(self.db),*args],text=True,capture_output=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr)
        return p.stdout

    def generation(self,turn_id):
        return self.cwd / (self.log.name + '.attempt-' + turn_id)

    def run_turn(self,cmd=None,turn_id='turn-1'):
        return self.call('turn','worker',turn_id,str(cmd or self.player),'model','high',str(self.cwd),str(self.task),str(self.log),'')

    def test_native_process_output_becomes_parent_report(self):
        self.run_turn()
        inbox=json.loads(self.call('inbox','root'))
        self.assertEqual([m['body'] for m in inbox],['Task recorded.'])
        self.assertEqual((self.cwd/'received.txt').read_text(),self.task.read_text())
        self.assertEqual(json.loads(self.call('player','worker'))['native'],'native-fixture')
        self.assertEqual(len(self.generation('turn-1').read_text().splitlines()),3)

    def test_completed_turn_retry_does_not_start_another_process(self):
        self.run_turn()
        before=self.generation('turn-1').read_text()
        self.player.unlink()
        self.run_turn()
        self.assertEqual(self.generation('turn-1').read_text(),before)
        self.assertEqual(len(json.loads(self.call('inbox','root'))),1)

    def test_two_real_turns_keep_generations_for_one_output_log(self):
        self.run_turn(turn_id='generation-one')
        first = self.generation('generation-one')
        first_bytes = first.read_bytes()
        self.run_turn(turn_id='generation-two')
        second = self.generation('generation-two')
        self.assertTrue(first.is_file())
        self.assertEqual(first.read_bytes(), first_bytes)
        self.assertIn(b'Task recorded.', first_bytes)
        self.assertIn(b'Task recorded.', second.read_bytes())
        with sqlite3.connect(self.db) as connection:
            rows = connection.execute('SELECT attempt,log,base FROM log_generations ORDER BY attempt').fetchall()
        self.assertEqual(rows, [
            ('generation-one', str(first), str(self.log)),
            ('generation-two', str(second), str(self.log)),
        ])

    def test_turn_id_owned_by_another_player_does_not_replay_its_report(self):
        self.register('other','root','claude-code','model','high',str(self.cwd),'other-branch','base')
        self.call('report','turn-1','other','Other worker report')
        p=subprocess.run([str(EXE),str(self.db),'turn','worker','turn-1',str(self.player),'model','high',str(self.cwd),str(self.task),str(self.log),''],text=True,capture_output=True)
        self.assertNotEqual(p.returncode,0)
        self.assertFalse((self.cwd/'received.txt').exists())
        self.assertEqual(json.loads(self.call('delivery','turn-1'))['sender'],'other')

    def test_startup_output_and_large_input_are_drained_concurrently(self):
        self.task.write_text('large task '*40000)
        self.player.write_text('#!'+sys.executable+'\n'+'import json,sys\nprint(json.dumps({"type":"system","subtype":"init","session_id":"s","detail":"x"*400000}),flush=True)\nline=sys.stdin.readline()\nprompt=json.loads(line)["message"]["content"]\nprint(json.dumps({"type":"result","result":str(len(prompt))}))\n')
        self.run_turn()
        self.assertEqual(json.loads(self.call('inbox','root'))[0]['body'],str(len(self.task.read_text())))

    def test_start_failure_reports_to_parent(self):
        self.run_turn(self.cwd/'missing-program')
        inbox=json.loads(self.call('inbox','root'))
        self.assertIn('could not start',inbox[0]['body'])
        self.assertEqual(inbox[0]['recipient'],'root')

    def test_exit_without_result_reports_failure_and_keeps_logs(self):
        self.player.write_text('#!'+sys.executable+'\nimport sys;sys.stdin.read();print("unframed startup failure");sys.stderr.write("diagnosis");raise SystemExit(7)\n')
        self.run_turn()
        inbox=json.loads(self.call('inbox','root'))
        self.assertTrue(any('without a native result' in m['body'] for m in inbox))
        self.assertTrue(any('exit 7' in m['body'] for m in inbox))
        self.assertEqual(self.generation('turn-1').read_text(),'unframed startup failure\n')
        self.assertEqual(pathlib.Path(str(self.generation('turn-1'))+'.stderr').read_text(),'diagnosis')

    def test_omp_prompt_session_route_and_terminal_report(self):
        self.register('omp-worker','root','omp','requested-model','high',str(self.cwd),'omp-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
request=json.loads(sys.stdin.readline())
assert request['type']=='set_event_filter' and request['events'] is None and request['messageUpdates']=='delta'
state=json.loads(sys.stdin.readline())
assert state['type']=='get_state'
prompt=json.loads(sys.stdin.readline())['message']
pathlib.Path("received.txt").write_text(prompt)
pathlib.Path("argv.json").write_text(json.dumps(sys.argv))
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-native','model':{'provider':'provider','id':'actual-model'}}}),flush=True)
print(json.dumps({'type':'message_update','assistantMessageEvent':{'type':'text_delta','delta':prompt},'message':{'role':'assistant','content':[{'type':'text','text':prompt}]}}))
print(json.dumps({'type':'tool_execution_update','toolCallId':'tool-1','partialResult':{'content':[{'type':'text','text':prompt}]}}))
print(json.dumps({'type':'message_start','message':{'role':'assistant','content':[]}}))
print(json.dumps({"type":"message_end","message":{"role":"assistant","provider":"provider","model":"actual-model","content":[]}}))
print(json.dumps({"type":"agent_end","isTerminal":False,"messages":[]}))
print(json.dumps({"type":"agent_end","isTerminal":True,"messages":[{"role":"assistant","content":[{"type":"text","text":"First answer"}]},{"role":"assistant","content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"Full final answer λ"}]}]}),flush=True)
assert sys.stdin.read()==''
''')
        self.call('turn','omp-worker','omp-turn',str(self.player),'requested-model','high',str(self.cwd),str(self.task),str(self.log),'')
        self.assertEqual((self.cwd/'received.txt').read_text(),self.task.read_text())
        self.assertEqual(json.loads(self.call('inbox','root'))[0]['body'],'Full final answer λ')
        session=json.loads(self.call('player','omp-worker'))
        self.assertEqual(session['native'],'omp-native')
        self.assertEqual(session['observedModel'],'provider/actual-model')
        self.assertEqual(session['model'],'requested-model')
        event_lines=self.generation('omp-turn').read_text().splitlines()
        frames=[json.loads(line) for line in event_lines]
        self.assertEqual([f for f in frames if f.get('type')=='message_update'], [])
        self.assertEqual([f['partialResult']['content'][0]['text'] for f in frames if f.get('type')=='tool_execution_update'], [self.task.read_text()])
        self.assertEqual([f['type'] for f in frames], ['response','message_end','agent_end','agent_end','tool_execution_update','baton_event_filter'])
        with sqlite3.connect(self.db) as connection:
            projection=connection.execute('SELECT event_sha256,projection,artifact_refs FROM log_terminal_observations WHERE session=? AND turn_id=?',('omp-worker','omp-turn')).fetchone()
            stored_event=connection.execute('SELECT event FROM turns WHERE id=?',('omp-turn',)).fetchone()[0]
        self.assertIsNotNone(projection)
        digest,projection_json,artifact_json=projection
        self.assertEqual(digest,hashlib.sha256(stored_event.encode()).hexdigest())
        summary=json.loads(projection_json)
        self.assertEqual(summary['messageCount'],2)
        self.assertEqual(summary['roleCharacters']['assistant'],len('First answerFull final answer λ'))
        self.assertEqual(summary['lastMessageCharacters'],len('Full final answer λ'))
        artifacts=json.loads(artifact_json)
        self.assertEqual(artifacts['outputLog'],str(self.generation('omp-turn')))
        self.assertEqual(artifacts['providerSession'],'omp-native')
        args=json.loads((self.cwd/'argv.json').read_text())
        self.assertEqual(args[args.index('--mode')+1],'rpc')
        self.assertEqual(args[args.index('--session-dir')+1],str(self.db)+'.sessions')
        self.call('turn','omp-worker','omp-turn-2',str(self.player),'requested-model','high',str(self.cwd),str(self.task),str(self.cwd/'second.jsonl'),'omp-native')
        resumed=json.loads((self.cwd/'argv.json').read_text())
        self.assertEqual(resumed[resumed.index('--resume')+1],'omp-native')
        self.assertEqual(resumed[resumed.index('--session-dir')+1],args[args.index('--session-dir')+1])

    def test_omp_frame_retention_uses_exact_json_type(self):
        self.register('omp-worker','root','omp','model','low',str(self.cwd),'omp-branch','base')
        retained = [
            '{"type":null,"probe":"null"}',
            '{"type":123,"probe":"number"}',
            '{"type":["message_update"],"probe":"array"}',
            '{"probe":"message_update"}',
            r'{"type":"message_update\u0000suffix","probe":"nul suffix"}',
            '{invalid JSON containing message_update}',
        ]
        omitted = [
            '  {"message":{"content":"prefix"},"type":"message_update"}  ',
            r'{"typ\u0065":"message_\u0075pdate","probe":"escaped"}',
        ]
        final_text = "Final answer with apostrophe ' and unicode λ🙂."
        terminal = json.dumps({'type':'agent_end','isTerminal':True,'messages':[
            {'role':'assistant','content':[{'type':'text','text':final_text}]}]})
        (self.cwd/'events.jsonl').write_text('\n'.join(retained+omitted+[terminal])+'\n')
        self.player.write_text('#!'+sys.executable+'\n'+'''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
''')
        self.call('turn','omp-worker','retained-turn',str(self.player),'model','low',str(self.cwd),str(self.task),str(self.log),'')
        note='{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual(self.generation('retained-turn').read_text().splitlines(),retained+[terminal,omitted[1],note])
        self.assertEqual(json.loads(self.call('delivery','retained-turn'))['body'],final_text)

    def test_omp_empty_terminal_envelope_delivers_streamed_trial_report(self):
        # Actual issue-608-reclaim native output, 2026-09-27 cutover trial.
        events = (ROOT / 'bend2/test/fixtures/issue608-omp-report.jsonl').read_text()
        final, terminal = [json.loads(line) for line in events.splitlines()]
        expected = '\n'.join(c['text'] for c in final['message']['content'] if c['type'] == 'text')
        self.assertEqual(terminal['messages'], [])
        self.register('omp-worker','root','omp','deepseek/deepseek-flash','low',str(self.cwd),'omp-branch','base')
        (self.cwd / 'events.jsonl').write_text(events)
        receiver = self.cwd / 'root-receiver.py'
        receiver.write_text('import json,pathlib,sqlite3,sys\n'
                            'db, output, report = sys.argv[1:]\n'
                            'with sqlite3.connect(db) as connection:\n'
                            ' body = connection.execute("SELECT body FROM messages WHERE id=?", (report,)).fetchone()[0]\n'
                            'with pathlib.Path(output).open("a") as stream: stream.write(json.dumps(body)+"\\n")\n')
        received = self.cwd / 'root-reports.jsonl'
        endpoint = json.dumps([sys.executable, str(receiver), str(self.db), str(received)])
        self.call('attach','root','native-fixture','root-session',endpoint)
        self.player.write_text('#!'+sys.executable+'\n'+'''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
''')
        self.call('turn','omp-worker','trial-report',str(self.player),'deepseek/deepseek-flash','low',str(self.cwd),str(self.task),str(self.log),'')
        self.assertEqual(json.loads(self.call('delivery','trial-report'))['body'], expected)
        self.assertEqual(json.loads(self.call('inbox','root'))[0]['body'], expected)
        note='{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual(self.generation('trial-report').read_text().splitlines(),events.splitlines()+[note])
        self.assertEqual([json.loads(line) for line in received.read_text().splitlines()], [expected])
        self.player.unlink()
        self.call('turn','omp-worker','trial-report',str(self.player),'deepseek/deepseek-flash','low',str(self.cwd),str(self.task),str(self.log),'')
        self.assertEqual(len(json.loads(self.call('turns','omp-worker'))),1)
        self.assertEqual([json.loads(line) for line in received.read_text().splitlines()], [expected])

    def test_omp_guidance_receipt_follows_native_steer_acceptance(self):
        self.register('omp-worker','root','omp','requested-model','low',str(self.cwd),'omp-branch','base')
        body='Change focus now: report the guidance label indigo λ.'
        self.call('message','guidance-1','root','omp-worker','guidance',body)
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib,sqlite3
json.loads(sys.stdin.readline())
state=json.loads(sys.stdin.readline())
prompt=json.loads(sys.stdin.readline())
assert prompt['type']=='prompt'
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-guided','model':{'provider':'deepseek','id':'deepseek-flash'}}}),flush=True)
guide=json.loads(sys.stdin.readline())
assert guide['type']=='steer'
db=sys.argv[sys.argv.index('--session-dir')+1].removesuffix('.sessions')
with sqlite3.connect(db) as conn:
    assert conn.execute('SELECT receipt FROM messages WHERE id=?',(guide['id'],)).fetchone()[0] is None
pathlib.Path('guidance.json').write_text(json.dumps(guide))
print(json.dumps({'type':'response','command':'steer','success':True,'id':guide['id']}),flush=True)
print(json.dumps({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':guide['message']}]}]}),flush=True)
assert sys.stdin.read()==''
''')
        self.call('turn','omp-worker','guided-turn',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.log),'')
        self.assertEqual(json.loads((self.cwd/'guidance.json').read_text())['message'],body)
        receipt=json.loads(json.loads(self.call('delivery','guidance-1'))['receipt'])
        self.assertEqual(receipt,{'type':'response','command':'steer','success':True,'id':'guidance-1'})
        self.assertEqual(json.loads(self.call('delivery','guided-turn'))['body'],body)
        self.assertEqual(json.loads(self.call('inbox','omp-worker')),[])

    def test_omp_delta_filter_echo_activates_the_projection(self):
        self.register('omp-worker','root','omp','requested-model','low',str(self.cwd),'omp-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
request=json.loads(sys.stdin.readline())
assert request=={'type':'set_event_filter','id':'baton:filter','events':None,'messageUpdates':'delta'},request
emitted=[]
def emit(frame):
    line=json.dumps(frame)
    emitted.append(line)
    print(line,flush=True)
emit({'type':'response','id':'baton:filter','command':'set_event_filter','success':True,'data':{'events':None,'messageUpdates':'delta'}})
state=json.loads(sys.stdin.readline())
assert state['type']=='get_state'
prompt=json.loads(sys.stdin.readline())['message']
emit({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-delta','model':{'provider':'provider','id':'actual-model'}}})
emit({'type':'message_update','messageId':'m1','assistantMessageEvent':{'type':'text_delta','delta':'partial λ'}})
emit({'type':'message_end','message':{'id':'m1','role':'assistant','provider':'provider','model':'actual-model','content':[{'type':'text','text':'delta answer λ'}]}})
emit({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'delta answer λ'}]}]})
pathlib.Path('emitted.jsonl').write_text(chr(10).join(emitted)+chr(10))
''')
        self.call('turn','omp-worker','delta-turn',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.log),'')
        frames=[json.loads(line) for line in self.generation('delta-turn').read_text().splitlines()]
        self.assertEqual([f['type'] for f in frames],['response','response','message_end','agent_end','baton_event_filter'])
        self.assertEqual(frames[0],{'type':'response','id':'baton:filter','command':'set_event_filter','success':True,'data':{'events':None,'messageUpdates':'delta'}})
        self.assertEqual(frames[-1],{'type':'baton_event_filter','requested':'delta','active':True})
        wire=[json.loads(line) for line in (self.cwd/'emitted.jsonl').read_text().splitlines()]
        self.assertEqual([f for f in wire if f['type']=='message_update'],
                         [{'type':'message_update','messageId':'m1','assistantMessageEvent':{'type':'text_delta','delta':'partial λ'}}])
        self.assertEqual(json.loads(self.call('delivery','delta-turn'))['body'],'delta answer λ')
        self.assertEqual(json.loads(self.call('player','omp-worker'))['native'],'omp-delta')

    def test_omp_filter_refusal_keeps_full_snapshots_and_completes(self):
        self.register('omp-worker','root','omp','requested-model','low',str(self.cwd),'omp-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys
request=json.loads(sys.stdin.readline())
assert request['type']=='set_event_filter'
print(json.dumps({'type':'response','id':'baton:filter','command':'set_event_filter','success':False,'error':'Unknown request type set_event_filter'}),flush=True)
state=json.loads(sys.stdin.readline())
assert state['type']=='get_state'
prompt=json.loads(sys.stdin.readline())['message']
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-refused','model':{'provider':'provider','id':'actual-model'}}}),flush=True)
print(json.dumps({'type':'message_update','assistantMessageEvent':{'type':'text_delta','delta':'partial λ'},'message':{'role':'assistant','content':[{'type':'text','text':'partial λ'}]}}),flush=True)
print(json.dumps({'type':'message_end','message':{'role':'assistant','provider':'provider','model':'actual-model','content':[{'type':'text','text':'refused answer λ'}]}}),flush=True)
print(json.dumps({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'refused answer λ'}]}]}),flush=True)
''')
        self.call('turn','omp-worker','refused-turn',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.log),'')
        frames=[json.loads(line) for line in self.generation('refused-turn').read_text().splitlines()]
        self.assertEqual([f['type'] for f in frames],['response','response','message_end','agent_end','baton_event_filter'])
        self.assertIs(frames[0]['success'],False)
        self.assertEqual(frames[-1],{'type':'baton_event_filter','requested':'delta','active':False,'outcome':'refused'})
        self.assertEqual([f for f in frames if f.get('type')=='message_update'],[])
        self.assertEqual(json.loads(self.call('delivery','refused-turn'))['body'],'refused answer λ')
        self.assertEqual(json.loads(self.call('player','omp-worker'))['native'],'omp-refused')

    def test_omp_nonmatching_filter_answers_stay_inactive(self):
        self.register('omp-worker','root','omp','requested-model','low',str(self.cwd),'omp-branch','base')
        scenarios = {
            'false-success': {'type':'response','id':'baton:filter','command':'set_event_filter','success':False,
                              'error':'Unknown request type set_event_filter'},
            'missing-events': {'type':'response','id':'baton:filter','command':'set_event_filter','success':True,
                               'data':{'messageUpdates':'delta'}},
            'restricted-events': {'type':'response','id':'baton:filter','command':'set_event_filter','success':True,
                                  'data':{'events':['message_end'],'messageUpdates':'delta'}},
        }
        expected = {'false-success':'refused','missing-events':'unconfirmed','restricted-events':'unconfirmed'}
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
request=json.loads(sys.stdin.readline())
assert request=={'type':'set_event_filter','id':'baton:filter','events':None,'messageUpdates':'delta'},request
print(json.dumps(json.loads(pathlib.Path('scenario.json').read_text())),flush=True)
state=json.loads(sys.stdin.readline())
assert state['type']=='get_state'
prompt=json.loads(sys.stdin.readline())['message']
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-partial','model':{'provider':'provider','id':'actual-model'}}}),flush=True)
print(json.dumps({'type':'message_end','message':{'role':'assistant','provider':'provider','model':'actual-model','content':[{'type':'text','text':'partial answer λ'}]}}),flush=True)
print(json.dumps({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'partial answer λ'}]}]}),flush=True)
''')
        for name, reply in scenarios.items():
            (self.cwd/'scenario.json').write_text(json.dumps(reply))
            self.task.write_text('run ' + name)
            turn_log = self.log.with_suffix('.' + name + '.jsonl')
            self.call('turn','omp-worker',name + '-turn',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(turn_log),'')
            frames=[json.loads(line) for line in turn_log.read_text().splitlines()]
            self.assertEqual(frames[0],reply,name)
            self.assertEqual(frames[-1],{'type':'baton_event_filter','requested':'delta','active':False,'outcome':expected[name]},name)
            self.assertEqual(json.loads(self.call('delivery',name + '-turn'))['body'],'partial answer λ',name)
        self.assertEqual(json.loads(self.call('player','omp-worker'))['native'],'omp-partial')

    def test_muse_resumed_turn_reads_new_task_in_recorded_session(self):
        self.register('muse-worker','root','muse','requested-model','low',str(self.cwd),'muse-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
args=sys.argv
assert args[1]=='exec'
prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
pathlib.Path('received.txt').write_text(prompt)
session=args[args.index('--session-id')+1] if '--session-id' in args else 'native-muse'
print(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.model.configured','payload':{'kind':'run_model_configured','model_id':'actual-muse'}}))
print(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'turn.input.user','payload':{'kind':'turn_input_user','command_id':'muse-primary'}}))
print(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.terminal.completed','payload':{'kind':'run_terminal','terminal':'completed','command_id':'muse-primary','text':prompt}}))
''')
        self.call('turn','muse-worker','muse-1',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.log),'')
        native=json.loads(self.call('player','muse-worker'))['native']
        self.assertEqual(native,'native-muse')
        self.task.write_text('Continue with a new task λ.')
        self.call('turn','muse-worker','muse-2',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.cwd/'resumed.jsonl'),native)
        self.assertEqual((self.cwd/'received.txt').read_text(),self.task.read_text())
        reports=json.loads(self.call('inbox','root'))
        self.assertEqual([r['id'] for r in reports],['muse-1','muse-2'])
        self.assertEqual(reports[-1]['body'],self.task.read_text())
        self.assertEqual(json.loads(self.call('player','muse-worker'))['native'],native)

    def test_codex_terminal_report_uses_final_message_and_resumes_native_thread(self):
        self.register('codex-worker','root','codex','gpt-6-astra','low',str(self.cwd),'codex-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib,os
args=sys.argv
native_args=args[3:] if args[1:3]==['-c','forced_login_method="chatgpt"'] else args[1:]
assert native_args[0]=='exec'
assert '--ephemeral' not in args
pathlib.Path('argv.json').write_text(json.dumps(args))
prompt=sys.stdin.read()
pathlib.Path('received.txt').write_text(prompt)
with pathlib.Path('native-launches.jsonl').open('a') as launches:
    launches.write(json.dumps({'args':args[1:],'cwd':os.getcwd(),'prompt':prompt,
                              'apiKeyVariablesPresent':[key for key in ('OPENAI_API_KEY','CODEX_API_KEY') if key in os.environ]})+'\\n')
print(json.dumps({'type':'thread.started','thread_id':'native-codex'}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Working on it.'}}))
print(json.dumps({'type':'item.completed','item':{'type':'command_execution','aggregated_output':'tool output'}}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':prompt}}))
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':42,'output_tokens':7}}))
''')
        with patch.dict(os.environ, {'OPENAI_API_KEY':'controlled-unused-key', 'CODEX_API_KEY':'controlled-unused-key'}):
            self.call('turn','codex-worker','codex-1',str(self.player),'gpt-6-astra','low',str(self.cwd),str(self.task),str(self.log),'')
        session=json.loads(self.call('player','codex-worker'))
        self.assertEqual(session['native'],'native-codex')
        self.assertEqual(session['observedModel'],'')
        self.assertEqual(json.loads(self.call('inbox','root'))[0]['body'],self.task.read_text())
        initial_prompt=self.task.read_text()
        self.task.write_text('Next instruction with trailing newline.\n')
        with patch.dict(os.environ, {'OPENAI_API_KEY':'controlled-unused-key', 'CODEX_API_KEY':'controlled-unused-key'}):
            self.call('turn','codex-worker','codex-2',str(self.player),'gpt-6-astra','low',str(self.cwd),str(self.task),str(self.cwd/'second.jsonl'),session['native'])
        args=json.loads((self.cwd/'argv.json').read_text())
        launches=[json.loads(line) for line in (self.cwd/'native-launches.jsonl').read_text().splitlines()]
        for launch, subcommand, prompt in zip(launches, [['exec'],['exec','resume','native-codex']], [initial_prompt,self.task.read_text()]):
            self.assertEqual(launch['args'][:2], ['-c','forced_login_method="chatgpt"'])
            self.assertEqual(launch['args'][2:2+len(subcommand)],subcommand)
            configs=[launch['args'][i+1] for i,arg in enumerate(launch['args']) if arg=='-c']
            self.assertEqual(configs,['forced_login_method="chatgpt"','model_reasoning_effort="low"'])
            self.assertEqual(launch['args'][launch['args'].index('--model')+1],'gpt-6-astra')
            self.assertEqual(launch['apiKeyVariablesPresent'],[])
            self.assertEqual(launch['cwd'],str(self.cwd))
            self.assertEqual(launch['prompt'],prompt)
        self.assertEqual(len(launches),2)
        self.assertEqual(json.loads(self.call('player','codex-worker'))['native'],session['native'])
        self.assertEqual(args[-1],'-')
        self.assertEqual(json.loads(self.call('inbox','root'))[-1]['body'],self.task.read_text())
        self.player.unlink()
        self.call('turn','codex-worker','codex-2',str(self.player),'gpt-6-astra','low',str(self.cwd),str(self.task),str(self.cwd/'second.jsonl'),session['native'])
        self.assertEqual(len(json.loads(self.call('turns','codex-worker'))),2)

    def test_codex_failed_turn_retains_native_failure_for_parent(self):
        self.register('codex-worker','root','codex','gpt-6-astra','low',str(self.cwd),'codex-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys
sys.stdin.read()
print(json.dumps({'type':'thread.started','thread_id':'failed-codex'}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Unfinished work.'}}))
print(json.dumps({'type':'turn.failed','error':{'message':'Provider refused request'}}))
sys.exit(1)
''')
        self.call('turn','codex-worker','codex-failed',str(self.player),'gpt-6-astra','low',str(self.cwd),str(self.task),str(self.log),'')
        report=json.loads(self.call('delivery','codex-failed'))
        event=json.loads(report['body'])
        self.assertEqual(event['nativeEvent']['type'],'turn.failed')
        self.assertEqual(event['result'],'Provider refused request')
        self.assertEqual(event['is_error'],1)


    def test_unresumable_conversation_restarts_fresh_and_finishes_the_task(self):
        # OMP answers "not found" for a conversation it never persisted; the
        # turn then runs fresh so the pending input still completes.
        self.register('omp-worker','root','omp','requested-model','low',str(self.cwd),'omp-branch','base')
        self.player.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
args=sys.argv
if '--resume' in args:
    sys.stderr.write('Error: Session "%s" not found.\\n' % args[args.index('--resume')+1])
    raise SystemExit(1)
json.loads(sys.stdin.readline())
state=json.loads(sys.stdin.readline())
prompt=json.loads(sys.stdin.readline())['message']
pathlib.Path('fresh-prompt.txt').write_text(prompt)
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'omp-fresh','model':{'provider':'deepseek','id':'deepseek-flash'}}}),flush=True)
print(json.dumps({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'fresh answer'}]}]}),flush=True)
assert sys.stdin.read()==''
''')
        self.call('turn','omp-worker','omp-resume-gone',str(self.player),'requested-model','low',str(self.cwd),str(self.task),str(self.log),'omp-native-gone')
        self.assertEqual(json.loads(self.call('player','omp-worker'))['native'],'omp-fresh')
        prompt=(self.cwd/'fresh-prompt.txt').read_text()
        self.assertIn(self.task.read_text(),prompt)
        self.assertIn('fresh conversation',prompt)
        inbox=json.loads(self.call('inbox','root'))
        self.assertEqual(inbox[-1]['body'],'fresh answer')
        self.assertIn('omp-resume-gone:recovery',[r['id'] for r in inbox])

if __name__=='__main__': unittest.main()
