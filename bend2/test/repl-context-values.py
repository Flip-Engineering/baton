"""Native context values, recipient projections and immutable turn snapshots."""
import json
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('context_fixture', Path(__file__).with_name('repl-context.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ContextValues(fixture.ReplContext):
    # Reuse the native database/process fixture without rerunning inherited cases.
    def context_cell(self, value):
        expression = json.dumps(json.dumps(value, ensure_ascii=False), ensure_ascii=False)
        result = self.repl('author', 'eval', expression, '--type', 'String', '--label', 'context')
        return json.loads(result.stdout)['cells'][0]['reference']

    def checkpoint(self, value):
        cell = self.context_cell(value)
        receipt = json.loads(self.repl('author', 'checkpoint', '--cell', cell).stdout)
        self.assertEqual(receipt['context']['format'], 'baton.context-value/v1')
        self.assertEqual(receipt['context']['mediaType'], 'application/vnd.baton.context-value+json')
        return cell, receipt

    def projected(self, actor, *args, success=True):
        result = self.repl(actor, 'context', *args, success=success)
        if not success:
            return result
        return json.loads(result.stdout.strip().splitlines()[-1])['context']

    def test_value_projection_is_bounded_and_reconstructs_unicode(self):
        value = {'facts': ['λ🌱' * 3000], 'topic': 'compiler', 'nested': {'result': 41}}
        cell, receipt = self.checkpoint(value)
        self.assertEqual(len(receipt['context']['preview']), 1024)
        self.assertFalse(receipt['context']['complete'])
        self.assertNotIn('source', receipt)
        self.projected('recipient', '--cell', receipt['citation'], success=False)
        message = self.share(cell)
        self.assertEqual(json.loads(message['body']), receipt)
        fragments = []
        cursor = 0
        while True:
            read = self.projected('recipient', '--cell', receipt['citation'],
                                  '--offset', str(cursor), '--length', '613')
            self.assertEqual(read['offset'], cursor)
            self.assertLessEqual(read['length'], 613)
            self.assertEqual(read['length'], len(read['fragment']))
            fragments.append(read['fragment'])
            if read['complete']:
                self.assertIsNone(read.get('nextOffset'))
                break
            self.assertGreater(read['nextOffset'], cursor)
            cursor = read['nextOffset']
        complete = ''.join(fragments)
        self.assertEqual(len(complete), read['totalCharacters'])
        self.assertEqual(json.loads(complete), value)
        self.assertEqual(self.query('SELECT DISTINCT recipient FROM message_reads WHERE message=?',
                                    (message['id'],)), [('recipient',)])
        self.projected('outsider', '--cell', receipt['citation'], success=False)

    def test_binding_is_idempotent_and_turn_version_survives_rebinding(self):
        first, receipt = self.checkpoint({'step': 1})
        self.repl('author', 'checkpoint', '--cell', first)
        self.assertEqual(self.query('SELECT version FROM repl_context_bindings'), [(1,)])
        self.invoke('attach', 'coordinator', 'fixture', '', '')
        with fixture.sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE sessions SET parent='coordinator' WHERE id='author'")
        terminal = json.dumps({'type': 'result', 'subtype': 'success', 'result': 'first turn'})
        self.invoke('observe', 'author', 'context-turn-1', terminal)
        second, second_receipt = self.checkpoint({'step': 2})
        self.assertNotEqual(second_receipt['citation'], receipt['citation'])
        self.invoke('observe', 'author', 'context-turn-1', terminal)
        self.invoke('observe', 'author', 'context-turn-2', terminal)
        self.assertEqual(self.query('SELECT turn,cell,version FROM repl_context_turns ORDER BY turn'),
                         [('context-turn-1', first, 1), ('context-turn-2', second, 2)])
        self.assertEqual(json.loads(self.projected('author', '--turn', 'context-turn-1')['fragment']), {'step': 1})
        self.projected('recipient', '--turn', 'context-turn-1', success=False)
        self.assertEqual(json.loads(self.projected('author')['fragment']), {'step': 2})
        self.assertEqual(json.loads(self.projected('author', '--cell', receipt['citation'])['fragment']),
                         {'step': 1})

    def test_turn_without_context_stays_unbound_after_replay(self):
        self.invoke('attach', 'coordinator', 'fixture', '', '')
        with fixture.sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE sessions SET parent='coordinator' WHERE id='author'")
        terminal = json.dumps({'type': 'result', 'subtype': 'success', 'result': 'unbound turn'})
        self.invoke('observe', 'author', 'context-turn-unbound', terminal)
        self.checkpoint({'step': 2})
        self.invoke('observe', 'author', 'context-turn-unbound', terminal)
        self.assertEqual(self.query('SELECT turn,cell,version FROM repl_context_turns'),
                         [('context-turn-unbound', None, None)])

    def test_invalid_context_cannot_replace_the_committed_value(self):
        cell, receipt = self.checkpoint({'valid': True})
        for expression, expected in [('42', 'U32'), ('"not json"', 'String')]:
            result = self.repl('author', 'eval', expression, '--type', expected)
            invalid = json.loads(result.stdout)['cells'][0]['reference']
            self.repl('author', 'checkpoint', '--cell', invalid, success=False)
        self.assertEqual(self.query('SELECT cell,version FROM repl_context_bindings'), [(cell, 1)])
        self.repl('recipient', 'checkpoint', '--cell', cell, success=False)
        for offset, length in [('-1', '4'), ('1x', '4'), ('0', '0'), ('0', '8193'), ('0', '1e3')]:
            self.projected('author', '--offset', offset, '--length', length, success=False)
        self.assertEqual(json.loads(self.projected('author')['fragment']), {'valid': True})


# The parent module's eight cases are run separately by the qualification driver.
for name in dir(fixture.ReplContext):
    if name.startswith('test_'):
        setattr(ContextValues, name, None)

if __name__ == '__main__':
    unittest.main()
