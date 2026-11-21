"""Check stable SDK selection and the SDK identity used by the compiler."""
import datetime
import hashlib
import json
from pathlib import Path
import runpy
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib


SDK = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/darwin-sdk.py'))


class DarwinSDK(unittest.TestCase):
    def test_uses_highest_stable_sdk_and_accepts_matching_xcode_patches(self):
        rows = ''.join(f'<tr><td>{xcode}</td><td>host</td><td>iOS 99<br>macOS {sdk}</td></tr>'
                       for xcode, sdk in [
                           ('Xcode 31 beta 2', '31'),
                           ('Xcode 30.10 RC', '30.10'),
                           ('Xcode 30.2', '30.2'),
                           ('Xcode 30.9.1', '30.9'),
                           ('Xcode 30.9', '30.9'),
                       ])
        self.assertEqual(SDK['stable_releases']('<table>' + rows + '</table>'),
                         ('30.9', {'30.9', '30.9.1'}))

    def test_selects_current_sdk_from_newest_matching_apple_product(self):
        apple = 'https://swdist.apple.com/'
        pkg = {'URL': 'https://swcdn.apple.com/CLTools_macOSNMOS_SDK.pkg'}
        products = {
            product: {'PostDate': datetime.date(2030, 1, day), 'Packages': [pkg],
                      'Distributions': {'English': apple + product}}
            for day, product in enumerate(('older', 'stable-patch', 'beta'), start=1)
        }
        titles = {'older': '30.9', 'stable-patch': '30.9.1', 'beta': '31 beta 2'}

        def distribution(url, host):
            self.assertEqual(host, 'swdist.apple.com')
            version = titles[url.removeprefix(apple)]
            return f'"SU_TITLE" = "Command Line Tools for Xcode {version}";'.encode()

        with patch.dict(SDK['sdk_product'].__globals__, {'fetch': distribution}):
            self.assertEqual(SDK['sdk_product'](products, {'30.9', '30.9.1'}),
                             ('stable-patch', '30.9.1', pkg))

    def test_checks_catalog_digest_and_payload(self):
        stored = b'sdk-payload'
        checksum = hashlib.sha1(stored).hexdigest()
        toc = f'''<xar><toc><file><name>Payload</name><data>
            <offset>0</offset><length>{len(stored)}</length>
            <archived-checksum style="sha1">{checksum}</archived-checksum>
            </data></file></toc></xar>'''.encode()
        compressed = zlib.compress(toc)
        header = struct.pack('>4sHHQQI', b'xar!', 28, 1, len(compressed), len(toc), 1)
        package = header + compressed + stored
        metadata = {'Size': len(package), 'Digest': hashlib.sha1(compressed).hexdigest()}
        self.assertEqual(SDK['payload'](package, metadata), stored)
        with self.assertRaisesRegex(RuntimeError, 'payload differs'):
            SDK['payload'](package[:-1] + b'!', metadata)
        with self.assertRaisesRegex(RuntimeError, 'differs from its catalog digest'):
            SDK['payload'](package, dict(metadata, Digest='0' * 40))

    def test_rejects_changes_to_the_resolved_sdk_tree(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / 'MacOSX30.9.sdk'
            headers = root / 'usr/include'
            headers.mkdir(parents=True)
            header = headers / 'fixture.h'
            header.write_text('original')
            (root / 'SDKSettings.json').write_text('{"CanonicalName":"macosx30.9","Version":"30.9"}')
            receipt = json.dumps({
                'schema': SDK['SCHEMA'], 'sdkroot': str(root),
                'version': '30.9', 'tree_sha256': SDK['tree_sha256'](root),
            })
            SDK['receipt_path'](root).write_text(receipt)
            self.assertEqual(SDK['verify'](root)['version'], '30.9')
            header.write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'does not match the selected SDK tree'):
                SDK['verify'](root)


if __name__ == '__main__':
    unittest.main()
