#!/usr/bin/env python3
"""Public-data checks; actual signing, network and native launch are excluded."""
from argparse import Namespace
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch


BASE = Path(__file__).resolve().parent
SOURCE = BASE.parent / 'harness' / 'git-series.py'
SPEC = importlib.util.spec_from_file_location('git_series_fixture', SOURCE)
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)
MODELS = ('gpt-6-astra', 'kimi-code/k3', 'deepseek/deepseek-flash', 'muse-spark-1.3-contributor')
MODEL_SERIES = dict(zip(MODELS, ('gpt', 'kimi', 'deepseek', 'muse')))
NEXT_MODEL = 'fixture/gpt-next-exact'


class ModelGit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # All six public fixture identities remain available after the run.
        fixtures = BASE.parents[1] / '.scratch' / 'git-series-fixtures'
        fixtures.mkdir(parents=True, exist_ok=True)
        cls.directory = Path(tempfile.mkdtemp(prefix='public-', dir=fixtures))
        cls.registry = cls.directory / 'series.json'
        series = {}
        cls.series_identities = {}
        for index, key in enumerate(MODEL.SERIES):
            directory = cls.directory / ('App fixture λ ' + key)
            directory.mkdir()
            slug = 'fixture-series-' + key
            bot_id = 9000 + index
            identity = {'seriesKey': key, 'displaySeries': key,
                        'github': {'appId': 1000 + index, 'clientId': 'fixture-client-' + str(index),
                                   'slug': slug, 'botLogin': slug + '[bot]', 'botId': bot_id,
                                   'commitEmail': f'{bot_id}+{slug}[bot]@users.noreply.github.com',
                                   'installationId': 2000 + index,
                                   'repositoryFullName': MODEL.REPOSITORY, 'repositoryId': 3000,
                                   'permissions': dict(MODEL.PERMISSIONS)}}
            path = directory / 'identity-series.json'
            path.write_text(json.dumps(identity))
            path.chmod(0o600)
            # Preserved old metadata is deliberately inconsistent and unused.
            old = directory / 'identity.json'
            old.write_text(json.dumps({'modelKey': 'old-snapshot', 'github': {'appId': -1}}))
            old.chmod(0o600)
            series[key] = str(directory)
            cls.series_identities[key] = identity['github']
        cls.identities = {model: cls.series_identities[key] for model, key in MODEL_SERIES.items()}
        models = {**MODEL_SERIES, NEXT_MODEL: 'gpt'}
        cls.registry.write_text(json.dumps({'models': models, 'series': series}))
        cls.registry.chmod(0o600)
        (cls.directory / 'BOUNDARY.json').write_text(json.dumps({
            'fixture_only': True, 'actual_credentials': False, 'private_key_created': False,
            'App_and_bot_IDs': 'invented fixture identifiers', 'native_execution': False,
            'network': 'replaced by in-memory response fixtures', 'series': list(MODEL.SERIES)}))

    def args(self, model, command, native=False, series=None):
        return Namespace(registry=str(self.registry), model_key=model, series_key=series,
                         command=command, native_model=native)

    def test_explicit_git_commit_message_is_not_a_native_model(self):
        args = self.args(MODELS[0], ['--', 'git', 'commit', '-m', 'Retain actual Player change'])
        with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
            MODEL.launch(args)
        program, command, environment = execute.call_args.args
        self.assertEqual((program, command), ('git', args.command[1:]))
        self.assertEqual(environment['GIT_AUTHOR_EMAIL'], self.identities[MODELS[0]]['commitEmail'])

    def test_native_known_model_option_forms_match_exact_key(self):
        for model in MODELS:
            for option in (['--model', model], ['-m', model], ['--model=' + model]):
                with self.subTest(model=model, option=option):
                    with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
                        MODEL.launch(self.args(model, ['native-fixture', *option], True))
                    self.assertEqual(execute.call_args.args[2]['GIT_COMMITTER_EMAIL'],
                                     self.identities[model]['commitEmail'])

    def test_native_mismatch_and_missing_option_refuse_before_launch(self):
        for command in (['native-fixture', '--model', MODELS[1]], ['native-fixture']):
            with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
                with self.assertRaises(MODEL.Refusal):
                    MODEL.launch(self.args(MODELS[0], command, True))
                execute.assert_not_called()

    def test_recipient_reselects_identity_and_discards_inherited_auth_overrides(self):
        inherited = {'GIT_AUTHOR_NAME': 'sender', 'GIT_AUTHOR_EMAIL': 'sender@example.invalid',
                     'GIT_COMMITTER_NAME': 'sender', 'GIT_COMMITTER_EMAIL': 'sender@example.invalid',
                     'GH_TOKEN': 'fixture-sender-token', 'GITHUB_TOKEN': 'fixture-sender-token',
                     'GIT_ASKPASS': 'sender-askpass', 'GIT_CONFIG_COUNT': '4',
                     'GIT_CONFIG_KEY_0': 'diff.algorithm', 'GIT_CONFIG_VALUE_0': 'patience',
                     'GIT_CONFIG_KEY_1': 'credential.helper', 'GIT_CONFIG_VALUE_1': 'sender-helper',
                     'GIT_CONFIG_KEY_2': 'http.extraHeader',
                     'GIT_CONFIG_VALUE_2': 'Authorization: fixture-sender-authorization',
                     'GIT_CONFIG_KEY_3': 'core.fsmonitor', 'GIT_CONFIG_VALUE_3': 'false',
                     'GIT_CONFIG_PARAMETERS': shlex.join(['gc.auto=0', 'credential.helper=sender-helper'])}
        for model in MODELS:
            with self.subTest(model=model):
                environment = MODEL.scoped_environment(self.registry, MODEL_SERIES[model], self.identities[model], inherited)
                self.assertEqual(environment['GIT_AUTHOR_NAME'], self.identities[model]['botLogin'])
                self.assertEqual(environment['GIT_COMMITTER_EMAIL'], self.identities[model]['commitEmail'])
                self.assertNotIn('GH_TOKEN', environment)
                self.assertNotIn('GITHUB_TOKEN', environment)
                self.assertNotIn('GIT_CONFIG_PARAMETERS', environment)
                pairs = [(environment[f'GIT_CONFIG_KEY_{i}'], environment[f'GIT_CONFIG_VALUE_{i}'])
                         for i in range(int(environment['GIT_CONFIG_COUNT']))]
                self.assertIn(('diff.algorithm', 'patience'), pairs)
                self.assertIn(('core.fsmonitor', 'false'), pairs)
                self.assertIn(('gc.auto', '0'), pairs)
                self.assertIn(('credential.helper', ''), pairs)
                self.assertIn(('http.extraHeader', ''), pairs)
                self.assertNotIn('sender-helper', [value for _, value in pairs])
                self.assertNotIn('Authorization: fixture-sender-authorization', [value for _, value in pairs])
                self.assertNotEqual(environment['GIT_ASKPASS'], 'sender-askpass')
                for path in (MODEL.REPOSITORY, MODEL.REPOSITORY + '.git'):
                    helper = dict(pairs)['credential.https://github.com/' + path + '.helper']
                    argv = shlex.split(helper.removeprefix('!'))
                    self.assertEqual(argv[-2:], ['--series-key', MODEL_SERIES[model]])
                    self.assertIn(str(SOURCE), argv)

    def test_unknown_model_has_no_family_fallback(self):
        with self.assertRaises(MODEL.Refusal):
            MODEL.selected_identity(self.registry, 'deepseek/another-model')

    def test_codex_launch_preserves_subscription_wrapper_and_clears_api_keys(self):
        command = ['codex-subscription-fixture', '--model', MODELS[0]]
        with patch.dict(MODEL.os.environ, {'OPENAI_API_KEY': 'fixture', 'CODEX_API_KEY': 'fixture'}, clear=True):
            with patch.object(MODEL.os, 'execvpe') as execute:
                MODEL.launch(self.args(MODELS[0], command, True))
        self.assertEqual(execute.call_args.args[1], command)
        self.assertNotIn('OPENAI_API_KEY', execute.call_args.args[2])
        self.assertNotIn('CODEX_API_KEY', execute.call_args.args[2])

    def test_wrong_repository_host_protocol_and_username_refuse_before_auth(self):
        good = {'protocol': 'https', 'host': 'github.com', 'path': MODEL.REPOSITORY + '.git'}
        variants = ({'path': 'Flip-Engineering/another-repository'}, {'host': 'other.example'},
                    {'protocol': 'http'}, {'username': 'operator'})
        for changed in variants:
            context = {**good, **changed}
            request = '\n'.join(key + '=' + value for key, value in context.items()) + '\n\n'
            args = Namespace(registry=str(self.registry), series_key='gpt', operation='get')
            with patch.object(MODEL.sys, 'stdin', io.StringIO(request)):
                with patch.object(MODEL, 'selected_identity') as select, patch.object(MODEL, 'installation_token') as issue:
                    with self.assertRaises(MODEL.Refusal):
                        MODEL.helper(args)
                    select.assert_not_called()
                    issue.assert_not_called()

    def test_exact_repository_paths_are_accepted(self):
        for path in (MODEL.REPOSITORY, MODEL.REPOSITORY + '.git'):
            MODEL.credential_context(io.StringIO('protocol=https\nhost=github.com\npath=' + path + '\n\n'))

    def test_helper_store_and_erase_do_not_persist_or_authenticate(self):
        for operation in ('store', 'erase'):
            with patch.object(MODEL, 'selected_identity') as select, patch.object(MODEL, 'installation_token') as issue:
                MODEL.helper(Namespace(operation=operation))
                select.assert_not_called()
                issue.assert_not_called()

    def token_responses(self, model):
        github = self.identities[model]
        installation = {'id': github['installationId'], 'app_id': github['appId'], 'app_slug': github['slug'],
                        'account': {'login': 'Flip-Engineering'}, 'suspended_at': None,
                        'permissions': dict(MODEL.PERMISSIONS)}
        issued = {'token': 'fixture-token-no-network', 'permissions': dict(MODEL.PERMISSIONS),
                  'expires_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
        return [{'id': github['appId'], 'slug': github['slug'], 'client_id': github['clientId']},
                installation, copy.deepcopy(installation), issued,
                {'total_count': 1, 'repositories': [{'id': github['repositoryId'], 'full_name': MODEL.REPOSITORY}]}]

    def test_fixture_token_request_selects_exact_repository_and_permissions(self):
        github = self.identities[MODELS[0]]
        with patch.object(MODEL, 'app_jwt', return_value='fixture-jwt-no-key') as sign:
            with patch.object(MODEL, 'api', side_effect=self.token_responses(MODELS[0])) as api:
                token = MODEL.installation_token(self.directory, github)
        self.assertEqual(token, 'fixture-token-no-network')
        self.assertEqual(api.call_args_list[3].args,
                         (f"/app/installations/{github['installationId']}/access_tokens", 'fixture-jwt-no-key',
                          {'repository_ids': [github['repositoryId']], 'permissions': MODEL.PERMISSIONS}))
        sign.assert_called_once_with(self.directory, github)

    def test_app_installation_permissions_and_repository_conflicts_refuse(self):
        mutations = [(0, 'id', -1), (1, 'id', -1), (2, 'app_id', -1),
                     (3, 'permissions', {**MODEL.PERMISSIONS, 'issues': 'write'}),
                     (4, 'repositories', [{'id': -1, 'full_name': MODEL.REPOSITORY}]),
                     (4, 'total_count', 2)]
        for position, key, value in mutations:
            with self.subTest(position=position, key=key):
                responses = self.token_responses(MODELS[0])
                responses[position][key] = value
                with patch.object(MODEL, 'app_jwt', return_value='fixture-jwt-no-key'):
                    with patch.object(MODEL, 'api', side_effect=responses):
                        with self.assertRaises(MODEL.Refusal):
                            MODEL.installation_token(self.directory, self.identities[MODELS[0]])


    def test_observed_repeated_capability_prefix_accepts_synthetic_target(self):
        # Only the two capability[] field names/count are from the real receipt.
        # Their values and all subsequent fields below are controlled fixtures.
        request = ('capability[]=fixture-first\ncapability[]=fixture-second\n'
                   'protocol=https\nhost=github.com\npath=' + MODEL.REPOSITORY + '.git\n\n')
        args = Namespace(registry=str(self.registry), series_key='gpt', operation='get')
        output = io.StringIO()
        with patch.object(MODEL.sys, 'stdin', io.StringIO(request)), patch.object(MODEL.sys, 'stdout', output):
            with patch.object(MODEL, 'installation_token', return_value='fixture-token-no-network') as issue:
                MODEL.helper(args)
        self.assertEqual(output.getvalue(), 'username=x-access-token\npassword=fixture-token-no-network\n\n')
        self.assertEqual(issue.call_args.args[1], self.identities[MODELS[0]])

    def test_duplicate_scalar_authority_fields_refuse_before_auth(self):
        good = {'protocol': 'https', 'host': 'github.com', 'path': MODEL.REPOSITORY,
                'username': 'x-access-token'}
        args = Namespace(registry=str(self.registry), series_key='gpt', operation='get')
        for key, value in good.items():
            for duplicate in (value, 'fixture-conflict'):
                with self.subTest(key=key, duplicate=duplicate):
                    request = ''.join(k + '=' + v + '\n' for k, v in good.items()) + key + '=' + duplicate + '\n\n'
                    with patch.object(MODEL.sys, 'stdin', io.StringIO(request)):
                        with patch.object(MODEL, 'selected_identity') as select, patch.object(MODEL, 'installation_token') as issue:
                            with self.assertRaises(MODEL.Refusal):
                                MODEL.helper(args)
                            select.assert_not_called()
                            issue.assert_not_called()

    def test_ignored_array_values_do_not_replace_required_scalar_authority(self):
        arrays = ('capability[]=fixture\ncapability[]=\nstate[]=opaque-fixture\n'
                  'state[]=another-fixture\nwwwauth[]=fixture-challenge\n'
                  'protocol[]=https\nhost[]=github.com\npath[]=' + MODEL.REPOSITORY + '\n')
        with self.assertRaises(MODEL.Refusal):
            MODEL.credential_context(io.StringIO(arrays + '\n'))
        MODEL.credential_context(io.StringIO(arrays + 'protocol=https\nhost=github.com\npath='
                                           + MODEL.REPOSITORY + '\n\n'))

    def test_array_text_validation_precedes_extension_ignoring(self):
        for bad in ('capability[]=bad\x00value', 'capability[]=bad\rvalue', 'capability\x00[]=fixture'):
            with self.subTest(bad=repr(bad)):
                with self.assertRaises(MODEL.Refusal):
                    MODEL.credential_context(io.StringIO(bad + '\nprotocol=https\nhost=github.com\npath='
                                                       + MODEL.REPOSITORY + '\n\n'))


    def test_multiple_exact_versions_select_same_series_and_validate_exact_native_option(self):
        for model in (MODELS[0], NEXT_MODEL):
            with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
                MODEL.launch(self.args(model, ['native-fixture', '--model', model], True))
            self.assertEqual(execute.call_args.args[2]['GIT_AUTHOR_EMAIL'],
                             self.series_identities['gpt']['commitEmail'])
        with patch.object(MODEL.os, 'execvpe') as execute:
            with self.assertRaises(MODEL.Refusal):
                MODEL.launch(self.args(NEXT_MODEL, ['native-fixture', '--model', MODELS[0]], True))
            execute.assert_not_called()

    def test_all_six_series_bind_non_native_git_commands_and_fixed_public_metadata(self):
        for key in MODEL.SERIES:
            with self.subTest(series=key):
                with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
                    MODEL.launch(self.args(None, ['git', 'commit', '-m', 'Fixture commit text'], series=key))
                self.assertEqual(execute.call_args.args[2]['GIT_AUTHOR_NAME'],
                                 self.series_identities[key]['botLogin'])
                selected, directory, github = MODEL.selected_identity(self.registry, series_key=key)
                self.assertEqual(selected, key)
                self.assertEqual(github, self.series_identities[key])
                self.assertTrue((directory / 'identity.json').exists())

    def test_unmapped_exact_model_requires_explicit_series_and_exact_native_agreement(self):
        key = 'unknown/exact-model-fixture'
        with patch.object(MODEL.os, 'execvpe') as execute:
            with self.assertRaises(MODEL.Refusal):
                MODEL.launch(self.args(key, ['native-fixture', '--model', key], True))
            execute.assert_not_called()
        with patch.dict(MODEL.os.environ, {}, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
            MODEL.launch(self.args(key, ['native-fixture', '--model', key], True, 'glm'))
        self.assertEqual(execute.call_args.args[2]['GIT_COMMITTER_EMAIL'],
                         self.series_identities['glm']['commitEmail'])
        with patch.object(MODEL.os, 'execvpe') as execute:
            with self.assertRaises(MODEL.Refusal):
                MODEL.launch(self.args(key, ['native-fixture', '--model', MODELS[0]], True, 'glm'))
            execute.assert_not_called()

    def test_mapped_model_disagrees_with_explicit_series_before_launch(self):
        for model, correct in MODEL_SERIES.items():
            wrong = next(key for key in MODEL.SERIES if key != correct)
            with self.subTest(model=model, series=wrong), patch.object(MODEL.os, 'execvpe') as execute:
                with self.assertRaises(MODEL.Refusal):
                    MODEL.launch(self.args(model, ['git', 'status'], series=wrong))
                execute.assert_not_called()

    def test_native_validation_requires_exact_key_even_with_selected_series(self):
        with patch.object(MODEL.os, 'execvpe') as execute:
            with self.assertRaises(MODEL.Refusal):
                MODEL.launch(self.args(None, ['native-fixture', '--model', MODELS[0]], True, 'gpt'))
            execute.assert_not_called()

    def test_gpt_series_clears_codex_api_keys_for_another_exact_version(self):
        inherited = {'OPENAI_API_KEY': 'fixture', 'CODEX_API_KEY': 'fixture'}
        with patch.dict(MODEL.os.environ, inherited, clear=True), patch.object(MODEL.os, 'execvpe') as execute:
            MODEL.launch(self.args(NEXT_MODEL, ['subscription-fixture', '--model', NEXT_MODEL], True))
        self.assertNotIn('OPENAI_API_KEY', execute.call_args.args[2])
        self.assertNotIn('CODEX_API_KEY', execute.call_args.args[2])

    def test_invalid_mapping_and_identity_series_refuse(self):
        original = json.loads(self.registry.read_text())
        invalid = copy.deepcopy(original)
        invalid['models'][MODELS[0]] = 'unregistered-fixture-series'
        invalid_path = self.directory / 'invalid-mapping.json'
        invalid_path.write_text(json.dumps(invalid))
        invalid_path.chmod(0o600)
        with self.assertRaises(MODEL.Refusal):
            MODEL.selected_identity(invalid_path, MODELS[0], 'gpt')
        mismatch = self.directory / 'mismatched-metadata'
        mismatch.mkdir()
        identity = {'seriesKey': 'kimi', 'displaySeries': 'fixture', 'github': self.series_identities['gpt']}
        metadata = mismatch / 'identity-series.json'
        metadata.write_text(json.dumps(identity))
        metadata.chmod(0o600)
        invalid = copy.deepcopy(original)
        invalid['series']['gpt'] = str(mismatch)
        invalid_path = self.directory / 'mismatched-registry.json'
        invalid_path.write_text(json.dumps(invalid))
        invalid_path.chmod(0o600)
        with self.assertRaises(MODEL.Refusal):
            MODEL.selected_identity(invalid_path, series_key='gpt')
        with self.assertRaises(MODEL.Refusal):
            MODEL.selected_identity(self.registry, series_key='unregistered-fixture-series')

    def test_cli_parses_series_and_optional_exact_model_separately(self):
        variants = [(['--series-key', 'claude'], None, 'claude', False),
                    (['--model-key', MODELS[0], '--native-model'], MODELS[0], None, True),
                    (['--model-key', 'fixture/unknown', '--series-key', 'glm', '--native-model'],
                     'fixture/unknown', 'glm', True)]
        for options, model, series, native in variants:
            argv = ['git-series.py', 'launch', '--registry', str(self.registry), *options,
                    '--', 'native-fixture', '--model', model or 'ignored-in-non-native-mode']
            with self.subTest(options=options), patch.object(MODEL.sys, 'argv', argv):
                with patch.object(MODEL, 'launch') as launch:
                    self.assertEqual(MODEL.main(), 0)
            parsed = launch.call_args.args[0]
            self.assertEqual((parsed.model_key, parsed.series_key, parsed.native_model), (model, series, native))


if __name__ == '__main__':
    unittest.main(verbosity=2)
