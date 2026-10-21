"""Check the packaged canonical schema maintenance entry on isolated databases."""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

INDEX = 'CREATE INDEX IF NOT EXISTS message_reads_by_message ON message_reads(message);'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--alias', action='append', default=[], type=Path)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    binary, fixture = args.binary.resolve(), args.fixture.resolve()
    records, checks = [], []

    def run(name, argv):
        result = subprocess.run(list(map(str, argv)), capture_output=True)
        (directory / (name + '.stdout')).write_bytes(result.stdout)
        (directory / (name + '.stderr')).write_bytes(result.stderr)
        records.append({'name': name, 'argv': list(map(str, argv)), 'exit': result.returncode})
        return result

    def require(condition, name):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    passed = False
    try:
        schema_result = run('schema', [fixture, 'schema', 'unused.db'])
        require(schema_result.returncode == 0, 'qualified native canonical schema is available')
        schema = schema_result.stdout.decode()
        require(schema.count(INDEX) == 1, 'native schema contains one message index')
        legacy = directory / 'legacy.db'
        with closing(sqlite3.connect(legacy)) as db:
            db.executescript(schema.replace(INDEX, ''))
        original = digest(legacy)
        invalid = run('missing-argument', [binary, '--ensure-schema'])
        require(invalid.returncode != 0, 'missing database argument is refused')
        invalid = run('extra-argument', [binary, '--ensure-schema', legacy, '--unknown'])
        require(invalid.returncode != 0 and digest(legacy) == original, 'extra arguments preserve the database')
        help_result = run('leading-help', [binary, '--help', '--ensure-schema', legacy])
        require(help_result.returncode == 0 and digest(legacy) == original, 'leading help preserves the database')
        missing = directory / 'missing.db'
        refused = run('missing-database', [binary, '--ensure-schema', missing])
        require(refused.returncode != 0 and not missing.exists(), 'canonical path resolution preserves a missing database path')
        readonly = directory / 'readonly.db'
        shutil.copy2(legacy, readonly)
        readonly.chmod(0o444)
        refused = run('readonly-database', [binary, '--ensure-schema', readonly])
        require(refused.returncode != 0 and digest(readonly) == original, 'filesystem read-only database retains its bytes and error')
        linked = directory / 'linked.db'
        linked.symlink_to(legacy.name)
        migrated = run('canonical-symlink', [binary, '--ensure-schema', linked])
        require(migrated.returncode == 0 and json.loads(migrated.stdout) == {'schema': 'baton2-schema-ensure-v1', 'status': 'ready'},
                'canonical existing database path installs through production maintenance')
        with closing(sqlite3.connect(legacy)) as db:
            require([row[2] for row in db.execute('PRAGMA index_info(message_reads_by_message)')] == ['message'],
                    'production maintenance installs the message-leading index')
        checker = Path(__file__).with_name('check-message-read-index-native.py')
        for i, alias in enumerate([binary] + [p.resolve() for p in args.alias]):
            result = run('alias-' + str(i), [sys.executable, checker, '--fixture', fixture, '--cli', binary,
                '--migration-cli', alias, '--directory', directory / ('alias-' + str(i))])
            require(result.returncode == 0, 'alias ' + str(i) + ' preserves complete messages and native identities with normal owner lifecycle')
        passed = True
    finally:
        (directory / 'result.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'commands': records,
            'binary_sha256': digest(binary), 'fixture_sha256': digest(fixture)}, indent=2))
    print(json.dumps({'passed': passed, 'assertions': len(checks), 'directory': str(directory)}))

if __name__ == '__main__':
    main()
