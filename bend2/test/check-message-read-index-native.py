"""Qualify canonical native schema migration and complete public message output."""
import argparse
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess

INDEX = 'CREATE INDEX IF NOT EXISTS message_reads_by_message ON message_reads(message);'
TABLES = ('sessions', 'messages', 'executions', 'session_stops', 'message_reads')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--cli', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--migration-cli')
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=False)
    fixture, cli = str(Path(args.fixture).resolve()), str(Path(args.cli).resolve())
    database = directory / 'existing.db'
    commands, checks = [], []

    def run(name, argv):
        result = subprocess.run(argv, capture_output=True)
        (directory / (name + '.stdout')).write_bytes(result.stdout)
        (directory / (name + '.stderr')).write_bytes(result.stderr)
        commands.append({'name': name, 'argv': argv, 'exit': result.returncode,
                         'stdout_sha256': hashlib.sha256(result.stdout).hexdigest()})
        if result.returncode:
            raise AssertionError(name + ' failed: ' + result.stderr.decode(errors='replace'))
        return result.stdout

    def require(condition, label):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def snapshot():
        with closing(sqlite3.connect(database)) as db:
            return {name: db.execute('SELECT * FROM ' + name + ' ORDER BY rowid').fetchall() for name in TABLES}

    owner = None
    passed = False
    try:
        schema = run('native-schema', [fixture, 'schema', str(database)]).decode()
        require(schema.count(INDEX) == 1, 'native C.schema contains one canonical message index')
        with closing(sqlite3.connect(database)) as db:
            db.executescript(schema.replace(INDEX, ''))
            db.executemany('INSERT INTO sessions(id,parent,harness,model,native) VALUES(?,NULL,?,?,?)', [
                ('index-operator', 'omp', '', ''), ('recorded-actor', 'omp', '', 'recorded-native')])
            db.executemany('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)', [
                ('pending-' + str(i), 'recorded-actor', 'index-operator', 'guidance',
                 'complete body ' + str(i) + '\nUnicode: λ') for i in range(20)])
            db.executemany('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)', [
                ('history-' + str(i), 'recorded-actor', 'recorded-actor', 'report', 'historical body ' + str(i))
                for i in range(20000)])
            db.executemany('INSERT INTO message_reads VALUES(?,?,?,?,?,?)', [
                ('history-attempt-' + str(i), 'history-' + str(i), 'recorded-actor', 'history-native', 'history-identity', None)
                for i in range(20000)])
            db.executemany('INSERT INTO message_reads VALUES(?,?,?,?,?,?)', [
                ('a', 'pending-0', 'index-operator', 'native-a', 'identity-a', None),
                ('b', 'pending-1', 'index-operator', 'native-b', 'identity-b', 'settled-b'),
                ('c', 'pending-1', 'index-operator', 'native-c', 'identity-c', None)])
            db.commit()
            require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'seeded historical and current observations have valid references')
            require([row[1] for row in db.execute('PRAGMA index_list(message_reads)')] ==
                    ['sqlite_autoindex_message_reads_1'], 'existing history starts with only primary-key index')
        owner_argv = [cli, '--instance-owner', str(database)]
        with (directory / 'instance-owner.stdout').open('wb') as out, (directory / 'instance-owner.stderr').open('wb') as err:
            owner = subprocess.Popen(owner_argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True)
        commands.append({'name': 'instance-owner-start', 'argv': owner_argv, 'pid': owner.pid})
        before = run('public-before', [cli, str(database), 'as', 'index-operator', 'inbox'])
        original = snapshot()
        migrate = [str(Path(args.migration_cli).resolve()), '--ensure-schema', str(database)] if args.migration_cli else [fixture, 'migrate', str(database)]
        migrated = run('native-migrate', migrate)
        if args.migration_cli:
            require(json.loads(migrated) == {'schema': 'baton2-schema-ensure-v1', 'status': 'ready'}, 'production canonical migration reports completion')
        run('native-migrate-repeat', migrate)
        require(original == snapshot(), 'canonical repeated migration preserves messages, sessions, attempts and stops')
        with closing(sqlite3.connect(database)) as db:
            require([row[2] for row in db.execute('PRAGMA index_info(message_reads_by_message)')] == ['message'],
                    'native migration installed the message-leading index')
        native = run('native-read', [fixture, 'read', str(database), before.decode().strip()])
        require(json.loads(native) == json.loads(before), 'native MessageStatus projection and Sql.read preserve complete public records')
        after = run('public-after', [cli, str(database), 'as', 'index-operator', 'inbox'])
        require(before == after, 'complete public CLI bytes unchanged after native migration')
        records = json.loads(after)
        require(len(records) == 20, 'all twenty complete public messages returned')
        require([row['body'] for row in records] == ['complete body ' + str(i) + '\nUnicode: λ' for i in range(20)],
                'all complete bodies and Unicode preserved')
        require(records[0]['nativeInputStatus']['handled'] == 'incomplete', 'incomplete native observation preserved')
        require(records[1]['nativeInputStatus']['handled'] == 'recorded', 'settled native observation preserved')
        require([row['native'] for row in records[1]['nativeInputStatus']['attempts']] == ['native-b', 'native-c'],
                'multiple native attempt identities preserved')
        require(original == snapshot(), 'public and native inspection preserve attempt custody and receipts')
        spec = importlib.util.spec_from_file_location('index_checks', Path(__file__).with_name('message-read-index.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with closing(sqlite3.connect(database)) as db:
            plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + module.projection_sql(), (module.payload(),))]
        (directory / 'query-plan.json').write_text(json.dumps(plan, indent=2))
        lookups = [row for row in plan if row.startswith(('SCAN r', 'SEARCH r'))]
        require(len(lookups) == 5 and all(row.startswith('SEARCH r USING') and 'message_reads_by_message' in row for row in lookups),
                'all five correlated history queries use indexed native-migrated schema')
        passed = True
    finally:
        try:
            if database.exists():
                run('normal-shutdown', [cli, '--instance-shutdown', str(database)])
            if owner is not None:
                owner_exit = owner.wait()
                commands.append({'name': 'instance-owner-exit', 'pid': owner.pid, 'exit': owner_exit})
                require(owner_exit == 0, 'instance owner exits through normal shutdown')
        except BaseException:
            passed = False
            raise
        finally:
            (directory / 'result.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'commands': commands,
                'fixture_sha256': hashlib.sha256(Path(fixture).read_bytes()).hexdigest(),
                'cli_sha256': hashlib.sha256(Path(cli).read_bytes()).hexdigest()}, indent=2))
    print(json.dumps({'passed': passed, 'assertions': len(checks), 'directory': str(directory)}))

if __name__ == '__main__':
    main()
