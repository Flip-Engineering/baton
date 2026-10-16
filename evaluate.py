import json
from pathlib import Path

root = Path.cwd().resolve()
reasons = []
try:
    item = json.loads((root / 'candidate.json').read_text())
    if item.get('schema') != 'baton-compiler-investigation-candidate-v1':
        reasons.append('candidate schema is missing')
    files = [item.get('proposal_path')] + item.get('evidence_paths', [])
    for name in files:
        if not isinstance(name, str):
            reasons.append('artifact path is not text')
            continue
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size == 0:
            reasons.append('artifact is absent or outside the snapshot')
    for key in ['evidence_paths', 'source_references', 'correctness_invariants', 'limitations']:
        if not isinstance(item.get(key), list) or not item[key]:
            reasons.append(key + ' is missing')
    qualification = item.get('qualification', {})
    if qualification.get('performance_measured') is not False or qualification.get('tests_executed') != []:
        reasons.append('unapproved execution or performance claim requires separate review')
except (OSError, ValueError, TypeError, KeyError) as error:
    reasons.append(type(error).__name__)
print(json.dumps({'accepted': not reasons, 'score': 0, 'scope': 'authored artifact completeness; performance unmeasured', 'reasons': reasons}))
