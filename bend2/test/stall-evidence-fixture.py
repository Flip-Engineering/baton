#!/usr/bin/env python3
"""Build and check the focused stall evidence fixture.

The schema is created by the stall evidence entry (`stall-evidence DB init`).
This fixture inserts the recorded states used by the focused report and wake
checks, then verifies the report and wake observations.
"""
import json
import pathlib
import sqlite3
import sys


def build(database_path):
    database_path = pathlib.Path(database_path)
    directory = database_path.parent
    directory.mkdir(parents=True, exist_ok=True)
    marker = directory / 'wake.marker'
    endpoint = directory / 'endpoint.py'
    endpoint.write_text(
        '#!/usr/bin/env python3\n'
        'import pathlib, sys\n'
        f'pathlib.Path({str(marker)!r}).open("a").write(" ".join(sys.argv)+"\\n")\n'
    )
    endpoint.chmod(0o700)
    endpoint_json = json.dumps([sys.executable, str(endpoint)])
    database = sqlite3.connect(database_path)
    database.execute(
        'INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) '
        'VALUES(?,?,?,?,?,?,?)', ('root', None, 'omp', 'fixture', 'low', 'native-root', ''))
    for name, phase, endpoint_value in (
            ('active', 'running', endpoint_json),
            ('exited', 'exited', endpoint_json),
            ('stopped', 'exited', endpoint_json),
            ('blocked', 'exited', ''),
            ('claimed', 'exited', endpoint_json),
            ('never', '', endpoint_json)):
        database.execute(
            'INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) '
            'VALUES(?,?,?,?,?,?,?)',
            (name, 'root', 'omp', 'fixture', 'low', 'native-' + name, endpoint_value))
        if phase:
            database.execute(
                'INSERT INTO executions(session,id,mode,directory,phase,status) '
                'VALUES(?,?,?,?,?,?)',
                (name, 'attempt-' + name, 'retained', '', phase, 'exit 0'))
        database.execute(
            'INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
            ('owed-' + name, 'root', name, 'task', 'Owed work for ' + name))
    database.execute(
        'INSERT INTO session_stops(session,id,reason,attempt,directory,outcome) '
        'VALUES(?,?,?,?,?,?)',
        ('stopped', 'stop-stopped', 'operator stop', '', '', 'stopped'))
    database.execute(
        'INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) '
        'VALUES(?,?,?,?)', ('claimed', 'claimed', 'owed-claimed', 1))
    database.commit()
    database.close()
    print('endpoint=' + str(endpoint))
    print('marker=' + str(marker))


def check_report(path):
    report = json.loads(pathlib.Path(path).read_text())
    rows = {row['id']: row['state'] for row in report['candidates']}
    expected = {'active': 'active', 'exited': 'stalled', 'stopped': 'stopped',
                'blocked': 'blocked', 'claimed': 'claimed', 'never': 'blocked'}
    observed = [f'CASE report-{name}: {rows.get(name, "missing")}'
                for name in sorted(expected)]
    expected_lines = [f'CASE report-{name}: {expected[name]}'
                      for name in sorted(expected)]
    print('\n'.join(observed))
    if observed != expected_lines:
        print('expected:\n' + '\n'.join(expected_lines), file=sys.stderr)
        sys.exit(1)


def check_wake(database_path, marker_path):
    marker = pathlib.Path(marker_path)
    lines = marker.read_text().splitlines() if marker.exists() else []
    delivered = [line for line in lines if 'owed-exited' in line]
    others = [line for line in lines
              if any('owed-' + name in line
                     for name in ('active', 'stopped', 'blocked', 'claimed', 'never'))]
    database = sqlite3.connect(database_path)
    claims = dict(database.execute('SELECT session,state FROM wake_claims'))
    stopped = database.execute(
        'SELECT count(*) FROM session_stops WHERE session=?', ('stopped',)).fetchone()[0]
    database.close()
    observations = [
        'CASE wake-exited-delivered: ' + ('yes' if delivered else 'no'),
        'CASE wake-other-delivered: ' + ('yes' if others else 'no'),
        'CASE wake-exited-claim: ' + claims.get('exited', 'missing'),
        'CASE wake-active-claim: ' + claims.get('active', 'missing'),
        'CASE wake-blocked-claim: ' + claims.get('blocked', 'missing'),
        'CASE wake-never-claim: ' + claims.get('never', 'missing'),
        'CASE wake-stopped-claim: ' + claims.get('stopped', 'missing'),
        'CASE wake-claimed-claim: ' + claims.get('claimed', 'missing'),
        'CASE wake-stopped-preserved: ' + str(stopped),
    ]
    expected = [
        'CASE wake-exited-delivered: yes',
        'CASE wake-other-delivered: no',
        'CASE wake-exited-claim: claimed',
        'CASE wake-active-claim: missing',
        'CASE wake-blocked-claim: missing',
        'CASE wake-never-claim: missing',
        'CASE wake-stopped-claim: missing',
        'CASE wake-claimed-claim: claimed',
        'CASE wake-stopped-preserved: 1',
    ]
    print('\n'.join(observations))
    if observations != expected:
        print('expected:\n' + '\n'.join(expected), file=sys.stderr)
        sys.exit(1)


def main(argv):
    if len(argv) == 2 and argv[0] == 'build':
        build(argv[1])
        return
    if len(argv) == 2 and argv[0] == 'check-report':
        check_report(argv[1])
        return
    if len(argv) == 3 and argv[0] == 'check-wake':
        check_wake(argv[1], argv[2])
        return
    print('usage: stall-evidence-fixture.py build DB | check-report REPORT | '
          'check-wake DB MARKER', file=sys.stderr)
    sys.exit(2)


if __name__ == '__main__':
    main(sys.argv[1:])
