import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('lfs_put_under_test', pathlib.Path(__file__).with_name('lfs_put.py'))
LFS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LFS)


class LfsAuthorizationTest(unittest.TestCase):
    def setUp(self):
        self.original_authorization = LFS.H.pop('Authorization', None)

    def tearDown(self):
        LFS.H.pop('Authorization', None)
        if self.original_authorization is not None:
            LFS.H['Authorization'] = self.original_authorization

    def test_default_headers_use_github_cli_token_without_logging_it(self):
        token = 'fixture-token-never-log'
        output = io.StringIO()
        with patch.object(LFS.subprocess, 'check_output', return_value=token) as command, \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            headers = LFS.api_headers()
        command.assert_called_once_with(['gh', 'auth', 'token'], text=True, stderr=LFS.subprocess.DEVNULL)
        self.assertEqual(headers['Authorization'], 'Basic ' + LFS.base64.b64encode(('x-access-token:' + token).encode()).decode())
        self.assertNotIn(token, output.getvalue())

    def test_importer_authorization_is_preserved_without_replacing_it(self):
        for name in ('Authorization', 'authorization'):
            with self.subTest(name=name):
                LFS.H[name] = 'Bearer importer-auth'
                with patch.object(LFS.subprocess, 'check_output', side_effect=AssertionError('unexpected credential lookup')):
                    self.assertEqual(LFS._header_value(LFS.api_headers(), 'Authorization'), 'Bearer importer-auth')
                LFS.H.pop(name, None)

    def test_put_sends_the_authenticated_batch_request(self):
        token = 'fixture-batch-token'
        response = io.BytesIO(json.dumps({'objects': [{'oid': 'unused', 'actions': {}}]}).encode())
        with tempfile.NamedTemporaryFile() as payload, \
             patch.object(LFS.subprocess, 'check_output', return_value=token), \
             patch.object(LFS.urllib.request, 'urlopen', return_value=response) as request, \
             contextlib.redirect_stderr(io.StringIO()):
            LFS.put(payload.name)
        headers = request.call_args.args[0].headers
        expected = 'Basic ' + LFS.base64.b64encode(('x-access-token:' + token).encode()).decode()
        self.assertEqual(headers['Authorization'], expected)

    def test_cross_origin_verify_does_not_receive_batch_credential(self):
        token = 'fixture-batch-token'
        batch = io.BytesIO(json.dumps({'objects': [{'oid': 'unused', 'actions': {
            'upload': {'href': 'https://upload.invalid/object', 'header': {'X-Upload-Token': 'signed-upload'}},
            'verify': {'href': 'https://verify.invalid/object', 'header': {'X-Verify': 'signed-verify'}},
        }}]}).encode())
        responses = [batch, io.BytesIO(b''), io.BytesIO(b'{}')]
        with tempfile.NamedTemporaryFile() as payload, \
             patch.object(LFS.subprocess, 'check_output', return_value=token), \
             patch.object(LFS.urllib.request, 'urlopen', side_effect=responses) as request, \
             contextlib.redirect_stderr(io.StringIO()):
            LFS.put(payload.name)
        batch_headers = request.call_args_list[0].args[0].headers
        verify_request = request.call_args_list[2].args[0]
        self.assertIn('Authorization', batch_headers)
        self.assertNotIn('Authorization', verify_request.headers)
        self.assertEqual(verify_request.headers['X-verify'], 'signed-verify')

    def test_cross_origin_verify_drops_global_importer_authorization(self):
        for name in ('Authorization', 'authorization'):
            with self.subTest(name=name):
                LFS.H[name] = 'Bearer importer-auth'
                batch = io.BytesIO(json.dumps({'objects': [{'oid': 'unused', 'actions': {
                    'upload': {'href': 'https://upload.invalid/object'},
                    'verify': {'href': 'https://verify.invalid/object', 'header': {'X-Verify': 'signed-verify'}},
                }}]}).encode())
                responses = [batch, io.BytesIO(b''), io.BytesIO(b'{}')]
                with (
                    tempfile.NamedTemporaryFile() as payload,
                    patch.object(LFS.subprocess, 'check_output', side_effect=AssertionError('unexpected credential lookup')),
                    patch.object(LFS.urllib.request, 'urlopen', side_effect=responses) as request,
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    LFS.put(payload.name)
                verify_request = request.call_args_list[2].args[0]
                self.assertNotIn('Authorization', verify_request.headers)
                self.assertEqual(verify_request.headers['X-verify'], 'signed-verify')
                LFS.H.pop(name, None)

    def test_same_origin_verify_reuses_importer_authorization(self):
        LFS.H['Authorization'] = 'Bearer importer-auth'
        batch = io.BytesIO(json.dumps({'objects': [{'oid': 'unused', 'actions': {
            'upload': {'href': 'https://upload.invalid/object'},
            'verify': {'href': 'https://github.com/verify/object', 'header': {'X-Verify': 'signed-verify'}},
        }}]}).encode())
        responses = [batch, io.BytesIO(b''), io.BytesIO(b'{}')]
        with tempfile.NamedTemporaryFile() as payload, \
             patch.object(LFS.subprocess, 'check_output', side_effect=AssertionError('unexpected credential lookup')), \
             patch.object(LFS.urllib.request, 'urlopen', side_effect=responses) as request, \
             contextlib.redirect_stderr(io.StringIO()):
            LFS.put(payload.name)
        verify_headers = request.call_args_list[2].args[0].headers
        self.assertEqual(verify_headers['Authorization'], 'Bearer importer-auth')
        self.assertEqual(verify_headers['X-verify'], 'signed-verify')

    def test_signed_verify_authorization_overrides_batch_credential(self):
        token = 'fixture-batch-token'
        batch = io.BytesIO(json.dumps({'objects': [{'oid': 'unused', 'actions': {
            'upload': {'href': 'https://upload.invalid/object'},
            'verify': {'href': 'https://verify.invalid/object', 'header': {'authorization': 'Bearer signed-verify'}},
        }}]}).encode())
        responses = [batch, io.BytesIO(b''), io.BytesIO(b'{}')]
        with tempfile.NamedTemporaryFile() as payload, \
             patch.object(LFS.subprocess, 'check_output', return_value=token), \
             patch.object(LFS.urllib.request, 'urlopen', side_effect=responses) as request, \
             contextlib.redirect_stderr(io.StringIO()):
            LFS.put(payload.name)
        verify_headers = request.call_args_list[2].args[0].headers
        self.assertEqual(verify_headers['Authorization'], 'Bearer signed-verify')
        self.assertNotIn(token, str(verify_headers))


if __name__ == '__main__':
    unittest.main()
