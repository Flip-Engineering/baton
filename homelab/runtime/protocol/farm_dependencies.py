"""Portable, versioned dependency declarations shared by job producers and farms."""
import json
import re

KINDS = ('python', 'system', 'npm')
SYSTEM = re.compile(r'[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?(?:=[A-Za-z0-9.+:~_-]+)?\Z')
NPM = re.compile(r'(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]*(?:@[^\s]+)?\Z')

def normalize(value=None):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError('dependencies must be an object with python, system and/or npm lists')
    unknown = set(value) - set(KINDS)
    if unknown:
        raise ValueError('Unsupported dependency kind(s): ' + ', '.join(sorted(unknown)))
    result = {}
    for kind in KINDS:
        items = value.get(kind, [])
        if not isinstance(items, list):
            raise ValueError('dependencies.' + kind + ' must be a list')
        normalized = []
        for item in items:
            if not isinstance(item, str) or not item.strip() or any(ord(c) < 32 or ord(c) == 127 for c in item):
                raise ValueError('Dependency entries must be nonempty single-line strings')
            item = item.strip()
            if item.startswith('-'):
                raise ValueError('Dependency entries cannot be installer options')
            if kind == 'system' and not SYSTEM.fullmatch(item):
                raise ValueError('System dependency must be a Debian package name, optionally :architecture or =version: ' + item)
            if kind == 'npm' and not NPM.fullmatch(item):
                raise ValueError('npm dependency must be a package name, optionally @version: ' + item)
            if kind == 'python' and not re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[|\s|@|[<>=!~;]|$)', item):
                raise ValueError('Python dependency must be a named pip requirement: ' + item)
            if item not in normalized:
                normalized.append(item)
        result[kind] = sorted(normalized)
    return result

def parse(text):
    """Accept either a JSON object or @path/to/a/JSON file on the submitting host."""
    if text.startswith('@'):
        with open(text[1:]) as f:
            return normalize(json.load(f))
    return normalize(json.loads(text))

def npm_name(requirement):
    return requirement.rsplit('@', 1)[0] if '@' in requirement[1:] else requirement
