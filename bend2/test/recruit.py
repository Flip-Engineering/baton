"""Worker recruitment and status against independent, temporary Git repositories."""
import json
import pathlib
import subprocess
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

    def call(self,*args,ok=True,cwd=None):
        p=subprocess.run([str(EXE),str(self.db),*map(str,args)],text=True,capture_output=True,cwd=cwd or ROOT)
        self.assertEqual(p.returncode==0,ok,p.stderr)
        return json.loads(p.stdout) if ok else p.stderr

    def recruit(self,worker='worker',branch='worker-branch',path='work λ',parent='root',ok=True):
        return self.call('recruit',worker,parent,'omp','zai/glm-5.3-flash','high',self.repo,branch,path,self.base,ok=ok)

    def test_recruit_creates_registers_and_reads_workspace_from_another_cwd(self):
        row=self.recruit()
        workspace=pathlib.Path(row['workspace'])
        self.assertTrue(workspace.is_absolute())
        self.assertEqual(workspace,self.repo/'work λ')
        self.assertEqual(row['parent'],'root')
        self.assertEqual(row['base'],self.base)
        self.assertEqual(self.recruit(),row)
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
        self.call('session','worker',ok=False)

    def test_missing_parent_and_conflicting_worker_id_preserve_existing_work(self):
        self.recruit(parent='missing',ok=False)
        self.assertFalse((self.repo/'work λ').exists())
        self.recruit()
        self.recruit(branch='another-branch',path='another-path',ok=False)
        self.assertFalse((self.repo/'another-path').exists())
        self.assertNotIn('another-branch',self.git('branch','--list'))
        self.assertEqual(self.call('session','worker')['branch'],'worker-branch')

if __name__=='__main__': unittest.main()
