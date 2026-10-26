"""Production worker context and generated overlay under real native custody.

Set BATON2_DSH_WORKER_NATIVE_EXE to the focused fixture binary and
BATON_DSH_MODULES to an installed DSH node_modules directory. The controlled
native process owns the admitted birth; no model provider or live worker runs.
"""
import importlib.util
import json
import os
import pathlib
import socket
import sqlite3
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('worker_fixture', ROOT / 'bend2/test/dsh-worker.py')
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)

NATIVE = r'''import json,os,pathlib,socket,subprocess,sys
args=sys.argv[1:]
assert args[:2]==['--profile','headless'],args
patches=[args[i+1] for i,x in enumerate(args) if x=='--patch']
assert len(patches)==2 and all(pathlib.Path(p).is_file() for p in patches)
assert args[-2:]==['--session-id','session-retained-fixture'],args
prompt=sys.stdin.read()
assert 'Fixture worker task.' in prompt,prompt
control=socket.create_connection(('127.0.0.1',int(os.environ['BATON_DSH_FIXTURE_PORT'])))
stream=control.makefile('rwb',buffering=0)
def send(value):stream.write((json.dumps(value)+'\n').encode())
names=['BATON_DATABASE','BATON_SESSION','BATON_ATTEMPT_DIRECTORY','BATON_COORDINATOR','BATON_DSH_WORKER_BRIDGE','DSH_HOME']
send({'pid':os.getpid(),'argv':args,'cwd':os.getcwd(),'context':{k:os.environ[k] for k in names},'prompt':prompt})
os.environ['TOOLS_OVERLAY']=patches[0]
print(json.dumps({'type':'session','sessionId':'session-retained-fixture','cwd':os.getcwd()},separators=(',',':')),flush=True)
for line in stream:
    action=json.loads(line)
    if action['kind']=='quit':break
    if action['kind']=='context':argv=[os.environ['BATON_COORDINATOR'],os.environ['BATON_DATABASE'],'agent-worker-context']
    else:argv=[os.environ['NODE'],os.environ['BATON_DSH_FIXTURE_PIPELINE']]
    child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    stdout,stderr=child.communicate()
    send({'pid':os.getpid(),'child_pid':child.pid,'argv':argv,'code':child.returncode,'stdout':stdout,'stderr':stderr})
print(json.dumps({'type':'final','text':'Controlled worker finished.'},separators=(',',':')),flush=True)
stream.close();control.close()
'''

PIPELINE = r'''import assert from 'node:assert/strict';
import { Context } from CORDIS;
import { SystemPrompt } from PROMPT;
import { ToolRuntime } from TOOLS;
import * as MCP from MCP_MODULE;
import { loadOverlayPatches } from APP_BOOT;
import { interpolate } from LOADER;
const root=new Context();
try {
  await root.plugin(SystemPrompt,{});
  await root.plugin(ToolRuntime,{});
  const patches=loadOverlayPatches('dsh-worker-fixture',process.env.TOOLS_OVERLAY);
  const row=patches.flatMap(p=>p.insert??[]).find(p=>p.id==='baton-worker');
  assert.ok(row);
  assert.equal(interpolate(root,row.disabled),false);
  const config=interpolate(root,row.config);
  assert.equal(config.args[0],process.env.BATON_DSH_WORKER_BRIDGE);
  assert.ok(Object.keys(config.env).every(k=>/^GIT_CONFIG_KEY_[0-9]+$/.test(k)));
  await root.plugin(MCP,config);
  const agent={};
  const visible=[...root.tools.view(agent).visible.keys()];
  const results={};
  for(const [tool,args] of [['inbox',{}], ['read',{ids:['owed-detail','already-handled']}],
      ['report',{text:'Production native worker report λ'}],
      ['completion_request',{text:'Production native completion evidence λ'}],
      ['commit',{paths:['native-contribution'],message:'Native worker scoped contribution'}]]) {
    assert.ok(visible.includes('mcp__baton-worker__'+tool),JSON.stringify(visible));
    const result=await root.tools.execute({agent,callId:tool,name:'mcp__baton-worker__'+tool,
      arguments:args,signal:new AbortController().signal});
    results[tool]=result;
    assert.ok(!result.isError,JSON.stringify(result));
    if(tool==='inbox'||tool==='read') {
      const child=JSON.parse(result.content[0].text);
      const rows=JSON.parse(child.stdout);
      const messages=tool==='read'?rows.map(row=>row.delivery):rows;
      assert.equal(messages.find(row=>row.id==='owed-detail').body,'Complete native input λ🙂\n'.repeat(10000));
      if(tool==='read') assert.equal(messages.find(row=>row.id==='already-handled').receipt,'earlier-receipt');
    }
  }
  console.log(JSON.stringify({visible,results,overlay:process.env.TOOLS_OVERLAY}));
} finally {await root.fiber.dispose();}
'''


class NativeWorker(unittest.TestCase):
    def setUp(self):
        self.binary = pathlib.Path(os.environ['BATON2_DSH_WORKER_NATIVE_EXE']).resolve()
        self.modules = pathlib.Path(os.environ['BATON_DSH_MODULES']).resolve()
        self.fixture = WORKER.DshWorker('test_report_and_completion_forward_complete_text_with_recorded_actor')
        self.fixture._testMethodName = self._testMethodName
        self.fixture.setUp()
        self.root = self.fixture.root
        self.env = self.fixture.env
        registry = pathlib.Path(self.env['BATON2_GIT_REGISTRY'])
        data = json.loads(registry.read_text())
        data['models'] = {'deepseek-flash': 'deepseek'}
        registry.write_text(json.dumps(data))
        pipeline = PIPELINE
        for label, package in [('CORDIS', 'cordis'), ('PROMPT', 'dsh-system-prompt'),
                               ('TOOLS', 'dsh-tools'), ('MCP_MODULE', 'dsh-mcp-client'),
                               ('APP_BOOT', 'dsh-app-boot'), ('LOADER', 'cordis-plugin-loader')]:
            pipeline = pipeline.replace('from ' + label + ';',
                'from ' + json.dumps((self.modules / '@deepseek-ai' / package / 'lib/index.js').as_uri()) + ';')
        self.pipeline = self.root / 'pipeline.mjs'
        self.pipeline.write_text(pipeline)
        self.native = self.root / 'native-fixture'
        self.native.write_text('#!' + sys.executable + '\n' + NATIVE)
        self.native.chmod(0o700)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(.2)
        self.addCleanup(self.server.close)
        runtime = self.root / 'runtime'
        runtime.mkdir(mode=0o700)
        (runtime / 'baton2').mkdir(mode=0o700)
        self.env.update(NODE=WORKER.NODE, BATON_DSH_FIXTURE_PORT=str(self.server.getsockname()[1]),
                        BATON_DSH_FIXTURE_PIPELINE=str(self.pipeline), XDG_RUNTIME_DIR=str(runtime))
        setup = self.fixture.child([self.binary, 'setup', self.fixture.database, self.fixture.attempt,
                            self.fixture.workspace, 'session-retained-fixture'], self.root)
        self.assertEqual(setup['returncode'], 0, setup)
        with sqlite3.connect(self.fixture.database) as db:
            db.executemany('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)', [
                ('owed-detail', 'operator', 'worker', 'guidance', 'Complete native input λ🙂\n' * 10000, None),
                ('owed-inbox', 'operator', 'worker', 'guidance', 'Complete inbox body', None),
                ('already-handled', 'operator', 'worker', 'guidance', 'Retained history', 'earlier-receipt'),
                ('other-recipient', 'worker', 'operator', 'report', 'Other recipient body', None)])
        (self.fixture.workspace / 'native-contribution').write_text('Native fixture contribution\n')
        self.output = (self.root / 'native-observer.stdout').open('w')
        self.errors = (self.root / 'native-observer.stderr').open('w')
        self.launch = subprocess.Popen([str(self.binary), 'launch', str(self.fixture.database),
            str(self.fixture.attempt), str(self.fixture.workspace), str(self.native), 'session-retained-fixture'],
            cwd=self.fixture.workspace, env=self.env, stdout=self.output, stderr=self.errors)
        self.addCleanup(self.finish)
        while True:
            try:
                self.connection, _ = self.server.accept()
                break
            except socket.timeout:
                if self.launch.poll() is not None:
                    self.fail((self.root / 'native-observer.stderr').read_text())
        self.stream = self.connection.makefile('rwb', buffering=0)
        self.started = json.loads(self.stream.readline())
        (self.root / 'native-started.json').write_text(json.dumps(self.started, indent=2))

    def action(self, kind):
        self.stream.write((json.dumps({'kind': kind}) + '\n').encode())
        result = json.loads(self.stream.readline())
        with (self.root / 'native-actions.jsonl').open('a') as out:
            out.write(json.dumps(result) + '\n')
        return result

    def finish(self):
        if self.output.closed:
            return
        if hasattr(self, 'stream'):
            try:
                self.stream.write(b'{"kind":"quit"}\n')
            except (OSError, ValueError):
                pass
            self.stream.close()
            self.connection.close()
            del self.stream
        code = self.launch.wait()
        self.output.close()
        self.errors.close()
        (self.root / 'native-observer.result.json').write_text(json.dumps({'pid': self.launch.pid, 'exit_code': code}))
        result = self.fixture.child([self.binary, '--instance-shutdown', self.fixture.database], self.root)
        self.assertEqual(result['returncode'], 0, result)

    def test_native_context_generated_overlay_and_scoped_operations(self):
        self.assertEqual(self.started['cwd'], str(self.fixture.workspace))
        self.assertEqual(self.started['context']['BATON_COORDINATOR'], str(self.binary))
        context = self.action('context')
        self.assertEqual(context['code'], 0, context)
        value = json.loads(context['stdout'])
        self.assertEqual((value['session'], value['attempt'], value['native'], value['model'], value['branch']),
                         ('worker', 'worker-turn', 'session-retained-fixture', 'deepseek-flash', 'worker-branch'))
        result = self.action('mcp')
        self.assertEqual(result['code'], 0, result)
        with sqlite3.connect(self.fixture.database) as db:
            messages = db.execute("SELECT sender,recipient,kind,body FROM messages WHERE sender='worker'").fetchall()
            self.assertIn(('worker', 'operator', 'report', 'Production native worker report λ'), messages)
            self.assertIn(('worker', 'operator', 'completion-request', 'Production native completion evidence λ'), messages)
            reads = db.execute('SELECT message,recipient,attempt,native,handled FROM message_reads').fetchall()
            self.assertEqual({row[0] for row in reads}, {'owed-detail', 'owed-inbox', 'already-handled'})
            self.assertTrue(all(row[1:] == ('worker', 'worker-turn', 'session-retained-fixture', None)
                                for row in reads), reads)
            self.assertEqual(db.execute("SELECT receipt FROM messages WHERE id='owed-detail'").fetchone(), (None,))
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('late-unread','operator','worker','guidance','Arrived after the reads')")
            db.execute("UPDATE executions SET phase='exited' WHERE session='worker'")
        self.assertNotEqual(self.action('context')['code'], 0)
        with sqlite3.connect(self.fixture.database) as db:
            db.execute("UPDATE executions SET phase='running' WHERE session='worker'")
            db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','fixture-stop','fixture stop','stopped')")
        self.assertNotEqual(self.action('context')['code'], 0)
        with sqlite3.connect(self.fixture.database) as db:
            db.execute("DELETE FROM session_stops WHERE session='worker'")
        self.assertEqual(self.action('context')['code'], 0)
        self.assertEqual(self.fixture.git('show', '-s', '--format=%an').strip(), 'Flip Baton - DeepSeek')
        self.finish()
        self.assertEqual(self.launch.returncode, 0, (self.root / 'native-observer.stderr').read_text())
        with sqlite3.connect(self.fixture.database) as db:
            self.assertEqual(db.execute("SELECT receipt FROM messages WHERE id='owed-detail'").fetchone(),
                             ('native-turn:worker-turn',))
            self.assertEqual(db.execute("SELECT receipt FROM messages WHERE id='already-handled'").fetchone(),
                             ('earlier-receipt',))
            self.assertEqual(db.execute("SELECT receipt FROM messages WHERE id='late-unread'").fetchone(), (None,))
            self.assertEqual(db.execute("SELECT receipt FROM messages WHERE id='other-recipient'").fetchone(), (None,))
        dead_env = {**self.env, **self.started['context']}
        old = self.fixture.env
        self.fixture.env = dead_env
        try:
            ended = self.fixture.child([self.binary, self.fixture.database, 'agent-worker-context'], self.fixture.workspace)
            self.assertNotEqual(ended['returncode'], 0, ended)
        finally:
            self.fixture.env = old


if __name__ == '__main__':
    unittest.main()
