"""Remote qualification of the native knowledge index and selected read.

Set BATON2_KNOWLEDGE_EXE to the exact candidate native artifact and
BATON2_KNOWLEDGE_MCP to its adapter. NODE selects the admitted Node runtime.
All subprocess argv, stdout, stderr and exits remain in the printed directory.
The fixtures use endpoint-free SQLite data; no model/provider runs.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_KNOWLEDGE_EXE', ROOT / '.scratch/bend2/baton2')).resolve()
MCP = Path(os.environ.get('BATON2_KNOWLEDGE_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs')).resolve()
EVIDENCE = Path(tempfile.mkdtemp(prefix='baton-knowledge-index-'))


class KnowledgeIndex(unittest.TestCase):
    def setUp(self):
        self.directory = EVIDENCE / self._testMethodName
        self.directory.mkdir()
        self.db = self.directory / 'coord.db'
        self.serial = 0
        self.native('attach', 'root', 'fixture', 'native-root', '')
        with sqlite3.connect(self.db) as sql:
            sql.executemany('INSERT INTO sessions(id,harness,native,endpoint,parent) VALUES(?,?,?,?,?)', [
                ('author', 'fixture', 'a', '', 'root'),
                ('sibling', 'fixture', 's', '', 'root'),
                ('grandchild', 'fixture', 'g', '', 'author'),
                ('foreign', 'fixture', 'f', '', None),
            ])
        self.native('knowledge', 'root')  # The legacy command initializes the optional pair.
        self.body = 'retained evidence\nλ\x00' + 'x' * 200000
        self.claim = 'claim\n日本語\x00complete'
        self.limits = 'scope\nλ\x00limits'
        self.ids = ['first', "finding ' λ $(literal)", '--pretty', '--id', '', 'last']
        with sqlite3.connect(self.db) as sql:
            sql.execute('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)',
                        ('evidence', 'author', 'root', 'report', self.body, 'already acknowledged'))
            sql.executemany('INSERT INTO knowledge VALUES(?,?,?,?,?)',
                            [(key, 'author', self.claim, 'message:evidence', self.limits) for key in self.ids])
            sql.execute('INSERT INTO knowledge VALUES(?,?,?,?,?)',
                        ('hidden', 'foreign', 'hidden claim', 'message:evidence', 'hidden limits'))
            sql.execute('INSERT INTO knowledge_promotions VALUES(?,?,?,?,?,?)',
                        ('promotion', 'first', 'author', 'root', 'sibling', 'sibling'))

    def process(self, argv, data=None):
        self.serial += 1
        prefix = self.directory / str(self.serial)
        prefix.with_suffix('.argv.json').write_text(json.dumps(argv))
        result = subprocess.run(argv, input=data, capture_output=True)
        prefix.with_suffix('.stdout').write_bytes(result.stdout)
        prefix.with_suffix('.stderr').write_bytes(result.stderr)
        prefix.with_suffix('.exit').write_text(str(result.returncode) + '\n')
        return result

    def native(self, *args, success=True, database=None):
        result = self.process([str(EXE), str(database or self.db), *args])
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.directory.glob('coord.db*')}

    def read(self, reader='author', *options):
        before = self.snapshot()
        result = self.native('knowledge', reader, *options)
        self.assertEqual(self.snapshot(), before)
        return result

    def mcp(self, arguments):
        requests = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
             'params': {'name': 'baton2_knowledge', 'arguments': arguments}},
        ]
        result = self.process([os.environ.get('NODE', 'node'), str(MCP), str(self.db),
                               str(EXE), '--session', 'author'],
                              ''.join(json.dumps(row) + '\n' for row in requests).encode())
        self.assertEqual(result.returncode, 0, result.stderr)
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([row['id'] for row in responses], [1, 2, 3])
        self.assertIn('baton2_knowledge', [t['name'] for t in responses[1]['result']['tools']])
        return responses[-1]['result']

    def test_metadata_and_literal_navigation_preserve_full_selected_findings(self):
        legacy = self.native('knowledge', 'author')
        indexed = self.read('author', '--index')
        self.assertEqual([row['id'] for row in indexed], self.ids)
        for row, complete in zip(indexed, legacy):
            self.assertNotIn('claim', row)
            self.assertNotIn('limits', row)
            self.assertNotIn('body', row['evidenceMessage'])
            self.assertEqual(row['claimBytes'], len(self.claim.encode()))
            self.assertEqual(row['limitsBytes'], len(self.limits.encode()))
            self.assertEqual(row['evidenceMessage']['bodyBytes'], len(self.body.encode()))
            self.assertEqual(row['evidenceMessage']['receiptState'], 'acknowledged')
            self.assertEqual(row['detailRead'], ['knowledge', 'author', '--id', row['id']])
            before = self.snapshot()
            self.assertEqual(self.native(*row['detailRead']), [complete])
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(complete['evidenceMessage']['body'], self.body)
            self.assertEqual(complete['claim'], self.claim)
            self.assertEqual(complete['limits'], self.limits)

    def test_selected_id_conjoins_all_visibility_branches(self):
        self.assertEqual(self.read('author', '--id', 'absent'), [])
        self.assertEqual(self.read('author', '--id', 'hidden'), [])
        self.assertEqual([r['id'] for r in self.read('root', '--id', 'last')], ['last'])
        self.assertEqual(self.read('grandchild', '--index'), [])
        self.assertEqual([r['id'] for r in self.read('sibling', '--index')], ['first'])
        row = self.read('sibling', '--id', 'first')[0]
        self.assertEqual(row['author'], 'author')
        self.assertEqual(row['destinations'], ['sibling'])
        self.assertEqual(row['promotions'], [{'finding': 'first', 'author': 'author',
                                             'source': 'root', 'destination': 'sibling',
                                             'promotedBy': 'sibling'}])
        self.assertEqual(self.read('sibling', '--id', 'last'), [])
        self.assertEqual(self.read("reader ' λ", '--index'), [])

    def test_pretty_and_flag_shaped_identifiers(self):
        for key in self.ids:
            expected = self.read('author', '--id', key)
            self.assertEqual(self.read('author', '--id', key, '--pretty'), expected)
            self.assertEqual(self.read('author', '--pretty', '--id', key), expected)
        self.assertEqual(self.read('author', '--index', '--pretty'), self.read('author', '--pretty', '--index'))

    def test_invalid_native_options_preserve_database(self):
        for options in [('--index', '--id', 'first'), ('--id',), ('--index', '--index'),
                        ('--id', 'first', '--id', 'last'), ('--unknown',),
                        ('--index', '--pretty', '--pretty'), ('--id', 'first', 'trailing')]:
            before = self.snapshot()
            self.native('knowledge', 'author', *options, success=False)
            self.assertEqual(self.snapshot(), before)

    def test_absent_pair_and_partial_schema_preserve_database(self):
        with sqlite3.connect(self.db) as sql:
            sql.executescript('DROP TABLE knowledge; DROP TABLE knowledge_promotions;')
        self.assertEqual(self.read('author', '--index'), [])
        self.assertEqual(self.read('author', '--id', 'first', '--pretty'), [])
        with sqlite3.connect(self.db) as sql:
            sql.execute('CREATE TABLE knowledge(id TEXT)')
        before = self.snapshot()
        result = self.native('knowledge', 'author', '--index', success=False)
        self.assertIn(b'partial schema', result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_missing_database_and_bad_encoding_are_readonly(self):
        missing = self.directory / 'missing.db'
        self.native('knowledge', 'author', '--index', database=missing, success=False)
        self.assertFalse(missing.exists())
        utf16 = self.directory / 'utf16.db'
        with sqlite3.connect(utf16) as sql:
            sql.executescript("PRAGMA encoding='UTF-16'; CREATE TABLE marker(x);")
        before = utf16.read_bytes()
        self.native('knowledge', 'author', '--index', database=utf16, success=False)
        self.assertEqual(utf16.read_bytes(), before)

    def test_real_mcp_index_detail_and_errors(self):
        for args, native in [({'index': True}, self.read('author', '--index')),
                             ({'id': '--pretty', 'pretty': True}, self.read('author', '--id', '--pretty')),
                             ({'reader': 'sibling', 'id': 'first'}, self.read('sibling', '--id', 'first')),
                             ({'reader': '', 'index': True}, [])]:
            before = self.snapshot()
            result = self.mcp(args)
            self.assertFalse(result.get('isError'), result)
            self.assertEqual(json.loads(result['content'][0]['text']), native)
            self.assertEqual(self.snapshot(), before)
        for args in [{'index': True, 'id': 'first'}, {'index': 'yes'}, {'id': None},
                     {'reader': None}, {'extra': True}, {'pretty': 1}]:
            before = self.snapshot()
            self.assertTrue(self.mcp(args).get('isError'))
            self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    print('Retained qualification evidence:', EVIDENCE, flush=True)
    unittest.main()
