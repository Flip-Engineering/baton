#!/usr/bin/env python3
"""Select the workflow attempt whose artifact a job should download.

A job rerun creates a new attempt number, while artifacts of jobs that already
succeeded keep the suffix of the attempt that uploaded them (#1263). Artifact
names end in `-<attempt>`. This script lists the artifacts of one workflow run
and prints the highest attempt, not above the current one, that has an unexpired
artifact with the exact prefix. The consumer then verifies the downloaded
content against its recorded source and hashes.
"""
import argparse
import json
import os
import re
import sys
import urllib.request


def select(artifacts, prefix, current):
    """Return the highest attempt <= current among unexpired artifacts named prefix + digits."""
    pattern = re.compile(re.escape(prefix) + r'([1-9][0-9]*)')
    attempts = []
    for artifact in artifacts:
        match = pattern.fullmatch(artifact.get('name', ''))
        if match and not artifact.get('expired', False) and int(match.group(1)) <= current:
            attempts.append(int(match.group(1)))
    if not attempts:
        raise SystemExit('No unexpired artifact named %s<attempt> exists for attempts up to %d.' % (prefix, current))
    return max(attempts)


def fetch(api, repository, run_id, token):
    artifacts, page = [], 1
    while True:
        request = urllib.request.Request(
            '%s/repos/%s/actions/runs/%s/artifacts?per_page=100&page=%d' % (api, repository, run_id, page),
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=60) as response:
            batch = json.load(response)['artifacts']
        artifacts += batch
        if len(batch) < 100:
            return artifacts
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', required=True, help='artifact name up to and including the final dash')
    parser.add_argument('--current-attempt', type=int, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--artifacts-file', help='JSON lines or a JSON array of {name, expired}; "-" reads stdin')
    source.add_argument('--run-id')
    parser.add_argument('--repository')
    parser.add_argument('--api-url', default=os.environ.get('GITHUB_API_URL', 'https://api.github.com'))
    args = parser.parse_args()
    if args.current_attempt < 1:
        parser.error('--current-attempt must be positive')
    if args.artifacts_file:
        text = sys.stdin.read() if args.artifacts_file == '-' else open(args.artifacts_file).read()
        text = text.strip()
        artifacts = json.loads(text) if text.startswith('[') else [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        token = os.environ.get('GITHUB_TOKEN', '')
        if not (args.repository and token):
            parser.error('--run-id needs --repository and GITHUB_TOKEN')
        artifacts = fetch(args.api_url, args.repository, args.run_id, token)
    print(select(artifacts, args.prefix, args.current_attempt))


if __name__ == '__main__':
    main()
