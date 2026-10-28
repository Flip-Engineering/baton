"""Exercise contextual native message actions against retained public records."""

import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import receive as receive_fixture


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class AgentActions(unittest.TestCase):
    def setUp(self):
        if not receive_fixture.require_candidate():
            self.fail(f'Coordinator not built at {receive_fixture.EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.addCleanup(self.shutdown_private_owner)
        self.repo = self.directory / 'repo'
        self.repo.mkdir()
        for args in [('init', '-q'), ('config', 'user.name', 'Agent actions fixture'),
                     ('config', 'user.email', 'fixture@example.invalid'),
                     ('commit', '-qm', 'Initial tree', '--allow-empty')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                           capture_output=True, text=True)
        self.deliveries = self.directory / 'deliveries.jsonl'
        endpoint = self.directory / 'endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            f'with pathlib.Path({str(self.deliveries)!r}).open("a") as f:\n'
                            ' f.write(sys.argv[-1]+"\\n")\n')
        self.endpoint = json.dumps([sys.executable, str(endpoint)])
        self.legacy('attach', 'root', 'fixture', '', self.endpoint)
        self.legacy('role', 'root', 'principal-conductor')
        self.legacy('attach', 'other-root', 'fixture', '', self.endpoint)
        self.legacy('role', 'other-root', 'principal-conductor')
        for name in ('worker-a', 'worker-b'):
            self.legacy('recruit', name, 'root', 'fixture', 'model', 'low',
                        str(self.repo), name + '-branch',
                        str(self.directory / name), 'HEAD')
            self.legacy('connect', name, '', self.endpoint)

    def shutdown_private_owner(self, database=None):
        database = self.db if database is None else database
        if not database.exists():
            return
        owner = f'{EXE.resolve()} --instance-owner '
        receive_fixture.Receive.eventually(self, lambda: all(
            process['command'].startswith(owner)
            for process in receive_fixture.Receive.owned_processes(self)),
            'Asynchronous fixture work did not finish before owner shutdown.')
        result = subprocess.run([str(EXE), '--instance-shutdown', str(database)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receive_fixture.Receive.eventually(self, lambda: not any(
            process['command'] == owner + str(database.resolve())
            for process in receive_fixture.Receive.owned_processes(self)),
            'The fixture database owner did not exit after shutdown.')

    def invoke(self, *args, cwd=None, success=True, environment=None):
        env = os.environ.copy()
        for key in ('BATON_DATABASE', 'BATON_SESSION', 'CODEX_THREAD_ID'):
            env.pop(key, None)
        if environment:
            env.update(environment)
        result = subprocess.run([str(EXE), *map(str, args)], cwd=cwd,
                                env=env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def legacy(self, *args, success=True):
        return self.invoke(self.db, *args, success=success)

    def action(self, session, *args, success=True):
        return self.invoke(self.db, 'as', session, *args, success=success)

    def stored_messages(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('SELECT id,sender,recipient,kind,body,receipt '
                              'FROM messages ORDER BY seq').fetchall()

    def endpoint_output(self):
        owner = f'{EXE.resolve()} --instance-owner '
        receive_fixture.Receive.eventually(self, lambda: all(
            process['command'].startswith(owner)
            for process in receive_fixture.Receive.owned_processes(self)),
            'The fixture endpoint did not finish its detached delivery.')
        return self.deliveries.read_bytes() if self.deliveries.exists() else b''

    def test_compact_actions_resolve_context_and_retained_completion(self):
        self.legacy('project', self.repo)
        routes = [('bare', ()), ('project', ('--project', self.repo)),
                  ('actor', ('as', 'worker-a')), ('database', (self.db, 'as', 'worker-a'))]
        for label, prefix in routes:
            with self.subTest(route=label):
                environment = {'BATON_DATABASE': str(self.db), 'BATON_SESSION': 'worker-a'}
                for action, kind in [('report', 'report'), ('ask', 'question')]:
                    body = label + ' complete ' + action + ': λ / 漢字 / "quotes"\n'
                    result = self.invoke(*prefix, action, body, cwd=self.repo,
                                         environment=environment)
                    self.assertEqual(len(result), 1)
                    message = self.stored_messages()[-1]
                    self.assertEqual(message[1:5], ('worker-a', 'root', kind, body))
                sent = self.invoke(*prefix, 'send', 'root', 'and', cwd=self.repo,
                                   environment=environment)[0]
                self.assertEqual(sent['status'], 'admitted')
                self.assertEqual(sent['delivery']['body'], 'and')
                self.assertEqual(sent['delivery']['kind'], 'report')
                self.legacy('message', label + '-assignment', 'root', 'worker-a',
                            'task-assignment', 'Complete this assigned work.')
                summary = label + ' complete summary: λ / 漢字\n'
                request = self.invoke(*prefix, 'finish', summary, cwd=self.repo,
                                      environment=environment)[0]
                self.assertEqual(request['status'], 'admitted')
                self.assertEqual(request['delivery']['body'], summary)
                self.assertEqual(request['delivery']['kind'], 'completion-request')
                state = self.legacy('session', 'worker-a')['taskCompletion']
                self.assertEqual(state['requestId'], request['id'])
                self.assertFalse(state['confirmed'])
                confirmed = self.invoke('confirm', 'worker-a', cwd=self.repo,
                                        environment={**environment, 'BATON_SESSION': 'root'})[0]
                self.assertEqual(confirmed['status'], 'admitted')
                self.assertEqual(confirmed['delivery']['body'], request['id'])
                self.assertTrue(self.legacy('session', 'worker-a')['taskCompletion']['confirmed'])
                guided = self.invoke('guide', 'worker-a', 'Continue the next assignment.',
                                     cwd=self.repo,
                                     environment={**environment, 'BATON_SESSION': 'root'})[0]
                self.assertEqual(guided['delivery']['kind'], 'guidance')
                self.assertEqual(guided['delivery']['body'], 'Continue the next assignment.')

    def test_named_sends_default_each_kind_to_report(self):
        result = self.action('root', 'send', 'worker-a', '--text', 'First complete report.',
                             'and', 'worker-b', '--text', 'Second complete report.')
        self.assertEqual([row['delivery']['kind'] for row in result], ['report', 'report'])
        self.assertEqual([row['delivery']['body'] for row in result],
                         ['First complete report.', 'Second complete report.'])

    def test_positional_guidance_preserves_batch_words_as_text_and_recipient(self):
        self.legacy('join', 'and', 'root', 'fixture', 'model', 'low', self.repo)
        self.legacy('connect', 'and', '', self.endpoint)
        for recipient, body in [('worker-a', 'and'), ('worker-a', '--and'),
                                ('and', 'Continue the complete assignment.')]:
            with self.subTest(recipient=recipient, body=body):
                result = self.action('root', 'guide', recipient, body)[0]
                self.assertEqual(result['status'], 'admitted')
                self.assertEqual((result['delivery']['recipient'],
                                  result['delivery']['kind'], result['delivery']['body']),
                                 (recipient, 'guidance', body))

    def test_help_actions_need_no_project_pointer(self):
        for args in [('help',), ('inbox', '--help'), ('read', '--help'),
                     ('send', '--help'),
                     ('session', '--help'), ('player', '--help'),
                     ('players', '--help'), ('assignment', '--help'),
                     ('completion-request', '--help'),
                     ('completion-confirmed', '--help'), ('finish', '--help'),
                     ('confirm', '--help'), ('guide', '--help')]:
            with self.subTest(args=args):
                result = subprocess.run([str(EXE), 'as', 'root', *args],
                                        cwd=self.directory, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue(result.stdout or result.stderr)

    def test_contextual_help_keeps_two_token_precedence(self):
        cases = (
            (('help', '--help'), ('help',)),
            (('help', '-h'), ('help',)),
            (('unknown-action', '--help'), ('help',)),
            (('', '-h'), ('help',)),
            (('--help', '--help'), ('help',)),
            (('-h', '-h'), ('help',)),
            (('player', '-h'), ('help', 'player')),
            (('players', '--help'), ('help', 'players')),
            (('session', '--help'), ('help', 'session')),
            (('assignment', '-h'), ('help', 'assignment')),
            (('completion-request', '--help'), ('help', 'completion-request')),
            (('completion-confirmed', '-h'), ('help', 'completion-confirmed')),
            (('guide', '--help'), ('help', 'guide')),
        )
        for args, expected in cases:
            with self.subTest(args=args):
                actual = subprocess.run([str(EXE), 'as', 'root', *args],
                                        cwd=self.directory, capture_output=True, text=True)
                reference = subprocess.run([str(EXE), 'as', 'root', *expected],
                                           cwd=self.directory, capture_output=True, text=True)
                self.assertEqual(actual.returncode, 0, actual.stdout + actual.stderr)
                self.assertEqual(reference.returncode, 0,
                                 reference.stdout + reference.stderr)
                self.assertEqual((actual.stdout, actual.stderr),
                                 (reference.stdout, reference.stderr))

    def test_contextual_inspection_and_help_reject_extra_arguments(self):
        before = self.stored_messages()
        delivered = self.endpoint_output()
        for args in (('player',), ('player', ''), ('player', 'worker-a', 'extra'),
                     ('players', 'extra'), ('session', ''),
                     ('session', 'worker-a', 'extra'), ('assignment', ''),
                     ('assignment', 'worker-a', 'extra'),
                     ('help', 'players', 'extra'), ('guide', '--help', 'extra')):
            with self.subTest(args=args):
                self.action('root', *args, success=False)
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.endpoint_output(), delivered)

    def test_bare_and_project_contextual_inspection_and_task_messages(self):
        self.legacy('project', self.repo)
        routes = [('bare', ()), ('project', ('--project', self.repo))]
        for name in ('read', 'inbox', 'send'):
            project = self.directory / name
            project.mkdir()
            subprocess.run(['git', '-C', str(project), 'init', '-q'], check=True,
                           capture_output=True, text=True)
            self.legacy('project', project)
            routes.append(('project-' + name, ('--project', name)))
        for label, prefix in routes:
            with self.subTest(route=label):
                selected_db = self.db if label == 'bare' else self.directory / 'absent.db'
                worker_env = {'BATON_DATABASE': str(selected_db),
                              'BATON_SESSION': 'worker-a'}
                root_env = {**worker_env, 'BATON_SESSION': 'root'}
                worker = self.legacy('session', 'worker-a')
                self.assertEqual(self.invoke(*prefix, 'session', cwd=self.directory,
                                             environment=worker_env), worker)
                self.assertEqual(self.invoke(*prefix, 'session', 'root',
                                             cwd=self.directory, environment=worker_env),
                                 self.legacy('session', 'root'))
                self.assertEqual(self.invoke(*prefix, 'player', 'worker-a',
                                             cwd=self.directory, environment=root_env),
                                 self.legacy('player', 'worker-a'))
                self.assertEqual(self.invoke(*prefix, 'players', cwd=self.directory,
                                             environment=root_env), self.legacy('players'))
                self.assertEqual(self.invoke(*prefix, 'assignment', cwd=self.directory,
                                             environment=worker_env), worker)
                self.legacy('message', label + '-task', 'root', 'worker-a',
                            'task-assignment', 'Complete this contextual task.')
                request = self.invoke(*prefix, 'completion-request', '--text',
                                      'Complete report with λ🙂.\n', '--id', label + '-request',
                                      cwd=self.directory, environment=worker_env)
                self.assertEqual(request[0]['status'], 'admitted')
                self.assertEqual(request[0]['delivery']['sender'], 'worker-a')
                self.assertEqual(request[0]['delivery']['recipient'], 'root')
                self.assertEqual(request[0]['delivery']['body'], 'Complete report with λ🙂.\n')
                confirmation = self.invoke(*prefix, 'completion-confirmed', '--request',
                                           request[0]['id'], cwd=self.directory,
                                           environment=root_env)
                self.assertEqual(confirmation[0]['status'], 'admitted')
                self.assertEqual(confirmation[0]['delivery']['recipient'], 'worker-a')
                self.assertEqual(confirmation[0]['delivery']['body'], request[0]['id'])
                state = self.legacy('session', 'worker-a')['taskCompletion']
                self.assertEqual(state['requestId'], request[0]['id'])
                self.assertTrue(state['confirmed'])
                self.assertFalse(state['open'])
                guidance = self.invoke(*prefix, 'guide', '--to', 'worker-a', '--text',
                                       'Continue with the next task.\n', '--id', label + '-guide',
                                       cwd=self.directory, environment=root_env)
                self.assertEqual(guidance[0]['status'], 'admitted')
                self.assertEqual(guidance[0]['delivery']['sender'], 'root')
                self.assertEqual(guidance[0]['delivery']['kind'], 'guidance')
                self.assertEqual(guidance[0]['delivery']['body'], 'Continue with the next task.\n')

    def test_bare_and_project_new_action_help_needs_no_context(self):
        env = {'PATH': os.environ.get('PATH', '')}
        for action in ('session', 'player', 'players', 'assignment',
                       'completion-request', 'completion-confirmed', 'guide'):
            for prefix in ((), ('--project', str(self.directory / 'unregistered'))):
                with self.subTest(action=action, prefix=prefix):
                    result = subprocess.run([str(EXE), *prefix, action, '--help'],
                                            cwd=self.directory, env=env,
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertTrue(result.stdout)

    def test_database_first_inspection_keeps_legacy_actor_and_database(self):
        env = {'BATON_DATABASE': str(self.directory / 'absent.db'),
               'BATON_SESSION': 'worker-b'}
        for args in (('session', 'root'), ('player', 'worker-a'), ('players',),
                     ('status',)):
            with self.subTest(args=args):
                self.assertEqual(self.invoke(self.db, *args, cwd=self.directory,
                                             environment=env), self.legacy(*args))

        body = 'Complete positional dispatch body.\nKeep λ🙂 and --id literally.\n'
        path = self.directory / 'positional dispatch.txt'
        path.write_text(body)
        self.invoke(self.db, 'dispatch-file', 'positional-dispatch', 'root', 'worker-a',
                    'guidance', path, cwd=self.directory, environment=env)
        delivered = self.legacy('delivery', 'positional-dispatch')
        self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind'],
                          delivered['body']), ('root', 'worker-a', 'guidance', body))

    def test_database_named_report_and_knowledge_keep_actor_body_and_read(self):
        env = {'BATON_DATABASE': str(self.directory / 'absent.db'),
               'BATON_SESSION': 'worker-a'}
        self.legacy('message', 'database-named-task', 'root', 'worker-a',
                    'task-assignment', 'Preserve this complete assignment.\nλ🙂')
        before = self.legacy('session', 'worker-a')
        body = 'Complete database report.\nKeep --and, --id and λ🙂 literally.\n'
        reported = self.invoke(self.db, 'report', '--text', body,
                               environment=env)[0]
        self.assertEqual(reported['status'], 'completed')
        report_id = reported['nativeArgv'][3]
        report = self.legacy('delivery', report_id)
        self.assertEqual((report['sender'], report['recipient'], report['kind'], report['body']),
                         ('worker-a', 'root', 'report', body))
        self.action('root', 'read', report_id)
        self.assertTrue(receive_fixture.read_recorded(self.db, report_id, 'root'))
        repeated = self.invoke(self.db, 'report', '--id', report_id, '--text', body,
                               environment=env)[0]
        self.assertEqual(repeated['status'], 'completed')
        self.assertIsNone(self.legacy('delivery', report_id)['receipt'])

        claim = 'The complete report supports this finding.\nKeep λ🙂 and the final newline.\n'
        recorded = self.invoke(self.db, 'knowledge', 'record', '--kind', 'observation',
                               '--claim', claim, '--evidence', 'report', '--limits', '--kind',
                               '--and', 'ask', '--text', '--id', environment=env)
        self.assertEqual([row['status'] for row in recorded], ['completed', 'completed'])
        finding = next(row for row in self.legacy('knowledge', 'worker-a')
                       if row['claim'] == claim)
        self.assertEqual(finding['author'], 'worker-a')
        self.assertEqual(finding['limits'], '--kind')
        self.assertEqual(finding['evidenceMessage']['id'], report_id)
        self.assertEqual(finding['evidenceMessage']['body'], body)
        read = self.invoke(self.db, 'knowledge', 'read', environment=env)[0]
        self.assertEqual(read['status'], 'completed')
        selected = next(row for row in json.loads(read['stdout']) if row['id'] == finding['id'])
        self.assertEqual((selected['author'], selected['claim'], selected['evidenceMessage']['body']),
                         ('worker-a', claim, body))
        for args in (('knowledge',), ('knowledge', '--scope', 'worker', '--subject', 'worker-a')):
            with self.subTest(args=args):
                equivalent = self.invoke(self.db, *args, environment=env)[0]
                self.assertEqual(equivalent['status'], 'completed')
                self.assertEqual(json.loads(equivalent['stdout']), json.loads(read['stdout']))
        batch_body = 'Report after the complete default knowledge read.\nλ🙂'
        batch = self.invoke(self.db, 'knowledge', '--and', 'report', '--text', batch_body,
                            environment=env)
        self.assertEqual([row['status'] for row in batch], ['completed', 'completed'])
        self.assertEqual(json.loads(batch[0]['stdout']), json.loads(read['stdout']))
        self.assertEqual(self.legacy('delivery', batch[1]['nativeArgv'][3])['body'], batch_body)
        question = self.legacy('delivery', recorded[1]['nativeArgv'][3])
        self.assertEqual((question['sender'], question['recipient'], question['body']),
                         ('worker-a', 'root', '--id'))
        self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'],
                         before['taskCompletion'])
        self.assertIsNone(self.legacy('delivery', 'database-named-task')['receipt'])
        self.assertFalse((self.directory / 'absent.db').exists())

    def test_database_named_recruit_and_role_infer_parent_and_keep_worktree(self):
        env = {'BATON_DATABASE': str(self.directory / 'absent.db'), 'BATON_SESSION': 'root'}
        workspace = self.directory / 'named lead λ'
        result = self.invoke(self.db, 'recruit', '--session', 'named-lead',
                             '--harness', 'fixture', '--model', 'model', '--effort', 'high',
                             '--repo', self.repo, '--branch', 'named-lead-branch',
                             '--path', workspace, '--base', 'HEAD', environment=env)[0]
        self.assertEqual(result['status'], 'completed')
        lead = self.legacy('session', 'named-lead')
        self.assertEqual((lead['parent'], lead['harness'], lead['model'], lead['effort'],
                          lead['workspace'], lead['branch']),
                         ('root', 'fixture', 'model', 'high', str(workspace), 'named-lead-branch'))
        self.assertTrue((workspace / '.git').exists())
        assigned = self.invoke(self.db, 'role', '--session', 'named-lead',
                               '--role', 'associate-conductor', environment=env)[0]
        self.assertEqual(assigned['status'], 'completed')
        self.assertEqual(self.legacy('role', 'named-lead')['role'], 'associate-conductor')
        self.assertFalse((self.directory / 'absent.db').exists())

    def test_database_named_help_resolves_before_database_and_actor(self):
        missing = self.directory / 'help-only.db'
        env = os.environ.copy()
        for key in ('BATON_DATABASE', 'BATON_SESSION', 'CODEX_THREAD_ID'):
            env.pop(key, None)
        for args, expected in ((('help', 'recruit'), 'recruit --session'),
                               (('recruit', '--help'), 'recruit --session'),
                               (('knowledge', 'record', '--help'), 'knowledge record'),
                               (('report', '--help'), 'report')):
            with self.subTest(args=args):
                result = subprocess.run([str(EXE), str(missing), *args], cwd=self.directory,
                                        env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(expected, result.stdout)
                self.assertFalse(missing.exists())

    def test_database_named_routing_preserves_positional_knowledge_and_report(self):
        finding = self.legacy('record', 'legacy-finding', 'worker-a',
                              'Complete positional finding.', '', '')
        self.assertEqual(finding['id'], 'legacy-finding')
        rows = self.legacy('knowledge', 'worker-a')
        self.assertEqual(rows[0]['claim'], 'Complete positional finding.')
        report = self.legacy('report', 'legacy-report', 'worker-a', '--text')
        self.assertEqual((report['id'], report['sender'], report['body']),
                         ('legacy-report', 'worker-a', '--text'))
        for action in ('status', 'players', 'orchestra', 'pending'):
            with self.subTest(action=action):
                plain = self.legacy(action)
                pretty = self.legacy(action, '--pretty')
                self.assertEqual(pretty, plain)

    def test_database_prefixed_decisions_infer_actor_and_preserve_full_report(self):
        worker_env = {'BATON_DATABASE': str(self.directory / 'absent.db'),
                      'BATON_SESSION': 'worker-a'}
        root_env = {**worker_env, 'BATON_SESSION': 'root'}
        self.legacy('message', 'database-decision-task', 'root', 'worker-a',
                    'task-assignment', 'Complete this bounded assignment.\nλ🙂')
        self.action('worker-a', 'read', 'database-decision-task')
        self.assertTrue(receive_fixture.read_recorded(self.db, 'database-decision-task', 'worker-a'))
        report = 'Full completion report.\nPreserve λ🙂, --and, and the final newline.\n'
        report_path = self.directory / 'complete report λ.txt'
        report_path.write_text(report)
        request = self.invoke(self.db, 'completion-request', '--file', report_path,
                              cwd=self.directory, environment=worker_env)[0]
        self.assertEqual(request['status'], 'admitted')
        self.assertEqual((request['delivery']['sender'], request['delivery']['recipient'],
                          request['delivery']['kind'], request['delivery']['body']),
                         ('worker-a', 'root', 'completion-request', report))
        self.action('root', 'read', request['id'])
        self.assertTrue(receive_fixture.read_recorded(self.db, request['id'], 'root'))
        repeated = self.invoke(self.db, 'completion-request', '--id', request['id'],
                               '--file', report_path, cwd=self.directory,
                               environment=worker_env)[0]
        self.assertEqual(repeated['id'], request['id'])
        self.assertIsNone(self.legacy('delivery', request['id'])['receipt'])

        before = self.stored_messages()
        state = self.legacy('session', 'worker-a')['taskCompletion']
        delivered = self.endpoint_output()
        for actor, action, arguments in (
                ('other-root', 'completion-confirmed', ('--to', 'worker-a')),
                ('root', 'completion-request', ('--file', report_path))):
            with self.subTest(actor=actor, action=action):
                refused = self.invoke(self.db, action, *arguments, cwd=self.directory,
                                      environment={**worker_env, 'BATON_SESSION': actor})[0]
                self.assertEqual(refused['status'], 'refused')
                self.assertTrue(refused['admission']['cause'])
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.endpoint_output(), delivered)
                self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'], state)

        confirmed = self.invoke(self.db, 'completion-confirmed', '--to', 'worker-a',
                                cwd=self.directory, environment=root_env)[0]
        self.assertEqual(confirmed['status'], 'admitted')
        self.assertEqual((confirmed['delivery']['sender'], confirmed['delivery']['recipient'],
                          confirmed['delivery']['kind'], confirmed['delivery']['body']),
                         ('root', 'worker-a', 'completion-confirmed', request['id']))
        completion = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertEqual(completion['requestId'], request['id'])
        self.assertTrue(completion['confirmed'])
        self.assertFalse(completion['open'])
        self.assertIsNone(self.legacy('delivery', 'database-decision-task')['receipt'])
        self.assertIsNone(self.legacy('delivery', request['id'])['receipt'])

        guidance = 'Continue with the next bounded task.\nFull guidance λ🙂.\n'
        guidance_path = self.directory / 'complete guidance.txt'
        guidance_path.write_text(guidance)
        guided = self.invoke(self.db, 'guide', '--to', 'worker-a', '--file', guidance_path,
                             cwd=self.directory, environment=root_env)[0]
        self.assertEqual(guided['status'], 'admitted')
        self.assertEqual((guided['delivery']['sender'], guided['delivery']['recipient'],
                          guided['delivery']['kind'], guided['delivery']['body']),
                         ('root', 'worker-a', 'guidance', guidance))

    def test_new_inspection_words_accept_ids_named_after_old_actions(self):
        self.legacy('project', self.repo)
        for name in ('read', 'inbox', 'send', 'and', '--and'):
            self.legacy('attach', name, 'fixture', '', self.endpoint)
        before = self.stored_messages()
        delivered = self.endpoint_output()
        env = {'BATON_DATABASE': str(self.db), 'BATON_SESSION': 'root'}
        for prefix in ((), ('--project', self.repo), ('as', 'root')):
            for name in ('read', 'inbox', 'send', 'and', '--and'):
                for action, legacy_action in (('session', 'session'),
                                              ('player', 'player'),
                                              ('assignment', 'session')):
                    with self.subTest(prefix=prefix, action=action, name=name):
                        self.assertEqual(
                            self.invoke(*prefix, action, name, cwd=self.directory,
                                        environment=env),
                            self.legacy(legacy_action, name))
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.endpoint_output(), delivered)

    def test_malformed_task_actions_report_grammar_before_resolving_context(self):
        before = self.stored_messages()
        delivered = self.endpoint_output()
        absent_db = self.directory / 'unopened.db'
        absent_project = self.directory / 'unregistered-project'
        env = {'BATON_DATABASE': str(absent_db), 'BATON_SESSION': 'missing-actor'}
        causes = {
            'completion-request': 'completion-request accepts --text TEXT or --file PATH '
                                  'and optional --id ID; use help completion-request.',
            'completion-confirmed': None,
            'guide': 'guide expects --to SESSION and its documented named arguments; '
                     'use help guide.',
        }
        for prefix in ((), ('--project', absent_project), ('as', 'root'),
                       ('--project', 'read'), ('--project', 'inbox'),
                       ('--project', 'send')):
            for action, cause in causes.items():
                for old_verb in ('read', 'inbox', 'send'):
                    with self.subTest(prefix=prefix, action=action, old_verb=old_verb):
                        refused = self.invoke(*prefix, action, old_verb,
                                              cwd=self.directory, environment=env,
                                              success=False)
                        self.assertEqual(refused.returncode, 2)
                        self.assertEqual(refused.stdout, '')
                        if cause is None:
                            self.assertTrue(refused.stderr.splitlines()[0].startswith(
                                'completion-confirmed '), refused.stderr)
                        else:
                            self.assertEqual(refused.stderr.splitlines()[0], cause)
                        self.assertFalse(absent_db.exists())
                        self.assertFalse(absent_project.exists())
                        self.assertEqual(self.stored_messages(), before)
                        self.assertEqual(self.endpoint_output(), delivered)

    def test_reserved_database_name_uses_explicit_relative_path(self):
        database = self.directory / 'session'
        self.addCleanup(self.shutdown_private_owner, database)
        self.invoke('./session', 'attach', 'reserved-reader', 'fixture', '',
                    self.endpoint, cwd=self.directory)
        env = {'BATON_DATABASE': str(self.db), 'BATON_SESSION': 'worker-b'}
        for args in (('session', 'reserved-reader'), ('player', 'reserved-reader'),
                     ('players',)):
            with self.subTest(args=args):
                self.assertEqual(self.invoke('./session', *args, cwd=self.directory,
                                             environment=env),
                                 self.invoke(database, *args))

    def test_contextual_session_player_and_assignment_reads_use_existing_views(self):
        self.legacy('message', 'assignment-input', 'root', 'worker-a',
                    'task-assignment', 'Implement the assigned change.')
        self.assertEqual(self.action('worker-a', 'session'),
                         self.legacy('session', 'worker-a'))
        self.assertEqual(self.action('root', 'player', 'worker-a'),
                         self.legacy('player', 'worker-a'))
        self.assertEqual(self.action('root', 'players'), self.legacy('players'))
        assignment = self.action('worker-a', 'assignment')
        self.assertEqual(assignment, self.legacy('session', 'worker-a'))
        self.assertEqual(assignment['taskCompletion']['assignmentId'],
                         'assignment-input')
        self.assertEqual(self.action('root', 'assignment', 'worker-a'), assignment)

    def test_contextual_completion_request_and_confirmation_keep_request_identity(self):
        self.legacy('message', 'completion-assignment', 'root', 'worker-a',
                    'task-assignment', 'Implement and report the change.')
        self.legacy('message', 'not-completion-request', 'worker-a', 'root',
                    'guidance', 'This message cannot be confirmed as completion.')
        report = 'Completed the change.\nEvidence: retained source fixture.\n'
        request = self.action('worker-a', 'completion-request', '--text', report)
        self.assertEqual(request[0]['status'], 'admitted')
        self.assertEqual(request[0]['delivery']['sender'], 'worker-a')
        self.assertEqual(request[0]['delivery']['recipient'], 'root')
        self.assertEqual(request[0]['delivery']['kind'], 'completion-request')
        self.assertEqual(request[0]['delivery']['body'], report)

        before = self.stored_messages()
        delivered = self.endpoint_output()
        invalid = (
            ('root', ('--request', 'unknown-completion-request'),
             'No retained completion-request has the supplied ID.'),
            ('root', ('--request', 'not-completion-request'),
             'The supplied message is not a completion-request.'),
            ('worker-b', ('--request', request[0]['id']),
             'The completion-request is addressed to another coordinator.'),
            ('root', ('--request', request[0]['id'], '--to', 'worker-b'),
             '--to does not match the author of the completion-request.'),
        )
        for actor, args, cause in invalid:
            with self.subTest(actor=actor, args=args):
                refused = self.action(actor, 'completion-confirmed', *args)
                self.assertEqual(refused[0]['status'], 'refused')
                self.assertEqual(refused[0]['admission']['status'], 'refused')
                self.assertEqual(refused[0]['admission']['cause'], cause)
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.endpoint_output(), delivered)

        confirmation = self.action('root', 'completion-confirmed',
                                   '--request', request[0]['id'])
        self.assertEqual(confirmation[0]['status'], 'admitted')
        self.assertEqual(confirmation[0]['delivery']['kind'], 'completion-confirmed')
        self.assertEqual(confirmation[0]['delivery']['recipient'], 'worker-a')
        self.assertEqual(confirmation[0]['delivery']['body'], request[0]['id'])
        state = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertEqual(state['requestId'], request[0]['id'])
        self.assertTrue(state['confirmed'])
        self.assertFalse(state['open'])

        second_request = self.action('worker-a', 'completion-request', '--text',
                                     'The recorded author may also be selected explicitly.')
        self.assertEqual(second_request[0]['status'], 'admitted')
        explicit_confirmation = self.action('root', 'completion-confirmed',
                                            '--to', 'worker-a')
        self.assertEqual(explicit_confirmation[0]['status'], 'admitted')
        self.assertEqual(explicit_confirmation[0]['delivery']['recipient'], 'worker-a')
        self.assertEqual(explicit_confirmation[0]['delivery']['body'],
                         second_request[0]['id'])

        before = self.stored_messages()
        parentless = self.action('root', 'completion-request', '--text',
                                 'A top-level session has no parent.')
        self.assertEqual(parentless[0]['status'], 'refused')
        self.assertEqual(parentless[0]['admission']['status'], 'refused')
        self.assertEqual(parentless[0]['admission']['cause'],
                         'The current session has no recorded immediate parent.')
        self.assertEqual(self.stored_messages(), before)

    def test_completion_confirmation_resolves_unicode_recorded_author(self):
        worker = 'worker-λ🙂'
        self.legacy('join', worker, 'root', 'fixture', 'model', 'low', self.repo)
        self.legacy('connect', worker, '', self.endpoint)
        self.legacy('message', 'unicode-assignment', 'root', worker, 'task-assignment',
                    'Complete this retained assignment.')
        request = self.action(worker, 'completion-request',
                              '--text', 'Completed λ🙂.\n')
        confirmation = self.action('root', 'completion-confirmed',
                                   '--request', request[0]['id'])
        self.assertEqual(confirmation[0]['status'], 'admitted')
        self.assertEqual(confirmation[0]['delivery']['recipient'], worker)
        self.assertEqual(confirmation[0]['delivery']['body'], request[0]['id'])
        task = self.legacy('session', worker)['taskCompletion']
        self.assertTrue(task['confirmed'])
        self.assertFalse(task['open'])

    def test_confirmation_infers_named_child_current_request_and_keeps_parent_authority(self):
        self.legacy('message', 'inferred-task', 'root', 'worker-a',
                    'task-assignment', 'Complete the assigned work.\nλ🙂')
        older = self.action('worker-a', 'completion-request', '--text',
                            'Earlier completion evidence.')[0]['id']
        current = self.action('worker-a', 'completion-request', '--text',
                              'Current complete evidence.\nλ🙂')[0]['id']
        self.assertNotEqual(older, current)
        self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion']['requestId'],
                         current)
        before = self.stored_messages()
        state = self.legacy('session', 'worker-a')['taskCompletion']
        delivered = self.endpoint_output()
        refusal = self.action('other-root', 'completion-confirmed', '--to', 'worker-a')[0]
        self.assertEqual(refusal['status'], 'refused')
        self.assertTrue(refusal['admission']['cause'])
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'], state)
        self.assertEqual(self.endpoint_output(), delivered)

        confirmed = self.action('root', 'completion-confirmed', '--to', 'worker-a')[0]
        self.assertEqual(confirmed['status'], 'admitted')
        self.assertTrue(confirmed['id'])
        self.assertEqual(confirmed['delivery']['recipient'], 'worker-a')
        self.assertEqual(confirmed['delivery']['body'], current)
        state = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertEqual(state['requestId'], current)
        self.assertTrue(state['confirmed'])
        self.assertFalse(state['open'])
        self.assertEqual(self.legacy('delivery', older)['body'],
                         'Earlier completion evidence.')
        self.assertIsNone(self.legacy('delivery', 'inferred-task')['receipt'])

    def test_bare_confirmation_requires_one_current_owned_child_request(self):
        before = self.stored_messages()
        absent = self.action('root', 'completion-confirmed')[0]
        self.assertEqual(absent['status'], 'refused')
        self.assertTrue(absent['admission']['cause'])
        self.assertEqual(self.stored_messages(), before)
        requests = {}
        for worker in ('worker-a', 'worker-b'):
            self.legacy('message', worker + '-inferred-task', 'root', worker,
                        'task-assignment', 'Complete ' + worker + ' assigned work.')
            requests[worker] = self.action(worker, 'completion-request', '--text',
                                           worker + ' complete evidence.')[0]['id']
        before = self.stored_messages()
        states = {worker: self.legacy('session', worker)['taskCompletion']
                  for worker in requests}
        delivered = self.endpoint_output()
        ambiguous = self.action('root', 'completion-confirmed')[0]
        self.assertEqual(ambiguous['status'], 'refused')
        self.assertTrue(ambiguous['admission']['cause'])
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.endpoint_output(), delivered)
        for worker in requests:
            self.assertEqual(self.legacy('session', worker)['taskCompletion'], states[worker])

        selected = self.action('root', 'completion-confirmed', '--to', 'worker-a')[0]
        self.assertEqual(selected['delivery']['body'], requests['worker-a'])
        remaining = self.action('root', 'completion-confirmed')[0]
        self.assertEqual(remaining['status'], 'admitted')
        self.assertEqual(remaining['delivery']['recipient'], 'worker-b')
        self.assertEqual(remaining['delivery']['body'], requests['worker-b'])
        self.assertNotEqual(selected['id'], remaining['id'])
        for worker in requests:
            state = self.legacy('session', worker)['taskCompletion']
            self.assertEqual(state['requestId'], requests[worker])
            self.assertTrue(state['confirmed'])
            self.assertFalse(state['open'])

    def test_completion_inference_preserves_request_before_new_assignment(self):
        self.legacy('message', 'older-assignment', 'root', 'worker-a',
                    'task-assignment', 'Original bounded assignment.')
        older = self.action('worker-a', 'completion-request', '--text',
                            'Original bounded assignment handled.')[0]['id']
        older_confirmation = self.action('root', 'completion-confirmed',
                                         '--request', older)[0]
        self.assertEqual(older_confirmation['status'], 'admitted')
        self.legacy('message', 'newer-assignment', 'root', 'worker-a',
                    'task-assignment', 'New work remains open.\nλ🙂')
        state = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertIsNone(state['requestId'])
        self.assertTrue(state['open'])
        before = self.stored_messages()
        for arguments in ((), ('--to', 'worker-a')):
            with self.subTest(arguments=arguments):
                refused = self.action('root', 'completion-confirmed', *arguments)[0]
                self.assertEqual(refused['status'], 'refused')
                self.assertTrue(refused['admission']['cause'])
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'], state)
        for arguments in (('--request', older),
                          ('--to', 'worker-a', '--request', older)):
            with self.subTest(arguments=arguments):
                refused = self.action('root', 'completion-confirmed', *arguments)[0]
                self.assertEqual(refused['status'], 'refused')
                self.assertIn('older assignment', refused['admission']['cause'])
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'], state)
        current = self.action('worker-a', 'completion-request', '--text',
                              'New bounded assignment handled.')[0]['id']
        state = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertEqual(state['requestId'], current)
        self.assertTrue(state['open'])
        before = self.stored_messages()
        for arguments in (('--request', older),
                          ('--to', 'worker-a', '--request', older)):
            with self.subTest(arguments=arguments):
                refused = self.action('root', 'completion-confirmed', *arguments)[0]
                self.assertEqual(refused['status'], 'refused')
                self.assertIn('older assignment', refused['admission']['cause'])
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.legacy('session', 'worker-a')['taskCompletion'], state)
        explicit = self.action('root', 'completion-confirmed', '--to', 'worker-a',
                               '--request', current)[0]
        self.assertEqual(explicit['status'], 'admitted')
        self.assertEqual(explicit['delivery']['body'], current)
        self.assertNotEqual(explicit['delivery']['body'], older)
        self.assertIsNone(self.legacy('delivery', 'newer-assignment')['receipt'])
        state = self.legacy('session', 'worker-a')['taskCompletion']
        self.assertEqual(state['requestId'], current)
        self.assertTrue(state['confirmed'])
        self.legacy('message', 'second-new-assignment', 'root', 'worker-a',
                    'task-assignment', 'Another bounded assignment remains open.')
        current_second = self.action('worker-a', 'completion-request', '--text',
                                     'Second bounded assignment handled.')[0]['id']
        semantic = self.action('root', 'completion-confirmed', '--to', 'worker-a')[0]
        self.assertEqual(semantic['status'], 'admitted')
        self.assertEqual(semantic['delivery']['body'], current_second)

    def test_mixed_confirmation_infers_current_request_and_retains_exact_native_result(self):
        self.legacy('message', 'mixed-inferred-task', 'root', 'worker-a',
                    'task-assignment', 'Complete the bounded mixed assignment.\nλ🙂')
        request = self.action('worker-a', 'completion-request', '--text',
                              'The bounded assignment is complete.\nλ🙂')[0]['id']
        rows = self.action('root', 'completion-confirmed', '--to', 'worker-a',
                           '--and', 'assignment', '--session', 'worker-a')
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        self.assertNotIn('--request', rows[0]['nativeArgv'])
        admission = json.loads(rows[0]['stdout'])[0]
        self.assertEqual(admission['status'], 'admitted')
        self.assertTrue(admission['id'])
        self.assertEqual((admission['delivery']['recipient'], admission['delivery']['body']),
                         ('worker-a', request))
        state = json.loads(rows[1]['stdout'])['taskCompletion']
        self.assertEqual(state['requestId'], request)
        self.assertTrue(state['confirmed'])
        self.assertFalse(state['open'])
        self.assertIsNone(self.legacy('delivery', 'mixed-inferred-task')['receipt'])

    def test_contextual_guidance_reads_complete_file_and_malformed_decisions_write_nothing(self):
        body = "Continue the assigned work.\nKeep this line and λ🙂.\n"
        path = self.directory / 'guidance.txt'
        path.write_text(body)
        before = self.stored_messages()
        delivered = self.endpoint_output()
        for args in (
                ('completion-request',),
                ('completion-confirmed', '--to'),
                ('guide', '--to', 'worker-a', '--text', 'first',
                 '--text', 'duplicate')):
            with self.subTest(args=args):
                self.action('root', *args, success=False)
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.endpoint_output(), delivered)

        guidance = self.action('root', 'guide', '--to', 'worker-a',
                               '--file', path)
        self.assertEqual(guidance[0]['status'], 'admitted')
        self.assertEqual(guidance[0]['delivery']['kind'], 'guidance')
        self.assertEqual(guidance[0]['delivery']['body'], body)

    def test_inbox_uses_named_session_and_selected_project(self):
        self.legacy('message', 'worker-input', 'root', 'worker-a', 'guidance',
                    'Work for worker-a.')
        self.legacy('message', 'root-report', 'worker-a', 'root', 'report',
                    'Full report for root.\nSecond line.\n')
        root_inbox = self.legacy('inbox', 'root')
        worker_inbox = self.legacy('inbox', 'worker-a')
        self.assertEqual(self.action('root', 'inbox'), root_inbox)
        self.assertEqual(self.action('worker-a', 'inbox'), worker_inbox)
        self.assertEqual([row['id'] for row in root_inbox], ['root-report'])
        self.assertEqual([row['id'] for row in worker_inbox], ['worker-input'])

        registered = self.legacy('project', self.repo)
        self.assertTrue(pathlib.Path(registered['pointer']).is_file())
        nested = self.repo / 'nested directory'
        nested.mkdir()
        self.assertEqual(self.invoke('as', 'root', 'inbox', cwd=nested), root_inbox)
        self.assertEqual(self.invoke('--project', nested, 'as', 'root', 'inbox',
                                     cwd=self.directory), root_inbox)
        self.assertEqual(self.invoke('--project', nested, 'inbox', 'root',
                                     cwd=self.directory), root_inbox)

    def test_implicit_context_selects_database_and_session_with_overrides(self):
        self.legacy('message', 'implicit-report', 'worker-a', 'root', 'report',
                    'Full report for the inferred root.\n')
        self.legacy('message', 'other-inbox', 'root', 'worker-a', 'guidance',
                    'Input owned by worker-a.')
        root_inbox = self.legacy('inbox', 'root')
        worker_inbox = self.legacy('inbox', 'worker-a')
        env = {'BATON_DATABASE': str(self.db), 'BATON_SESSION': 'root'}
        self.assertEqual(self.invoke('inbox', cwd=self.directory,
                                     environment=env), root_inbox)
        self.assertEqual(self.invoke('as', 'worker-a', 'inbox', cwd=self.directory,
                                     environment=env), worker_inbox)
        self.assertEqual(self.invoke(self.db, 'inbox', cwd=self.directory,
                                     environment={'BATON_SESSION': 'root',
                                                  'BATON_DATABASE': str(self.directory / 'absent.db')}),
                         root_inbox)

        self.legacy('project', self.repo)
        nested = self.repo / 'nested'
        nested.mkdir()
        self.assertEqual(self.invoke('inbox', cwd=nested,
                                     environment={'BATON_SESSION': 'root'}), root_inbox)
        self.assertEqual(self.invoke('--project', nested, 'inbox',
                                     cwd=self.directory,
                                     environment={'BATON_DATABASE': str(self.directory / 'absent.db'),
                                                  'BATON_SESSION': 'root'}), root_inbox)
        self.assertEqual(self.invoke('--project', nested, 'as', 'worker-a', 'inbox',
                                     cwd=self.directory, environment=env), worker_inbox)
        sent = self.invoke('send', 'worker-a', '--kind', 'guidance', '--text',
                           'Sent from inferred root.', '--id', 'implicit-send',
                           cwd=self.directory, environment=env)
        self.assertEqual(sent[0]['delivery']['sender'], 'root')
        read = self.invoke('read', 'implicit-report', cwd=self.directory, environment=env)
        self.assertEqual(read[0]['status'], 'found')
        self.assertTrue(receive_fixture.read_recorded(self.db, 'implicit-report', 'root'))
        self.assertIsNone(self.legacy('delivery', 'implicit-report')['receipt'])

    def test_implicit_codex_native_requires_one_exact_session(self):
        receive_fixture.install_public_queue_codex(self, self.directory)
        native = 'fixture-codex-thread-714'
        self.legacy('attach', 'root', 'codex', native, self.endpoint)
        self.legacy('message', 'context-report', 'worker-a', 'root',
                    'report', 'Retained Codex report.')
        env = {'BATON_DATABASE': str(self.db), 'CODEX_THREAD_ID': native}
        inbox = self.invoke('inbox', cwd=self.directory, environment=env)
        self.assertEqual([row['id'] for row in inbox], ['context-report'])
        read = self.invoke('read', 'context-report', cwd=self.directory,
                           environment=env)
        self.assertEqual(read[0]['delivery']['body'], 'Retained Codex report.')
        self.assertEqual(self.invoke('as', 'root', 'inbox', cwd=self.directory,
                                     environment=env), self.legacy('inbox', 'root'))
        self.assertEqual(self.invoke('inbox', cwd=self.directory,
                                     environment={**env, 'BATON_SESSION': 'root'}),
                         self.legacy('inbox', 'root'))

        before = self.stored_messages()
        absent = self.invoke('send', 'worker-a', '--kind', 'guidance', '--text',
                             'Never admitted.', cwd=self.directory, success=False,
                             environment={'BATON_DATABASE': str(self.db)})
        self.assertTrue(absent.stderr)
        unknown = self.invoke('read', 'context-report', cwd=self.directory, success=False,
                              environment={'BATON_DATABASE': str(self.db),
                                           'CODEX_THREAD_ID': 'unknown-codex-thread'})
        self.assertTrue(unknown.stderr)
        self.assertFalse(receive_fixture.read_recorded(self.db, 'context-report'))
        self.assertEqual(self.stored_messages(), before)

        self.legacy('attach', 'other-root', 'codex', native, self.endpoint)
        ambiguous = self.invoke('send', 'worker-a', '--kind', 'guidance', '--text',
                                'Never admitted under ambiguous native.',
                                cwd=self.directory, success=False, environment=env)
        self.assertTrue(ambiguous.stderr)
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.invoke('as', 'root', 'inbox',
                                     cwd=self.directory, environment=env)[0]['id'],
                         'context-report')

    def test_help_and_malformed_actions_resolve_before_implicit_context(self):
        help_result = subprocess.run([str(EXE), 'help'], cwd=self.directory,
                                     env={'PATH': os.environ.get('PATH', '')},
                                     capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0,
                         help_result.stdout + help_result.stderr)
        self.assertIn('send', help_result.stdout)
        before = self.stored_messages()
        invalid = self.invoke('send', 'worker-a', '--kind', 'report',
                              cwd=self.directory, success=False)
        self.assertIn('--text', invalid.stderr)
        self.assertEqual(self.stored_messages(), before)

    def test_read_returns_complete_selected_records_in_order(self):
        large = "Report with apostrophe ' and λ🙂.\n" * 4000
        second = 'Second complete body.\nAnother line.\n'
        large_file = self.directory / 'large-report.txt'
        large_file.write_text(large)
        self.legacy('message-file', 'read-first', 'worker-a', 'root', 'report',
                    large_file)
        self.legacy('message', 'read-second', 'worker-b', 'root', 'report', second)
        self.legacy('message', 'read-foreign', 'root', 'worker-a', 'guidance',
                    'Retained input for worker-a.')
        rows = self.action('root', 'read', 'read-first', 'read-second',
                           'missing-read', 'read-first', 'read-foreign')
        self.assertEqual([row['id'] for row in rows],
                         ['read-first', 'read-second', 'missing-read',
                          'read-first', 'read-foreign'])
        self.assertEqual([row['status'] for row in rows],
                         ['found', 'found', 'absent', 'found', 'found'])
        for row, ident in zip(rows, ('read-first', 'read-second', None,
                                     'read-first', 'read-foreign')):
            if ident is not None:
                stored = self.legacy('delivery', ident)
                for field in ('id', 'sender', 'recipient', 'kind', 'body', 'receipt'):
                    self.assertEqual(row['delivery'][field], stored[field])
        self.assertEqual(rows[0]['delivery']['body'], large)
        self.assertEqual(rows[1]['delivery']['body'], second)
        self.assertEqual(rows[4]['delivery']['recipient'], 'worker-a')
        self.assertIsNone(rows[2].get('delivery'))

    def test_contextual_reads_keep_private_argv_shapes(self):
        ids = [f'arity-report-{i}' for i in range(10)]
        for ident in ids:
            self.legacy('message', ident, 'worker-a', 'root', 'report',
                        f'Complete report {ident}.')
        self.legacy('project', self.repo)
        current_project = self.invoke('as', 'root', 'read', *ids, cwd=self.repo)
        explicit_database = self.action('root', 'read', *ids[:9])
        self.assertEqual([row['id'] for row in current_project], ids)
        self.assertEqual([row['id'] for row in explicit_database], ids[:9])
        self.assertTrue(all(row['status'] == 'found' for row in current_project))
        self.assertTrue(all(row['status'] == 'found' for row in explicit_database))
        for ident in ids:
            self.assertTrue(receive_fixture.read_recorded(self.db, ident, 'root'))
            self.assertIsNone(self.legacy('delivery', ident)['receipt'])

    def test_read_batch_records_each_owned_message_and_keeps_foreign_input_unread(self):
        for ident in ('ack-first', 'ack-second'):
            self.legacy('message', ident, 'worker-a', 'root', 'report', ident)
        self.legacy('message', 'ack-foreign', 'root', 'worker-a', 'guidance',
                    'worker-a owns this input')
        rows = self.action('root', 'read', 'ack-first', 'ack-foreign', 'ack-second')
        self.assertEqual([row['id'] for row in rows],
                         ['ack-first', 'ack-foreign', 'ack-second'])
        self.assertEqual([str(row['index']) for row in rows], ['0', '1', '2'])
        self.assertTrue(all(row['status'] == 'found' for row in rows))
        self.assertTrue(receive_fixture.read_recorded(self.db, 'ack-first', 'root'))
        self.assertTrue(receive_fixture.read_recorded(self.db, 'ack-second', 'root'))
        self.assertFalse(receive_fixture.read_recorded(self.db, 'ack-foreign', 'root'))
        self.assertFalse(receive_fixture.read_recorded(self.db, 'ack-foreign', 'worker-a'))
        self.assertIsNone(self.legacy('delivery', 'ack-first')['receipt'])
        self.assertIsNone(self.legacy('delivery', 'ack-second')['receipt'])
        self.assertIsNone(self.legacy('delivery', 'ack-foreign')['receipt'])
        repeated = self.action('root', 'read', 'ack-first')
        self.assertEqual(repeated[0]['status'], 'found')
        self.assertTrue(receive_fixture.read_recorded(self.db, 'ack-first', 'root'))

    def test_send_keeps_each_clause_identity_body_and_wake_result(self):
        file_body = 'File body with λ🙂.\nSecond line.\n'
        body_file = self.directory / 'report body.txt'
        body_file.write_text(file_body)
        rows = self.action('root', 'send', 'worker-a', '--kind', 'guidance',
                           '--text', 'First body.\n', '--id', 'send-first',
                           'and', 'worker-b', '--kind', 'report', '--file',
                           body_file, '--id', 'send-second')
        self.assertEqual([row['status'] for row in rows], ['admitted', 'admitted'])
        for row, ident, recipient, kind, body in zip(
                rows, ('send-first', 'send-second'), ('worker-a', 'worker-b'),
                ('guidance', 'report'), ('First body.\n', file_body)):
            self.assertEqual(row['id'], ident)
            self.assertEqual(row['admission']['status'], 'admitted')
            self.assertEqual(row['delivery']['id'], ident)
            self.assertEqual((row['delivery']['sender'], row['delivery']['recipient'],
                              row['delivery']['kind'], row['delivery']['body']),
                             ('root', recipient, kind, body))
            stored = self.legacy('delivery', ident)
            self.assertEqual((stored['id'], stored['sender'], stored['recipient'],
                              stored['kind'], stored['body']),
                             (ident, 'root', recipient, kind, body))
            self.assertIn('status', row['wake'])
        replay = self.action('root', 'send', 'worker-a', '--kind', 'guidance',
                             '--text', 'First body.\n', '--id', 'send-first')
        self.assertEqual(replay[0]['delivery']['body'], 'First body.\n')
        self.assertEqual([row[0] for row in self.stored_messages()].count('send-first'), 1)
        generated = self.action('root', 'send', 'worker-a', '--kind', 'custom',
                                '--text', 'Generated identity.')
        self.assertEqual(generated[0]['status'], 'admitted')
        generated_id = generated[0]['id']
        self.assertTrue(generated_id)
        self.assertNotIn(generated_id, ('send-first', 'send-second'))
        self.assertEqual(self.legacy('delivery', generated_id)['body'],
                         'Generated identity.')

    def test_send_item_failures_preserve_other_admissions(self):
        missing_file = self.directory / 'missing-body.txt'
        failing_endpoint = json.dumps([sys.executable, '-c',
                                       'import sys;sys.exit(7)'])
        self.legacy('connect', 'worker-b', '', failing_endpoint)
        rows = self.action('root', 'send', 'worker-a', '--kind', 'report',
                           '--file', missing_file, '--id', 'missing-file',
                           'and', 'other-root', '--kind', 'report', '--text',
                           'Denied route.', '--id', 'denied-route',
                           'and', 'worker-b', '--kind', 'guidance', '--text',
                           'Retained after endpoint failure.', '--id', 'wake-refused',
                           'and', 'worker-a', '--kind', 'guidance', '--text',
                           'Valid body.', '--id', 'valid-after-errors')
        self.assertEqual([row['id'] for row in rows],
                         ['missing-file', 'denied-route', 'wake-refused',
                          'valid-after-errors'])
        self.assertNotEqual(rows[0]['status'], 'admitted')
        self.assertNotEqual(rows[1]['status'], 'admitted')
        self.assertTrue(rows[0].get('error') or rows[0].get('admission'))
        self.assertEqual(rows[2]['admission']['status'], 'admitted')
        self.assertEqual(rows[2]['wake']['status'], 'accepted')
        self.assertIsNone(rows[2]['delivery']['receipt'])
        self.endpoint_output()
        failure = pathlib.Path(str(self.db) + '.dispatch-' + 'wake-refused'.encode().hex() + '.stderr')
        self.assertIn('session delivery failed', failure.read_text())
        self.assertIn('exit 7', failure.read_text())
        self.assertEqual(rows[2]['delivery']['body'],
                         'Retained after endpoint failure.')
        self.assertEqual(rows[3]['status'], 'admitted')
        self.assertEqual(rows[3]['delivery']['body'], 'Valid body.')
        stored = {row[0] for row in self.stored_messages()}
        self.assertNotIn('missing-file', stored)
        self.assertNotIn('denied-route', stored)
        self.assertIn('wake-refused', stored)
        self.assertIn('valid-after-errors', stored)

    def test_invalid_whole_grammar_preserves_existing_messages(self):
        cases = [
            ('send', 'worker-a', '--kind', 'report', '--id', 'missing-body'),
            ('send', 'worker-a', '--kind', 'report', '--text', 'one', '--file',
             self.directory / 'body.txt'),
            ('send', 'worker-a', '--kind', 'report', '--text', 'one', '--text', 'two'),
            ('send', 'worker-a', '--kind', 'report', '--kind', 'task', '--text', 'one'),
            ('send', 'worker-a', '--kind', 'report', '--text', 'one',
             '--id', 'one', '--id', 'two'),
            ('send', 'worker-a', '--kind', 'report', '--text', 'one', '--unknown'),
            ('send', 'worker-a', '--kind', 'report', '--text', 'one', 'and'),
            ('read',),
        ]
        for args in cases:
            with self.subTest(args=args):
                before = self.stored_messages()
                delivered = self.endpoint_output()
                self.action('root', *args, success=False)
                self.assertEqual(self.stored_messages(), before)
                self.assertEqual(self.endpoint_output(), delivered)

    def test_project_pointer_errors_and_explicit_database(self):
        self.legacy('message', 'pointer-report', 'worker-a', 'root', 'report',
                    'Retained after pointer errors.')
        registered = self.legacy('project', self.repo)
        pointer = pathlib.Path(registered['pointer'])
        original = pointer.read_bytes()
        before = self.stored_messages()
        pointer.unlink()
        missing = self.invoke('as', 'root', 'inbox', cwd=self.repo, success=False)
        self.assertIn('Project database pointer', missing.stderr)
        pointer.write_bytes(b'')
        empty = self.invoke('--project', self.repo, 'as', 'root', 'inbox',
                            cwd=self.directory, success=False)
        self.assertIn('Project database pointer', empty.stderr)
        pointer.unlink()
        pointer.mkdir()
        unreadable = self.invoke('as', 'root', 'inbox', cwd=self.repo, success=False)
        self.assertIn('Project database pointer', unreadable.stderr)
        pointer.rmdir()
        pointer.write_bytes(original)
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.action('root', 'inbox'), self.legacy('inbox', 'root'))

    def test_named_domain_help_precedes_project_and_session_resolution(self):
        cases = [('attempt', '--help'), ('configure', '--help'),
                 ('resume', '--help'), ('receiver', '--help'), ('stop', '--help'),
                 ('worktree', '--help'), ('knowledge', 'record', '--help'),
                 ('knowledge', 'read', '-h'), ('project', 'settings', '--help'),
                 ('context', 'query', '--help'), ('status', '--help'),
                 ('pending', '--help'), ('orchestra', '--help'), ('role', '--help'),
                 ('ensemble', '--help'), ('ensemble-member', '--help'),
                 ('section', '--help'), ('section-member', '--help')]
        for args in cases:
            with self.subTest(args=args):
                result = subprocess.run([str(EXE), *args], cwd=self.directory,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(args[0], result.stdout)

    def test_named_read_batch_retains_exact_child_stdout_and_actor_state(self):
        self.legacy('message', 'held-task', 'root', 'worker-a', 'task-assignment',
                    'Complete the assigned source change.')
        before = self.legacy('session', 'worker-a')
        expected = subprocess.run([str(EXE), str(self.db), 'worktree', 'worker-a'],
                                  capture_output=True, text=True, check=True)
        rows = self.action('worker-a', 'worktree', '--and', 'attempt', '--and',
                           'attempts', '--and', 'outbox')
        self.assertEqual([row['status'] for row in rows], ['completed'] * 4)
        self.assertEqual(rows[0]['stdout'], expected.stdout)
        self.assertTrue(rows[0]['stdout'].endswith('\n'))
        self.assertEqual(rows[0]['stderr'], expected.stderr)
        self.assertEqual(rows[0]['waitStatus'], 'exit 0')
        self.assertEqual(pathlib.Path(rows[0]['stderrPath']).read_text(), '')
        self.assertEqual(json.loads(rows[1]['stdout'])['taskCompletion']['assignmentId'],
                         'held-task')
        self.assertEqual(self.legacy('session', 'worker-a'), before)
        self.assertIsNone(self.legacy('delivery', 'held-task')['receipt'])

    def test_mixed_named_inspections_retain_views_assignment_and_single_shapes(self):
        self.legacy('message', 'mixed-held-task', 'root', 'worker-a',
                    'task-assignment', 'Complete the current assignment.')
        before = self.legacy('session', 'worker-a')
        rows = self.action('worker-a', 'session', '--and', 'player', '--session',
                           'worker-b', '--and', 'players', '--and', 'assignment',
                           '--id', 'worker-a', '--and', 'attempt', '--and', 'outbox')
        self.assertEqual([row['action'] for row in rows],
                         ['session', 'player', 'players', 'assignment', 'attempt', 'outbox'])
        self.assertEqual([row['status'] for row in rows], ['completed'] * 6)
        self.assertEqual(json.loads(rows[0]['stdout'])['id'], 'worker-a')
        self.assertEqual(json.loads(rows[1]['stdout'])['id'], 'worker-b')
        self.assertEqual(json.loads(rows[2]['stdout']), self.legacy('players'))
        self.assertEqual(json.loads(rows[3]['stdout'])['taskCompletion']['assignmentId'],
                         'mixed-held-task')
        self.assertEqual(json.loads(rows[4]['stdout'])['taskCompletion']['assignmentId'],
                         'mixed-held-task')
        self.assertEqual(json.loads(rows[5]['stdout']), self.legacy('outbox', 'worker-a'))
        for action in ('session', 'player', 'assignment'):
            named = self.action('root', action, '--session', 'worker-a')
            self.assertEqual(len(named), 1)
            self.assertEqual(json.loads(named[0]['stdout']), before)
            self.assertEqual(self.action('root', action, 'worker-a'), before)
        self.assertEqual(self.legacy('session', 'worker-a'), before)
        self.assertIsNone(self.legacy('delivery', 'mixed-held-task')['receipt'])

    def test_mixed_decisions_share_complete_stdin_and_preserve_parent_confirmation(self):
        self.legacy('message', 'mixed-completion-task', 'root', 'worker-a',
                    'task-assignment', 'Implement the assigned change.')
        body = '\ufeff' + ('Complete λ🙂 evidence and\n' * 8000) + 'Trailing spaces  '
        result = subprocess.run([str(EXE), str(self.db), 'as', 'worker-a',
                                 'completion-request', '--file', '-', '--and', 'guide', '--to', 'root',
                                 '--id', 'mixed-guide-up', '--file', '-', '--and',
                                 'assignment'], input=body.encode('utf-8'), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        rows = json.loads(result.stdout)
        self.assertEqual([row['status'] for row in rows], ['completed'] * 3)
        request_id = json.loads(rows[0]['stdout'])[0]['id']
        self.assertTrue(request_id.startswith('message:worker-a:'))
        for row, message_id, kind in zip(rows[:2], (request_id, 'mixed-guide-up'),
                                         ('completion-request', 'guidance')):
            self.assertEqual(row['argv'][2:], ['agent-contextual-input', 'worker-a'])
            item = json.loads(row['stdout'])[0]
            self.assertEqual(item['status'], 'admitted')
            self.assertEqual(item['delivery']['id'], message_id)
            self.assertEqual(item['delivery']['sender'], 'worker-a')
            self.assertEqual(item['delivery']['recipient'], 'root')
            self.assertEqual(item['delivery']['kind'], kind)
            self.assertEqual(item['delivery']['body'], body)
        state = json.loads(rows[2]['stdout'])['taskCompletion']
        self.assertEqual(state['requestId'], request_id)
        self.assertFalse(state['confirmed'])
        self.assertTrue(state['open'])
        confirmed = self.action('root', 'completion-confirmed', '--request', request_id,
                                '--to', 'worker-a', '--id', 'mixed-confirmation',
                                '--and', 'assignment', '--session', 'worker-a',
                                '--and', 'outbox')
        admission = json.loads(confirmed[0]['stdout'])[0]
        self.assertEqual(admission['status'], 'admitted')
        self.assertEqual(admission['delivery']['id'], 'mixed-confirmation')
        self.assertEqual(admission['delivery']['recipient'], 'worker-a')
        self.assertEqual(admission['delivery']['body'], request_id)
        state = json.loads(confirmed[1]['stdout'])['taskCompletion']
        self.assertEqual(state['requestId'], request_id)
        self.assertTrue(state['confirmed'])
        self.assertFalse(state['open'])
        self.assertIsNone(self.legacy('delivery', 'mixed-completion-task')['receipt'])

    def test_mixed_authority_and_file_refusals_keep_later_reads_and_decisions(self):
        self.legacy('message', 'mixed-authority-task', 'root', 'worker-a',
                    'task-assignment', 'Retain the owned task.')
        request = self.action('worker-a', 'completion-request',
                              '--text', 'Done declaration.')
        before = self.legacy('session', 'worker-a')['taskCompletion']
        for actor, args, cause in (
                ('other-root', (), 'addressed to another coordinator'),
                ('root', ('--to', 'worker-b'), 'does not match the author')):
            rows = self.action(actor, 'completion-confirmed', '--request', request[0]['id'],
                               *args, '--and', 'assignment', '--session', 'worker-a')
            refusal = json.loads(rows[0]['stdout'])[0]
            self.assertEqual(refusal['status'], 'refused')
            self.assertIn(cause, refusal['admission']['cause'])
            self.assertEqual(rows[1]['status'], 'completed')
            self.assertEqual(json.loads(rows[1]['stdout'])['taskCompletion'], before)
        rows = self.action('root', 'completion-request', '--text', 'Parentless declaration.',
                           '--and', 'guide', '--to', 'worker-a', '--id', 'mixed-good-guide',
                           '--text', '--and', '--and', 'completion-request', '--file',
                           self.directory / 'missing-report', '--and', 'player',
                           '--id', 'worker-a')
        parentless = json.loads(rows[0]['stdout'])[0]
        self.assertEqual(parentless['status'], 'refused')
        self.assertIn('no recorded immediate parent', parentless['admission']['cause'])
        guidance = json.loads(rows[1]['stdout'])[0]
        self.assertEqual(guidance['status'], 'admitted')
        self.assertEqual(guidance['delivery']['body'], '--and')
        self.assertEqual(rows[2]['status'], 'refused')
        self.assertIn('--text', rows[2]['cause'])
        self.assertEqual(rows[3]['status'], 'completed')
        self.assertEqual(json.loads(rows[3]['stdout'])['id'], 'worker-a')
        self.assertIsNone(self.legacy('delivery', 'mixed-authority-task')['receipt'])

    def test_named_role_groups_status_and_pending_keep_native_ownership(self):
        self.legacy('message', 'group-held-input', 'root', 'worker-a',
                    'task-assignment', 'Retain this complete group input.\n')
        rows = self.action('root', 'ensemble', '--id', 'named-team', '--coupling', 'tight',
                           '--and', 'ensemble-member', '--id', 'named-team', '--player',
                           'worker-a', '--action', 'add', '--and', 'section', '--ensemble',
                           'named-team', '--id', 'review', '--capability', 'Full λ review',
                           '--and', 'section-member', '--ensemble', 'named-team', '--id',
                           'review', '--player', 'worker-a', '--action', 'add', '--and',
                           'section', '--ensemble', 'named-team', '--id', 'review',
                           '--and', 'role', '--and', 'pending', '--index', '--recipient',
                           'worker-a', '--kind', 'task-assignment', '--and', 'status',
                           '--and', 'orchestra')
        self.assertEqual([row['status'] for row in rows], ['completed'] * 9)
        self.assertEqual(json.loads(rows[0]['stdout'])['owner'], 'root')
        section = json.loads(rows[4]['stdout'])
        self.assertEqual(section['capability'], 'Full λ review')
        self.assertEqual(section['members'], ['worker-a'])
        self.assertEqual(json.loads(rows[5]['stdout']), self.legacy('role', 'root'))
        pending = json.loads(rows[6]['stdout'])
        self.assertEqual([row['id'] for row in pending], ['group-held-input'])
        self.assertEqual(json.loads(rows[7]['stdout']), self.legacy('status'))
        self.assertEqual(json.loads(rows[8]['stdout']), self.legacy('orchestra'))
        refused = self.action('other-root', 'ensemble', '--id', 'named-team',
                              '--owner', 'other-root', '--coupling', 'loose', '--and',
                              'section-member', '--ensemble', 'named-team', '--id', 'review',
                              '--player', 'worker-a', '--action', 'remove', '--and',
                              'ensemble', '--id', 'named-team')
        self.assertEqual([row['status'] for row in refused], ['failed', 'failed', 'completed'])
        self.assertIn('ensemble-owner-conflict', refused[0]['stderr'])
        self.assertIn('section-refused', refused[1]['stderr'])
        retained = json.loads(refused[2]['stdout'])
        self.assertEqual(retained['owner'], 'root')
        self.assertEqual(retained['coupling'], 'tight')
        self.assertEqual(retained['sections'][0]['members'], ['worker-a'])
        self.assertIsNone(self.legacy('delivery', 'group-held-input')['receipt'])
        roles = self.action('root', 'role', '--session', 'worker-b', '--role',
                            'associate-conductor', '--and', 'role', '--session',
                            'worker-b', '--and', 'role', '--session', 'worker-b',
                            '--role', 'principal-conductor', '--and', 'player',
                            '--session', 'worker-b')
        self.assertEqual([row['status'] for row in roles],
                         ['completed', 'completed', 'failed', 'completed'])
        self.assertEqual(json.loads(roles[1]['stdout'])['role'], 'associate-conductor')
        self.assertIn('invalid-role', roles[2]['stderr'])
        player = json.loads(roles[3]['stdout'])
        self.assertEqual(player['parent'], 'root')
        self.assertEqual(player['role'], 'associate-conductor')

    def test_malformed_mixed_later_decision_prevents_earlier_admission(self):
        before = self.stored_messages()
        output = self.endpoint_output()
        self.action('root', 'guide', '--to', 'worker-a', '--text', 'Valid earlier item.',
                    '--id', 'must-not-admit', '--and', 'completion-confirmed',
                    '--to', success=False)
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.endpoint_output(), output)
        for action in ('session', 'player', 'assignment'):
            for option in ('--session', '--id'):
                with self.subTest(action=action, option=option):
                    missing = self.action('root', action, option, success=False)
                    self.assertIn('Missing value for ' + option, missing.stderr)
            conflict = self.action('root', action, '--session', 'worker-a',
                                   '--id', 'worker-b', success=False)
            self.assertIn('Choose --session or --id.', conflict.stderr)
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.endpoint_output(), output)

    def test_named_batch_keeps_real_errors_and_later_complete_output(self):
        bad_repo = self.directory / 'missing-git-directory'
        rows = self.action('root', 'project', 'register', '--path', bad_repo, 'and',
                           'knowledge', 'record', '--id', 'missing-file-record',
                           '--kind', 'observation', '--claim-file',
                           self.directory / 'absent-claim', '--and', 'outbox')
        self.assertEqual(rows[0]['status'], 'failed')
        self.assertNotEqual(rows[0]['waitStatus'], 'exit 0')
        self.assertIn(str(bad_repo), rows[0]['nativeArgv'])
        self.assertEqual(rows[0]['stderr'],
                         'Native control setup failed; inspect the registered session and retained input.\n')
        self.assertEqual(pathlib.Path(rows[0]['stderrPath']).read_text(), rows[0]['stderr'])
        self.assertEqual(rows[1]['status'], 'refused')
        self.assertIn('--claim', rows[1]['cause'])
        self.assertEqual(rows[2]['status'], 'completed')
        self.assertEqual(json.loads(rows[2]['stdout']), self.legacy('outbox', 'root'))
        self.assertFalse(any(row['id'] == 'missing-file-record'
                             for row in self.legacy('knowledge', 'root')))

    def test_named_knowledge_complete_files_relations_promotion_and_search(self):
        self.legacy('report', 'named-evidence', 'worker-a', 'Complete source evidence.')
        claim = '\ufeff' + ('Unicode λ and actual source evidence.\n' * 5000)
        limits = 'A complete authored limit.\nTrailing spaces  '
        claim_path = self.directory / 'claim text.txt'
        limits_path = self.directory / 'limits.txt'
        claim_path.write_text(claim, encoding='utf-8')
        limits_path.write_text(limits, encoding='utf-8')
        rows = self.action('worker-a', 'knowledge', 'record', '--id', 'named-finding',
                           '--kind', 'observation', '--claim-file', claim_path,
                           '--evidence', 'message:named-evidence', '--limits-file',
                           limits_path, '--and', 'knowledge', 'read', '--id', 'named-finding')
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        finding = json.loads(rows[1]['stdout'])[0]
        self.assertEqual(finding['claim'], claim)
        self.assertEqual(finding['limits'], limits)
        self.assertEqual(finding['evidenceMessage']['body'], 'Complete source evidence.')
        related = self.action('worker-a', 'knowledge', 'relate', '--id', 'named-link',
                              '--source', 'message:named-evidence', '--relation',
                              'Supports', '--target', 'finding:named-finding')
        self.assertEqual(related[0]['status'], 'completed')
        promoted = self.action('root', 'knowledge', 'promote', '--id', 'named-promotion',
                               '--from', 'worker-a', '--to', 'root', '--finding', 'named-finding')
        self.assertEqual(promoted[0]['status'], 'completed')
        query = self.directory / 'query.txt'
        query.write_text('Unicode source', encoding='utf-8')
        searched = self.action('root', 'knowledge', 'search', '--scope', 'all',
                               '--query-file', query, '--and', 'knowledge', 'traverse',
                               '--scope', 'all', '--reference', 'finding:named-finding',
                               '--direction', 'both', '--recursive')
        self.assertEqual([row['status'] for row in searched], ['completed', 'completed'])
        self.assertIn('named-finding', searched[0]['stdout'])
        self.assertIn('named-link', searched[1]['stdout'])

    def test_body_bom_file_and_stdin_preserve_valid_bytes_and_refuse_invalid_bytes(self):
        body = '\ufeffComplete λ input.\nLast line  '
        path = self.directory / 'bom.txt'
        path.write_bytes(body.encode('utf-8'))
        row = self.action('root', 'send', 'worker-a', '--kind', 'report',
                          '--id', 'bom-file', '--file', path)[0]
        self.assertEqual(row['delivery']['body'], body)
        stdin = subprocess.run([str(EXE), str(self.db), 'as', 'root', 'send',
                                'worker-a', '--kind', 'report', '--id', 'bom-stdin',
                                '--file', '-'], input=body.encode('utf-8'), capture_output=True)
        self.assertEqual(stdin.returncode, 0, stdin.stdout + stdin.stderr)
        self.assertEqual(json.loads(stdin.stdout)[0]['delivery']['body'], body)
        shared = subprocess.run([str(EXE), str(self.db), 'as', 'root', 'send',
                                 'worker-a', '--kind', 'report', '--id', 'shared-stdin-a',
                                 '--file', '-', '--and', 'worker-b', '--kind', 'report',
                                 '--id', 'shared-stdin-b', '--file', '-'],
                                input=body.encode('utf-8'), capture_output=True)
        self.assertEqual(shared.returncode, 0, shared.stdout + shared.stderr)
        self.assertEqual([row['delivery']['body'] for row in json.loads(shared.stdout)],
                         [body, body])
        for name, raw, cause in [('bom-invalid', b'\xef\xbb\xbf\xff', 'invalidUtf8 byte 3'),
                                 ('bom-nul', b'\xef\xbb\xbf\x00', 'embeddedNul byte 3')]:
            with self.subTest(name=name):
                path.write_bytes(raw)
                rows = self.action('root', 'send', 'worker-a', '--kind', 'report',
                                   '--id', name, '--file', path, '--and', 'worker-b',
                                   '--kind', 'report', '--id', name + '-valid', '--text', 'and')
                self.assertEqual(rows[0]['status'], 'refused')
                self.assertIn(cause, rows[0]['admission']['cause'])
                self.assertEqual(rows[1]['delivery']['body'], 'and')
                self.assertNotIn(name, {row[0] for row in self.stored_messages()})

    def test_named_receiver_and_configure_use_selected_record_and_expected_route(self):
        command = self.directory / 'recorded receiver λ🙂'
        command.write_text('#!/bin/sh\nexit 0\n')
        command.chmod(0o755)
        log = self.directory / 'receiver log λ.jsonl'
        configured = self.action('root', 'configure', '--session', 'worker-a',
                                 '--harness', 'codex', '--command', command, '--output-log', log)
        self.assertEqual(configured[0]['status'], 'completed')
        self.legacy('bind', 'worker-a', 'saved-worker-native-λ', 'codex', 'model', 'low')
        original = self.legacy('session', 'worker-a')
        registered = self.action('root', 'receiver', '--session', 'worker-a',
                                 '--command', command, '--output-log', log)
        self.assertEqual(registered[0]['status'], 'completed')
        changed = self.action('root', 'configure', '--session', 'worker-a', '--effort', 'high')
        self.assertEqual(changed[0]['status'], 'completed')
        current = self.legacy('session', 'worker-a')
        self.assertEqual((current['harness'], current['model'], current['effort']),
                         ('codex', 'model', 'high'))
        self.assertEqual(current['native'], original['native'])
        endpoint = json.loads(current['endpoint'])
        self.assertEqual(endpoint[-5], str(command))
        self.assertEqual(endpoint[-1], str(log))
        denied = self.action('root', 'configure', '--session', 'worker-a',
                             '--model', 'new-model', '--expected-model', 'wrong-model',
                             '--and', 'attempt', '--session', 'worker-a')
        self.assertEqual(denied[0]['status'], 'failed')
        self.assertEqual(denied[1]['status'], 'completed')
        self.assertEqual(self.legacy('session', 'worker-a'), current)

    def test_named_project_registration_settings_and_explicit_context(self):
        registered = self.action('root', 'project', 'register', '--path', self.repo)
        self.assertEqual(registered[0]['status'], 'completed')
        project = json.loads(registered[0]['stdout'])
        settings = pathlib.Path(project['project']) / 'baton2' / 'settings.json'
        body = json.dumps({'schema': 'baton2-project-settings-v1',
                           'routes': [{'name': 'review λ', 'harness': 'codex', 'model': 'model',
                                       'effort': 'high'}],
                           'context': {'disabled': [], 'preferred': ['saved λ context']},
                           'subscriptions': []}, ensure_ascii=False, indent=2) + '\n  '
        settings.write_text(body, encoding='utf-8')
        worker = self.legacy('session', 'worker-a')
        rows = self.invoke('--project', self.repo, 'as', 'worker-a', 'project',
                           'settings', 'and', 'project', 'sessions',
                           cwd=self.directory, environment={'BATON_DATABASE': str(self.directory / 'wrong.db')})
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        inspected = json.loads(rows[0]['stdout'])
        self.assertEqual(inspected['status'], 'decoded')
        self.assertEqual(inspected['body'], body)
        self.assertEqual(inspected['path'], str(settings))
        self.assertEqual(rows[0]['argv'], [str(EXE.resolve()), '--project-settings', worker['workspace']])
        self.assertEqual(rows[0]['waitStatus'], 'exit 0')
        self.assertEqual(json.loads(rows[1]['stdout'])['project']['database'], str(self.db))
        self.assertEqual(settings.read_text(), body)
        settings.write_text('{invalid settings', encoding='utf-8')
        failed = self.action('root', 'project', 'settings', '--path', self.repo,
                             '--and', 'outbox')
        self.assertEqual(failed[0]['status'], 'failed')
        refusal = json.loads(failed[0]['stdout'])
        self.assertEqual(refusal['body'], '{invalid settings')
        self.assertEqual(refusal['status'], 'refused')
        self.assertEqual(refusal['reason'], 'projectSettingsMalformed')
        self.assertEqual(failed[1]['status'], 'completed')
        unknown = json.loads(body)
        unknown['unknownField'] = 'Full original text stays available.'
        unknown_body = json.dumps(unknown, ensure_ascii=False) + '\n'
        settings.write_text(unknown_body, encoding='utf-8')
        rejected = self.action('root', 'project', 'settings', '--path', self.repo)[0]
        self.assertEqual(rejected['status'], 'failed')
        strict = json.loads(rejected['stdout'])
        self.assertEqual(strict['body'], unknown_body)
        self.assertEqual(strict['reason'], 'projectSettingsMalformed')
        settings.write_bytes(b'\xffinvalid')
        invalid_utf8 = self.action('root', 'project', 'settings', '--path', self.repo)[0]
        self.assertEqual(invalid_utf8['status'], 'failed')
        self.assertEqual(json.loads(invalid_utf8['stdout'])['bytesHex'], 'ff696e76616c6964')

    def test_named_stop_reason_keeps_explicit_stop_and_no_automatic_resume(self):
        reason = self.directory / 'reason.txt'
        body = '\ufeffOperator stop.\nKeep original assignment and evidence.  '
        reason.write_text(body, encoding='utf-8')
        configured = self.action('root', 'configure', '--session', 'worker-b',
                                 '--harness', 'codex', '--command', sys.executable,
                                 '--output-log', self.directory / 'unused-log')
        self.assertEqual(configured[0]['status'], 'completed')
        self.legacy('connect', 'worker-b', '', self.endpoint)
        self.legacy('bind', 'worker-b', 'saved-stopped-native', 'codex', 'model', 'low')
        self.legacy('message', 'stop-task', 'root', 'worker-b', 'task-assignment', 'Original work.')
        rows = self.action('root', 'stop', '--session', 'worker-b', '--id', 'named-stop',
                           '--reason-file', reason, '--and', 'receive', '--session', 'worker-b',
                           '--command', self.directory / 'unused-command', '--output-log',
                           self.directory / 'unused-log', '--and', 'attempt', '--session', 'worker-b')
        self.assertEqual(rows[0]['status'], 'completed')
        current = self.legacy('session', 'worker-b')
        self.assertEqual(current['taskCompletion']['assignmentId'], 'stop-task')
        self.assertIn('named-stop', json.dumps(current))
        self.assertEqual(json.loads(rows[0]['stdout'])['reason'], body)
        self.assertIsNone(self.legacy('delivery', 'stop-task')['receipt'])
        self.assertEqual(rows[-1]['status'], 'completed')

    def test_native_file_stdin_references_share_one_complete_invocation(self):
        self.legacy('report', 'stdin-knowledge-evidence', 'worker-a', 'Evidence body.')
        body = '\ufeffComplete λ input.\nTrailing spaces  '
        result = subprocess.run([str(EXE), str(self.db), 'as', 'worker-a',
                                 'knowledge', 'record', '--id', 'stdin-finding-a',
                                 '--kind', 'observation', '--claim-file', '-',
                                 '--limits-file', '-', '--evidence', 'message:stdin-knowledge-evidence',
                                 '--and', 'knowledge', 'record', '--id', 'stdin-finding-b',
                                 '--kind', 'finding', '--claim-file', '-', '--evidence',
                                 'message:stdin-knowledge-evidence'],
                                input=body.encode('utf-8'), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([row['status'] for row in json.loads(result.stdout)],
                         ['completed', 'completed'])
        saved = {row['id']: row for row in self.legacy('knowledge', 'worker-a')}
        self.assertEqual(saved['stdin-finding-a']['claim'], body)
        self.assertEqual(saved['stdin-finding-a']['limits'], body)
        self.assertEqual(saved['stdin-finding-b']['claim'], body)

    def test_named_turn_stdin_keeps_complete_task_and_native_report(self):
        fixture = self.directory / 'direct-claude-fixture'
        prompt = self.directory / 'direct-prompt.txt'
        fixture.write_text('#!' + sys.executable + '\nimport json,pathlib,sys\n'
                           'text=json.loads(sys.stdin.readline())["message"]["content"]\n'
                           f'pathlib.Path({str(prompt)!r}).write_text(text,encoding="utf-8")\n'
                           'print(json.dumps({"type":"system","subtype":"init",'
                           '"session_id":"named-native","model":"model"}),flush=True)\n'
                           'print(json.dumps({"type":"result","result":"Named task completed.",'
                           '"session_id":"named-native","is_error":False}),flush=True)\n')
        fixture.chmod(0o755)
        log = self.directory / 'named-direct.jsonl'
        configured = self.action('root', 'configure', '--session', 'worker-a',
                                 '--harness', 'claude-code', '--command', fixture, '--output-log', log)
        self.assertEqual(configured[0]['status'], 'completed')
        bound = self.action('root', 'bind', '--session', 'worker-a', '--harness',
                            'claude-code', '--model', 'model', '--effort', 'low', '--native', '')
        self.assertEqual(bound[0]['status'], 'completed')
        body = '\ufeffImplement the complete task.\nUnicode λ🙂 and trailing spaces  '
        result = subprocess.run([str(EXE), str(self.db), 'as', 'worker-a', 'turn',
                                 '--id', 'named-direct-turn', '--command', str(fixture),
                                 '--file', '-', '--output-log', str(log), '--and', 'attempt'],
                                input=body.encode('utf-8'), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        rows = json.loads(result.stdout)
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        self.assertEqual(rows[0]['argv'], [str(EXE.resolve()), str(self.db.resolve()),
                                          'agent-native-input'])
        self.assertEqual(rows[0]['nativeArgv'][2], 'turn-text')
        self.assertEqual(rows[0]['nativeArgv'][9], body)
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            retained_task, = database.execute(
                'SELECT task FROM direct_turn_requests WHERE id=?',
                ('named-direct-turn',)).fetchone()
        self.assertEqual(retained_task, body)
        self.assertEqual(list(self.directory.glob(self.db.name + '.agent-command-*.stdin')), [])
        self.assertFalse(pathlib.Path(str(self.db) + '.actions').exists())
        self.assertTrue(prompt.read_text(encoding='utf-8').endswith(body))
        self.assertEqual(self.legacy('delivery', 'named-direct-turn:task-input')['body'], body)
        actor = self.legacy('session', 'worker-a')
        self.assertEqual(actor['native'], 'named-native')
        self.assertTrue(actor['taskCompletion']['open'])
        self.assertFalse(actor['taskCompletion']['confirmed'])
        self.assertIn('Named task completed.',
                      '\n'.join(row['body'] for row in self.legacy('inbox', 'root')))

    def test_named_report_and_dispatch_preserve_authored_body_and_native_identity(self):
        self.legacy('bind', 'worker-a', 'retained-native', 'fixture', 'model', 'low')
        connected = self.action('worker-a', 'connect', '--endpoint', self.endpoint)
        self.assertEqual(connected[0]['status'], 'completed')
        self.assertEqual(self.legacy('session', 'worker-a')['native'], 'retained-native')
        text = '\ufeff' + 'Complete λ report.\n' * 9000
        path = self.directory / 'large-report.txt'
        path.write_text(text, encoding='utf-8')
        rows = self.action('worker-a', 'report', '--id', 'named-report', '--file', path,
                           '--and', 'ask', '--id', 'named-question', '--text', 'and')
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        self.assertEqual(self.legacy('delivery', 'named-report')['body'], text)
        self.assertEqual(self.legacy('delivery', 'named-report')['recipient'], 'root')
        self.assertEqual(self.legacy('delivery', 'named-question')['body'], 'and')
        sent = self.action('root', 'dispatch', '--id', 'named-dispatch', '--to', 'worker-b',
                           '--file', path)
        self.assertEqual(sent[0]['status'], 'completed')
        delivered = self.legacy('delivery', 'named-dispatch')
        self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind']),
                         ('root', 'worker-b', 'task'))
        self.assertEqual(delivered['body'], text)

    def test_mixed_mutations_generate_ids_and_keep_explicit_retry_identity(self):
        self.legacy('report', 'generated-id-evidence', 'worker-a',
                    'Complete retained evidence.\nλ🙂')
        body = '\ufeffComplete generated-ID report.\nλ🙂\nTrailing spaces  '
        question = 'Which retained source should be used?\nλ🙂'
        claim = 'The full retained input is available.\nλ🙂'
        rows = self.action('worker-a', 'report', '--text', body, '--and',
                           'ask', '--text', question, '--and', 'knowledge', 'record',
                           '--kind', 'observation', '--claim', claim,
                           '--evidence', 'message:generated-id-evidence')
        self.assertEqual([row['status'] for row in rows], ['completed'] * 3)
        report_id, question_id, finding_id = (row['nativeArgv'][3] for row in rows)
        self.assertTrue(all(isinstance(ident, str) and ident
                            for ident in (report_id, question_id, finding_id)))
        self.assertEqual(len({report_id, question_id, finding_id}), 3)
        for ident, kind, text, row in ((report_id, 'report', body, rows[0]),
                                      (question_id, 'question', question, rows[1])):
            delivered = self.legacy('delivery', ident)
            self.assertEqual((delivered['sender'], delivered['recipient'],
                              delivered['kind'], delivered['body']),
                             ('worker-a', 'root', kind, text))
            self.assertIn(ident, row['stdout'])
        finding = next(row for row in self.legacy('knowledge', 'worker-a')
                       if row['id'] == finding_id)
        self.assertEqual(finding['claim'], claim)
        self.assertEqual(finding['evidenceMessage']['body'],
                         'Complete retained evidence.\nλ🙂')
        before = self.stored_messages()
        before_findings = self.legacy('knowledge', 'worker-a')
        replay = self.action('worker-a', 'report', '--id', report_id, '--text', body,
                             '--and', 'knowledge', 'record', '--id', finding_id,
                             '--kind', 'observation', '--claim', claim,
                             '--evidence', 'message:generated-id-evidence')
        self.assertEqual([row['status'] for row in replay], ['completed', 'completed'])
        self.assertIn(report_id, replay[0]['nativeArgv'])
        self.assertIn(finding_id, replay[1]['nativeArgv'])
        self.assertEqual(self.stored_messages(), before)
        self.assertEqual(self.legacy('knowledge', 'worker-a'), before_findings)

    def test_report_evidence_selects_own_current_assignment_and_preserves_complete_body(self):
        self.legacy('report', 'old-report', 'worker-a', 'Earlier assignment evidence.')
        self.legacy('message', 'evidence-task', 'root', 'worker-a',
                    'task-assignment', 'Investigate the current source.')
        self.legacy('report', 'other-author-report', 'worker-b', 'Another actor evidence.')
        self.legacy('ensemble', 'evidence-peers', 'root', 'tight')
        for member in ('worker-a', 'other-root'):
            self.legacy('ensemble-member', 'evidence-peers', 'root', member, 'add')
        self.legacy('message', 'other-recipient-report', 'worker-a', 'other-root',
                    'report', 'Another recipient evidence.')
        body = '\ufeffComplete observed source and command evidence.\nλ🙂\nTrailing spaces  '
        rows = self.action('worker-a', 'report', '--text', body, '--and',
                           'knowledge', 'record', '--kind', 'observation',
                           '--claim', 'First source fact.', '--evidence', 'report',
                           '--limits', 'Observed command only.', '--and',
                           'knowledge', 'record', '--kind', 'finding',
                           '--claim', 'Second source fact.', '--evidence', 'report')
        self.assertEqual([row['status'] for row in rows], ['completed'] * 3)
        report_id = rows[0]['nativeArgv'][3]
        findings = self.legacy('knowledge', 'worker-a')
        self.assertEqual(len(findings), 2)
        for finding in findings:
            self.assertEqual(finding['author'], 'worker-a')
            self.assertEqual(finding['evidence'], 'message:' + report_id)
            self.assertEqual(finding['evidenceMessage'], {'id': report_id,
                             'sender': 'worker-a', 'recipient': 'root', 'body': body})
        self.assertEqual(self.legacy('delivery', report_id)['body'], body)

    def test_report_evidence_refuses_absent_ambiguous_and_stale_contexts(self):
        arguments = ('knowledge', 'record', '--kind', 'finding',
                     '--claim', 'An evidence-backed source fact.', '--evidence', 'report')
        unassigned = self.action('worker-a', *arguments)[0]
        self.assertEqual(unassigned['status'], 'refused')
        self.assertIn('no retained current assignment', unassigned['cause'])
        self.legacy('report', 'stale-report', 'worker-a', 'Stale evidence.')
        self.legacy('message', 'current-evidence-task', 'root', 'worker-a',
                    'task-assignment', 'Current investigation.')
        absent = self.action('worker-a', *arguments)[0]
        self.assertEqual(absent['status'], 'refused')
        self.assertIn('No authored report', absent['cause'])
        self.legacy('report', 'first-current-report', 'worker-a', 'First current evidence.\nλ🙂')
        self.legacy('report', 'second-current-report', 'worker-a', 'Second current evidence.')
        ambiguous = self.action('worker-a', *arguments, '--and',
                                'ask', '--text', 'Which source evidence should be selected?')
        self.assertEqual([row['status'] for row in ambiguous], ['refused', 'completed'])
        self.assertIn('Several authored reports', ambiguous[0]['cause'])
        self.assertEqual(self.legacy('knowledge', 'worker-a'), [])
        selected = self.action('worker-a', 'knowledge', 'record', '--kind', 'finding',
                               '--claim', 'Deliberately selected earlier evidence.',
                               '--evidence', 'message:first-current-report')[0]
        self.assertEqual(selected['status'], 'completed')
        finding = self.legacy('knowledge', 'worker-a')[0]
        self.assertEqual(finding['evidence'], 'message:first-current-report')
        self.assertEqual(finding['evidenceMessage']['body'], 'First current evidence.\nλ🙂')
        self.legacy('message', 'next-evidence-task', 'root', 'worker-a',
                    'task-assignment', 'A separate investigation.')
        newer = self.action('worker-a', *arguments)[0]
        self.assertEqual(newer['status'], 'refused')
        self.assertIn('No authored report', newer['cause'])

    def test_generated_continuation_and_stop_keep_original_work_and_retry_stop(self):
        self.legacy('configure', 'worker-b', 'codex', 'model', 'low', sys.executable,
                    str(self.directory / 'control-output.jsonl'), 'fixture', 'model', 'low')
        self.legacy('connect', 'worker-b', 'retained-control-native', self.endpoint)
        self.assertEqual(self.legacy('session', 'worker-b')['harness'], 'codex')
        self.legacy('message', 'generated-control-task', 'root', 'worker-b',
                    'task-assignment', 'Original unfinished work.\nλ🙂')
        self.action('worker-b', 'read', 'generated-control-task')
        self.assertTrue(receive_fixture.read_recorded(self.db, 'generated-control-task', 'worker-b'))
        reason = 'Operator stop after explicit continuation.\nλ🙂'
        rows = self.action('root', 'continue-task', '--session', 'worker-b', '--and',
                           'stop', '--session', 'worker-b', '--reason', reason)
        self.assertEqual([row['status'] for row in rows], ['completed', 'completed'])
        continuation_id = json.loads(rows[0]['stdout'])['continuationId']
        self.assertTrue(continuation_id)
        self.assertEqual(continuation_id, rows[0]['nativeArgv'][4] + ':task-continuation')
        continuation = self.legacy('delivery', continuation_id)
        self.assertEqual((continuation['sender'], continuation['recipient']),
                         ('worker-b', 'worker-b'))
        self.assertIn('generated-control-task', continuation['body'])
        state = self.legacy('session', 'worker-b')
        stop_id = state['stop']['id']
        self.assertTrue(stop_id)
        self.assertNotEqual(stop_id, continuation_id)
        self.assertIn(stop_id, rows[1]['nativeArgv'])
        self.assertEqual(json.loads(rows[1]['stdout'])['reason'], reason)
        self.assertEqual(self.legacy('delivery', 'generated-control-task')['body'],
                         'Original unfinished work.\nλ🙂')
        self.assertIsNone(self.legacy('delivery', 'generated-control-task')['receipt'])
        before = self.stored_messages()
        replay = self.action('root', 'stop', '--session', 'worker-b',
                             '--id', stop_id, '--reason', reason)
        self.assertEqual(replay[0]['status'], 'completed')
        self.assertIn(stop_id, replay[0]['nativeArgv'])
        self.assertEqual(self.legacy('session', 'worker-b')['stop'], state['stop'])
        self.assertEqual(self.stored_messages(), before)

    def test_malformed_later_named_clause_performs_no_earlier_operation(self):
        before = self.legacy('session', 'worker-a')
        cases = [('receiver', '--session', 'worker-a', '--command', 'never-run',
                  '--output-log', str(self.directory / 'never-log'), '--and',
                  'configure', '--unknown', 'value'),
                 ('configure', '--session', 'worker-a', '--model', 'changed',
                  'and', 'knowledge', 'record', '--id', 'invalid-later', '--kind', 'finding'),
                 ('worktree', '--session', 'worker-a', '--session', 'worker-b'),
                 ('land', '--repo', str(self.repo), '--target', 'main', '--check', 'missing-files')]
        for args in cases:
            with self.subTest(args=args):
                self.action('root', *args, success=False)
                self.assertEqual(self.legacy('session', 'worker-a'), before)

    def test_legacy_commands_and_private_shutdown_keep_their_argv(self):
        self.legacy('message', 'legacy-input', 'root', 'worker-a', 'guidance',
                    'Legacy body.')
        before = self.legacy('session', 'root')
        self.assertEqual(self.legacy('delivery', 'legacy-input')['body'],
                         'Legacy body.')
        stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                 capture_output=True, text=True)
        self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        self.assertEqual(self.legacy('session', 'root'), before)
        self.assertEqual(self.action('worker-a', 'inbox')[0]['id'], 'legacy-input')


if __name__ == '__main__':
    unittest.main()
