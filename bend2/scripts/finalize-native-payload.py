#!/usr/bin/env python3
"""Refresh a native payload manifest receipt and complete regular-file checksums."""
import argparse
import hashlib
import json
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def finalize(prefix):
    prefix = Path(prefix).resolve()
    manifest_path = prefix / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    require(isinstance(manifest.get('source'), dict), 'The payload manifest has no source identity')
    require(isinstance(manifest.get('source_manifest'), dict), 'The payload manifest has no source manifest')
    require(isinstance(manifest.get('binaries'), list) and manifest['binaries'],
            'The payload manifest has no binary list')
    receipt = prefix / 'install-receipt.json'
    existing = json.loads(receipt.read_text()) if receipt.is_file() else {}
    receipt_value = {
        'schema': 'baton2-native-install-receipt-v1',
        'created_at': existing.get('created_at', manifest.get('created_at')),
        'manifest': {'path': 'manifest.json', 'sha256': sha256(manifest_path)},
        'source': manifest['source'],
        'source_manifest': manifest['source_manifest'],
        'binaries': manifest['binaries'],
        'compile_queue': manifest.get('compile_queue'),
    }
    receipt.write_text(json.dumps(receipt_value, indent=2) + '\n')
    files = sorted(path.relative_to(prefix).as_posix() for path in prefix.rglob('*')
                   if path.is_file() and path.relative_to(prefix).as_posix() != 'SHA256SUMS')
    (prefix / 'SHA256SUMS').write_text('\n'.join(
        sha256(prefix / name) + '  ' + name for name in files) + '\n')
    return {'manifest_sha256': sha256(manifest_path),
            'install_receipt_sha256': sha256(receipt),
            'checksums_sha256': sha256(prefix / 'SHA256SUMS'),
            'files': len(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(finalize(args.prefix)))


if __name__ == '__main__':
    main()
