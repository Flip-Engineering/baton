"""Integration test for the Bend2 Muse Conductor receive wake (issues #564 and #592).

A registered Muse Conductor is a supported harness session whose delivery endpoint
is the native receive operation. This suite proves, against the real coordinator
binary, that a committed report starts a Muse turn in an idle session, that the
turn reaches the session's recorded native conversation, that input committed
while that turn is live is drained exactly once by a later turn, and that no
other session's pending row is consumed.
"""
import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

spec = importlib.util.spec_from_file_location('receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)

# The fixture speaks the Muse adapter's `exec --json` stream: a stream session
# envelope carrying the native identity, the turn's input command, and the
# terminal result that names the same command. It acknowledges every delivered
# input through the coordinator CLI, as a real Conductor does. The first turn
# holds until the test releases it, so a later input is committed while this
# attempt still owns the session.
MUSE_FIXTURE = '''#!__PYTHON__
import json,os,pathlib,re,subprocess,sys,time
EXE=__EXE__
DB=__DB__
CALLS=pathlib.Path(__CALLS__)
GATE=pathlib.Path(__GATE__)
args=sys.argv[1:]
prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
native=args[args.index('--session-id')+1] if '--session-id' in args else 'native-muse-fresh'
with CALLS.open('a') as output:
    output.write(json.dumps({'pid':os.getpid(),'args':args,'cwd':os.getcwd(),'prompt':prompt,'native':native})+chr(10))
for ident in re.findall(r'\\[id: (.*?)\\]:',prompt):
    accepted=subprocess.run([EXE,DB,'ack',ident,'root','muse reviewed this input'],capture_output=True,text=True)
    assert accepted.returncode==0, accepted.stderr
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user',
                  'payload':{'kind':'turn_input_user','command_id':'muse-primary'}}),flush=True)
while not GATE.exists():
    time.sleep(0.05)
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.completed',
                  'payload':{'kind':'run_terminal','terminal':'completed','command_id':'muse-primary',
                             'text':'Muse Conductor reviewed the delivered input.'}}),flush=True)
'''


class MuseConductorReceive(unittest.TestCase):
    """A Muse Conductor's registered receive endpoint wakes it for its input."""

    close_children = receive.Receive.close_children
    owned_processes = receive.Receive.owned_processes

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.children = []
        self.controls = []
        self.home = self.directory / 'isolated-home'
        self.home.mkdir()
        self.environment = dict(os.environ, HOME=str(self.home))
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Muse wake fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True,
                           env=self.environment)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True,
                       capture_output=True, env=self.environment)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'], check=True,
                       capture_output=True, env=self.environment)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'], check=True,
                                   capture_output=True, text=True,
                                   env=self.environment).stdout.strip()
        self.db = self.directory / 'state.db'
        self.calls = self.directory / 'muse-calls.jsonl'
        self.gate = self.directory / 'release-muse-turn'
        self.log = self.directory / 'root.jsonl'
        self.native = self.directory / 'muse fixture'
        self.native.write_text(MUSE_FIXTURE
                               .replace('__PYTHON__', sys.executable)
                               .replace('__EXE__', repr(str(EXE)))
                               .replace('__DB__', repr(str(self.db)))
                               .replace('__CALLS__', repr(str(self.calls)))
                               .replace('__GATE__', repr(str(self.gate))))
        self.native.chmod(0o700)
        self.task = self.directory / 'start-task.txt'
        self.task.write_text('Start the Muse Conductor.\n')
        self.late = self.directory / 'late-report.txt'
        self.late.write_text('Late report during the active turn.\n')
        self.unrelated = self.directory / 'unrelated.txt'
        self.unrelated.write_text('This row belongs to another Player.\n')

    def tearDown(self):
        self.close_children()
        self.temp.cleanup()

    def coord(self, *args, ok=True):
        child = subprocess.run([str(EXE), str(self.db), *map(str, args)], env=self.environment,
                               text=True, capture_output=True)
        if ok:
            self.assertEqual(child.returncode, 0, child.stderr)
        return child.stdout.strip()

    def calls_made(self):
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text().splitlines() if line.strip()]

    def eventually(self, observation, description):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(0.05)

    def dispatch(self, *args):
        result = json.loads(self.coord(*args))
        self.assertEqual(result['state'], 'launched')
        self.assertGreater(result['deliveryPid'], 0)
        return result

    def test_a_muse_principal_is_woken_from_idle_and_drains_the_input_that_arrives_during_its_turn(self):
        # The operator starts the parentless Muse Conductor. The recorded
        # workspace and the receiver endpoint are the session's wake address.
        launched = self.dispatch('start', 'root', 'muse', str(self.native), 'muse-model', 'low',
                                 str(self.repo), str(self.log), 'start-task', str(self.task))
        self.assertGreater(launched['deliveryPid'], 0)
        self.coord('recruit', 'child', 'root', 'omp', 'child-model', 'low', str(self.repo),
                   'child-branch', str(self.checkouts / 'child'), self.base)
        self.coord('recruit', 'other', 'root', 'omp', 'other-model', 'low', str(self.repo),
                   'other-branch', str(self.checkouts / 'other'), self.base)

        started = self.eventually(lambda: self.calls_made()[:1], 'The Muse root did not start its task turn.')
        root = json.loads(self.coord('player', 'root'))
        self.assertEqual(root['role'], 'principal-conductor')
        self.assertIsNone(root['parent'])
        self.assertEqual(root['workspace'], str(self.repo.resolve()))
        # The wake address is the stored session endpoint: the native receive
        # operation with the session's own recorded command and log. It names no
        # session, process or path supplied by configuration.
        self.assertEqual(json.loads(self.coord('session', 'root'))['endpointArgv'],
                         [str(EXE.resolve()), str(self.db.resolve()), 'receive', 'root',
                          str(self.native.resolve()), '', '', '', str(self.log.resolve())])
        # The idle-registered root is woken into a turn that reads its task from
        # the attempt's own prompt file and starts a fresh Muse conversation.
        self.assertEqual(started[0]['cwd'], str(self.repo.resolve()))
        args = started[0]['args']
        task_path = pathlib.Path(args[args.index('--prompt-file') + 1])
        with sqlite3.connect(self.db) as database:
            attempts = database.execute("SELECT directory FROM executions WHERE session='root'").fetchall()
        self.assertEqual(attempts, [(str(task_path.parent),)])
        self.assertIn('Start the Muse Conductor.', task_path.read_text())
        self.assertNotIn('--session-id', args)
        self.assertEqual(args[args.index('--model') + 1], 'muse-model')
        self.assertEqual(args[args.index('--reasoning-effort') + 1], 'low')

        # A row addressed to another Player is pending throughout, and a report
        # committed while the root's turn is live waits for the session's single
        # owner instead of starting a second native conversation.
        self.coord('message', 'unrelated', 'root', 'other', 'guidance', self.unrelated.read_text())
        self.dispatch('dispatch-file', 'late-report', 'child', 'root', 'report', str(self.late))
        self.assertEqual(len(self.calls_made()), 1)
        self.assertIsNone(json.loads(self.coord('delivery', 'late-report'))['receipt'])

        self.gate.write_text('release\n')

        second = self.eventually(lambda: self.calls_made()[1:2], 'The queued input was never drained.')
        # The drained turn continues the conversation the first turn recorded.
        self.assertEqual(second[0]['args'][second[0]['args'].index('--session-id') + 1], 'native-muse-fresh')
        self.assertEqual(second[0]['cwd'], str(self.repo.resolve()))
        self.assertIn('Late report during the active turn.', second[0]['prompt'])
        self.assertNotIn('Start the Muse Conductor.', second[0]['prompt'])

        self.eventually(lambda: len(self.calls_made()) == 2, 'The retained attempt started more than twice.')
        self.assertEqual(len(self.calls_made()), 2)
        # The drained turn ran a new native process from the same stored address.
        self.assertNotEqual(self.calls_made()[0]['pid'], self.calls_made()[1]['pid'])
        self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-muse-fresh')
        self.assertEqual(json.loads(self.coord('delivery', 'late-report'))['receipt'],
                         'muse reviewed this input')
        self.assertEqual(json.loads(self.coord('delivery', 'start-task'))['receipt'],
                         'muse reviewed this input')

        # Both turns reported the parentless Conductor's result to the operator.
        self.eventually(lambda: len(json.loads(self.coord('turns', 'root'))) == 2,
                        'The completed Muse turns did not retain their reports.')
        self.assertEqual(len(json.loads(self.coord('turns', 'root'))), 2)
        inbox = json.loads(self.coord('inbox', 'operator'))
        self.assertEqual([row['recipient'] for row in inbox], ['operator', 'operator'])
        self.assertEqual({row['sender'] for row in inbox}, {'root'})
        self.assertEqual({row['body'] for row in inbox},
                         {'Muse Conductor reviewed the delivered input.'})

        # The other Player's row was never consumed by this session's receive.
        self.assertIsNone(json.loads(self.coord('delivery', 'unrelated'))['receipt'])
        self.assertIn('unrelated', [row['id'] for row in json.loads(self.coord('inbox', 'other'))])
        self.assertNotIn('This row belongs to another Player.',
                         ''.join(call['prompt'] for call in self.calls_made()))


if __name__ == '__main__':
    unittest.main()
