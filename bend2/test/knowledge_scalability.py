"""Storage indexes and deterministic relation output for knowledge reads.

The fixture records one finding through the coordinator so the write path
installs the knowledge schema, then bulk-inserts findings and relations. Each
assertion is an independent contract: the five storage indexes exist, a write
recreates a missing index, the planner uses the indexes for the lookup shapes
the read paths emit, and a complete read returns every stored relation in
identity order.
"""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

INDEXES = {
    'knowledge': 'knowledge_author',
    'knowledge_promotions': 'knowledge_promotions_finding',
    'knowledge_relations': ('knowledge_relations_source',
                            'knowledge_relations_target',
                            'knowledge_relations_author'),
}


class KnowledgeScalability(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.repo.mkdir()
        self.checkouts.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Knowledge fixture']):
            subprocess.run(argv, check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-test', 'root-session', 'native-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.call('recruit', 'worker', 'root', 'requested-harness', 'requested-model', 'high',
                  str(self.repo), 'worker-branch', str(self.checkouts / 'worker'), self.base)
        self.call('record', 'seed-finding', 'root', 'seed claim', 'run:seed', 'seed limits')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args, success=True):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0, p.stdout)
        return p

    def indexes(self, table):
        with sqlite3.connect(self.db) as connection:
            return {row[1] for row in connection.execute('PRAGMA index_list(' + table + ')')}

    def plan(self, sql):
        with sqlite3.connect(self.db) as connection:
            return ' '.join(row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + sql))

    def bulk(self, findings, relations):
        with sqlite3.connect(self.db) as connection:
            connection.executemany(
                "INSERT INTO knowledge(id,author,claim,evidence,limits,kind) VALUES(?,?,?,?,?,?)",
                ((f'finding-{i:05d}', 'worker', f'claim {i} token group{i % 7}',
                  f'run:evidence-{i}', f'limits {i}', 'finding') for i in range(findings)))
            connection.executemany(
                "INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES(?,?,?,?,?)",
                ((f'link-{i:05d}', 'worker', f'finding:finding-{(i * 7) % findings:05d}',
                  'Supports' if i % 2 else 'Contradicts',
                  f'finding:finding-{(i * 7 + 1) % findings:05d}') for i in range(relations)))

    def test_every_knowledge_write_installs_the_storage_indexes(self):
        for table, expected in INDEXES.items():
            present = self.indexes(table)
            names = {expected} if isinstance(expected, str) else set(expected)
            self.assertEqual(names - present, set(), table)
        # A database that predates the indexes regains them on the next write.
        with sqlite3.connect(self.db) as connection:
            for name in ('knowledge_author', 'knowledge_promotions_finding',
                         'knowledge_relations_source', 'knowledge_relations_target',
                         'knowledge_relations_author'):
                connection.execute('DROP INDEX ' + name)
        self.call('record', 'after-upgrade', 'root', 'upgraded claim', 'run:upgrade', 'one run')
        for table, expected in INDEXES.items():
            names = {expected} if isinstance(expected, str) else set(expected)
            self.assertEqual(names - self.indexes(table), set(), table)

    def test_the_read_lookup_shapes_use_the_indexes(self):
        plans = {
            "SELECT id FROM knowledge WHERE author='worker'": 'knowledge_author',
            "SELECT id FROM knowledge_relations WHERE source='finding:x'": 'knowledge_relations_source',
            "SELECT id FROM knowledge_relations WHERE target='finding:x'": 'knowledge_relations_target',
            "SELECT id FROM knowledge_relations WHERE author='worker'": 'knowledge_relations_author',
            "SELECT id FROM knowledge_promotions WHERE finding='x'": 'knowledge_promotions_finding',
        }
        for sql, index in plans.items():
            self.assertIn(index, self.plan(sql), sql)

    def test_complete_reads_return_every_relation_in_identity_order(self):
        self.bulk(300, 900)
        first = self.call('knowledge', 'root')
        second = self.call('knowledge', 'root')
        self.assertEqual(first, second)
        self.assertEqual(len(first), 301)
        for item in first:
            identifiers = [relation['id'] for relation in item['relations']]
            self.assertEqual(identifiers, sorted(identifiers), item['id'])
            for relation in item['relations']:
                self.assertEqual(relation['sourceReference'], relation['source'])
                self.assertEqual(relation['targetReference'], relation['target'])
                self.assertIn(relation['sourceKind'], ('finding', 'observation'))
                self.assertIn(relation['targetKind'], ('finding', 'observation'))


if __name__ == '__main__':
    unittest.main()
