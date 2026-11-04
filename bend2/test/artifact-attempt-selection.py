#!/usr/bin/env python3
"""Artifact lookup across workflow rerun attempts (#1263).

A rerun of failed jobs gets a new attempt number, while the artifacts of jobs
that already succeeded keep the suffix of the attempt that uploaded them. These
tests run `select-artifact-attempt.py` and the workflow steps that call it
against a local stand-in for the Actions artifact listing. No workflow is run
and no compiler is launched.
"""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

import yaml

ROOT = Path(__file__).resolve().parents[2]
SELECTOR = ROOT / '.github/scripts/select-artifact-attempt.py'
WORKFLOW = ROOT / '.github/workflows/bend2-native.yml'
SHA = 'a' * 40
OTHER_SHA = 'b' * 40


class ArtifactListing(http.server.BaseHTTPRequestHandler):
    artifacts = []
    requests = []

    def do_GET(self):
        type(self).requests.append((self.path, self.headers.get('Authorization')))
        page = int(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('page', ['1'])[0])
        batch = type(self).artifacts[(page - 1) * 100:page * 100]
        body = json.dumps({'total_count': len(type(self).artifacts), 'artifacts': batch}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def artifact(name, expired=False):
    return {'name': name, 'expired': expired}


class SelectorRules(unittest.TestCase):
    def run_selector(self, artifacts, current, prefix='baton2-generated-c-' + SHA + '-'):
        return subprocess.run([sys.executable, str(SELECTOR), '--prefix', prefix, '--current-attempt', str(current),
                               '--artifacts-file', '-'], input='\n'.join(json.dumps(a) for a in artifacts),
                              capture_output=True, text=True)

    def test_producer_kept_from_attempt_one_is_selected_in_attempt_two(self):
        result = self.run_selector([artifact('baton2-generated-c-%s-1' % SHA), artifact('baton2-linux-producer-%s-1' % SHA)], 2)
        self.assertEqual((result.returncode, result.stdout.strip()), (0, '1'), result.stderr)

    def test_current_attempt_wins_when_the_producer_ran_again(self):
        result = self.run_selector([artifact('baton2-generated-c-%s-1' % SHA), artifact('baton2-generated-c-%s-2' % SHA)], 2)
        self.assertEqual(result.stdout.strip(), '2')

    def test_later_attempts_than_the_current_one_are_ignored(self):
        result = self.run_selector([artifact('baton2-generated-c-%s-1' % SHA), artifact('baton2-generated-c-%s-3' % SHA)], 2)
        self.assertEqual(result.stdout.strip(), '1')

    def test_expired_artifacts_are_ignored(self):
        result = self.run_selector([artifact('baton2-generated-c-%s-1' % SHA), artifact('baton2-generated-c-%s-2' % SHA, True)], 2)
        self.assertEqual(result.stdout.strip(), '1')

    def test_other_sources_and_other_names_are_not_matched(self):
        result = self.run_selector([artifact('baton2-generated-c-%s-1' % OTHER_SHA), artifact('baton2-generated-c-%s-1-extra' % SHA),
                                    artifact('baton2-generated-c-%s-01' % SHA), artifact('baton2-generated-c-%s-x' % SHA)], 2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No unexpired artifact', result.stderr)

    def test_missing_producer_is_an_error_not_a_guess(self):
        self.assertNotEqual(self.run_selector([], 1).returncode, 0)


class ListingFetch(unittest.TestCase):
    def setUp(self):
        ArtifactListing.requests = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ArtifactListing)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.api = 'http://127.0.0.1:%d' % self.server.server_address[1]

    def select(self, artifacts, current, **extra):
        ArtifactListing.artifacts = artifacts
        return subprocess.run([sys.executable, str(SELECTOR), '--prefix', 'baton2-generated-c-' + SHA + '-',
                               '--current-attempt', str(current), '--repository', 'owner/repo', '--run-id', '77',
                               '--api-url', self.api], capture_output=True, text=True,
                              env=dict(os.environ, GITHUB_TOKEN='secret-token'))

    def test_listing_is_read_for_the_run_with_the_token(self):
        result = self.select([artifact('baton2-generated-c-%s-1' % SHA)], 2)
        self.assertEqual(result.stdout.strip(), '1', result.stderr)
        path, authorization = ArtifactListing.requests[0]
        self.assertTrue(path.startswith('/repos/owner/repo/actions/runs/77/artifacts?'))
        self.assertEqual(authorization, 'Bearer secret-token')

    def test_producer_on_a_later_page_is_found(self):
        filler = [artifact('baton2-linux-target-%s-%d' % (SHA, number)) for number in range(1, 101)]
        result = self.select(filler + [artifact('baton2-generated-c-%s-1' % SHA)], 2)
        self.assertEqual(result.stdout.strip(), '1', result.stderr)
        self.assertEqual(len(ArtifactListing.requests), 2)


class WorkflowSteps(unittest.TestCase):
    """Run the workflow's own step text, so the selection a rerun uses is the one tested."""

    @classmethod
    def setUpClass(cls):
        cls.jobs = yaml.safe_load(WORKFLOW.read_text())['jobs']

    def step(self, job, name):
        return next(step for step in self.jobs[job]['steps'] if step.get('name') == name)

    def setUp(self):
        ArtifactListing.requests = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ArtifactListing)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def run_step(self, step, environment, cwd=ROOT):
        github_env, github_output = Path(self.directory.name, 'env'), Path(self.directory.name, 'output')
        github_env.write_text('')
        github_output.write_text('')
        base = dict(os.environ, GITHUB_ENV=str(github_env), GITHUB_OUTPUT=str(github_output),
                    GITHUB_API_URL='http://127.0.0.1:%d' % self.server.server_address[1], GITHUB_REPOSITORY='owner/repo',
                    GITHUB_RUN_ID='77', GITHUB_TOKEN='token', BATON2_SOURCE_SHA=SHA)
        base.update(environment)
        result = subprocess.run(['bash', '-c', step['run']], cwd=cwd, env=base, capture_output=True, text=True)
        outputs = dict(line.split('=', 1) for line in github_output.read_text().splitlines())
        exported = dict(line.split('=', 1) for line in github_env.read_text().splitlines())
        return result, outputs, exported

    def test_darwin_rerun_in_attempt_two_uses_the_producer_of_attempt_one(self):
        ArtifactListing.artifacts = [artifact('baton2-generated-c-%s-1' % SHA), artifact('baton2-linux-producer-%s-1' % SHA)]
        step = self.step('darwin-arm64', 'Select the attempt of the generated C producer')
        result, outputs, exported = self.run_step(step, {'BATON2_NAMED_PRODUCER_ATTEMPT': '', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs['attempt'], '1')
        self.assertEqual(exported['BATON2_GENERATED_C_RUN_ATTEMPT'], '1')

    def test_darwin_first_attempt_uses_its_own_producer(self):
        ArtifactListing.artifacts = [artifact('baton2-generated-c-%s-1' % SHA)]
        step = self.step('darwin-arm64', 'Select the attempt of the generated C producer')
        result, outputs, _ = self.run_step(step, {'BATON2_NAMED_PRODUCER_ATTEMPT': '', 'GITHUB_RUN_ATTEMPT': '1'})
        self.assertEqual((result.returncode, outputs['attempt']), (0, '1'), result.stderr)

    def test_a_named_producer_attempt_is_used_without_a_listing(self):
        step = self.step('darwin-arm64', 'Select the attempt of the generated C producer')
        result, outputs, _ = self.run_step(step, {'BATON2_NAMED_PRODUCER_ATTEMPT': '5', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertEqual((result.returncode, outputs['attempt']), (0, '5'), result.stderr)
        self.assertEqual(ArtifactListing.requests, [])

    def test_darwin_job_without_any_producer_artifact_fails(self):
        ArtifactListing.artifacts = []
        step = self.step('darwin-arm64', 'Select the attempt of the generated C producer')
        result, _, _ = self.run_step(step, {'BATON2_NAMED_PRODUCER_ATTEMPT': '', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertNotEqual(result.returncode, 0)

    def test_checkout_without_the_selector_keeps_the_current_attempt(self):
        # A pull request branch cut before the selector existed.
        step = self.step('darwin-arm64', 'Select the attempt of the generated C producer')
        result, outputs, _ = self.run_step(step, {'BATON2_NAMED_PRODUCER_ATTEMPT': '', 'GITHUB_RUN_ATTEMPT': '2'},
                                           cwd=Path(self.directory.name))
        self.assertEqual((result.returncode, outputs['attempt']), (0, '2'), result.stderr)

    def test_install_rerun_in_attempt_two_uses_the_package_of_attempt_one(self):
        ArtifactListing.artifacts = [artifact('baton2-development-darwin-arm64-%s-1' % SHA)]
        step = self.step('darwin-arm64-install', 'Select the attempt of the Darwin package')
        result, outputs, _ = self.run_step(step, {'BATON2_PACKAGE_LABEL': 'development', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertEqual((result.returncode, outputs['attempt']), (0, '1'), result.stderr)

    def test_install_selects_the_release_package_by_version_label(self):
        ArtifactListing.artifacts = [artifact('baton2-development-darwin-arm64-%s-2' % SHA),
                                     artifact('baton2-2.0.0-x-darwin-arm64-%s-1' % SHA)]
        step = self.step('darwin-arm64-install', 'Select the attempt of the Darwin package')
        result, outputs, _ = self.run_step(step, {'BATON2_PACKAGE_LABEL': '2.0.0-x', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertEqual((result.returncode, outputs['attempt']), (0, '1'), result.stderr)

    def test_downloads_use_the_selected_attempt_not_the_current_one(self):
        generated = self.step('darwin-arm64', 'Download selected exact-source Main C and producer checks')['with']['name']
        package = self.step('darwin-arm64-install', 'Download Darwin package and producer evidence')['with']['name']
        self.assertIn('steps.producer-attempt.outputs.attempt', generated)
        self.assertIn('steps.package-attempt.outputs.attempt', package)
        for name in (generated, package):
            self.assertNotIn('github.run_attempt', name)

    def test_uploads_still_carry_the_attempt_that_made_them(self):
        for job, step_name in (('linux-candidate', 'Retain generated C and producer results'),
                               ('darwin-arm64', 'Retain native artifact and validation evidence')):
            self.assertIn('github.run_attempt', self.step(job, step_name)['with']['name'])


if __name__ == '__main__':
    unittest.main()
