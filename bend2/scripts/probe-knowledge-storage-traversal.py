#!/usr/bin/env python3
"""Measure knowledge storage and traversal cost on a deterministic fixture.

The probe builds a database with the retained production coordinator, inserts a
chosen number of findings and relations directly, and measures complete reads,
index reads, detail reads, relation reads and traversal before and after the
five storage indexes. Search is measured on its own smaller fixture because the
unindexed search cost grows with both tables. The probe records peak RSS,
elapsed time and stdout bytes for each measured command, the index build time
and database bytes, the write cost on the indexed copy, and the planner lookups
for the five index shapes.

No coordinator source is compiled. The binary is the retained production build,
and every number is a measurement of that build against the fixture.
"""
import argparse
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import time

INDEXES = (
    'CREATE INDEX IF NOT EXISTS knowledge_author ON knowledge(author)',
    'CREATE INDEX IF NOT EXISTS knowledge_promotions_finding ON knowledge_promotions(finding)',
    'CREATE INDEX IF NOT EXISTS knowledge_relations_source ON knowledge_relations(source)',
    'CREATE INDEX IF NOT EXISTS knowledge_relations_target ON knowledge_relations(target)',
    'CREATE INDEX IF NOT EXISTS knowledge_relations_author ON knowledge_relations(author)',
)

PLAN_SHAPES = {
    'knowledge_author': "SELECT id FROM knowledge WHERE author='worker'",
    'knowledge_promotions_finding': "SELECT id FROM knowledge_promotions WHERE finding='x'",
    'knowledge_relations_source': "SELECT id FROM knowledge_relations WHERE source='finding:x'",
    'knowledge_relations_target': "SELECT id FROM knowledge_relations WHERE target='finding:x'",
    'knowledge_relations_author': "SELECT id FROM knowledge_relations WHERE author='worker'",
}


def call(binary, db, *args):
    p = subprocess.run([str(binary), str(db), *args], text=True, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(f'{args}: rc={p.returncode}\n{p.stdout}\n{p.stderr}')
    return p.stdout


def measured(argv, output):
    """Run argv with stdout in a file and return time, peak RSS and byte count."""
    start = time.time()
    with open(output, 'wb') as sink:
        proc = subprocess.Popen(argv, stdout=sink, stderr=subprocess.PIPE)
        pid, status, usage = os.wait4(proc.pid, 0)
        error = proc.stderr.read()
        proc.stderr.close()
        proc.returncode = os.waitstatus_to_exitcode(status)
    if proc.returncode != 0:
        raise SystemExit(f'{argv}: rc={proc.returncode}\n{error.decode(errors="replace")}')
    return {'seconds': round(time.time() - start, 3), 'peakRssKiB': usage.ru_maxrss,
            'stdoutBytes': output.stat().st_size}


def setup(binary, root, name, findings, relations):
    work = root / name
    repo = work / 'repository'
    checks = work / 'checkouts'
    repo.mkdir(parents=True)
    checks.mkdir()
    for argv in (['git', 'init', '-q', '-b', 'main', str(repo)],
                 ['git', '-C', str(repo), 'config', 'user.email', 'fixture@example.invalid'],
                 ['git', '-C', str(repo), 'config', 'user.name', 'Knowledge probe']):
        subprocess.run(argv, check=True, capture_output=True)
    (repo / 'seed.txt').write_text('seed\n')
    subprocess.run(['git', '-C', str(repo), 'add', 'seed.txt'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(repo), 'commit', '-q', '-m', 'seed'], check=True, capture_output=True)
    base = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'],
                          check=True, capture_output=True, text=True).stdout.strip()
    db = work / 'state.db'
    call(binary, db, 'attach', 'root', 'native-test', 'root-session', 'native-endpoint')
    call(binary, db, 'role', 'root', 'principal-conductor')
    call(binary, db, 'recruit', 'worker', 'root', 'requested-harness', 'requested-model', 'high',
         str(repo), 'worker-branch', str(checks / 'worker'), base)
    call(binary, db, 'record', 'seed-finding', 'root', 'seed claim', 'run:seed', 'seed limits')
    with sqlite3.connect(db) as connection:
        connection.executemany(
            "INSERT INTO knowledge(id,author,claim,evidence,limits,kind) VALUES(?,?,?,?,?,?)",
            ((f'finding-{i:06d}', 'worker', f'claim {i} token group{i % 97}',
              f'run:evidence-{i}', f'limits {i}', 'observation' if i % 3 else 'finding')
             for i in range(findings)))
        connection.executemany(
            "INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES(?,?,?,?,?)",
            ((f'link-{i:06d}', 'worker', f'finding:finding-{(i * 7) % findings:06d}',
              'Supports' if i % 2 else 'Contradicts',
              f'finding:finding-{(i * 7 + 1) % findings:06d}') for i in range(relations)))
    return db


def fixture_commands(binary, db, search):
    if search:
        return {'search group42': [str(binary), str(db), 'knowledge-search', 'root', 'all', '', 'group42']}
    return {
        'complete read': [str(binary), str(db), 'knowledge', 'root'],
        'index read': [str(binary), str(db), 'knowledge', 'root', '--index'],
        'detail read': [str(binary), str(db), 'knowledge', 'root', '--id', 'finding-000042'],
        'relations read': [str(binary), str(db), 'knowledge-relations', 'root', 'all', ''],
        'recursive traversal': [str(binary), str(db), 'knowledge-traverse', 'root', 'all', '',
                                'finding:finding-000000', 'out', '', 'recursive'],
        'single-hop traversal': [str(binary), str(db), 'knowledge-traverse', 'root', 'all', '',
                                 'finding:finding-000000', 'out', '', 'neighbors'],
    }


def index_copy(db, root, name):
    indexed = root / name
    shutil.copy2(db, indexed)
    start = time.time()
    with sqlite3.connect(indexed) as connection:
        for statement in INDEXES:
            connection.execute(statement)
        connection.commit()
    return indexed, {'seconds': round(time.time() - start, 3),
                     'plainBytes': db.stat().st_size, 'indexedBytes': indexed.stat().st_size}


def write_cost(indexed, plain, root):
    def insert(path):
        with sqlite3.connect(path) as connection:
            start = time.time()
            connection.executemany(
                "INSERT INTO knowledge(id,author,claim,evidence,limits,kind) VALUES(?,?,?,?,?,?)",
                ((f'w-finding-{i:05d}', 'worker', f'claim {i}', f'run:w-{i}', 'limits', 'finding')
                 for i in range(2000)))
            connection.commit()
            finding_seconds = round(time.time() - start, 3)
            start = time.time()
            connection.executemany(
                "INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES(?,?,?,?,?)",
                ((f'w-link-{i:05d}', 'worker', f'finding:w-finding-{(i * 7) % 2000:05d}',
                  'Supports', f'finding:w-finding-{(i * 7 + 1) % 2000:05d}') for i in range(6000)))
            connection.commit()
            return finding_seconds, round(time.time() - start, 3)
    unindexed = root / 'write-unindexed.db'
    shutil.copy2(plain, unindexed)
    return {'plain': insert(str(unindexed)), 'indexed': insert(str(indexed))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=pathlib.Path, required=True)
    parser.add_argument('--findings', type=int, default=10000)
    parser.add_argument('--relations', type=int, default=30000)
    parser.add_argument('--search-findings', type=int, default=2000)
    parser.add_argument('--search-relations', type=int, default=6000)
    parser.add_argument('--out', type=pathlib.Path)
    args = parser.parse_args()

    root = pathlib.Path(tempfile.mkdtemp(prefix='knowledge-probe-'))
    try:
        report = {'binary': str(args.binary),
                  'binarySha256': subprocess.run(['sha256sum', str(args.binary)], check=True,
                                                 capture_output=True, text=True).stdout.split()[0],
                  'main': {'fixture': {'findings': args.findings + 1, 'relations': args.relations}},
                  'search': {'fixture': {'findings': args.search_findings + 1,
                                         'relations': args.search_relations}},
                  'indexBuild': {}, 'writeCost': {}, 'plans': {}}

        db = setup(args.binary, root, 'main', args.findings, args.relations)
        sink = root / 'layer0.out'
        report['main']['layer0'] = {label: measured(argv, sink)
                                    for label, argv in fixture_commands(args.binary, db, False).items()}
        indexed, build = index_copy(db, root, 'indexed.db')
        report['indexBuild'] = build
        report['main']['layerA'] = {
            label: measured([str(indexed) if part == str(db) else part for part in argv], sink)
            for label, argv in fixture_commands(args.binary, db, False).items()}
        report['writeCost'] = write_cost(indexed, db, root)

        search_db = setup(args.binary, root, 'search', args.search_findings, args.search_relations)
        report['search']['layer0'] = {
            label: measured(argv, sink)
            for label, argv in fixture_commands(args.binary, search_db, True).items()}
        search_indexed, _ = index_copy(search_db, root, 'search-indexed.db')
        report['search']['layerA'] = {
            label: measured([str(search_indexed) if part == str(search_db) else part for part in argv], sink)
            for label, argv in fixture_commands(args.binary, search_db, True).items()}

        with sqlite3.connect(indexed) as connection:
            for name, sql in PLAN_SHAPES.items():
                report['plans'][name] = ' '.join(
                    row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + sql))
        value = json.dumps(report, indent=2) + '\n'
        if args.out:
            args.out.write_text(value)
        print(value, end='')
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == '__main__':
    main()
