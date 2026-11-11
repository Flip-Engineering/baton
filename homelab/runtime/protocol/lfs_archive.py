"""Streaming Git LFS transport for protocol farm media."""

import base64
import hashlib
import http.client
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

CHUNK_SIZE = 1 << 20
METADATA_LIMIT = 1 << 20
LFS_VERSION = 'version https://git-lfs.github.com/spec/v1'
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_|~0-9A-Za-z-]+$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _open_no_redirect(request, timeout):
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout)


def _https_url(value, label):
    if not isinstance(value, str) or not value or any(ord(char) <= 32 or ord(char) == 127 for char in value):
        raise RuntimeError('%s must be a valid HTTPS URL' % label)
    try:
        parsed = urllib.parse.urlsplit(value)
        parsed.port
    except ValueError:
        raise RuntimeError('%s must be a valid HTTPS URL' % label)
    if (parsed.scheme.lower() != 'https' or not parsed.hostname or parsed.username is not None or
            parsed.password is not None or parsed.fragment):
        raise RuntimeError('%s must be a valid HTTPS URL' % label)
    return parsed


def _validated_headers(headers, expected_size=None, add_content_length=False):
    if headers is None:
        headers = {}
    if not isinstance(headers, dict):
        raise RuntimeError('Git LFS action headers are invalid')
    checked = {}
    content_lengths = []
    for name, value in headers.items():
        if not isinstance(name, str) or not _HEADER_NAME.fullmatch(name):
            raise RuntimeError('Git LFS action header name is invalid')
        if (not isinstance(value, str) or
                any(ord(char) < 32 or ord(char) > 126 for char in value)):
            raise RuntimeError('Git LFS action header value is invalid')
        lowered = name.lower()
        if lowered == 'transfer-encoding':
            raise RuntimeError('Git LFS action transfer encoding is not allowed')
        if lowered == 'content-length':
            content_lengths.append(value)
        checked[name] = value
    if len(content_lengths) > 1:
        raise RuntimeError('Git LFS action has duplicate Content-Length headers')
    if content_lengths:
        text = content_lengths[0]
        if not text.isdigit() or (expected_size is not None and int(text) != expected_size):
            raise RuntimeError('Git LFS action Content-Length does not match the object size')
    elif add_content_length:
        if expected_size is None:
            raise RuntimeError('Git LFS upload size is required')
        checked['Content-Length'] = str(expected_size)
    return checked


def _validate_response_framing(headers, expected_size):
    get_all = getattr(headers, 'get_all', None)
    lengths = get_all('Content-Length') if get_all else None
    if lengths is None:
        value = headers.get('Content-Length') if headers else None
        lengths = [value] if value is not None else []
    if len(lengths) > 1:
        raise RuntimeError('Git LFS response has duplicate Content-Length headers')
    if lengths and (not str(lengths[0]).strip().isdigit() or int(str(lengths[0]).strip()) != expected_size):
        raise RuntimeError('Git LFS response Content-Length does not match the object size')


def pointer(oid, size):
    if len(oid) != 64 or any(ch not in '0123456789abcdef' for ch in oid):
        raise ValueError('invalid Git LFS SHA-256 object id')
    if not isinstance(size, int) or size < 0:
        raise ValueError('invalid Git LFS object size')
    return (LFS_VERSION + '\n' + 'oid sha256:' + oid + '\n' + 'size ' + str(size) + '\n').encode('ascii')


def parse_pointer(data):
    if len(data) > 1024:
        raise RuntimeError('Git LFS pointer exceeds the allowed size')
    try:
        lines = data.decode('ascii').splitlines()
    except UnicodeDecodeError:
        raise RuntimeError('archive entry is not a Git LFS pointer')
    if (len(lines) != 3 or lines[0] != LFS_VERSION or
            not lines[1].startswith('oid sha256:') or not lines[2].startswith('size ')):
        raise RuntimeError('invalid Git LFS pointer')
    oid, size = lines[1][11:], lines[2][5:]
    if len(oid) != 64 or any(ch not in '0123456789abcdef' for ch in oid) or not size.isdigit():
        raise RuntimeError('invalid Git LFS pointer fields')
    return oid, int(size)


def repository_slug(archive_url):
    if archive_url.startswith('git@github.com:'):
        path = archive_url[len('git@github.com:'):]
    else:
        parsed = urllib.parse.urlparse(archive_url)
        if parsed.hostname not in ('github.com', 'www.github.com') or parsed.scheme not in ('https', 'ssh'):
            raise RuntimeError('ARCH_URL must identify a GitHub owner and repository')
        path = parsed.path.strip('/')
    if path.endswith('.git'):
        path = path[:-4]
    if len(path.split('/')) != 2 or any(not part for part in path.split('/')):
        raise RuntimeError('ARCH_URL must identify a GitHub owner and repository')
    return path


def _auth(repo, operation, archive_url):
    if archive_url.startswith('git@github.com:') or urllib.parse.urlparse(archive_url).scheme == 'ssh':
        try:
            env = os.environ.copy()
            env['GIT_TERMINAL_PROMPT'] = '0'
            result = subprocess.run(
                ['ssh', '-o', 'BatchMode=yes', 'git@github.com', 'git-lfs-authenticate', repo, operation],
                capture_output=True, timeout=20, check=False, env=env)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Git LFS SSH authentication timed out')
        if result.returncode:
            raise RuntimeError('Git LFS SSH authentication failed with exit code %d' % result.returncode)
        try:
            data = json.loads(result.stdout)
            href, headers = data['href'], data.get('header', {})
        except (ValueError, KeyError, TypeError):
            raise RuntimeError('Git LFS SSH authentication returned invalid metadata')
        if not isinstance(headers, dict):
            raise RuntimeError('Git LFS SSH authentication returned invalid headers')
        _https_url(href, 'Git LFS authentication endpoint')
        return href.rstrip('/'), _validated_headers(headers)

    request = ('protocol=https\nhost=github.com\npath=' + repo + '.git\n\n').encode('utf-8')
    try:
        env = os.environ.copy()
        env['GIT_TERMINAL_PROMPT'] = '0'
        result = subprocess.run(['git', 'credential', 'fill'], input=request,
                                capture_output=True, timeout=20, check=False, env=env)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Git credential helper timed out')
    if result.returncode:
        raise RuntimeError('Git credential helper could not provide archive credentials')
    values = {}
    try:
        for line in result.stdout.decode('utf-8').splitlines():
            key, value = line.split('=', 1)
            values[key] = value
        username, password = values['username'], values['password']
    except (UnicodeDecodeError, ValueError, KeyError):
        raise RuntimeError('Git credential helper returned invalid archive credentials')
    token = base64.b64encode((username + ':' + password).encode('utf-8')).decode('ascii')
    href = 'https://github.com/' + repo + '.git/info/lfs'
    return href, {'Authorization': 'Basic ' + token}


def _json_request(url, headers, payload):
    _https_url(url, 'Git LFS metadata endpoint')
    body = json.dumps(payload).encode('utf-8')
    values = _validated_headers(headers, expected_size=len(body), add_content_length=True)
    values.update({'Accept': 'application/vnd.git-lfs+json',
                   'Content-Type': 'application/vnd.git-lfs+json'})
    request = urllib.request.Request(url, data=body, headers=values, method='POST')
    try:
        with _open_no_redirect(request, timeout=1800) as response:
            data = response.read(METADATA_LIMIT + 1)
        if len(data) > METADATA_LIMIT:
            raise RuntimeError('Git LFS metadata response exceeds the size limit')
        return json.loads(data.decode('utf-8'))
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ValueError, UnicodeDecodeError):
        raise RuntimeError('Git LFS metadata request failed')


def _batch(archive_url, operation, oid, size):
    repo = repository_slug(archive_url)
    href, headers = _auth(repo, operation, archive_url)
    payload = {'operation': operation, 'transfers': ['basic'],
               'ref': {'name': 'refs/heads/main'},
               'objects': [{'oid': oid, 'size': size}]}
    result = _json_request(href + '/objects/batch', headers, payload)
    objects = result.get('objects')
    if not isinstance(objects, list) or len(objects) != 1:
        raise RuntimeError('Git LFS batch response omitted the requested object')
    item = objects[0]
    if item.get('oid') != oid or item.get('size') != size or item.get('error'):
        raise RuntimeError('Git LFS service rejected the requested object')
    return item


def _post_verify(url, headers, payload):
    _https_url(url, 'Git LFS verification endpoint')
    body = json.dumps(payload).encode('utf-8')
    values = _validated_headers(headers, expected_size=len(body), add_content_length=True)
    values.update({'Accept': 'application/vnd.git-lfs+json',
                   'Content-Type': 'application/vnd.git-lfs+json'})
    request = urllib.request.Request(url, data=body, headers=values, method='POST')
    try:
        with _open_no_redirect(request, timeout=1800) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError('Git LFS verification returned HTTP %d' % response.status)
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('Git LFS object verification failed')


def stream_file(source, writer, size, chunk_size=CHUNK_SIZE):
    sent = 0
    while sent < size:
        block = source.read(min(chunk_size, size - sent))
        if not block:
            raise RuntimeError('source ended before its declared size')
        writer(block)
        sent += len(block)
    if source.read(1):
        raise RuntimeError('source grew beyond its declared size')
    return sent


def _put_file(action, path, size):
    if not isinstance(action, dict):
        raise RuntimeError('Git LFS upload action is invalid')
    parsed = _https_url(action.get('href', ''), 'Git LFS upload endpoint')
    target = urllib.parse.urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
    headers = _validated_headers(action.get('header') or {}, expected_size=size, add_content_length=True)
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=1800)
    try:
        connection.putrequest('PUT', target)
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.endheaders()
        with open(path, 'rb') as source:
            stream_file(source, connection.send, size)
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            raise RuntimeError('Git LFS object upload returned HTTP %d' % response.status)
    except (OSError, http.client.HTTPException, TimeoutError):
        raise RuntimeError('Git LFS object upload failed')
    finally:
        connection.close()


def upload_file(path, archive_url, oid, size):
    digest = hashlib.sha256()
    actual_size = 0
    with open(path, 'rb') as source:
        while True:
            block = source.read(CHUNK_SIZE)
            if not block:
                break
            digest.update(block)
            actual_size += len(block)
    if actual_size != size or digest.hexdigest() != oid:
        raise RuntimeError('source changed before Git LFS upload')
    item = _batch(archive_url, 'upload', oid, size)
    actions = item.get('actions') or {}
    upload = actions.get('upload')
    if upload:
        _put_file(upload, path, size)
    verify = actions.get('verify')
    if verify:
        _post_verify(verify['href'], verify.get('header') or {}, {'oid': oid, 'size': size})


def _stream_download(action, oid, size, destination=None):
    if not isinstance(action, dict):
        raise RuntimeError('Git LFS download action is invalid')
    _https_url(action.get('href', ''), 'Git LFS download endpoint')
    request_headers = _validated_headers(action.get('header') or {}, expected_size=size)
    request = urllib.request.Request(action['href'], headers=request_headers, method='GET')
    digest = hashlib.sha256()
    total = 0
    temporary = None
    output = None
    if destination is not None:
        parent = os.path.dirname(os.path.abspath(destination))
        os.makedirs(parent, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix='.lfs-', dir=parent)
        output = os.fdopen(descriptor, 'wb')
    try:
        with _open_no_redirect(request, timeout=1800) as response:
            _validate_response_framing(getattr(response, 'headers', None), size)
            while True:
                block = response.read(min(CHUNK_SIZE, max(1, size - total + 1)))
                if not block:
                    break
                total += len(block)
                if total > size:
                    raise RuntimeError('Git LFS download exceeds the declared size')
                digest.update(block)
                if output:
                    output.write(block)
        if total != size or digest.hexdigest() != oid:
            raise RuntimeError('Git LFS download failed size or SHA-256 validation')
        if output:
            output.flush()
            os.fsync(output.fileno())
            output.close()
            output = None
            os.replace(temporary, destination)
            temporary = None
        return {'oid': oid, 'size': total, 'sha256': digest.hexdigest()}
    except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError):
        raise RuntimeError('Git LFS object download failed')
    finally:
        if output:
            output.close()
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def verify_remote(archive_url, oid, size):
    item = _batch(archive_url, 'download', oid, size)
    action = (item.get('actions') or {}).get('download')
    if not action:
        raise RuntimeError('Git LFS download response omitted its object action')
    return _stream_download(action, oid, size)


def download_verified(archive_url, oid, size, destination, expected_sha256):
    if oid != expected_sha256:
        raise RuntimeError('manifest SHA-256 differs from Git LFS object id')
    item = _batch(archive_url, 'download', oid, size)
    action = (item.get('actions') or {}).get('download')
    if not action:
        raise RuntimeError('Git LFS download response omitted its object action')
    return _stream_download(action, oid, size, destination)
