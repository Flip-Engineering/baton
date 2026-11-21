#!/usr/bin/env python3
"""Resolve Apple's current stable macOS SDK for a Linux cross-build."""

import argparse
import gzip
import hashlib
from html.parser import HTMLParser
import json
import lzma
from pathlib import Path
import plistlib
import re
import struct
import subprocess
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zlib


REQUIREMENTS = 'https://developer.apple.com/xcode/system-requirements/'
CATALOG_ROOT = 'https://swscan.apple.com/content/catalogs/others/'
# Apple retains these catalog components after the switch to year-based numbering.
CATALOG_TAIL = ('15-14-13-12-10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-'
                'mountainlion-lion-snowleopard-leopard')
SDK_PACKAGE = 'CLTools_macOSNMOS_SDK.pkg'
SCHEMA = 'baton2-darwin-sdk-selection-v1'
VERSION = r'\d+(?:\.\d+)*'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def fetch(url, host):
    def check_location(location):
        parsed = urlsplit(location)
        require(parsed.scheme == 'https' and parsed.netloc == host,
                f'Expected an HTTPS resource from {host}: {location}')

    check_location(url)
    with urlopen(url) as response:
        check_location(response.geturl())
        return response.read()


class XcodeTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag == 'td' and self.row is not None:
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def version_key(version):
    return tuple(int(part) for part in re.sub(r'(?:\.0)+$', '', version).split('.'))


def stable_releases(requirements):
    table = XcodeTable()
    table.feed(requirements)
    releases = []
    for cells in table.rows:
        if len(cells) < 3:
            continue
        xcode = re.fullmatch(r'Xcode (' + VERSION + ')', cells[0])
        sdk = re.search(r'\bmacOS (' + VERSION + r')\b', cells[2])
        if xcode and sdk:
            releases.append((xcode[1], sdk[1]))
    require(releases, 'Apple did not list a stable Xcode release with a macOS SDK.')
    latest = max((sdk for _, sdk in releases), key=version_key)
    return latest, {xcode for xcode, sdk in releases if version_key(sdk) == version_key(latest)}


def catalog_url(sdk):
    current_major = version_key(sdk)[0]
    majors = '-'.join(map(str, range(current_major, 25, -1)))
    return CATALOG_ROOT + f'index-{majors}-{CATALOG_TAIL}.merged-1.sucatalog.gz'


def sdk_product(products, releases):
    ordered = sorted(products.items(), key=lambda item: item[1]['PostDate'], reverse=True)
    for product_id, product in ordered:
        packages = [p for p in product['Packages'] if p['URL'].endswith('/' + SDK_PACKAGE)]
        distribution = product.get('Distributions', {}).get('English')
        if not packages or not distribution:
            continue
        installer = fetch(distribution, 'swdist.apple.com').decode()
        title = re.search(r'"SU_TITLE"\s*=\s*"Command Line Tools for Xcode (' + VERSION + r')";',
                          installer)
        if title and title[1] in releases:
            require(len(packages) == 1, f'Apple product {product_id} has multiple current SDK packages.')
            return product_id, title[1], packages[0]
    raise RuntimeError('Apple Software Update has no SDK package for stable Xcode ' +
                       ', '.join(sorted(releases, key=version_key)))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def payload(package, metadata):
    require(len(package) == metadata['Size'], 'The Apple SDK package size differs from its catalog entry.')
    magic, header_size, version, toc_size, toc_length, checksum = struct.unpack_from('>4sHHQQI', package)
    require(magic == b'xar!' and version == 1 and header_size >= 28 and checksum == 1,
            'The Apple SDK package uses an unsupported XAR header.')
    heap = header_size + toc_size
    toc = package[header_size:heap]
    # Apple publishes the digest of the compressed XAR table of contents.
    require(hashlib.sha1(toc).hexdigest() == metadata['Digest'],
            'The Apple SDK package table of contents differs from its catalog digest.')
    decoded = zlib.decompress(toc)
    require(len(decoded) == toc_length, 'The Apple SDK package table of contents size differs.')
    files = ET.fromstring(decoded).findall('./toc/file')
    entry = next((entry.find('data') for entry in files if entry.findtext('name') == 'Payload'), None)
    require(entry is not None, 'The Apple SDK package has no Payload.')
    offset = heap + int(entry.findtext('offset'))
    length = int(entry.findtext('length'))
    stored = memoryview(package)[offset:offset + length]
    archived = entry.find('archived-checksum')
    require(len(stored) == length and archived is not None and archived.get('style') == 'sha1'
            and hashlib.sha1(stored).hexdigest() == archived.text,
            'The Apple SDK payload differs from its XAR table of contents.')
    return stored


def unpack(data, destination):
    require(len(data) >= 12 and data[:4] == b'pbzx', 'The Apple SDK payload is not PBZX.')
    position = 12
    with tempfile.TemporaryFile(dir=destination) as archive:
        while position < len(data):
            require(position + 16 <= len(data), 'The PBZX chunk header is incomplete.')
            raw_size, stored_size = struct.unpack_from('>QQ', data, position)
            start = position + 16
            position = start + stored_size
            require(position <= len(data), 'The PBZX chunk data is incomplete.')
            block = data[start:position]
            decoded = block if raw_size == stored_size else lzma.decompress(block)
            require(len(decoded) == raw_size, 'The PBZX chunk size differs after decompression.')
            archive.write(decoded)
        archive.seek(0)
        subprocess.run(['cpio', '--extract', '--make-directories', '--no-absolute-filenames',
                        '--no-preserve-owner', '--quiet'], cwd=destination, stdin=archive, check=True)


def sdk_version(sdk):
    settings = json.loads((sdk / 'SDKSettings.json').read_text())
    version = settings['Version']
    require(re.fullmatch(VERSION, version) is not None
            and settings['CanonicalName'].startswith('macosx'),
            'The extracted SDK settings must identify a macOS version.')
    return version


def tree_sha256(root):
    digest = hashlib.sha256()
    for file in sorted(root.rglob('*')):
        if file.is_symlink():
            kind, value = 'symlink', str(file.readlink())
        elif file.is_file():
            kind, value = 'file', sha256(file)
        else:
            continue
        digest.update(json.dumps([file.relative_to(root).as_posix(), kind, value]).encode() + b'\n')
    return digest.hexdigest()


def receipt_path(sdk):
    return sdk.with_name(sdk.name + '.selection.json')


def resolve(output):
    output = output.resolve()
    output.mkdir(mode=0o700, parents=True)
    requirements = fetch(REQUIREMENTS, 'developer.apple.com')
    expected_version, releases = stable_releases(requirements.decode())
    catalog = catalog_url(expected_version)
    raw_catalog = fetch(catalog, 'swscan.apple.com')
    products = plistlib.loads(gzip.decompress(raw_catalog))['Products']
    product, xcode, metadata = sdk_product(products, releases)
    package = fetch(metadata['URL'], 'swcdn.apple.com')
    unpack(payload(package, metadata), output)
    sdk_directory = output / 'Library/Developer/CommandLineTools/SDKs'
    sdks = [path for path in sdk_directory.glob('MacOSX*.sdk') if path.is_dir() and not path.is_symlink()]
    require(len(sdks) == 1, 'The Apple SDK payload must contain one macOS SDK directory.')
    sdk = sdks[0]
    version = sdk_version(sdk)
    require(version_key(version) == version_key(expected_version),
            f'Apple Software Update supplied SDK {version}. Stable Xcode lists SDK {expected_version}.')
    require((sdk / 'usr/include').is_dir(), 'The macOS SDK has no usr/include directory.')
    receipt = {
        'schema': SCHEMA, 'sdkroot': str(sdk), 'version': version, 'xcode_version': xcode,
        'requirements_url': REQUIREMENTS, 'requirements_sha256': hashlib.sha256(requirements).hexdigest(),
        'catalog_url': catalog, 'catalog_sha256': hashlib.sha256(raw_catalog).hexdigest(),
        'product_id': product, 'package_url': metadata['URL'], 'package_toc_sha1': metadata['Digest'],
        'package_sha256': hashlib.sha256(package).hexdigest(), 'tree_sha256': tree_sha256(sdk),
    }
    receipt_path(sdk).write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def verify(sdk):
    receipt = json.loads(receipt_path(sdk).read_text())
    require(receipt['schema'] == SCHEMA and Path(receipt['sdkroot']) == sdk
            and receipt['version'] == sdk_version(sdk)
            and receipt['tree_sha256'] == tree_sha256(sdk),
            'The macOS SDK resolution receipt does not match the selected SDK tree.')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new private directory for the SDK')
    args = parser.parse_args()
    print(json.dumps(resolve(args.output), indent=2))
