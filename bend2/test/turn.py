"""Integration checks with a controlled native-process protocol fixture."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

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
        self.worker=self.cwd/'fixture-harness'
        self.worker.write_text('#!'+sys.executable+'\n'+'''import json,sys,pathlib
line=sys.stdin.readline()
prompt=json.loads(line)["message"]["content"]
pathlib.Path("received.txt").write_text(prompt)
print(json.dumps({"type":"system","subtype":"init","session_id":"native-fixture","model":"actual-model"}))
print(json.dumps({"type":"assistant","message":{"content":"text containing \\\"type\\\":\\\"result\\\""}}))
print(json.dumps({"type":"result","result":"Task recorded.","session_id":"native-fixture","is_error":False}))
''')
        self.worker.chmod(0o700)
        self.call('attach','root','native-fixture','root-session','root-endpoint')
        self.call('worker','worker','root','claude-code','model','high',str(self.cwd),'branch','base')

    def tearDown(self): self.temp.cleanup()

    def call(self,*args):
        p=subprocess.run([str(EXE),str(self.db),*args],text=True,capture_output=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr)
        return p.stdout

    def run_turn(self,cmd=None):
        return self.call('turn','worker','turn-1',str(cmd or self.worker),'model','high',str(self.cwd),str(self.task),str(self.log),'')

    def test_native_process_output_becomes_parent_report(self):
        self.run_turn()
        inbox=json.loads(self.call('inbox','root'))
        self.assertEqual([m['body'] for m in inbox],['Task recorded.'])
        self.assertEqual((self.cwd/'received.txt').read_text(),self.task.read_text())
        self.assertEqual(json.loads(self.call('session','worker'))['native'],'native-fixture')
        self.assertEqual(len(self.log.read_text().splitlines()),3)

    def test_completed_turn_retry_does_not_start_another_process(self):
        self.run_turn()
        before=self.log.read_text()
        self.worker.unlink()
        self.run_turn()
        self.assertEqual(self.log.read_text(),before)
        self.assertEqual(len(json.loads(self.call('inbox','root'))),1)

    def test_startup_output_and_large_input_are_drained_concurrently(self):
        self.task.write_text('large task '*40000)
        self.worker.write_text('#!'+sys.executable+'\n'+'import json,sys\nprint(json.dumps({"type":"system","subtype":"init","session_id":"s","detail":"x"*400000}),flush=True)\nline=sys.stdin.readline()\nprompt=json.loads(line)["message"]["content"]\nprint(json.dumps({"type":"result","result":str(len(prompt))}))\n')
        self.run_turn()
        self.assertEqual(json.loads(self.call('inbox','root'))[0]['body'],str(len(self.task.read_text())))

    def test_start_failure_reports_to_parent(self):
        self.run_turn(self.cwd/'missing-program')
        inbox=json.loads(self.call('inbox','root'))
        self.assertIn('could not start',inbox[0]['body'])
        self.assertEqual(inbox[0]['recipient'],'root')

    def test_exit_without_result_reports_failure_and_keeps_logs(self):
        self.worker.write_text('#!'+sys.executable+'\nimport sys;sys.stdin.read();print("unframed startup failure");sys.stderr.write("diagnosis");raise SystemExit(7)\n')
        self.run_turn()
        inbox=json.loads(self.call('inbox','root'))
        self.assertTrue(any('without a native result' in m['body'] for m in inbox))
        self.assertTrue(any('exit 7' in m['body'] for m in inbox))
        self.assertEqual(self.log.read_text(),'unframed startup failure\n')
        self.assertEqual(pathlib.Path(str(self.log)+'.stderr').read_text(),'diagnosis')

if __name__=='__main__': unittest.main()
