import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-native.py'
SOURCE = Path(__file__).resolve().parents[1] / 'context/bend2'
TYPESCRIPT_SOURCE = Path(__file__).resolve().parents[1] / 'context/typescript'
SPEC = importlib.util.spec_from_file_location('package_native', SCRIPT)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
RECEIVE_SPEC = importlib.util.spec_from_file_location(
    'receive_fixture', Path(__file__).with_name('receive.py'))
RECEIVE = importlib.util.module_from_spec(RECEIVE_SPEC)
RECEIVE_SPEC.loader.exec_module(RECEIVE)


# Scripted Muse protocol fixture using the installed coordinator and MCP adapter.
NATIVE_HANDOFF = r'''import json,pathlib,re,subprocess,sys
config=json.loads(pathlib.Path(__file__).with_suffix('.json').read_text())
args=sys.argv[1:]
session=args[args.index('--model')+1]
resume=args[args.index('--session-id')+1] if '--session-id' in args else ''
native=resume or ('native-'+session)
prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
stream={'kind':'session','id':native}
print(json.dumps({'stream':stream,'payload_type':'run.model.configured',
                 'payload':{'kind':'run_model_configured','model_id':session}}),flush=True)
print(json.dumps({'stream':stream,'payload_type':'turn.input.user',
                 'payload':{'kind':'turn_input_user','command_id':'handoff'}}),flush=True)
def tool(name,arguments):
    requests=[{'jsonrpc':'2.0','id':1,'method':'initialize',
               'params':{'protocolVersion':'2024-11-05','capabilities':{},
                         'clientInfo':{'name':'native-object-handoff','version':'1'}}},
              {'jsonrpc':'2.0','id':2,'method':'tools/call',
               'params':{'name':name,'arguments':arguments}}]
    result=subprocess.run([config['node'],config['mcp'],config['db'],config['exe'],
                           '--session',session],
                          input=''.join(json.dumps(row)+'\n' for row in requests),
                          capture_output=True,text=True)
    assert result.returncode==0,(result.stdout,result.stderr)
    replies=[json.loads(line) for line in result.stdout.splitlines()]
    reply=next(row for row in replies if row.get('id')==2)
    assert 'error' not in reply,reply
    answer=reply['result']
    assert not answer.get('isError',False),answer
    return json.loads(answer['content'][0]['text'])
if session==config['producer'] and not resume:
    tool('baton2_context_query_file',{'query':config['query'],'path':config['request']})
acquired=tool('baton2_context_install',{'module':'bend2','path':config['moduleSource']})
assert acquired['status']=='present' and acquired['moduleId']=='bend2',acquired
inventory=tool('baton2_context_engines',{'scope':'session'})
assert inventory['scope']['session']==session,inventory
assert inventory['projectPolicy']['status']=='present',inventory
modules={row['moduleId']:row for row in inventory['modules']}
assert modules['bend2']['enabled'] and modules['bend2']['preferred'],inventory
assert modules['runtime']['enabled'] is False,inventory
retained=tool('baton2_context_result',{'query':config['query']})
assert retained['state']=='complete',retained
for ident in re.findall(r'^Message \([^\n]*\) from [^\n]* \[id: (.*?)\]:$',prompt,re.M):
    tool('baton2_ack',{'id':ident,'receipt':'native-consumed-'+config['query']})
body=json.dumps({'session':session,'native':native,'resume':resume,'prompt':prompt,
                 'retained':retained,'discoveryScope':inventory['scope']},ensure_ascii=False)
print(json.dumps({'stream':stream,'payload_type':'run.terminal.completed',
                 'payload':{'kind':'run_terminal','terminal':'completed',
                            'command_id':'handoff','text':body}}),flush=True)
'''


class SelectedContextPackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / 'bend2/context/bend2'
        shutil.copytree(SOURCE, source)
        self.previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = self.root
        self.payload = self.root / 'payload'
        self.payload.mkdir()

    def tearDown(self):
        PACKAGE.ROOT = self.previous_root
        if getattr(self, 'handoff_database', None) is not None and self.handoff_database.is_file():
            self.retain_handoff_execution()
        if getattr(self, 'keep_runtime_workspace', False):
            self.temp._finalizer.detach()
            print(f'Runtime workspace retains cleanup evidence: {self.root}', flush=True)
        else:
            self.temp.cleanup()

    def retain_handoff_execution(self):
        evidence = self.handoff_evidence
        evidence.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.handoff_database) as source, sqlite3.connect(evidence / 'state.db') as retained:
            source.backup(retained)
            retained.row_factory = sqlite3.Row
            tables = {row[0] for row in retained.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            records = {}
            for table in ('executions', 'log_generations', 'log_stderr_runs'):
                records[table] = [dict(row) for row in retained.execute(
                    f"SELECT * FROM {table} WHERE session IN (?,?)",
                    ('native-object-producer', 'native-object-consumer'))] if table in tables else []
            records['direct_turn_requests'] = [dict(row) for row in retained.execute(
                "SELECT session,id,directory FROM direct_turn_requests WHERE session IN (?,?)",
                ('native-object-producer', 'native-object-consumer'))] if 'direct_turn_requests' in tables else []
        files = []

        def copy(path, destination):
            path = Path(path)
            destination = evidence / destination
            exists = path.is_file()
            if exists:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
            files.append({'source': str(path), 'retained': str(destination) if exists else None})

        directories = {(row['session'], row['id']): Path(row['directory'])
                       for row in records['direct_turn_requests'] + records['executions'] if row['directory']}
        copy(str(self.handoff_database) + '.root.log', Path('root.log'))
        for row in records['log_generations']:
            ident = row['attempt'].encode().hex()
            copy(row['log'], Path(row['session']) / ident / 'generation.jsonl')
            directories.setdefault((row['session'], row['attempt']),
                                   Path(str(self.handoff_database) + '.attempt-' + ident))
        for (actor, attempt), directory in directories.items():
            for name in ('native.stderr', 'stdout', 'status', 'prompt.txt', 'checkpoint',
                         'checkpoint-error', 'manifest', 'native.pid', 'native.birth',
                         'launch', 'released', 'acknowledged', 'observer.log',
                         'observer-error', 'keeper.log'):
                copy(directory / name, Path(actor) / attempt.encode().hex() / name)
        for row in records['log_stderr_runs']:
            copy(row['stderr'], Path(row['session']) / row['attempt'].encode().hex()
                 / f"generation.stderr.run-{row['run']}")
        for name in ('native-handoff.py', 'native-handoff.json', 'handoff-request.json', 'handoff-task.txt'):
            copy(self.root / name, Path(name))
        (evidence / 'executions.json').write_text(json.dumps({**records, 'files': files}, indent=2) + '\n')
        print(f'Native handoff execution evidence: {evidence}', flush=True)

    def test_stages_the_selected_provider_and_frontend_files(self):
        declaration = json.loads((self.root / 'bend2/context/bend2/selected-module.json').read_text())
        selected = PACKAGE.stage_selected_context_payload(self.payload)
        module_root = self.payload / 'lib/context/modules/m-62656e6432'
        self.assertEqual(selected, {'moduleId': 'bend2', 'protocolVersion': '2',
                                   'path': 'lib/context/modules/m-62656e6432'})
        for row in declaration['files']:
            staged = module_root / row['path']
            source = self.root / 'bend2/context/bend2' / row['path']
            self.assertEqual(staged.read_bytes(), source.read_bytes())

    def test_refuses_path_escape(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['path'] = '../outside.mjs'
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'Unsafe selected Bend2 artifact path'):
            PACKAGE.stage_selected_context_payload(self.payload)

    def test_staged_provider_executes_and_returns_a_source_analysis_result(self):
        module_root = self.payload / 'lib/context/modules/m-62656e6432'
        PACKAGE.stage_selected_context_payload(self.payload)
        repository = Path(__file__).resolve().parents[2]
        integration = repository / 'bend2/context/bend2/native-provider.integration.mjs'
        result = subprocess.run([
            'node', str(integration), str(module_root), str(repository),
            'bend2/context/bend2/fixtures/valid.bend',
        ], cwd=repository, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'passed', result.stdout)

    def test_selected_typescript_invocation_preserves_native_identity_and_source_results(self):
        compiler = os.environ.get('BATON2_CONTEXT_TYPESCRIPT')
        if compiler is None:
            self.skipTest('Selected TypeScript runtime requires BATON2_CONTEXT_TYPESCRIPT')
        source = self.root / 'bend2/context/typescript'
        shutil.copytree(TYPESCRIPT_SOURCE, source)
        fixture_compiler = self.root / 'installed compiler'
        shutil.copytree(Path(compiler), fixture_compiler)
        compiler_metadata_path = fixture_compiler / 'package.json'
        compiler_metadata = json.loads(compiler_metadata_path.read_text())
        compiler_metadata['version'] += '+selected-fixture'
        compiler_metadata_path.write_text(json.dumps(compiler_metadata))
        selected = PACKAGE.stage_typescript_context_module(self.payload, fixture_compiler)
        module_root = self.payload / selected['path']
        declaration = json.loads((module_root / 'native-provider.declaration.json').read_text())
        self.assertEqual(declaration['protocolVersion'], '2')

        project = self.root / 'typescript project'
        (project / 'src').mkdir(parents=True)
        (project / 'tsconfig.json').write_text(json.dumps({
            'compilerOptions': {'strict': True, 'noEmit': True, 'types': [], 'typeRoots': []},
            'include': ['src/**/*.ts'],
        }))
        entry = project / 'src/app.ts'
        shared_type = self.root / 'shared types.ts'
        shared_type.write_text('export type Value = number;\n')
        entry.write_text('import type { Value } from "../../shared types";\n'
                         'export function double(value: Value): number { return value * 2; }\n'
                         'export const result = double(21);\n'
                         'export const wrong: string = 3;\n')
        wrapper = self.payload / 'libexec/baton2/context-provider.mjs'
        wrapper.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT.parent / 'context-provider.mjs', wrapper)
        binding = {'id': 'typescript', 'revision': declaration['revision'],
                   'protocolVersion': declaration['protocolVersion'],
                   'declarationDigest': PACKAGE.sha256(module_root / 'native-provider.declaration.json'),
                   'operation': 'sourceAnalysis',
                   'artifactIdentities': declaration['artifactIdentities'],
                   'schemaIdentities': declaration['schemaIdentities'],
                   'packageIdentity': declaration['packageIdentity']}
        invocation = {
            'version': 2, 'query': 'selected-typescript', 'owner': 'typescript-owner',
            'moduleBinding': binding,
            'request': {
                'version': 1, 'engine': 'typescript',
                'subject': {'kind': 'symbol', 'path': 'src/app.ts', 'name': 'double'},
                'select': ['definition', 'type', 'references', 'diagnostics'],
                'cwd': str(project), 'options': {'project': 'tsconfig.json'},
            },
            'operationPlan': [{'binding': binding, 'common': 'sourceAnalysis', 'dependencies': []}],
            'role': 'starter', 'incarnation': '7',
        }
        acquired = subprocess.run(['node', str(wrapper), '--capture-inputs'],
                                  input=json.dumps(invocation), cwd=project,
                                  capture_output=True, text=True)
        self.assertEqual(acquired.returncode, 0, acquired.stdout + acquired.stderr)
        capture = json.loads(acquired.stdout)
        self.assertEqual(capture['status'], 'captured', acquired.stdout)
        self.assertEqual((capture['query'], capture['owner']),
                         (invocation['query'], invocation['owner']))
        self.assertTrue(any(row['path'] == str(entry) for row in capture['captures']), acquired.stdout)
        self.assertTrue(any(row['path'] == str(shared_type) for row in capture['captures']), acquired.stdout)
        invocation['inputIdentities'] = capture['captures']
        result = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        frame = json.loads(result.stdout)
        self.assertEqual((frame['version'], frame['query'], frame['owner']),
                         (2, invocation['query'], invocation['owner']))
        self.assertEqual(frame['moduleBinding'], binding)
        self.assertEqual((frame['role'], frame['incarnation'], frame['sequence']), ('starter', '7', '1'))
        payload = frame['payload']
        self.assertEqual(payload['status'], 'completed', result.stdout)
        self.assertEqual(payload['schema'], 'baton2.context.typescript.source-analysis.result.v1')
        self.assertEqual(payload['query'], invocation['query'])
        self.assertEqual(payload['provider']['version'], compiler_metadata['version'])
        self.assertTrue({'definition', 'type', 'diagnostic'}.issubset(
            {fact['kind'] for fact in payload['facts']}), result.stdout)
        inputs = payload['snapshot']['inputs']
        self.assertTrue(any(row['path'] == str(entry) and row['sha256'] for row in inputs), result.stdout)
        self.assertTrue(any(row['path'] == str(shared_type) and row['sha256'] for row in inputs), result.stdout)
        self.assertTrue(payload['refs'], result.stdout)
        self.assertTrue(all(ref['snapshotId'] == payload['snapshot']['snapshotId']
                            for ref in payload['refs']), result.stdout)
        invocation['request']['subject']['path'] = 'src/missing.ts'
        del invocation['inputIdentities']
        missing_capture = subprocess.run(['node', str(wrapper), '--capture-inputs'],
                                         input=json.dumps(invocation), cwd=project,
                                         capture_output=True, text=True)
        self.assertEqual(missing_capture.returncode, 2, missing_capture.stdout + missing_capture.stderr)
        missing_answer = json.loads(missing_capture.stdout)
        self.assertEqual(missing_answer['status'], 'refused', missing_capture.stdout)
        self.assertEqual(missing_answer['reason'], 'context-subject-not-in-program', missing_capture.stdout)
        failed = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(failed.returncode, 0, failed.stdout + failed.stderr)
        failure = json.loads(failed.stdout)
        self.assertEqual((failure['query'], failure['owner'], failure['moduleBinding']),
                         (invocation['query'], invocation['owner'], binding))
        self.assertEqual(failure['payload']['status'], 'unavailable', failed.stdout)
        self.assertEqual(failure['payload']['reason'], 'context-subject-not-in-program', failed.stdout)
        self.assertTrue(failure['payload']['detail'], failed.stdout)

    def test_typescript_retained_closure_from_source_and_installed_module(self):
        compiler = os.environ.get('BATON2_CONTEXT_TYPESCRIPT')
        if compiler is None:
            self.skipTest('Selected TypeScript runtime requires BATON2_CONTEXT_TYPESCRIPT')
        shutil.copytree(TYPESCRIPT_SOURCE, self.root / 'bend2/context/typescript')
        compiler_root = Path(compiler).resolve()
        selected = PACKAGE.stage_typescript_context_module(self.payload, compiler_root)
        repository = Path(__file__).resolve().parents[2]
        environment = {**os.environ,
                       'BATON2_CONTEXT_TYPESCRIPT': str(compiler_root),
                       'BATON_TYPESCRIPT_MODULE_ROOT': str(self.payload / selected['path'])}
        result = subprocess.run([
            'node', '--test', str(repository / 'bend2/test/typescript-retained-closure.test.mjs'),
        ], cwd=repository, env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_selected_clang_invocation_joins_helper_statements_to_sqlite_catalog(self):
        runtime = os.environ.get('BATON2_CONTEXT_CLANG')
        if runtime is None:
            self.skipTest('Selected Clang runtime requires BATON2_CONTEXT_CLANG')
        repository = Path(__file__).resolve().parents[2]
        for directory in ('clang', 'catalogs'):
            shutil.copytree(repository / 'bend2/context' / directory,
                            self.root / 'bend2/context' / directory)
        selected = PACKAGE.stage_clang_module(
            self.payload, 'clang-analyzer', ['databaseAccesses'], Path(runtime))
        module_root = self.payload / selected['path']
        declaration = json.loads((module_root / 'native-provider.declaration.json').read_text())
        project = self.root / 'c project'
        project.mkdir()
        source = project / 'handler.c'
        source.write_text('''static int query_sql(const char *sql) { return sql != 0; }
void handler(const char *dynamic) {
  query_sql("SELECT value " "FROM records WHERE value LIKE 'a%'");
  query_sql("INSERT INTO records(value) VALUES ('z')");
  query_sql(dynamic);
  query_sql("SELECT 1; SELECT 2");
  query_sql("SELECT value FROM missing_table");
}
''')
        (project / 'compile_commands.json').write_text(json.dumps([{
            'directory': str(project), 'file': source.name,
            'arguments': ['clang', '-std=c11', '-fsyntax-only', source.name],
        }]))
        database = project / 'catalog.db'
        with sqlite3.connect(database) as connection:
            connection.execute('CREATE TABLE records(value TEXT)')
            connection.execute("INSERT INTO records VALUES ('alpha')")
        wrapper = self.payload / 'libexec/baton2/context-provider.mjs'
        wrapper.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT.parent / 'context-provider.mjs', wrapper)
        binding = {'id': 'clang-analyzer', 'revision': declaration['revision'],
                   'protocolVersion': '2', 'operation': 'sourceAnalysis',
                   'artifactIdentities': declaration['artifactIdentities'],
                   'schemaIdentities': declaration['schemaIdentities'],
                   'packageIdentity': declaration['packageIdentity']}
        invocation = {
            'version': 2, 'query': 'clang-handler-catalog', 'owner': 'clang-owner',
            'moduleBinding': binding,
            'request': {'version': 1, 'engine': 'clang-analyzer',
                        'subject': {'kind': 'symbol', 'path': source.name, 'name': 'handler'},
                        'select': ['databaseAccesses'], 'cwd': str(project),
                        'options': {'database': database.name}},
            'operationPlan': [{'binding': binding, 'common': 'sourceAnalysis', 'dependencies': []}],
            'role': 'starter', 'incarnation': '1',
        }
        result = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        frame = json.loads(result.stdout)
        self.assertEqual((frame['query'], frame['owner'], frame['moduleBinding']),
                         (invocation['query'], invocation['owner'], binding))
        self.assertEqual(frame['payload']['status'], 'complete', result.stdout)
        output = frame['payload']['result']
        accesses = output['databaseAccesses']
        self.assertEqual(accesses['status'], 'complete', result.stdout)
        self.assertEqual(accesses['database']['path'], str(database), result.stdout)
        relations = accesses['relations']
        self.assertTrue(any(relation['value']['statementKind'] == 'read' and
                            relation['value']['object']['name'] == 'records' and
                            "LIKE 'a%'" in relation['value']['statementText']
                            for relation in relations), result.stdout)
        self.assertTrue(any(relation['value']['statementKind'] == 'write' and
                            relation['value']['object']['name'] == 'records'
                            for relation in relations), result.stdout)
        calls = {call['id'] for call in output['calls']}
        refs = {ref['id']: ref for ref in accesses['refs']}
        for relation in relations:
            statement = relation['value']['statement']
            self.assertIn(statement['callId'], calls, result.stdout)
            self.assertEqual(statement['helperName'], 'query_sql', result.stdout)
            self.assertTrue(statement['helperUsr'], result.stdout)
            span = refs[relation['from']]['subject']
            self.assertEqual(span['path'], str(source), result.stdout)
            literal = source.read_bytes()[span['byteStart']:span['byteEnd']]
            self.assertIn(b'"', literal, result.stdout)
            self.assertEqual(refs[relation['to']]['subject']['name'], 'records', result.stdout)
        reasons = {finding['code'] for finding in accesses['unresolved']}
        self.assertTrue({'dynamicStatement', 'multipleStatements', 'engineParseRefused'}
                        .issubset(reasons), result.stdout)
        for finding in accesses['unresolved']:
            statement = finding['statement']
            self.assertIn(statement['callId'], calls, result.stdout)
            self.assertEqual(statement['callSource']['file'], str(source), result.stdout)
        with sqlite3.connect(database) as connection:
            self.assertEqual(connection.execute('SELECT value FROM records').fetchall(),
                             [('alpha',)])

    def test_selected_clang_maps_original_fossil_and_discovers_declared_database_helper(self):
        runtime = os.environ.get('BATON2_CONTEXT_CLANG')
        if runtime is None:
            self.skipTest('Selected Clang runtime requires BATON2_CONTEXT_CLANG')
        repository = Path(__file__).resolve().parents[2]
        for directory in ('clang', 'catalogs'):
            shutil.copytree(repository / 'bend2/context' / directory,
                            self.root / 'bend2/context' / directory)
        selected = PACKAGE.stage_clang_module(
            self.payload, 'clang-analyzer',
            ['type', 'calls', 'authorization', 'diagnostics', 'databaseAccesses'],
            Path(runtime))
        module_root = self.payload / selected['path']
        declaration = json.loads((module_root / 'native-provider.declaration.json').read_text())
        project = self.root / 'fossil project'
        project.mkdir()
        fixture = repository / 'bend2/context/clang/test/fixtures/fossil-reportlist.tar.gz'
        with tarfile.open(fixture) as archive:
            archive.extractall(project)
        source = project / 'src/report.c'
        generated = project / 'bld/report_.c'
        (project / 'compile_commands.json').write_text(json.dumps([{
            'directory': str(project), 'file': 'bld/report_.c',
            'arguments': ['clang', '-std=gnu89', '-I./src', '-fsyntax-only',
                          'bld/report_.c'],
        }]))
        database = project / 'reports.db'
        with sqlite3.connect(database) as connection:
            connection.execute('CREATE TABLE reportfmt(rn INTEGER PRIMARY KEY,title TEXT,owner TEXT)')
            connection.execute("INSERT INTO reportfmt VALUES (1,'Example report','operator')")
        wrapper = self.payload / 'libexec/baton2/context-provider.mjs'
        wrapper.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT.parent / 'context-provider.mjs', wrapper)
        binding = {'id': 'clang-analyzer', 'revision': declaration['revision'],
                   'protocolVersion': '2', 'operation': 'sourceAnalysis',
                   'artifactIdentities': declaration['artifactIdentities'],
                   'schemaIdentities': declaration['schemaIdentities'],
                   'packageIdentity': declaration['packageIdentity']}
        invocation = {
            'version': 2, 'query': 'fossil-reportlist-catalog', 'owner': 'clang-owner',
            'moduleBinding': binding,
            'request': {'version': 1, 'engine': 'clang-analyzer',
                        'subject': {'kind': 'position', 'path': 'src/report.c',
                                    'line': 30, 'column': 5},
                        'select': ['type', 'calls', 'authorization', 'diagnostics',
                                   'databaseAccesses'],
                        'cwd': str(project),
                        'options': {'project': 'compile_commands.json',
                                    'database': {'engine': 'sqlite-schema', 'path': database.name}}},
            'operationPlan': [{'binding': binding, 'common': 'sourceAnalysis', 'dependencies': []}],
            'role': 'starter', 'incarnation': '1',
        }
        result = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        frame = json.loads(result.stdout)
        self.assertEqual(frame['payload']['status'], 'complete', result.stdout)
        output = frame['payload']['result']
        function = output['selectedFunction']
        self.assertEqual(function['name'], 'view_list', result.stdout)
        self.assertEqual(function['formals'], [], result.stdout)
        self.assertEqual(output['translationUnit'], str(generated), result.stdout)
        mapping = function['correspondence']
        self.assertEqual((mapping['status'], mapping['original'], mapping['generated']),
                         ('mapped', str(source), str(generated)), result.stdout)
        self.assertEqual(source.read_bytes()[mapping['originalStart']:mapping['originalEnd']],
                         generated.read_bytes()[mapping['generatedStart']:mapping['generatedEnd']])
        prepare = next(call for call in output['calls'] if call['name'] == 'db_prepare')
        self.assertTrue(prepare['direct'], result.stdout)
        self.assertEqual(len(prepare['parameterTypes']), 2, result.stdout)
        self.assertTrue(prepare['usr'], result.stdout)
        self.assertFalse(any(helper['name'] == 'db_prepare'
                             for helper in output['helperDefinitions']), result.stdout)
        candidate = next(row for row in output['helperCandidates']
                         if row['callId'] == prepare['id'])
        sql = 'SELECT rn, title, owner FROM reportfmt ORDER BY title'
        literal = next(row for row in candidate['sqlLiterals'] if row['valueText'] == sql)
        self.assertEqual(literal['argumentIndex'], 1, result.stdout)
        self.assertEqual(candidate['helperUsr'], prepare['usr'], result.stdout)
        self.assertEqual(candidate['boundLocalName'], 'q', result.stdout)
        accesses = output['databaseAccesses']
        self.assertEqual(accesses['status'], 'complete', result.stdout)
        self.assertEqual(accesses['database']['path'], str(database), result.stdout)
        relations = [row for row in accesses['relations']
                     if row['value']['statement']['callId'] == prepare['id']]
        self.assertTrue(relations, result.stdout)
        refs = {ref['id']: ref for ref in accesses['refs']}
        for relation in relations:
            self.assertEqual(relation['classification'], 'static-possible', result.stdout)
            self.assertEqual(relation['value']['statementText'], sql, result.stdout)
            self.assertEqual(relation['value']['statementKind'], 'read', result.stdout)
            self.assertEqual(relation['value']['object']['name'], 'reportfmt', result.stdout)
            self.assertEqual(relation['value']['statement']['helperName'], 'db_prepare', result.stdout)
            span = refs[relation['from']]['subject']
            self.assertEqual(span['path'], str(generated), result.stdout)
            self.assertIn(sql.encode(), generated.read_bytes()[span['byteStart']:span['byteEnd']])
            self.assertEqual(refs[relation['to']]['subject']['name'], 'reportfmt', result.stdout)
        names = set()
        for condition in output.get('conditions', []):
            for operand in condition.get('operands', []):
                names.add(operand.get('name', ''))
                names.update(operand.get('fields', []))
        self.assertIn('okRdTkt', names, result.stdout)
        self.assertIn('okNewTkt', names, result.stdout)
        permission = next(condition for condition in output['conditions']
                          if any('okRdTkt' in [operand.get('name', '')] + list(operand.get('fields', []))
                                 for operand in condition.get('operands', [])))
        self.assertTrue(permission.get('supported', False), result.stdout)
        guard = next(row for row in output.get('guards', [])
                     if row.get('conditionId') == permission['id']
                     and row.get('callId') == prepare['id'])
        self.assertEqual(guard.get('status'), 'derived', result.stdout)
        denied = [route for route in guard.get('deniedRoutes', []) if route.get('returnId')]
        self.assertTrue(denied, result.stdout)
        return_ids = {row['id'] for row in output.get('returns', [])}
        for route in denied:
            self.assertIn(route['returnId'], return_ids, result.stdout)
        self.assertTrue(any(call.get('name') == 'login_needed' for call in output.get('calls', [])),
                        result.stdout)
        self.assertIsInstance(output.get('diagnostics'), list, result.stdout)
        for diagnostic in output['diagnostics']:
            self.assertIn(diagnostic.get('level'), ('error', 'warning', 'note', 'remark'),
                          result.stdout)
            self.assertTrue(diagnostic.get('message'), result.stdout)
        symbol_invocation = {**invocation, 'query': 'fossil-reportlist-body',
                             'request': {**invocation['request'],
                                         'subject': {'kind': 'symbol', 'path': 'src/report.c',
                                                     'name': 'view_list'},
                                         'select': ['calls', 'authorization', 'diagnostics']}}
        symbol_result = subprocess.run(['node', str(wrapper)], input=json.dumps(symbol_invocation),
                                       cwd=project, capture_output=True, text=True)
        self.assertEqual(symbol_result.returncode, 0, symbol_result.stdout + symbol_result.stderr)
        symbol_frame = json.loads(symbol_result.stdout)
        self.assertEqual(symbol_frame['payload']['status'], 'complete', symbol_result.stdout)
        symbol_output = symbol_frame['payload']['result']
        self.assertEqual(symbol_output['selectedFunction']['name'], 'view_list', symbol_result.stdout)
        self.assertTrue(any(call.get('name') == 'login_needed'
                            for call in symbol_output.get('calls', [])), symbol_result.stdout)
        self.assertTrue(symbol_output.get('conditions'), symbol_result.stdout)
        with sqlite3.connect(database) as connection:
            self.assertEqual(connection.execute('SELECT rn,title,owner FROM reportfmt').fetchall(),
                             [(1, 'Example report', 'operator')])

    def test_installed_native_cli_completes_a_selected_source_analysis(self):
        repository = Path(__file__).resolve().parents[2]
        coordinator = repository / '.scratch/bend2/baton2'
        if not coordinator.is_file():
            self.skipTest(f'Production coordinator not built at {coordinator}')
        node = shutil.which('node')
        if node is None:
            self.skipTest('Installed context query requires Node.js 22.15 or newer')
        version = subprocess.run([node, '--version'], capture_output=True, text=True)
        self.assertEqual(version.returncode, 0, version.stdout + version.stderr)
        major, minor = (int(part) for part in version.stdout.strip().lstrip('v').split('.')[:2])
        if (major, minor) < (22, 15):
            self.skipTest('Installed context query requires Node.js 22.15 or newer')

        previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = repository
        try:
            PACKAGE.stage_adapters(self.payload)
            PACKAGE.stage_selected_context_payload(self.payload)
            PACKAGE.stage_runtime_context_module(self.payload)
        finally:
            PACKAGE.ROOT = previous_root

        installed = self.payload / 'bin/baton2'
        installed.parent.mkdir(parents=True)
        shutil.copyfile(coordinator, installed)
        installed.chmod(0o755)
        database = self.root / 'state.db'
        self.handoff_database = database
        self.handoff_evidence = Path(os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE', str(self.root))) / 'native-object-handoff'
        self.handoff_evidence.mkdir(parents=True, exist_ok=True)
        RECEIVE.install_public_queue_codex(self, self.root)

        def invoke(*args, cwd=repository):
            argv = [str(installed), str(database), *args]
            result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
            with (self.handoff_evidence / 'commands.jsonl').open('a') as output:
                output.write(json.dumps({'argv': argv, 'cwd': str(cwd),
                                         'returncode': result.returncode,
                                         'stdout': result.stdout, 'stderr': result.stderr}) + '\n')
            return result

        attached = invoke('attach', 'validation-root', 'codex', 'fixture-native',
                          '')
        self.assertEqual(attached.returncode, 0, attached.stdout + attached.stderr)
        role = invoke('role', 'validation-root', 'principal-conductor')
        self.assertEqual(role.returncode, 0, role.stdout + role.stderr)

        project = self.root / 'project'
        fixture = project / 'bend2/context/bend2/fixtures/valid.bend'
        fixture.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / 'fixtures/valid.bend', fixture)
        project.mkdir(exist_ok=True)
        (project / '.baton').mkdir()
        (project / '.baton/context.json').write_text(json.dumps({
            'schema': 'baton2-context-project-v1',
            'disabled': ['runtime'], 'preferred': ['bend2'],
        }) + '\n')
        subprocess.run(['git', 'init', '-b', 'main', str(project)], check=True,
                       capture_output=True, text=True)
        subprocess.run(['git', 'add', '.'], cwd=project, check=True,
                       capture_output=True, text=True)
        subprocess.run(['git', 'add', '--force', '.baton/context.json'], cwd=project,
                       check=True, capture_output=True, text=True)
        subprocess.run(['git', '-c', 'user.name=Context fixture',
                        '-c', 'user.email=context-fixture@example.invalid',
                        '-c', 'core.hooksPath=/dev/null',
                        'commit', '-m', 'Add valid Bend source fixture'],
                       cwd=project, check=True, capture_output=True, text=True)

        worktree = self.root / 'owner-worktree'
        recruited = invoke('recruit', 'validation-owner', 'validation-root', 'codex',
                           'fixture-model', 'low', str(project), 'context-query-fixture',
                           str(worktree), 'HEAD')
        self.assertEqual(recruited.returncode, 0, recruited.stdout + recruited.stderr)

        distribution = self.root / 'context-distribution'
        module_source = distribution / 'lib/context/modules/m-62656e6432'
        module_source.parent.mkdir(parents=True)
        (self.payload / 'lib/context/modules/m-62656e6432').rename(module_source)
        missing_inventory = invoke('context-engines')
        self.assertEqual(missing_inventory.returncode, 0,
                         missing_inventory.stdout + missing_inventory.stderr)
        self.assertNotIn('bend2', {row['moduleId'] for row in json.loads(missing_inventory.stdout)['modules']})
        missing_source = invoke('context-install', 'bend2', str(self.root / 'missing-distribution'))
        self.assertEqual(missing_source.returncode, 2, missing_source.stdout + missing_source.stderr)
        self.assertIn('ENOENT', missing_source.stderr)
        acquired = invoke('context-install', 'bend2', str(distribution), cwd=worktree)
        self.assertEqual(acquired.returncode, 0, acquired.stdout + acquired.stderr)
        self.assertEqual(json.loads(acquired.stdout)['status'], 'installed')

        global_inventory = invoke('context-engines')
        self.assertEqual(global_inventory.returncode, 0,
                         global_inventory.stdout + global_inventory.stderr)
        self.assertNotIn('scope', json.loads(global_inventory.stdout))
        scoped_inventory = invoke('context-engines', 'validation-owner')
        self.assertEqual(scoped_inventory.returncode, 0,
                         scoped_inventory.stdout + scoped_inventory.stderr)
        discovery = json.loads(scoped_inventory.stdout)
        self.assertEqual(discovery['scope'], {'session': 'validation-owner',
                                             'workspace': str(worktree)})
        self.assertEqual(discovery['projectPolicy']['status'], 'present')
        modules = {row['moduleId']: row for row in discovery['modules']}
        self.assertTrue(modules['bend2']['enabled'])
        self.assertTrue(modules['bend2']['preferred'])
        self.assertFalse(modules['runtime']['enabled'])

        query = 'installed-source-analysis'
        request = self.root / 'request.json'
        source_tool = next(tool for tool in modules['bend2']['tools']
                           if tool['operation'] == 'sourceAnalysis')
        self.assertEqual(source_tool['optionsSchema']['type'], 'object')
        source_request = dict(source_tool['requestExample'], cwd=str(worktree))
        request.write_text(json.dumps(source_request) + '\n')
        submitted = invoke('context-query-file', 'validation-owner', query, str(request),
                           cwd=worktree)
        self.assertEqual(submitted.returncode, 0, submitted.stdout + submitted.stderr)

        retained = invoke('context-result', query, cwd=worktree)
        self.assertEqual(retained.returncode, 0, retained.stdout + retained.stderr)
        envelope = json.loads(retained.stdout)
        self.assertEqual(envelope['query'], query)
        self.assertEqual(envelope['owner'], 'validation-owner')
        self.assertEqual(envelope['state'], 'complete', retained.stdout)

        payload = envelope['result']['payload']
        self.assertEqual(payload['schema'],
                         'baton2.context.bend2.source-analysis.result.v1', retained.stdout)
        self.assertEqual(payload['status'], 'completed', retained.stdout)

        handoff_query = 'installed-native-handoff'
        producer, consumer = 'native-object-producer', 'native-object-consumer'
        handoff_request = self.root / 'handoff-request.json'
        source_request = json.loads(request.read_text())
        source_request['cwd'] = str(self.root / producer)
        handoff_request.write_text(json.dumps(source_request) + '\n')
        native_fixture = self.root / 'native-handoff.py'
        native_fixture.write_text('#!' + sys.executable + '\n' + NATIVE_HANDOFF)
        native_fixture.chmod(0o700)
        native_fixture.with_suffix('.json').write_text(json.dumps({
            'node': node, 'mcp': str(self.payload / 'libexec/baton2/mcp-conductor.mjs'),
            'db': str(database), 'exe': str(installed), 'producer': producer,
            'query': handoff_query, 'request': str(handoff_request),
            'moduleSource': str(module_source),
        }))
        handoff_task = self.root / 'handoff-task.txt'
        handoff_task.write_text('Read the complete retained source object for ' + handoff_query + '.\n')

        def checked(*args, cwd=repository):
            result = invoke(*args, cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)

        handoff_reports = {}
        producer_continuation = None
        for actor in (producer, consumer):
            actor_workspace = self.root / actor
            checked('recruit', actor, 'validation-root', 'muse', actor, 'low',
                    str(project), actor, str(actor_workspace), 'HEAD')
            turned = invoke('turn', actor, actor + '-first', str(native_fixture), actor,
                            'low', str(actor_workspace), str(handoff_task),
                            str(self.root / (actor + '.jsonl')), '')
            self.assertEqual(turned.returncode, 0, turned.stdout + turned.stderr)
            report = json.loads(checked('delivery', actor + '-first')['body'])
            handoff_reports[actor] = report
            self.assertEqual(report['session'], actor)
            self.assertEqual(report['native'], checked('session', actor)['native'])
            self.assertEqual(report['resume'], '')
            self.assertEqual(report['discoveryScope'],
                             {'session': actor, 'workspace': str(actor_workspace)})
            if actor == producer:
                rows = checked('players')
                player = next(row for row in rows if row['id'] == actor)
                producer_continuation = json.loads(player['latestReport'])
                terminal = 'context-query:' + handoff_query + ':terminal'
                notification = checked('delivery', terminal)
                self.assertEqual((producer_continuation['session'],
                                  producer_continuation['native'],
                                  producer_continuation['resume']),
                                 (producer, report['native'], report['native']))
                self.assertIn(terminal, producer_continuation['prompt'])
                self.assertEqual(notification['recipient'], producer)
                self.assertEqual(notification['receipt'], 'native-consumed-' + handoff_query)
                self.assertEqual(player['pendingCount'], 0)
        shared = checked('context-result', handoff_query)
        self.assertEqual(shared['owner'], producer)
        self.assertEqual(shared['result']['payload']['schema'], payload['schema'])
        for report in handoff_reports.values():
            self.assertEqual(report['retained'], shared)
        self.assertEqual(producer_continuation['retained'], shared)

        project_description = checked('project', str(project))
        original = checked('session', consumer)
        consumer_workspace = Path(original['workspace'])
        linked = checked('project', str(consumer_workspace))
        self.assertEqual(linked['project'], project_description['project'])
        self.assertEqual(linked['database'], str(database.resolve()))
        unfinished = consumer_workspace / 'unfinished.txt'
        unfinished.write_text('Keep unfinished native consumer source. λ\n')
        checked('connect', consumer, original['native'], '')
        message = 'native-handoff-resume'
        body = 'Read the same full retained source object again: ' + handoff_query
        checked('message', message, 'validation-root', consumer, 'task', body)
        self.assertIsNone(checked('delivery', message)['receipt'])
        checked('connect', consumer, original['native'], json.dumps(original['endpointArgv']))
        resumed = subprocess.run([str(installed), '--project', str(consumer_workspace),
                                  'resume', consumer], capture_output=True, text=True)
        self.assertEqual(resumed.returncode, 0, resumed.stdout + resumed.stderr)
        answer = json.loads(resumed.stdout)
        continued = json.loads(answer['latestReport'])
        self.assertEqual((answer['session'], answer['message']), (consumer, message))
        self.assertEqual(answer['delivery']['receipt'], 'native-consumed-' + handoff_query)
        self.assertEqual((continued['native'], continued['resume']),
                         (original['native'], original['native']))
        self.assertIn(body, continued['prompt'])
        self.assertEqual(continued['retained'], shared)
        final = checked('session', consumer)
        for field in ('id', 'parent', 'harness', 'workspace', 'branch', 'native'):
            self.assertEqual(final[field], original[field])
        self.assertEqual(unfinished.read_text(), 'Keep unfinished native consumer source. λ\n')
        discovered = subprocess.run([str(installed), '--project', str(consumer_workspace),
                                     'project-sessions', str(project)],
                                    capture_output=True, text=True)
        self.assertEqual(discovered.returncode, 0, discovered.stdout + discovered.stderr)
        sessions = {row['id']: row for row in json.loads(discovered.stdout)['sessions']}
        self.assertEqual(sessions[consumer]['native'], original['native'])
        self.assertEqual(sessions[producer]['native'], handoff_reports[producer]['native'])
        self.assertEqual(sessions[consumer]['pendingCount'], 0)

        checked('connect', consumer, original['native'], '')
        stopped_input = 'native-handoff-stopped-input'
        checked('message', stopped_input, 'validation-root', consumer, 'task',
                'Retain this input under the native consumer stop.')
        checked('stop', consumer, 'native-handoff-stop', 'Native consumer work is complete.')
        refused = subprocess.run([str(installed), '--project', str(consumer_workspace),
                                  'resume', consumer], capture_output=True, text=True)
        self.assertNotEqual(refused.returncode, 0, refused.stdout)
        self.assertIn('terminally stopped', refused.stderr)
        self.assertIsNone(checked('delivery', stopped_input)['receipt'])
        self.assertEqual(checked('session', consumer)['native'], original['native'])
        self.assertEqual(checked('context-result', handoff_query, cwd=consumer_workspace), shared)
        handoff_evidence = Path(os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE', str(self.root)))
        handoff_evidence.mkdir(parents=True, exist_ok=True)
        (handoff_evidence / 'native-object-handoff.json').write_text(json.dumps({
            'harnessFixture': 'scripted-muse-protocol',
            'producer': handoff_reports[producer], 'consumer': handoff_reports[consumer],
            'resumed': answer, 'projectSessions': json.loads(discovered.stdout),
            'stoppedResume': {'code': refused.returncode, 'stdout': refused.stdout,
                              'stderr': refused.stderr}, 'retained': shared,
        }, ensure_ascii=False) + '\n')

        compiler = os.environ.get('BATON2_CONTEXT_TYPESCRIPT')
        if compiler is not None:
            previous_root = PACKAGE.ROOT
            PACKAGE.ROOT = repository
            try:
                PACKAGE.stage_typescript_context_module(self.payload, Path(compiler))
            finally:
                PACKAGE.ROOT = previous_root
            (worktree / 'analysis.ts').write_text(
                'declare function query(sql: string): number;\n'
                'export const answer: number = query("SELECT value FROM records");\n')
            catalog_database = worktree / 'catalog.db'
            with sqlite3.connect(catalog_database) as connection:
                connection.execute('CREATE TABLE records(value TEXT)')
                connection.execute("INSERT INTO records VALUES ('alpha')")
            request.write_text(json.dumps({
                'version': 1, 'engine': 'typescript',
                'subject': {'kind': 'symbol', 'path': 'analysis.ts', 'name': 'answer'},
                'select': ['definition', 'type', 'databaseAccesses'], 'cwd': str(worktree),
                'options': {'database': {'engine': 'sqlite-schema', 'path': 'catalog.db'},
                            'client': {'path': 'analysis.ts', 'line': 0, 'column': 17}},
            }) + '\n')
            submitted = invoke('context-query-file', 'validation-owner', 'installed-typescript',
                               str(request), cwd=worktree)
            self.assertEqual(submitted.returncode, 0, submitted.stdout + submitted.stderr)
            retained = invoke('context-result', 'installed-typescript', cwd=worktree)
            self.assertEqual(retained.returncode, 0, retained.stdout + retained.stderr)
            envelope = json.loads(retained.stdout)
            self.assertEqual(envelope['state'], 'complete', retained.stdout)
            payload = envelope['result']['payload']
            self.assertEqual(payload['schema'], 'baton2.context.typescript.source-analysis.result.v1')
            self.assertEqual(payload['status'], 'completed', retained.stdout)
            self.assertTrue({'definition', 'type', 'sqlCall'}.issubset(
                {fact['kind'] for fact in payload['facts']}), retained.stdout)
            sql_calls = [fact['value']['record']['sql'] for fact in payload['facts']
                         if fact['kind'] == 'sqlCall']
            self.assertIn({'status': 'constant', 'text': 'SELECT value FROM records',
                           'literalKind': 'stringLiteral'}, sql_calls, retained.stdout)
            # The catalog half of the same projection: the retained result carries the relation
            # from the resolved call's own reference to the catalog object its statement names.
            statement_facts = [fact for fact in payload['facts'] if fact['kind'] == 'sqlCall']
            accesses = payload['databaseAccesses']
            self.assertEqual(accesses['status'], 'complete', retained.stdout)
            self.assertEqual(accesses['database']['path'], str(catalog_database), retained.stdout)
            relations = [relation for relation in accesses['relations']
                         if relation['value']['object']['name'] == 'records']
            self.assertTrue(relations, retained.stdout)
            relation = relations[0]
            self.assertEqual(relation['value']['statementKind'], 'read', retained.stdout)
            self.assertEqual(relation['value']['statementText'], 'SELECT value FROM records',
                             retained.stdout)
            statement = relation['value']['statement']
            calls_by_id = {fact['id']: fact for fact in statement_facts}
            self.assertIn(statement['sqlCallId'], calls_by_id, retained.stdout)
            self.assertEqual(statement['clientMatch'], 'matched', retained.stdout)
            self.assertEqual(relation['from'], calls_by_id[statement['sqlCallId']]['value']['callSiteRef'],
                             retained.stdout)
            self.assertIn(relation['from'], {ref['id'] for ref in payload['refs']}, retained.stdout)
            joined_refs = {ref['id']: ref for ref in accesses['refs']}
            self.assertEqual(joined_refs[relation['to']]['subject']['name'], 'records', retained.stdout)
            with sqlite3.connect(catalog_database) as connection:
                self.assertEqual(connection.execute('SELECT value FROM records').fetchall(),
                                 [('alpha',)], retained.stdout)

        (worktree / '.baton/context.json').write_text(json.dumps({
            'schema': 'baton2-context-project-v1', 'disabled': [], 'preferred': ['bend2'],
        }) + '\n')
        target = worktree / 'runtime-target.mjs'
        shutil.copyfile(repository / 'bend2/context/runtime/cdp-fixture-longrun.mjs', target)
        target_source = target.read_text()
        original = worktree / 'runtime-original.ts'
        original.write_text('\n\n\n' + target_source)
        source_map = worktree / 'runtime-target.mjs.map'
        source_map.write_text(json.dumps({
            'version': 3, 'file': target.name, 'sources': [original.name],
            'sourcesContent': [original.read_text()], 'names': [],
            'mappings': ';'.join(['AAGA'] + ['AACA'] * (len(target_source.splitlines()) - 1)),
        }) + '\n')
        target.write_text(target_source + '\n//# sourceMappingURL=runtime-target.mjs.map\n')
        runtime = 'rt:installed-runtime-launch'
        evidence_root = Path(os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE', str(self.root)))
        evidence = evidence_root / 'installed-runtime'
        evidence.mkdir(parents=True, exist_ok=True)
        transcript = evidence / 'commands.jsonl'

        def retain_runtime_database():
            with sqlite3.connect(database) as source, sqlite3.connect(evidence / 'state.db') as retained:
                source.backup(retained)

        def runtime_invoke(*args):
            result = invoke(*args, cwd=worktree)
            with transcript.open('a') as output:
                output.write(json.dumps({'argv': [str(installed), str(database), *args],
                                         'cwd': str(worktree), 'returncode': result.returncode,
                                         'stdout': result.stdout, 'stderr': result.stderr}) + '\n')
            if result.returncode != 0:
                retain_runtime_database()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return result

        def runtime_result(query):
            while True:
                result = runtime_invoke('context-result', query)
                envelope = json.loads(result.stdout)
                self.assertEqual((envelope['query'], envelope['owner']),
                                 (query, 'validation-owner'), result.stdout)
                if envelope['state'] in ('accepted', 'running'):
                    time.sleep(0.1)
                    continue
                self.assertEqual(envelope['state'], 'complete', result.stdout)
                frame = envelope['result']
                self.assertEqual((frame['version'], frame['query'], frame['owner']),
                                 (2, query, 'validation-owner'), result.stdout)
                self.assertEqual(frame['moduleBinding']['id'], 'runtime', result.stdout)
                answer = frame['payload']
                self.assertEqual(answer['schema'], 'baton2.context.runtime.result.v1', result.stdout)
                self.assertEqual(answer['runtime'], runtime, result.stdout)
                self.assertNotIn('refusal', answer, result.stdout)
                return answer

        def runtime_submit(query, subject, select, effects):
            document = {'version': 1, 'engine': 'runtime', 'cwd': str(worktree),
                        'subject': {'kind': 'runtime', **subject},
                        'select': select, 'effects': effects}
            path = evidence / f'{query}.json'
            path.write_text(json.dumps(document) + '\n')
            return runtime_invoke('context-query-file', 'validation-owner', query, str(path))

        def runtime_cleanup():
            while True:
                with sqlite3.connect(database) as connection:
                    connection.row_factory = sqlite3.Row
                    rows = [dict(row) for row in connection.execute(
                        "SELECT r.*,q.artifact_path FROM semantic_roles r "
                        "JOIN semantic_queries q ON q.id=r.query_id "
                        "WHERE r.query_id=? AND r.role IN ('target','adapter') ORDER BY r.role",
                        ('installed-runtime-launch',))]
                (evidence / 'roles.json').write_text(json.dumps(rows, indent=2) + '\n')
                self.assertEqual(len(rows), 2, json.dumps(rows))
                for row in rows:
                    capture = json.loads(row['capture_json'] or '{}').get('stdout', {})
                    copied = capture.get('copy', {})
                    stderr_path = capture.get('stderrPath')
                    if stderr_path and Path(stderr_path).is_file():
                        shutil.copyfile(stderr_path, evidence / f"{row['role']}-copy.stderr")
                    copy_failed = (copied.get('nativeStatus') not in (None, 'exit 0')
                                   or any(copied.get(field) is not None for field in
                                          ('spawnError', 'closeError', 'readError', 'waitError')))
                    self.assertFalse(row['cleanup_phase'] == 'failed' or copy_failed, json.dumps(rows))
                if all(row['cleanup_phase'] == 'released' for row in rows):
                    for row in rows:
                        output = Path(row['artifact_path']) / f"{row['role']}.stdout"
                        self.assertTrue(output.is_file(), json.dumps(rows))
                        shutil.copyfile(output, evidence / output.name)
                    self.keep_runtime_workspace = False
                    return
                time.sleep(0.1)

        self.keep_runtime_workspace = True
        runtime_submit('installed-runtime-launch',
                       {'intent': 'launch', 'program': str(target), 'args': [],
                        'env': {'BATON_CDP_FIXTURE_MARKER': 'installed-runtime'},
                        'onOwnerStop': 'terminate'}, ['state'], ['controlRuntime'])
        try:
            launched = runtime_result('installed-runtime-launch')
            self.assertEqual(launched['intent'], 'launch', json.dumps(launched))
            if launched['state'] != 'paused':
                runtime_submit('installed-runtime-pause',
                               {'intent': 'pause', 'session': runtime},
                               ['state'], ['controlRuntime'])
                paused = runtime_result('installed-runtime-pause')
                self.assertEqual(paused['state'], 'paused', json.dumps(paused))
            runtime_submit('installed-runtime-observe',
                           {'intent': 'observe', 'session': runtime},
                           ['state', 'frames', 'scopes', 'values', 'threads', 'exception'], [])
            observed = runtime_result('installed-runtime-observe')
            self.assertEqual((observed['intent'], observed['state']),
                             ('observe', 'paused'), json.dumps(observed))
            self.assertTrue(observed['frames'], json.dumps(observed))
            mapped_frames = [frame for frame in observed['frames']
                             if frame['original'] is not None
                             and frame['original']['path'] == str(original.resolve())]
            self.assertTrue(mapped_frames, json.dumps(observed))
            for frame in mapped_frames:
                self.assertEqual(frame['provenance'], 'mapped', json.dumps(frame))
                self.assertEqual((frame['original']['line'], frame['original']['column']),
                                 (frame['generated']['line'] + 3, 0), json.dumps(frame))
            self.assertTrue(observed['threads'], json.dumps(observed))
            self.assertTrue(observed['scopes'], json.dumps(observed))
            self.assertTrue(observed['records'], json.dumps(observed))
            self.assertEqual(observed['identity']['runtime'], runtime, json.dumps(observed))
            self.assertEqual(observed['identity']['epoch'], observed['epoch'], json.dumps(observed))
            self.assertEqual(observed['capture']['epoch'], observed['epoch'], json.dumps(observed))
            self.assertTrue(all(isinstance(row['response']['result'], list)
                                for row in observed['records']), json.dumps(observed))
            source_map.unlink()
            runtime_submit('installed-runtime-missing-map',
                           {'intent': 'observe', 'session': runtime}, ['frames'], [])
            missing_map = runtime_result('installed-runtime-missing-map')
            missing_frames = [frame for frame in missing_map['frames']
                              if frame.get('mapping', {}).get('condition') == 'missingMap']
            self.assertTrue(missing_frames, json.dumps(missing_map))
            self.assertTrue(all(frame['original'] is None and frame['provenance'] == 'unmapped'
                                for frame in missing_frames), json.dumps(missing_map))
        finally:
            try:
                runtime_submit('installed-runtime-release',
                               {'intent': 'release', 'session': runtime,
                                'onRelease': 'terminate', 'signal': 'SIGTERM'},
                               ['state'], ['controlRuntime'])
                released = runtime_result('installed-runtime-release')
                self.assertEqual((released['intent'], released['state']),
                                 ('release', 'exited'), json.dumps(released))
                self.assertTrue(released['exit']['code'] is not None
                                or released['exit']['signal'] is not None, json.dumps(released))
                runtime_cleanup()
            finally:
                retain_runtime_database()

if __name__ == '__main__':
    unittest.main()
