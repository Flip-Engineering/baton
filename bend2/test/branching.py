"""Branching Ensemble snapshots, native identities, evaluator evidence and continuation."""
import json
import os
import pathlib
import subprocess
import sys
import unittest

import control


class Branching(unittest.TestCase):
    setUp_control = control.Control.setUp
    git = control.Control.git
    call = control.Control.call
    root = control.Control.root
    recruit = control.Control.recruit
    receiver = control.Control.receiver
    accept_any = control.Control.accept_any
    accept = control.Control.accept
    action = control.Control.action
    finish = control.Control.finish
    rows = control.Control.rows
    eventually = control.Control.eventually
    process_rows = control.Control.process_rows
    exited = control.Control.exited
    close_fixtures = control.Control.close_fixtures

    def setUp(self):
        self.setUp_control()
        self.root()
        self.call('connect', 'root', 'saved-root', json.dumps(['/usr/bin/true']))
        source = self.recruit('source')
        self.source = pathlib.Path(source['workspace'])
        self.receiver('source')
        self.call('ensemble', 'search', 'root', 'tight')
        # Native conversation identity follows the generated Player, even when
        # branches deliberately share one model and effort configuration.
        fixture = control.FIXTURE.replace(
            "session=config.get('sessions',{}).get(model,model)",
            "session=os.environ['BATON_SESSION']")
        fixture = fixture.replace("    if action.get('output'):", """    if 'write_branch' in action:
        pathlib.Path('result.json').write_text(json.dumps(action['write_branch']))
        reply({'written':True})
        continue
    if action.get('output'):""")
        self.fixture.write_text('#!' + sys.executable + '\n' + fixture)
        self.task_body = 'Complete the isolated task.\nPreserve "quotes", λ and 🙂.\n' * 100
        (self.source / 'seed.txt').write_text('changed tracked input\n')
        (self.source / 'untracked.txt').write_text('untracked task input\n')
        (self.source / '.gitignore').write_text('required.secret\n')
        (self.source / 'required.secret').write_text('selected ignored task input\n')
        (self.source / 'evaluate.py').write_text('''import json,pathlib,sys
value=json.loads(pathlib.Path('result.json').read_text())
print('retained evaluator diagnostic',file=sys.stderr)
print(json.dumps(value))
sys.exit(value.get('exit',0))
''')
        self.original_index = self.source_git('ls-files', '--stage').stdout
        self.finding_claim = 'Retain the selected source finding. λ\n' * 100
        self.call('record', 'source-finding', 'source', self.finding_claim,
                  'Evidence contains the complete observed source result.', 'Scoped to this source workspace.')

    def source_git(self, *args):
        return subprocess.run(['git', '-C', str(self.source), *args], env=self.environment,
                              check=True, capture_output=True, text=True)

    def branch(self, verb, *args, ok=True):
        return self.call('as', 'root', 'branch', verb, '--ensemble', 'search', *args, ok=ok)

    def start(self, count=2, *options):
        state = self.branch('start', '--from', 'source', '--count', str(count),
                            '--text', self.task_body,
                            '--evaluator', json.dumps([sys.executable, 'evaluate.py']),
                            '--include', json.dumps(['required.secret']),
                            '--knowledge', json.dumps(['source-finding']), *options)
        self.assertEqual(len(state['candidates']), count, state)
        for operation in state['operations']:
            self.assertEqual(operation['result']['status'], 'completed', operation)
        streams = {}
        starts = {}
        for _ in state['candidates']:
            stream, observed = self.accept_any()
            player = observed['session']
            self.assertNotIn(player, streams)
            streams[player], starts[player] = stream, observed
            with (self.directory / 'native-starts.jsonl').open('a') as output:
                output.write(json.dumps(observed) + '\n')
            self.eventually(lambda: self.rows(
                "SELECT s.id FROM sessions s JOIN executions e ON e.session=s.id "
                "WHERE s.id=? AND s.native=? AND e.phase='running'",
                (player, observed['native'])))
        self.assertEqual(set(streams), {candidate['state']['player'] for candidate in state['candidates']})
        return state, streams, starts

    def result(self, stream, score, accepted=True, exit_code=0):
        self.assertEqual(self.action(stream, write_branch={
            'accepted': accepted, 'score': score, 'exit': exit_code}), {'written': True})

    def settle(self, player, stream):
        self.finish(stream, body='Completed isolated branch work.')
        row = self.exited(player)
        self.eventually(lambda: (pathlib.Path(row['directory']) / 'released').exists())
        return row

    def test_snapshots_fresh_context_selection_and_same_conversation_continuation(self):
        state, streams, starts = self.start()
        players = list(streams)
        self.assertNotEqual(starts[players[0]]['native'], starts[players[1]]['native'])
        self.assertNotEqual(starts[players[0]]['cwd'], starts[players[1]]['cwd'])
        for player, started in starts.items():
            self.assertEqual(started['resume'], '')
            self.assertIn(self.task_body, started['prompt'])
            self.assertIn(json.dumps(self.finding_claim, ensure_ascii=False)[1:-1], started['prompt'])
            recorded = next(row['state']['session'] for row in state['candidates']
                            if row['state']['player'] == player)
            self.assertEqual((recorded['parent'], recorded['harness'], recorded['model'], recorded['effort']),
                             ('root', 'omp', 'source', 'low'))
            self.assertEqual(recorded['base'], state['snapshot'])
            workspace = pathlib.Path(started['cwd'])
            self.assertEqual(recorded['workspace'], str(workspace))
            self.assertEqual((workspace / 'seed.txt').read_text(), 'changed tracked input\n')
            self.assertEqual((workspace / 'untracked.txt').read_text(), 'untracked task input\n')
            self.assertEqual((workspace / 'required.secret').read_text(), 'selected ignored task input\n')
            self.assertFalse((workspace / 'result.json').exists())
        self.assertEqual(state['knowledge'][0]['claim'], self.finding_claim)
        self.assertEqual(self.source_git('ls-files', '--stage').stdout, self.original_index)
        self.assertEqual(self.source_git('rev-parse', 'HEAD').stdout.strip(), self.base)
        for score, player in enumerate(players):
            self.result(streams[player], score)
            self.settle(player, streams[player])
        evaluated = self.branch('evaluate')
        self.assertEqual(len(evaluated['evaluations']), 2, evaluated)
        seeds = self.rows('SELECT session,seed,instruction,guidance FROM native_initial_inputs WHERE session IN (?,?)', players)
        self.assertEqual(len({row['seed'] for row in seeds}), 2, seeds)
        for row in seeds:
            self.assertIn(self.task_body, row['guidance'])
            self.assertIn(row['seed'], starts[row['session']]['prompt'])
            self.assertIn(row['instruction'], starts[row['session']]['prompt'])
        for result in evaluated['evaluations']:
            self.assertTrue(result['accepted'], result)
            self.assertEqual(result['argv'], [sys.executable, 'evaluate.py'])
            self.assertEqual(result['native'], starts[result['player']]['native'])
            self.assertEqual((result['phase'], result['nativeStatus']), ('exited', 'exit 0'))
            self.assertEqual(len(result['snapshot']), 40)
            self.assertEqual(result['result']['waitStatus'], 'exit 0')
            self.assertIn('retained evaluator diagnostic', result['result']['stderr'])
            self.assertTrue(pathlib.Path(result['workspace']).is_dir())
            self.assertNotEqual(result['workspace'], starts[result['player']]['cwd'])
        selected = self.branch('select')
        winner = players[-1]
        self.assertEqual(selected['selection']['player'], winner)
        original_native = starts[winner]['native']
        self.branch('continue')
        stream, resumed = self.accept(winner)
        self.assertEqual(resumed['native'], original_native)
        self.assertTrue(resumed['resume'])
        self.assertEqual(resumed['cwd'], starts[winner]['cwd'])
        self.assertIn(self.task_body, resumed['prompt'])
        self.settle(winner, stream)
        retained = self.branch('status')
        self.assertEqual(len(retained['candidates']), 2)
        self.assertTrue(pathlib.Path(starts[players[0]]['cwd']).is_dir())
        # A second explicit intervention forks the selected workspace and keeps
        # the prior round, evaluations and nonselected workspaces intact.
        followup = self.branch('start', '--count', '1', '--text', 'Review the selected result.',
                               '--evaluator', json.dumps([sys.executable, 'evaluate.py']))
        self.assertEqual(followup['ancestor'], state['round'])
        self.assertEqual(followup['source'], winner)
        new_player = followup['candidates'][0]['state']['player']
        stream, new_native = self.accept(new_player)
        self.assertNotEqual(new_native['native'], original_native)
        self.assertEqual(new_native['resume'], '')
        self.settle(new_player, stream)

    def test_partial_evaluation_explicit_selection_and_stop_survive_recovery(self):
        state, streams, starts = self.start()
        first, second = list(streams)
        self.result(streams[first], 3)
        self.settle(first, streams[first])
        evaluated = self.branch('evaluate')
        self.assertEqual([row['player'] for row in evaluated['evaluations']], [first])
        self.assertTrue(any(row['operation'] == 'evaluate' and row['session'] == second
                            for row in self.rows('SELECT * FROM branch_operations WHERE round=?', (state['round'],))))
        refused = self.branch('select', ok=False)
        self.assertIn('partial', refused['stderr'])
        chosen = self.branch('select', '--player', first, '--reason', 'The other branch remains active; continue the reviewed result.')
        self.assertEqual(chosen['selection']['player'], first)
        self.assertIsNone(starts[second].get('resume') or None)
        stopped = self.branch('stop', '--player', second, '--reason', 'Conductor ends this branch explicitly.')
        stop = next(row for row in stopped['candidates'] if row['state']['player'] == second)['state']['stop']
        self.assertEqual(stop['reason'], 'Conductor ends this branch explicitly.')
        self.eventually(lambda: self.rows("SELECT session FROM executions WHERE session=? AND phase='exited'", (second,)))
        before = self.rows('SELECT native FROM sessions WHERE id=?', (second,))[0]['native']
        recovered = self.branch('recover')
        self.assertEqual(next(row for row in recovered['candidates'] if row['state']['player'] == second)['state']['stop']['id'], stop['id'])
        self.assertEqual(self.rows('SELECT native FROM sessions WHERE id=?', (second,))[0]['native'], before)
        self.assertTrue(pathlib.Path(starts[second]['cwd']).is_dir())
        self.assertEqual(self.rows('SELECT count(*) AS n FROM messages WHERE id=?', (second + ':branch-task',))[0]['n'], 1)
        pending = self.call('delivery', second + ':branch-task')
        self.assertIsNone(pending['receipt'])
        self.assertIn(self.task_body, pending['body'])

    def test_ties_and_failed_evaluators_remain_explicit(self):
        state, streams, starts = self.start()
        for player, stream in streams.items():
            self.result(stream, 5)
            self.settle(player, stream)
        tied = self.branch('evaluate')
        self.assertEqual([row['score'] for row in tied['evaluations']], [5, 5])
        self.branch('select', ok=False)
        winner = list(streams)[0]
        self.branch('select', '--player', winner, ok=False)
        self.branch('select', '--player', winner, '--reason', 'Equal scores; choose the reviewed implementation.')
        # A later evaluation retains the previous result and records the real
        # evaluator failure with both streams and its ordinary wait status.
        failing = pathlib.Path(starts[winner]['cwd']) / 'result.json'
        failing.write_text(json.dumps({'accepted': True, 'score': 10, 'exit': 3}))
        failed = self.branch('evaluate')
        current = [row for row in failed['evaluations'] if row['player'] == winner][-1]
        self.assertEqual(current['result']['waitStatus'], 'exit 3')
        self.assertIsNone(current['accepted'])
        self.assertIn('retained evaluator diagnostic', current['result']['stderr'])
        self.assertGreater(len(failed['evaluations']), len(tied['evaluations']))

    def test_managed_transport_requires_an_explicit_native_command(self):
        self.call('connect', 'source', 'native-source', json.dumps(['/usr/bin/true']))
        refused = self.branch('start', '--from', 'source', '--count', '1', '--text', self.task_body,
                              '--evaluator', json.dumps([sys.executable, 'evaluate.py']), ok=False)
        self.assertIn('configured executable', refused['stderr'])
        state, streams, starts = self.start(1, '--command', str(self.fixture))
        player = next(iter(streams))
        self.assertEqual(starts[player]['resume'], '')
        self.result(streams[player], 1)
        self.settle(player, streams[player])
        self.assertEqual(self.branch('evaluate')['evaluations'][0]['result']['waitStatus'], 'exit 0')

    def test_failed_receiver_setup_retains_task_for_recovery(self):
        delayed = self.directory / 'late-native'
        failed = self.branch('start', '--from', 'source', '--count', '1', '--text', self.task_body,
                             '--evaluator', json.dumps([sys.executable, 'evaluate.py']),
                             '--command', str(delayed))
        player = failed['candidates'][0]['state']['player']
        configuration = [row for row in failed['operations'] if row['operation'] == 'receiver']
        self.assertEqual(len(configuration), 1, failed)
        self.assertEqual(configuration[0]['result']['status'], 'failed')
        self.assertTrue(configuration[0]['result']['stderr'], configuration)
        self.assertEqual(failed['task'], self.task_body)
        self.assertFalse(any(row['operation'] == 'dispatch' for row in failed['operations']))
        self.assertFalse(self.rows('SELECT * FROM messages WHERE id=?', (player + ':branch-task',)))
        delayed.write_bytes(self.fixture.read_bytes())
        delayed.chmod(0o755)
        recovered = self.branch('recover')
        self.assertEqual(recovered['round'], failed['round'])
        self.assertEqual(recovered['candidates'][0]['state']['player'], player)
        self.assertEqual(len([row for row in recovered['operations'] if row['operation'] == 'recruit']), 1)
        self.assertEqual([row for row in recovered['operations'] if row['operation'] == 'receiver'][-1]['result']['status'], 'completed')
        stream, start = self.accept(player)
        self.assertEqual(start['resume'], '')
        self.assertIn(self.task_body, start['prompt'])
        self.settle(player, stream)

    def test_scope_path_and_evaluator_refusals_preserve_source(self):
        for path in ('../outside', 'child/..', '.git/config', 'child/.git'):
            refused = self.branch('start', '--from', 'source', '--count', '1', '--text', 'Task',
                                  '--evaluator', json.dumps([sys.executable, 'evaluate.py']),
                                  '--include', json.dumps([path]), ok=False)
            self.assertIn('--include', refused['stderr'])
        self.branch('start', '--from', 'source', '--count', '1', '--text', 'Task',
                    '--evaluator', 'python3 evaluate.py', ok=False)
        self.assertEqual(self.source_git('ls-files', '--stage').stdout, self.original_index)
        self.branch('status', '--text', 'Unused input must refuse.', ok=False)
        self.call('attach', 'outsider', 'omp', '', '')
        refused = self.call('as', 'outsider', 'branch', 'status', '--ensemble', 'search', ok=False)
        self.assertIn('Conductor', refused['stderr'])


if __name__ == '__main__':
    unittest.main()
