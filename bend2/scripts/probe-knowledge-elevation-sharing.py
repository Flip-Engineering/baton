"""Measure knowledge promotion, sharing and elevation behavior on a throwaway database.

Each call is a separate product process. The script writes one JSON object to
stdout and retains its temporary fixture directory; the path is printed in the
`workdir` field. It does not touch a shared database or a Git checkout.

Usage:
    python3 bend2/scripts/probe-knowledge-elevation-sharing.py --baton PATH
"""
import argparse
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baton', required=True, help='baton2 executable')
    parser.add_argument('--workdir', default='',
                        help='fixture directory; omitted creates a temporary one')
    parser.add_argument('--remove', action='store_true',
                        help='remove the fixture directory after printing')
    args = parser.parse_args()
    base_dir = (pathlib.Path(args.workdir) if args.workdir
                else pathlib.Path(tempfile.mkdtemp(prefix='knowledge-elevation-sharing-')))
    base_dir.mkdir(parents=True, exist_ok=True)
    baton = str(pathlib.Path(args.baton).resolve())
    db = base_dir / 'state.db'
    repo = base_dir / 'repo'
    checkouts = base_dir / 'checkouts'
    checkouts.mkdir()

    def run(*argv, success=True):
        process = subprocess.run([baton, str(db), *argv], text=True, capture_output=True)
        if success and process.returncode != 0:
            raise RuntimeError((argv, process.returncode, process.stdout, process.stderr))
        if not success:
            return {'rc': process.returncode, 'stdout': process.stdout,
                    'stderr': process.stderr}
        return json.loads(process.stdout)

    def git(*argv):
        return subprocess.run(['git', *argv], check=True, capture_output=True,
                              text=True).stdout.strip()

    def size_and_counts():
        connection = sqlite3.connect(db)
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        counts = {table: connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                  for table in ('knowledge', 'knowledge_promotions',
                                'knowledge_relations', 'messages')}
        connection.close()
        return {'bytes': db.stat().st_size, 'counts': counts}

    git('init', '-q', '-b', 'main', str(repo))
    git('-C', str(repo), 'config', 'user.email', 'fixture@example.invalid')
    git('-C', str(repo), 'config', 'user.name', 'Knowledge probe')
    (repo / 'seed.txt').write_text('seed\n')
    git('-C', str(repo), 'add', 'seed.txt')
    git('-C', str(repo), 'commit', '-q', '-m', 'seed')
    base = git('-C', str(repo), 'rev-parse', 'HEAD')

    run('attach', 'root', 'native-test', 'root-session', 'native-endpoint')
    run('role', 'root', 'principal-conductor')
    for name in ('worker', 'sibling'):
        run('recruit', name, 'root', 'requested-harness', 'requested-model', 'high',
            str(repo), name + '-branch', str(checkouts / name), base)
    run('ensemble', 'review-group', 'root', 'tight')
    run('ensemble-member', 'review-group', 'root', 'worker', 'add')

    result = {
        'workdir': str(base_dir),
        'pin': {'binary': baton, 'binary_sha256': sha256(baton), 'fixture_base': base},
    }

    # Promotion writes one provenance row and leaves the finding unchanged.
    run('report', 'worker-evidence', 'worker', 'observed body')
    run('record', 'shared', 'worker', 'the retry doubles the work',
        'message:worker-evidence', 'one run')
    before = run('knowledge-scope', 'worker', 'worker', 'worker')[0]
    run('promote', 'share-to-worker', 'worker', 'worker', 'worker', 'shared')
    after = run('knowledge-scope', 'worker', 'worker', 'worker')[0]
    result['promotion_write'] = {
        'before': before,
        'after': after,
        'same_claim': before['claim'] == after['claim'],
        'same_author': before['author'] == after['author'],
    }

    # Reads do not materialize rows or bytes.
    state_before_reads = size_and_counts()
    for _ in range(10):
        run('knowledge-scope', 'worker', 'worker', 'worker')
        run('knowledge-search', 'worker', 'worker', 'worker', 'retry')
    state_after_reads = size_and_counts()
    result['reads_do_not_materialize'] = {
        'before': state_before_reads,
        'after': state_after_reads,
        'equal': state_before_reads == state_after_reads,
    }

    # The same logical share under a second identity duplicates the holding.
    run('promote', 'share-to-worker-2', 'worker', 'worker', 'worker', 'shared')
    duplicate = run('knowledge-scope', 'worker', 'worker', 'worker')[0]
    connection = sqlite3.connect(db)
    rows = connection.execute(
        'SELECT id, source_kind, source, destination_kind, destination, promoted_by '
        'FROM knowledge_promotions WHERE finding="shared" ORDER BY id').fetchall()
    notices = connection.execute(
        'SELECT id FROM messages WHERE id LIKE "share-to-worker%:promotion-notice" '
        'ORDER BY id').fetchall()
    connection.close()
    result['duplicate_share'] = {
        'promotion_rows': rows,
        'notices': notices,
        'destinations': duplicate['destinations'],
        'promotion_count': len(duplicate['promotions']),
    }

    # A group share preserves the complete finding and its incident cross-author relation.
    run('record', 'root-only', 'root', 'root-only claim', 'run:root-only', 'root limits')
    run('relate', 'cross', 'root', 'finding:shared', 'Supports', 'finding:root-only')
    run('promote-scoped', 'share-to-group', 'root', 'session', 'worker',
        'group', 'review-group', 'shared')
    group_read = run('knowledge-scope', 'sibling', 'group', 'review-group')
    group_node = group_read[0]
    group_search = run('knowledge-search', 'sibling', 'group', 'review-group', 'retry')
    result['group_share'] = {
        'reader': 'sibling',
        'reader_is_member': False,
        'finding_ids': [row['id'] for row in group_read],
        'claims': [row['claim'] for row in group_read],
        'promotions': group_node['promotions'],
        'relation_ids': [rel['id'] for rel in group_node['relations']],
        'node_ids': [node['id'] for node in group_search['nodes']],
        'edge_ids': [edge['id'] for edge in group_search['edges']],
        'references': group_search['references'],
    }

    # Dangling message evidence is stored and cited to a message that does not exist.
    run('record', 'dangling', 'worker', 'dangling claim', 'message:absent-0000', 'limits')
    dangling_node = next(row for row in run('knowledge-scope', 'worker', 'worker', 'worker')
                         if row['id'] == 'dangling')
    dangling_walk = run('knowledge-traverse', 'worker', 'worker', 'worker',
                        'finding:dangling', 'out', '', 'neighbors')
    result['dangling_evidence'] = {
        'evidence_message': dangling_node['evidenceMessage'],
        'edge_ids': [edge['id'] for edge in dangling_walk['edges']],
        'references': dangling_walk['references'],
    }

    # Elevation with existing records: a durable note, a finding that cites it,
    # and a DerivedFrom relation. The note remains unchanged.
    run('message', 'note-1', 'root', 'worker', 'question', 'draft observation')
    run('record-typed', 'elevated', 'worker', 'finding', 'draft observation claim',
        'message:note-1', 'one note')
    run('relate', 'derived', 'worker', 'finding:elevated', 'DerivedFrom', 'message:note-1')
    elevated = next(row for row in run('knowledge-scope', 'worker', 'worker', 'worker')
                    if row['id'] == 'elevated')
    note = run('delivery', 'note-1')
    result['elevation_pattern'] = {
        'finding': elevated,
        'note_body': note['body'],
        'note_sender': note['sender'],
    }

    # A failed notice leaves the promotion committed; one retry delivers one notice.
    deliveries = base_dir / 'deliveries.txt'
    endpoint = base_dir / 'endpoint.py'
    endpoint.write_text('import pathlib,sys\n'
                        'with pathlib.Path(sys.argv[1]).open("a") as stream:\n'
                        '    stream.write(sys.argv[2] + "\\n")\n')
    run('connect', 'root', 'root-session', json.dumps([str(base_dir / 'missing-endpoint')]))
    failed = run('promote', 'repair-share', 'root', 'worker', 'root', 'shared', success=False)
    connection = sqlite3.connect(db)
    row = connection.execute(
        'SELECT id FROM knowledge_promotions WHERE id="repair-share"').fetchone()
    unreceipted = connection.execute(
        'SELECT receipt IS NULL FROM messages WHERE id="repair-share:promotion-notice"').fetchone()
    connection.close()
    run('connect', 'root', 'root-session',
        json.dumps([sys.executable, str(endpoint), str(deliveries)]))
    retried = run('promote', 'repair-share', 'root', 'worker', 'root', 'shared')
    connection = sqlite3.connect(db)
    rows_after = connection.execute(
        'SELECT count(*) FROM knowledge_promotions WHERE id="repair-share"').fetchone()[0]
    notices_after = connection.execute(
        'SELECT count(*) FROM messages WHERE id="repair-share:promotion-notice"').fetchone()[0]
    connection.close()
    result['notice_recovery'] = {
        'first_rc': failed['rc'],
        'first_stderr': failed['stderr'],
        'row_after_failure': row,
        'notice_unreceipted_after_failure': unreceipted,
        'retry_answer': retried,
        'rows_after_retry': rows_after,
        'notices_after_retry': notices_after,
        'delivered_lines': deliveries.read_text().splitlines(),
    }

    # An exact-coordinate repeat can reclassify the finding kind.
    run('record-typed', 'kind-probe', 'worker', 'observation', 'kind claim',
        'run:kind', 'kind limits')
    first_kind = next(row for row in run('knowledge-scope', 'worker', 'worker', 'worker')
                      if row['id'] == 'kind-probe')['kind']
    run('record-typed', 'kind-probe', 'worker', 'correction', 'kind claim',
        'run:kind', 'kind limits')
    second_kind = next(row for row in run('knowledge-scope', 'worker', 'worker', 'worker')
                       if row['id'] == 'kind-probe')['kind']
    result['kind_rewrite'] = {
        'first_kind': first_kind,
        'second_kind': second_kind,
    }

    result['final_state'] = size_and_counts()
    print(json.dumps(result, indent=1))

    if args.remove:
        import shutil
        shutil.rmtree(base_dir, ignore_errors=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
