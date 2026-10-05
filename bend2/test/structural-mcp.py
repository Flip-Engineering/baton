"""Qualify structural MCP translation and real native result preservation.

Fresh fixtures contain no receiver endpoints. The recording executable proves
one complete native invocation; actual native cases exercise typed partial
results and the recorded structure through the public CLI and adapter.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
MCP = Path(os.environ.get('BATON2_STRUCTURAL_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs'))
EXE = Path(os.environ.get('BATON2_STRUCTURAL_EXE', ROOT / '.scratch/bend2/baton2'))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bend2/test' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


translation = load('structural_translation_support', 'control-index-mcp.py')
fixtures = load('structural_native_support', 'structural-construction.py')
translation.MCP = MCP


class Translation(unittest.TestCase):
    def setUp(self):
        self.helper = translation.ControlIndexMcp()
        self.helper.setUp()
        self.addCleanup(self.helper.doCleanups)
        self.args = dict(player="child's λ", parent='', harness='muse', model='model',
                         effort='high', repo='/repository', branch='branch',
                         workspace='/workspace', base='HEAD')

    def check(self, tool, args, argv, **response):
        result, calls = self.helper.exchange(tool, args, **response)
        self.assertEqual(calls, [[str(self.helper.database), *argv]])
        return result

    def test_recruit_complete_literal_groups_in_one_invocation(self):
        group = dict(ensemble="team's $(literal) λ", owner='--section')
        section = dict(**group, section='review "group"')
        args = dict(self.args, role='associate-conductor', ensembles=[group, group],
                    sections=[section])
        native = dict(type='structural-result', status='configured', startupRequested=False)
        result = self.check('baton2_recruit', args,
                            ['recruit', *self.args.values(), '--role', 'associate-conductor',
                             '--ensemble', *group.values(), '--ensemble', *group.values(),
                             '--section', *section.values()], stdout=json.dumps(native))
        self.assertEqual(json.loads(result['content'][0]['text']), native)

    def test_ensemble_sections_preserve_order_duplicates_and_literal_values(self):
        groups = [dict(section="quote' λ", capability='--role'),
                  dict(section='', capability='review "all"')]
        self.check('baton2_ensemble', dict(ensemble='', owner='', coupling='tight', sections=groups),
                   ['ensemble', '', '', 'tight', '--section', *groups[0].values(),
                    '--section', *groups[1].values()])

    def test_legacy_defaults_and_explicit_empty_parent_are_preserved(self):
        args = dict(self.args)
        del args['parent']
        self.check('baton2_recruit', args,
                   ['recruit', args['player'], 'attached', *list(args.values())[1:]])
        self.check('baton2_recruit', self.args, ['recruit', *self.args.values()])
        self.check('baton2_ensemble', {'ensemble': 'e'}, ['ensemble', 'e'])
        self.check('baton2_ensemble', {'ensemble': 'e', 'coupling': 'tight'},
                   ['ensemble', 'e', 'attached', 'tight'])
        self.check('baton2_recruit', dict(self.args, role='player', ensembles=[], sections=[]),
                   ['recruit', *self.args.values(), '--role', 'player'])

    def test_malformed_groups_and_missing_explicit_requirements_never_invoke_native(self):
        cases = [('baton2_recruit', dict(self.args, sections=[])),
                 ('baton2_recruit', {k: v for k, v in dict(self.args, role='player').items() if k != 'parent'}),
                 ('baton2_recruit', dict(self.args, role='principal-conductor')),
                 ('baton2_recruit', dict(self.args, role='player', ensembles=None)),
                 ('baton2_recruit', dict(self.args, role='player', sections=[{'ensemble': 'e', 'owner': 'p'}])),
                 ('baton2_recruit', dict(self.args, role='player', sections=[{'ensemble': 'e', 'owner': 2, 'section': 's'}])),
                 ('baton2_recruit', dict(self.args, role='player', sections=['e'])),
                 ('baton2_recruit', dict(self.args, role='player', start=True)),
                 ('baton2_ensemble', {'ensemble': 'e', 'owner': 'p', 'sections': [{'section': 's', 'capability': 'c'}]}),
                 ('baton2_ensemble', {'ensemble': 'e', 'coupling': 'tight', 'sections': [{'section': 's', 'capability': 'c'}]}),
                 ('baton2_ensemble', {'ensemble': 'e', 'owner': 'p', 'coupling': 'tight', 'sections': []}),
                 ('baton2_ensemble', {'ensemble': 'e', 'owner': 'p', 'coupling': 'tight', 'sections': [{'section': 's', 'capability': 'c', 'extra': ''}]})]
        for tool, args in cases:
            with self.subTest(tool=tool, args=args):
                result, calls = self.helper.exchange(tool, args)
                self.assertTrue(result.get('isError'), result)
                self.assertEqual(calls, [])

    def test_discovery_exposes_exact_group_schemas(self):
        self.helper.exchange('baton2_ensemble', {'ensemble': 'e'})
        tools = self.helper.advertised
        recruit = tools['baton2_recruit']['inputSchema']['properties']
        self.assertEqual(recruit['role']['enum'], ['player', 'associate-conductor'])
        for group, required in [('ensembles', ['ensemble', 'owner']),
                                ('sections', ['ensemble', 'owner', 'section'])]:
            self.assertEqual(recruit[group]['type'], 'array')
            self.assertEqual(recruit[group]['items']['required'], required)
            self.assertFalse(recruit[group]['items']['additionalProperties'])
        ensemble = tools['baton2_ensemble']['inputSchema']['properties']['sections']
        self.assertEqual(ensemble['items']['required'], ['section', 'capability'])
        self.assertEqual(ensemble['minItems'], 1)


class NativeProjection(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.StructuralFixture(EXE, 'structural-mcp-')
        self.addCleanup(self.f.close)
        self.f.conductor('principal')

    def call(self, tool, args):
        requests = [{'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                     'params': {'name': tool, 'arguments': args}}]
        p = subprocess.run(['node', str(MCP), str(self.f.db), str(EXE), '--session', 'principal'],
                           input=''.join(json.dumps(r) + '\n' for r in requests), text=True,
                           capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        answer = json.loads(p.stdout)['result']
        return answer

    def same(self, tool, args, argv):
        native = self.f.run(*argv)
        result = self.call(tool, args)
        text = result['content'][0]['text']
        if native[0] == 0:
            self.assertFalse(result.get('isError'), result)
            self.assertEqual(json.loads(text), json.loads(native[1]))
            return json.loads(text)
        self.assertTrue(result.get('isError'), result)
        self.assertIn(f'\nexit code: {native[0]}', text)
        streams = text.split('\nstdout:\n', 1)[1]
        out, err = streams.split('\nstderr:\n', 1)
        self.assertEqual((out, err), native[1:])
        return json.loads(err)

    def recruit(self, ident, parent='principal', role='player', sections=None):
        return dict(player=ident, parent=parent, harness='codex', model='fixture', effort='high',
                    repo=str(self.f.repo), branch='branch-' + ident,
                    workspace=str(self.f.root / ident), base=self.f.base,
                    role=role, sections=sections or [])

    def argv(self, args):
        return ['recruit', *[args[k] for k in ['player', 'parent', 'harness', 'model', 'effort',
                                             'repo', 'branch', 'workspace', 'base']],
                '--role', args['role'],
                *[value for group in args['sections'] for value in ['--section', group['ensemble'], group['owner'], group['section']]]]

    def test_principal_ensemble_siblings_nested_associate_and_critic_section(self):
        ensemble = "critic's λ"
        section = '--section'
        args = dict(ensemble=ensemble, owner='principal', coupling='tight',
                    sections=[dict(section=section, capability='review')])
        self.same('baton2_ensemble', args,
                  ['ensemble', ensemble, 'principal', 'tight', '--section', section, 'review'])
        for ident, parent, role in [('a', 'principal', 'associate-conductor'),
                                     ('b', 'principal', 'associate-conductor'),
                                     ('nested', 'a', 'associate-conductor'),
                                     ('critic1', 'a', 'player'), ('critic2', 'b', 'player')]:
            args = self.recruit(ident, parent, role,
                                [dict(ensemble=ensemble, owner='principal', section=section)])
            created = self.call('baton2_recruit', args)
            self.assertFalse(created.get('isError'), created)
            self.assertEqual(json.loads(created['content'][0]['text'])['workspace']['disposition'], 'created')
            retry = self.same('baton2_recruit', args, self.argv(args))
            self.assertEqual(retry['workspace']['disposition'], 'unchanged')
            self.assertEqual(retry['structure']['parent'], parent)
            self.assertFalse(retry['startupRequested'])
        view = self.call('baton2_orchestra', dict(index=True, session='principal'))
        view = json.loads(view['content'][0]['text'])
        self.assertEqual({p['id'] for p in view['players']}, {'principal', 'a', 'b', 'nested', 'critic1', 'critic2'})
        self.assertEqual(self.f.scalar('SELECT count(*) FROM ensemble_members WHERE session=?', ('principal',)), 0)
        self.assertEqual(self.f.scalar('SELECT count(*) FROM section_members'), 5)

    def test_native_refusal_full_object_and_host_failure_survive_mcp(self):
        args = dict(ensemble='team', owner='principal', coupling='tight',
                    sections=[dict(section='review', capability='')])
        refused = self.same('baton2_ensemble', args,
                            ['ensemble', 'team', 'principal', 'tight', '--section', 'review', ''])
        self.assertEqual(refused['status'], 'preflightRefused')
        args = self.recruit('occupied')
        Path(args['workspace']).mkdir()
        marker = Path(args['workspace']) / 'keep.txt'
        marker.write_text('preserve')
        failure = self.same('baton2_recruit', args, self.argv(args))
        self.assertEqual(failure['status'], 'workspaceFailed')
        self.assertEqual(marker.read_text(), 'preserve')
        self.assertEqual(self.f.scalar('SELECT count(*) FROM sessions WHERE id=?', ('occupied',)), 0)

    def test_mcp_registration_failure_reports_created_workspace_and_rolled_back_rows(self):
        self.f.ensemble('team', 'principal', 'tight')
        rc, out, err = self.f.run('section', 'team', 'review', 'principal', 'review')
        self.assertEqual(rc, 0, err)
        self.f.abort_trigger('section_members')
        args = self.recruit('partial', sections=[dict(ensemble='team', owner='principal', section='review')])
        result = self.call('baton2_recruit', args)
        self.assertTrue(result.get('isError'), result)
        text = result['content'][0]['text']
        out, err = text.split('\nstdout:\n', 1)[1].split('\nstderr:\n', 1)
        self.assertEqual(out, '')
        failure = json.loads(err)
        self.assertEqual(failure['status'], 'registrationFailed')
        self.assertEqual(failure['workspace']['disposition'], 'created')
        self.assertEqual(failure['workspace']['path'], args['workspace'])
        self.assertEqual(failure['workspace']['observed']['head'], self.f.base)
        self.assertEqual(fixtures.git(Path(args['workspace']), 'rev-parse', 'HEAD'), self.f.base)
        self.assertEqual(self.f.scalar('SELECT count(*) FROM sessions WHERE id=?', ('partial',)), 0)
        self.assertEqual(self.f.scalar('SELECT count(*) FROM ensemble_members WHERE session=?', ('partial',)), 0)
        self.assertEqual(self.f.scalar('SELECT count(*) FROM section_members WHERE session=?', ('partial',)), 0)

    def test_sqlite_failure_preserves_native_partial_result_and_rollback(self):
        self.f.abort_trigger('sections')
        args = dict(ensemble='team', owner='principal', coupling='tight',
                    sections=[dict(section='review', capability='review')])
        failure = self.same('baton2_ensemble', args,
                            ['ensemble', 'team', 'principal', 'tight', '--section', 'review', 'review'])
        self.assertEqual(failure['status'], 'registrationFailed')
        self.assertEqual(self.f.scalar('SELECT count(*) FROM ensembles'), 0)


if __name__ == '__main__':
    unittest.main()
