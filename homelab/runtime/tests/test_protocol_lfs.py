import base64
import hashlib
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'protocol'
sys.path.insert(0, str(PROTOCOL))
import lfs_archive

SPEC = importlib.util.spec_from_file_location('pipeline_farm_tested', PROTOCOL / 'pipeline-farm.py')
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


class QueueRepo:
    def __init__(self, job):
        self.job = job
    def head(self):
        return 'queue-rev'
    def read(self, revision, path):
        if path != pipeline.jobpath(self.job['id']):
            raise RuntimeError('unexpected queue path')
        return pipeline.dump(self.job)


class FakeArchive:
    latest = None
    def __init__(self, url, name):
        self.files = {}
        self.revision = 'parent'
        FakeArchive.latest = self
    def head(self):
        return self.revision
    def read(self, revision, path):
        if path not in self.files:
            raise RuntimeError('archive path is missing')
        return self.files[path]
    def commit(self, parent, files, message):
        for path, source in files.items():
            self.files[path] = source if isinstance(source, bytes) else pathlib.Path(source).read_bytes()
        self.revision = 'archive-commit'
        return True


class FailedArchive(FakeArchive):
    def commit(self, parent, files, message):
        return False


class ProtocolDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.job = {'id': 'job-1', 'state': 'claimed',
                    'claim': {'by': 'worker'}, 'delivery': None}
        self.drop_patch = mock.patch.object(pipeline, 'drop', lambda repo: None)
        self.drop_patch.start()
    def tearDown(self):
        self.drop_patch.stop()
    def queue(self):
        return QueueRepo(self.job)
    def use_archive(self, cls=FakeArchive):
        instance = cls('https://github.com/example/archive.git', 'arch')
        pipeline.Repo = lambda url, name: instance
        return instance
    def apply_change(self):
        def change(pipe, identifier, callback, message):
            error = callback(self.job)
            if error:
                raise AssertionError(error)
        return mock.patch.object(pipeline, 'change', change)

    def test_delivery_commits_pointer_and_attributes_before_queue_completion(self):
        archive = self.use_archive()
        with tempfile.TemporaryDirectory() as directory:
            video = pathlib.Path(directory) / 'share.mp4'
            video.write_bytes(b'video-payload')
            oid = pipeline.sha256(str(video))
            with mock.patch.object(lfs_archive, 'upload_file') as upload, \
                 mock.patch.object(lfs_archive, 'verify_remote') as readback, \
                 self.apply_change():
                result = pipeline.deliver_job(self.queue(), 'job-1', 'worker', [str(video)], 'test')
            upload.assert_called_once_with(str(video), pipeline.ARCH, oid, video.stat().st_size)
            readback.assert_called_once_with(pipeline.ARCH, oid, video.stat().st_size)
            pointer_data = archive.files['farm/job-1/share.mp4']
            self.assertEqual(lfs_archive.parse_pointer(pointer_data), (oid, video.stat().st_size))
            self.assertIn(b'farm/**/*.mp4 filter=lfs', archive.files['.gitattributes'])
            self.assertIn(b'farm/**/*.[mM][pP]4 filter=lfs', archive.files['.gitattributes'])
            manifest = json.loads(archive.files['farm/job-1/MANIFEST.json'])
            self.assertEqual(manifest['files'][0]['storage'], 'lfs')
            self.assertEqual(self.job['state'], 'done')
            self.assertEqual(self.job['delivery']['archive_commit'], 'archive-commit')
            self.assertTrue(result['lfs_readback'][0]['verified'])

    def test_remote_readback_failure_keeps_queue_claimed(self):
        self.use_archive()
        with tempfile.TemporaryDirectory() as directory:
            video = pathlib.Path(directory) / 'share.mp4'
            video.write_bytes(b'video-payload')
            with mock.patch.object(lfs_archive, 'upload_file'), \
                 mock.patch.object(lfs_archive, 'verify_remote', side_effect=RuntimeError('readback failed')), \
                 self.apply_change():
                with self.assertRaisesRegex(RuntimeError, 'readback failed'):
                    pipeline.deliver_job(self.queue(), 'job-1', 'worker', [str(video)], 'test')
            self.assertEqual(self.job['state'], 'claimed')
            self.assertIsNone(self.job['delivery'])

    def test_archive_push_failure_keeps_queue_claimed(self):
        self.use_archive(FailedArchive)
        with tempfile.TemporaryDirectory() as directory:
            receipt = pathlib.Path(directory) / 'receipt.json'
            receipt.write_text('{"ok": true}\n')
            with self.apply_change(), mock.patch.object(pipeline.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'archive main kept moving; try again'):
                    pipeline.deliver_job(self.queue(), 'job-1', 'worker', [str(receipt)], 'test')
            self.assertEqual(self.job['state'], 'claimed')

    def test_delivery_rejects_manifest_name_and_generated_part_collisions(self):
        self.use_archive()
        with tempfile.TemporaryDirectory() as directory:
            manifest = pathlib.Path(directory) / 'MANIFEST.json'
            manifest.write_bytes(b'caller data')
            with self.assertRaisesRegex(RuntimeError, 'reserved archive manifest name'):
                pipeline.deliver_job(self.queue(), 'job-1', 'worker', [str(manifest)], 'test')
            self.assertEqual(self.job['state'], 'claimed')
            large = pathlib.Path(directory) / 'data.bin'
            collision = pathlib.Path(directory) / 'data.bin.part00'
            large.write_bytes(b'large')
            collision.write_bytes(b'x')
            with mock.patch.object(pipeline, 'PART', 4):
                with self.assertRaisesRegex(RuntimeError, 'generated archive part name'):
                    pipeline.deliver_job(self.queue(), 'job-1', 'worker', [str(large), str(collision)], 'test')
            self.assertEqual(self.job['state'], 'claimed')


    def test_fetch_reads_lfs_pointer_and_legacy_chunks(self):
        archive = self.use_archive()
        video_bytes = b'video'
        oid = hashlib.sha256(video_bytes).hexdigest()
        legacy = b'{\n  }'
        archive.files['farm/job-1/MANIFEST.json'] = json.dumps({'files': [
            {'name': 'video.mp4', 'size': 5, 'sha256': oid, 'storage': 'lfs',
             'lfs_oid': oid, 'parts': []},
            {'name': 'receipt.json', 'size': len(legacy),
             'sha256': pipeline.hashlib.sha256(legacy).hexdigest(),
             'parts': ['receipt.json.part00']}
        ]}).encode()
        archive.files['farm/job-1/video.mp4'] = lfs_archive.pointer(oid, len(video_bytes))
        archive.files['farm/job-1/receipt.json.part00'] = legacy
        def download(url, object_id, size, destination, expected):
            pathlib.Path(destination).write_bytes(video_bytes)
            self.assertEqual((object_id, size, expected), (oid, len(video_bytes), oid))
        with mock.patch.object(lfs_archive, 'download_verified', download), \
             tempfile.TemporaryDirectory() as directory:
            pipeline.fetch_job('job-1', directory, [])
            self.assertEqual((pathlib.Path(directory) / 'video.mp4').read_bytes(), b'video')
            self.assertEqual((pathlib.Path(directory) / 'receipt.json').read_bytes(), legacy)

    def test_bad_lfs_readback_does_not_install_partial_file(self):
        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, size=-1):
                if not hasattr(self, 'done'):
                    self.done = True
                    return b'wrong'
                return b''
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'video.mp4'
            target.write_bytes(b'keep-existing-destination')
            action = {'href': 'https://example.invalid/media', 'header': {}}
            with mock.patch.object(lfs_archive, '_open_no_redirect', return_value=Response()):
                with self.assertRaisesRegex(RuntimeError, 'validation'):
                    lfs_archive._stream_download(action, hashlib.sha256(b'right').hexdigest(), 5, str(target))
            self.assertEqual(target.read_bytes(), b'keep-existing-destination')

    def test_pointer_matches_canonical_git_lfs_bytes(self):
        oid = hashlib.sha256(b'video').hexdigest()
        expected = ('version https://git-lfs.github.com/spec/v1\n'
                    'oid sha256:' + oid + '\nsize 5\n').encode('ascii')
        self.assertEqual(lfs_archive.pointer(oid, 5), expected)
        self.assertEqual(lfs_archive.parse_pointer(expected), (oid, 5))
        with self.assertRaisesRegex(RuntimeError, 'invalid Git LFS pointer'):
            lfs_archive.parse_pointer(expected.replace(b'version ', b'', 1))

    def test_credentials_are_sent_in_lfs_batch_header(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1): return b'{"objects": []}'
        completed = mock.Mock(returncode=0, stdout=b'username=worker\npassword=secret-value\n')
        captured = {}
        def open_request(request, timeout):
            captured['request'] = request
            captured['timeout'] = timeout
            return Response()
        with mock.patch.object(lfs_archive.subprocess, 'run', return_value=completed) as run, \
             mock.patch.object(lfs_archive, '_open_no_redirect', side_effect=open_request):
            href, headers = lfs_archive._auth('owner/repo', 'download', 'https://github.com/owner/repo.git')
            lfs_archive._json_request(href + '/objects/batch', headers, {'operation': 'download'})
        run.assert_called_once()
        self.assertIn(b'path=owner/repo.git', run.call_args.kwargs['input'])
        self.assertEqual(run.call_args.kwargs['env']['GIT_TERMINAL_PROMPT'], '0')
        request = captured['request']
        expected = 'Basic ' + base64.b64encode(b'worker:secret-value').decode('ascii')
        self.assertEqual(request.get_header('Authorization'), expected)
        self.assertEqual(request.get_header('Content-length'), str(len(request.data)))
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(captured['timeout'], 1800)

    def test_upload_transports_action_headers_and_exact_content_length(self):
        class Response:
            status = 200
        class Connection:
            def __init__(self): self.headers = []; self.body = bytearray(); self.closed = False
            def putrequest(self, method, target): self.method, self.target = method, target
            def putheader(self, name, value): self.headers.append((name, value))
            def endheaders(self): pass
            def send(self, data): self.body.extend(data)
            def getresponse(self): return Response()
            def close(self): self.closed = True
        payload = b'upload payload'
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'clip.mp4'
            path.write_bytes(payload)
            connection = Connection()
            with mock.patch.object(lfs_archive.http.client, 'HTTPSConnection', return_value=connection):
                lfs_archive._put_file({'href': 'https://upload.example.invalid/object?sig=hidden',
                                       'header': {'X-Upload-Token': 'signed', 'content-length': str(len(payload))}},
                                      str(path), len(payload))
            self.assertEqual(connection.method, 'PUT')
            self.assertEqual(connection.body, payload)
            self.assertIn(('X-Upload-Token', 'signed'), connection.headers)
            self.assertEqual([value for name, value in connection.headers if name.lower() == 'content-length'],
                             [str(len(payload))])
            self.assertTrue(connection.closed)
            with mock.patch.object(lfs_archive.http.client, 'HTTPSConnection') as connect:
                for headers in ({'Content-Length': '1'},
                                {'Content-Length': str(len(payload)), 'content-length': str(len(payload))},
                                {'Transfer-Encoding': 'chunked'},
                                {'X-Bad': 'value\nInjected: true'}):
                    with self.subTest(headers=list(headers)):
                        with self.assertRaises(RuntimeError):
                            lfs_archive._put_file({'href': 'https://upload.example.invalid/object',
                                                   'header': headers}, str(path), len(payload))
                connect.assert_not_called()

    def test_redirect_handler_refuses_cross_origin_redirects(self):
        handler = lfs_archive._NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, 'Found', {}, 'https://evil.invalid/'))

    def test_action_urls_and_header_framing_are_validated(self):
        for url in ('http://example.invalid/object', 'https://user@example.invalid/object',
                    'https://example.invalid/object#fragment'):
            with self.subTest(url_kind=url.split(':', 1)[0]):
                with self.assertRaisesRegex(RuntimeError, 'valid HTTPS URL'):
                    lfs_archive._https_url(url, 'Git LFS test endpoint')
        with self.assertRaisesRegex(RuntimeError, 'valid HTTPS URL') as error:
            lfs_archive._https_url('http://cdn.invalid/object?signature=private-value', 'Git LFS endpoint')
        self.assertNotIn('private-value', str(error.exception))
        valid = lfs_archive._validated_headers({'X-Token': 'signed-value', 'content-length': '5'}, 5)
        self.assertEqual(valid['X-Token'], 'signed-value')
        for headers in (
                {'Content-Length': '5', 'content-length': '5'},
                {'CONTENT-length': '4'},
                {'Transfer-Encoding': 'chunked'},
                {'X-Token': 'ok\r\nAuthorization: bad'},
                {'Bad Name': 'value'}):
            with self.subTest(header_names=list(headers)):
                with self.assertRaises(RuntimeError):
                    lfs_archive._validated_headers(headers, expected_size=5, add_content_length=True)
        self.assertEqual(lfs_archive._validated_headers({}, 5, True)['Content-Length'], '5')

    def test_download_verifies_hash_size_and_preserves_existing_destination(self):
        class Headers:
            def __init__(self, values=None): self.values = values or {}
            def get_all(self, name):
                return self.values.get(name.lower())
            def get(self, name):
                values = self.get_all(name)
                return values[0] if values else None
        class Response:
            status = 200
            def __init__(self, body, headers=None): self.body = body; self.headers = Headers(headers)
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1):
                if not self.body: return b''
                block, self.body = self.body[:size], self.body[size:]
                return block
        action = {'href': 'https://cdn.example.invalid/signed?secret=not-logged', 'header': {'X-Auth': 'signed'}}
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'video.mp4'
            target.write_bytes(b'previous-valid-file')
            payload = b'actual video bytes'
            oid = hashlib.sha256(payload).hexdigest()
            with mock.patch.object(lfs_archive, '_open_no_redirect', return_value=Response(payload, {'content-length': [str(len(payload))]})) as opener:
                receipt = lfs_archive._stream_download(action, oid, len(payload), str(target))
                request = opener.call_args.args[0]
                self.assertEqual(request.get_header('X-auth'), 'signed')
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(receipt, {'oid': oid, 'size': len(payload), 'sha256': oid})
            with mock.patch.object(lfs_archive, '_open_no_redirect',
                                   return_value=Response(payload, {'transfer-encoding': ['chunked']})):
                receipt = lfs_archive._stream_download(action, oid, len(payload), str(target))
            self.assertEqual(receipt['sha256'], oid)
            self.assertEqual(target.read_bytes(), payload)
            for body, expected_size, framing in (
                    (payload, len(payload), {'content-length': [str(len(payload)), str(len(payload))]}),
                    (payload[:-1], len(payload), {}),
                    (payload, len(payload), {'content-length': [str(len(payload) - 1)]})):
                target.write_bytes(b'previous-valid-file')
                with mock.patch.object(lfs_archive, '_open_no_redirect', return_value=Response(body, framing)):
                    with self.assertRaises(RuntimeError):
                        lfs_archive._stream_download(action, oid, expected_size, str(target))
                self.assertEqual(target.read_bytes(), b'previous-valid-file')

    def test_streaming_bounds_reads_for_payload_over_95mb(self):
        total = 95_000_001
        class Source:
            def __init__(self):
                self.remaining = total
                self.max_request = 0
            def read(self, count=-1):
                self.max_request = max(self.max_request, count)
                if self.remaining <= 0:
                    return b''
                size = min(count, self.remaining)
                self.remaining -= size
                return b'x' * size
        source = Source()
        written = [0]
        def writer(block):
            written[0] += len(block)
        self.assertEqual(lfs_archive.stream_file(source, writer, total), total)
        self.assertEqual(written[0], total)
        self.assertLessEqual(source.max_request, 1 << 20)

    def test_upload_verify_action_accepts_an_empty_success_response(self):
        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
        payload = b'video'
        oid = pipeline.hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / 'video.mp4'
            source.write_bytes(payload)
            action = {'href': 'https://example.invalid/verify', 'header': {}}
            response = Response()
            with mock.patch.object(lfs_archive, '_batch',
                                   return_value={'actions': {'verify': action}}), \
                 mock.patch.object(lfs_archive, '_open_no_redirect',
                                   return_value=response):
                lfs_archive.upload_file(str(source), pipeline.ARCH, oid, len(payload))

    def test_missing_remote_lfs_action_fails_closed(self):
        with mock.patch.object(lfs_archive, '_batch', return_value={'actions': {}}):
            with self.assertRaisesRegex(RuntimeError, 'omitted'):
                lfs_archive.verify_remote(pipeline.ARCH, 'a' * 64, 5)

    def test_archive_url_variants_resolve_to_same_repository(self):
        self.assertEqual(lfs_archive.repository_slug('https://github.com/example/archive.git'),
                         'example/archive')
        self.assertEqual(lfs_archive.repository_slug('git@github.com:example/archive.git'),
                         'example/archive')


if __name__ == '__main__':
    unittest.main()
