"""Run receive acceptance with a controlled Codex protocol and real local effects."""
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
DRIVER = ROOT / 'bend2/scripts/accept-receive-recovery.py'
OBSERVATIONS = []

CODEX = r'''import json,os,pathlib,subprocess,sys
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'fixture.json').read_text())
args=sys.argv[1:]
assert args[:2]==['-c','forced_login_method=chatgpt'],args
assert 'OPENAI_API_KEY' not in os.environ and 'CODEX_API_KEY' not in os.environ
args=args[2:]
if args==['login','status']:
    print('Logged in using ChatGPT')
    raise SystemExit(0)
assert args[0]=='exec' and '--json' in args,args
assert args[args.index('--model')+1]=='controlled-model',args
resume=args[2] if args[1]=='resume' else ''
native=resume or 'controlled-receive-thread'
assert native=='controlled-receive-thread',native
out=pathlib.Path(config['output'])
repo=out/'repo'
assert pathlib.Path.cwd()==repo
prompt=sys.stdin.read()
ident='recovery-followup' if resume else 'recovery-initial'
assert '[id: '+ident+']' in prompt,prompt
row={'pid':os.getpid(),'cwd':str(pathlib.Path.cwd()),'argv':sys.argv,
     'resume':resume,'native':native,'prompt':prompt,'api_keys_absent':True}
with (home/'native-observations.jsonl').open('a') as stream:
    stream.write(json.dumps(row)+'\n')
def emit(value): print(json.dumps(value),flush=True)
def git(*args):
    return subprocess.run(['git',*args],check=True,text=True,capture_output=True).stdout.strip()
emit({'type':'thread.started','thread_id':native})
document=repo/'docs/bend2/receive-recovery-example.md'
if not resume:
    checkpoint=[sys.executable,str(out/'control.py'),'checkpoint']
    emit({'type':'item.started','item':{'id':'checkpoint','type':'command_execution',
                                      'command':checkpoint,'status':'in_progress'}})
    completed=subprocess.run(checkpoint,check=True,text=True,capture_output=True)
    emit({'type':'item.completed','item':{'id':'checkpoint','type':'command_execution',
         'command':checkpoint,'status':'completed','exit_code':completed.returncode,
         'aggregated_output':completed.stdout+completed.stderr}})
    document.parent.mkdir(parents=True,exist_ok=True)
    document.write_text('# Controlled receive example\n\n`baton2 DATABASE inbox worker`\n')
    marker='RECOVERY_INITIAL_DONE'
    previous=''
else:
    previous=git('rev-parse','HEAD')
    document.write_text(document.read_text()+'\nA busy receive returns queued.\n')
    marker='RECOVERY_FOLLOWUP_DONE'
git('add',str(document.relative_to(repo)))
git('commit','-q','-m',ident)
commit=git('rev-parse','HEAD')
ack=subprocess.run([str(out/'baton2'),str(out/'state.db'),'ack',ident,'worker',
                    'controlled native reviewed '+ident],check=True,text=True,capture_output=True)
text=marker+' '+previous+' '+commit+'; controlled native protocol, no model or login store.'
emit({'type':'item.completed','item':{'id':'answer','type':'agent_message','text':text}})
emit({'type':'turn.completed','usage':{'input_tokens':0,'output_tokens':0}})
'''


class ReceiveAcceptance(unittest.TestCase):
    def test_public_recruit_and_complete_observer_loss_workflow(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        if not hasattr(select, 'kqueue'):
            self.skipTest('Receive acceptance requires macOS/BSD kqueue')
        directory = Path(tempfile.mkdtemp(prefix='accept-receive-', dir=EXE.parent))
        out = directory / 'run'
        codex = directory / 'controlled-codex'
        codex.write_text('#!' + sys.executable + '\n' + CODEX)
        codex.chmod(0o700)
        (directory / 'fixture.json').write_text(json.dumps({'output': str(out)}) + '\n')
        build_log = directory / 'build.log'
        build_log.write_text('Controlled fixture uses the supplied native binary. No compiler ran.\n')
        argv = [sys.executable, str(DRIVER), '--output', str(out), '--coordinator', str(EXE),
                '--build-log', str(build_log), '--source', str(ROOT), '--revision', 'HEAD',
                '--codex', str(codex), '--model', 'controlled-model', '--effort', 'low']
        env = {**os.environ, 'GIT_AUTHOR_NAME': 'Receive acceptance fixture',
               'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
               'GIT_COMMITTER_NAME': 'Receive acceptance fixture',
               'GIT_COMMITTER_EMAIL': 'fixture@example.invalid',
               'OPENAI_API_KEY': 'unused-controlled-fixture-value',
               'CODEX_API_KEY': 'unused-controlled-fixture-value'}
        child = subprocess.Popen(argv, cwd=ROOT, env=env, text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = child.communicate()
        (directory / 'driver.stdout').write_text(stdout)
        (directory / 'driver.stderr').write_text(stderr)
        observation = {'directory': str(directory), 'argv': argv, 'driver_pid': child.pid,
                       'exit': child.returncode, 'stdout': stdout, 'stderr': stderr,
                       'boundary': 'Controlled Codex protocol and simulated login status; no provider, authentication store or compiler. Native coordinator, observer loss, Git commits, endpoint delivery and receipts are real local effects. Artifacts retained in ignored native scratch.'}
        (directory / 'result.json').write_text(json.dumps(observation, indent=2) + '\n')
        OBSERVATIONS.append(observation)
        self.assertEqual(child.returncode, 0, stderr)
        evidence = json.loads((out / 'evidence.json').read_text())
        recruitment = json.loads((out / 'recruitment.json').read_text())
        seed, repo = out / 'seed', out / 'repo'
        def git(path, *args):
            return subprocess.run(['git', '-C', str(path), *args], check=True, text=True,
                                  capture_output=True).stdout.strip()
        self.assertEqual(git(seed, 'rev-parse', 'HEAD'), evidence['source'])
        self.assertEqual(git(seed, 'branch', '--show-current'), '')
        self.assertEqual(git(repo, 'branch', '--show-current'), 'accept-receive-recovery')
        self.assertEqual(recruitment['session']['workspace'], str(repo))
        self.assertEqual(recruitment['worktree']['commit'], evidence['source'])
        self.assertEqual(recruitment['worktree']['dirty'], False)
        self.assertEqual(evidence['worker_workspace'], str(repo))
        self.assertEqual(len(evidence['repository_commits']), 2)
        self.assertEqual(evidence['remaining_processes'], [])
        self.assertEqual(git(repo, 'status', '--porcelain'), '')
        self.assertEqual(git(repo, 'diff', '--name-only', evidence['source'], 'HEAD'),
                         'docs/bend2/receive-recovery-example.md')
        retry = next(row for row in evidence['timeline'] if row['kind'] == 'normal-receive-retry')
        self.assertEqual(json.loads(retry['event']['stdout']), {'session': 'worker', 'status': 'queued'})
        self.assertEqual(set(evidence['native_thread_ids']), {'controlled-receive-thread'})
        native = [json.loads(line) for line in (directory / 'native-observations.jsonl').read_text().splitlines()]
        self.assertEqual([row['resume'] for row in native], ['', 'controlled-receive-thread'])
        self.assertTrue(all(row['cwd'] == str(repo) and row['api_keys_absent'] for row in native))
        self.assertTrue(all(row['receipt'] for row in evidence['state']['messages']))
        observation['evidence_sha256'] = hashlib.sha256((out / 'evidence.json').read_bytes()).hexdigest()


if __name__ == '__main__':
    unittest.main()
