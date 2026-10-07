"""Player recruitment and status against independent, temporary Git repositories."""
from contextlib import closing
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
EXE=ROOT/'.scratch/bend2/baton2'

class Recruit(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'.scratch/bend2')
        self.directory=pathlib.Path(self.temp.name)
        self.repo=self.directory/'repository λ'
        self.repo.mkdir()
        self.db=self.directory/'state.db'
        self.git('init','-q','-b','main')
        self.git('config','user.name','Baton test')
        self.git('config','user.email','baton@example.invalid')
        self.git('commit','-q','--allow-empty','-m','initial')
        self.base=self.git('rev-parse','HEAD').strip()
        self.call('attach','root','codex','native-root','endpoint')

    def tearDown(self): self.temp.cleanup()

    def git(self,*args):
        return subprocess.run(['git','-C',str(self.repo),*args],check=True,text=True,capture_output=True).stdout

    def call(self,*args,ok=True,cwd=None,exit_code=None):
        p=subprocess.run([str(EXE),str(self.db),*map(str,args)],text=True,capture_output=True,cwd=cwd or ROOT)
        self.assertEqual(p.returncode==0,ok,p.stderr)
        if exit_code is not None:
            self.assertEqual(p.returncode,exit_code,p.stdout+p.stderr)
            self.assertEqual(p.stdout,'')
        return json.loads(p.stdout) if ok else p.stderr

    def recruit(self,player='worker',branch='worker-branch',path='work λ',parent='root',ok=True,
                harness='omp',model='zai/glm-5.3-flash',effort='high',base=None,exit_code=None):
        return self.call('recruit',player,parent,harness,model,effort,self.repo,branch,path,
                         self.base if base is None else base,ok=ok,exit_code=exit_code)

    def state(self):
        with closing(sqlite3.connect(self.db)) as db:
            return {name:db.execute('SELECT * FROM '+name).fetchall() for name in
                    ('sessions','messages','turns','executions','session_stops',
                     'session_roles','ensembles','ensemble_members')}

    def test_recruit_creates_registers_and_reads_workspace_from_another_cwd(self):
        row=self.recruit()
        workspace=pathlib.Path(row['workspace'])
        self.assertTrue(workspace.is_absolute())
        self.assertEqual(workspace,self.repo/'work λ')
        self.assertEqual(row['parent'],'root')
        self.assertEqual(row['base'],self.base)
        self.assertEqual(self.recruit(),row)
        self.assertEqual(self.call('player','worker',cwd=self.directory),row)
        clean=self.call('worktree','worker',cwd=self.directory)
        self.assertEqual(clean['branch'],'worker-branch')
        self.assertEqual(clean['commit'],self.base)
        self.assertFalse(clean['dirty'])
        (workspace/'new file').write_text('retained worker work')
        self.assertTrue(self.call('worktree','worker',cwd=self.directory)['dirty'])

    def test_existing_repo_relative_path_is_refused_without_creating_branch(self):
        (self.repo/'already here').mkdir()
        error=self.recruit(path='already here',ok=False)
        self.assertIn('path exists',error)
        self.assertNotIn('worker-branch',self.git('branch','--list'))
        self.call('player','worker',ok=False)

    def test_missing_parent_and_conflicting_player_id_preserve_existing_work(self):
        self.recruit(parent='missing',ok=False)
        self.assertFalse((self.repo/'work λ').exists())
        self.recruit()
        self.recruit(branch='another-branch',path='another-path',ok=False)
        self.assertFalse((self.repo/'another-path').exists())
        self.assertNotIn('another-branch',self.git('branch','--list'))
        self.assertEqual(self.call('player','worker')['branch'],'worker-branch')

    def test_assignment_conflicts_name_both_values_and_preserve_work_and_input(self):
        assigned=self.recruit()
        workspace=pathlib.Path(assigned['workspace'])
        self.call('attach','other-parent','codex','','')
        self.call('role', 'root', 'principal-conductor')
        self.call('message','pending-task','root','worker','task',"Keep this task λ\n")
        endpoint=json.dumps(['/usr/bin/true','retained worker endpoint'])
        self.call('connect','worker','native-kept',endpoint)
        self.call('bind','worker','native-kept','observed-harness','observed-model','low')
        (workspace/'committed.txt').write_text('committed worker work\n')
        for args in [('add','committed.txt'),('commit','-q','-m','worker change')]:
            subprocess.run(['git','-C',str(workspace),*args],check=True,capture_output=True)
        (workspace/'committed.txt').write_text('uncommitted worker change\n')
        (workspace/'untracked λ.txt').write_bytes(b'retained untracked work\n')
        self.git('commit','-q','--allow-empty','-m','another base')
        other_base=self.git('rev-parse','HEAD').strip()

        before=self.state()
        session=self.call('player','worker')
        work=self.call('worktree','worker')
        self.assertTrue(work['dirty'])
        self.assertNotEqual(work['commit'],self.base)
        refs=self.git('show-ref')
        worktrees=self.git('worktree','list','--porcelain')
        files={p.name:p.read_bytes() for p in workspace.iterdir() if p.is_file()}
        self.assertEqual(self.recruit(),session)
        self.assertEqual(self.state(),before)

        changes=[('parent','other-parent','parent'),('harness','muse','harness'),
                 ('model',"another/provider's-model λ",'model'),('effort','low','effort'),
                 ('path','another path λ','workspace'),('branch','another-branch','branch'),
                 ('base',other_base,'base')]
        fields=('parent','harness','model','effort','workspace','branch','base')
        original={key:assigned[key] for key in fields}
        for argument,value,field in changes:
            with self.subTest(field=field):
                refused=json.loads(self.recruit(**{argument:value},ok=False,exit_code=2))
                requested={**original,field:str(self.repo/value) if argument=='path' else value}
                self.assertEqual(refused['error'],'player-assignment-conflict')
                self.assertEqual(refused['session'],'worker')
                self.assertEqual(refused['existing'],original)
                self.assertEqual(refused['requested'],requested)
                for action in ('session ID','worktree ID','new ID','new branch','unused path'):
                    self.assertIn(action,refused['next'])
                self.assertEqual(self.state(),before)
                self.assertEqual(self.call('player','worker'),session)
                self.assertEqual(self.call('worktree','worker'),work)
                self.assertEqual(self.git('show-ref'),refs)
                self.assertEqual(self.git('worktree','list','--porcelain'),worktrees)
                self.assertEqual({p.name:p.read_bytes() for p in workspace.iterdir() if p.is_file()},files)
                self.assertFalse((self.repo/'another path λ').exists())
        self.assertEqual(self.recruit(),session)
        self.assertEqual(self.state(),before)

    def test_recruiting_an_existing_root_id_reports_the_null_parent_conflict(self):
        original=self.call('player','root')
        before=self.state()
        refused=json.loads(self.recruit(player='root',ok=False,exit_code=2))
        self.assertEqual(refused['error'],'player-assignment-conflict')
        self.assertIsNone(refused['existing']['parent'])
        self.assertEqual(refused['requested']['parent'],'root')
        self.assertEqual(self.call('player','root'),original)
        self.assertEqual(self.state(),before)
        self.assertFalse((self.repo/'work λ').exists())
        self.assertNotIn('worker-branch',self.git('branch','--list'))

    def test_failed_player_leaves_dirty_work_available(self):
        self.recruit()
        workspace = self.repo / 'work λ'
        (workspace / 'partial.txt').write_text('uncommitted work in progress')
        (workspace / 'committed.txt').write_text('committed change')
        subprocess.run(
            ['git', '-C', str(workspace), 'add', 'committed.txt'],
            check=True, capture_output=True,
        )
        subprocess.run(
            ['git', '-C', str(workspace), 'commit', '-q', '-m', 'partial delivery'],
            check=True, capture_output=True,
        )

        status = self.call('worktree', 'worker', cwd=self.directory)
        self.assertTrue(status['dirty'])
        self.assertNotEqual(status['commit'], self.base)
        self.assertTrue((workspace / 'partial.txt').exists())
        self.assertEqual((workspace / 'partial.txt').read_text(), 'uncommitted work in progress')
        self.assertTrue((workspace / 'committed.txt').exists())

    def test_refused_retries_preserve_endpoint_identity_pending_task_and_player_work(self):
        assigned=self.recruit()
        workspace=pathlib.Path(assigned['workspace'])
        self.call('role', 'root', 'principal-conductor')
        task=('message','pending-task','root','worker','task',"Keep this fixture task λ\n")
        self.call(*task)
        self.assertIsNone(self.call('delivery','pending-task')['receipt'])

        endpoint_file=self.directory/'endpoint.py'
        endpoint_file.write_text(
            'import json,pathlib,subprocess,sys\n'
            'exe,db,log,*arguments=sys.argv[1:]\n'
            'with pathlib.Path(log).open("a") as output:\n'
            ' output.write(json.dumps(arguments,ensure_ascii=False)+"\\n")\n'
            'result=subprocess.run([exe,db,"ack",arguments[-1],"worker","accepted"],capture_output=True)\n'
            'sys.stdout.buffer.write(result.stdout)\n'
            'sys.stderr.buffer.write(result.stderr)\n'
            'raise SystemExit(result.returncode)\n')
        self.deliveries=self.directory/'deliveries.jsonl'
        self.arguments=["λ ' whitespace\n",'']
        endpoint=json.dumps([sys.executable,str(endpoint_file),str(EXE),str(self.db),
                             str(self.deliveries),*self.arguments],ensure_ascii=False)
        self.call('connect','worker','native-kept',endpoint)

        (workspace/'committed.txt').write_text('committed worker work\n')
        for args in [('add','committed.txt'),('commit','-q','-m','worker change')]:
            subprocess.run(['git','-C',str(workspace),*args],check=True,capture_output=True)
        (workspace/'committed.txt').write_text('uncommitted worker change\n')
        (workspace/'untracked λ.txt').write_bytes(b'retained untracked work\n')

        before=self.state()
        session=self.call('player','worker')
        work=self.call('worktree','worker')
        refs=self.git('show-ref')
        worktrees=self.git('worktree','list','--porcelain')
        files={p.name:p.read_bytes() for p in workspace.iterdir() if p.is_file()}
        self.assertEqual(session['native'],'native-kept')
        self.assertEqual(session['endpoint'],endpoint)
        self.assertTrue(work['dirty'])
        self.assertNotEqual(work['commit'],self.base)
        self.assertEqual(len(self.call('inbox','worker')),1)

        filename=self.directory/'worker-endpoint.json'
        filename.write_text(endpoint)
        refused=json.loads(self.call('connect','worker','native-replacement',str(filename),
                                     ok=False,exit_code=2))
        self.assertEqual(refused['error'],'invalid-endpoint')
        self.assertEqual(refused['session'],'worker')
        self.assertIn('JSON',refused['condition'])
        self.assertIn('ENDPOINT',refused['next'])

        fields=('parent','harness','model','effort','workspace','branch','base')
        original={key:assigned[key] for key in fields}
        conflict=json.loads(self.recruit(harness='muse',ok=False,exit_code=2))
        self.assertEqual(conflict['error'],'player-assignment-conflict')
        self.assertEqual(conflict['session'],'worker')
        self.assertEqual(conflict['existing'],original)
        self.assertEqual(conflict['requested'],{**original,'harness':'muse'})
        for action in ('session ID','worktree ID','new ID','new branch','unused path'):
            self.assertIn(action,conflict['next'])

        self.assertEqual(self.state(),before)
        self.assertEqual(self.call('player','worker'),session)
        self.assertEqual(self.call('worktree','worker'),work)
        self.assertEqual(self.git('show-ref'),refs)
        self.assertEqual(self.git('worktree','list','--porcelain'),worktrees)
        self.assertEqual({p.name:p.read_bytes() for p in workspace.iterdir() if p.is_file()},files)
        self.assertFalse(self.deliveries.exists())
        pending=self.call('inbox','worker')
        self.assertEqual([row['id'] for row in pending],['pending-task'])
        self.assertEqual(pending[0]['body'],task[-1])

        self.assertEqual(self.recruit(),session)
        self.assertEqual(self.state(),before)
        self.assertEqual(self.git('show-ref'),refs)
        self.assertFalse(self.deliveries.exists())

        self.call(*task)
        self.assertEqual(json.loads(self.deliveries.read_text()),self.arguments+['pending-task'])
        delivered=self.call('delivery','pending-task')
        self.assertEqual(delivered['body'],task[-1])
        self.assertEqual(delivered['receipt'],'accepted')
        self.assertEqual(delivered['endpoint'],endpoint)
        self.assertEqual(self.call('inbox','worker'),[])
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute(
                "SELECT sender,recipient,kind,body,receipt FROM messages WHERE id='pending-task'"
            ).fetchone(),('root','worker','task',task[-1],'accepted'))

        after_delivery=self.state()
        self.call(*task)
        self.assertEqual(self.state(),after_delivery)
        self.assertEqual(len(self.deliveries.read_text().splitlines()),1)

if __name__=='__main__': unittest.main()
