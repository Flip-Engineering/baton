#!/usr/bin/env python3
"""Check the organization runner-group policy before a homelab dispatch."""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


API = 'https://api.github.com'
API_VERSION = '2026-03-10'


def api_get(path, token):
    url = urllib.parse.urljoin(API + '/', path.lstrip('/'))
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'baton-runner-readiness',
        'X-GitHub-Api-Version': API_VERSION,
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('GitHub API returned HTTP ' + str(error.code) + ' for ' + path) from None
    except urllib.error.URLError as error:
        raise RuntimeError('GitHub API request failed for ' + path + ': ' + str(error.reason)) from None
    except TimeoutError:
        raise RuntimeError('GitHub API request timed out for ' + path) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError('GitHub API returned invalid JSON for ' + path) from None


def list_group_repositories(org, group_id, token):
    repositories = []
    page = 1
    total = None
    while total is None or len(repositories) < total:
        result = api_get(
            '/orgs/{}/actions/runner-groups/{}/repositories?per_page=100&page={}'.format(
                urllib.parse.quote(org, safe=''), group_id, page),
            token,
        )
        rows = result.get('repositories')
        if not isinstance(rows, list):
            raise RuntimeError('Runner group repository response has no repositories list')
        reported_total = result.get('total_count')
        if not isinstance(reported_total, int) or reported_total < 0:
            raise RuntimeError('Runner group repository response has an invalid total_count')
        if total is not None and reported_total != total:
            raise RuntimeError('Runner group repository count changed during pagination')
        total = reported_total
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('id'), int):
                raise RuntimeError('Runner group repository response has an invalid repository row')
            repositories.append(row)
        if len(rows) < 100 and len(repositories) < total:
            raise RuntimeError('Runner group repository list ended before total_count')
        page += 1
    if len(repositories) != total:
        raise RuntimeError('Runner group repository list does not match total_count')
    return repositories


def expected_workflow_ref(repository, workflow_path, branch):
    if branch.startswith('refs/') or not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', branch):
        raise ValueError('Workflow branch must be a branch name without refs/ or a pull-request ref')
    path = workflow_path.replace('\\', '/')
    if not re.fullmatch(r'\.github/workflows/[^/]+\.ya?ml', path):
        raise ValueError('Workflow path must name a YAML file directly under .github/workflows/')
    return repository + '/' + path + '@refs/heads/' + branch


def read_token():
    token = os.environ.get('BATON2_RUNNER_GROUP_READ_TOKEN', '')
    if token:
        return token
    try:
        result = subprocess.run(['gh', 'auth', 'token', '--hostname', 'github.com'],
                                capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ''
    return result.stdout.strip() if result.returncode == 0 else ''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--org', default='Flip-Engineering')
    parser.add_argument('--runner-group-id', type=int, default=4)
    parser.add_argument('--runner-group-name', default='baton2-native-homelab')
    parser.add_argument('--repository', default='Flip-Engineering/baton')
    parser.add_argument('--repository-id', type=int, default=1296997100)
    parser.add_argument('--workflow-path', default='.github/workflows/bend2-native.yml')
    parser.add_argument('--workflow-branch', required=True)
    args = parser.parse_args()

    token = read_token()
    if not token:
        parser.error('authenticate gh or set BATON2_RUNNER_GROUP_READ_TOKEN with organization runner read access')
    if args.runner_group_id <= 0 or args.repository_id <= 0:
        parser.error('runner group and repository IDs must be positive')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        parser.error('--repository must be owner/name')
    if args.repository.split('/', 1)[0].casefold() != args.org.casefold():
        parser.error('--repository owner must match --org')

    try:
        workflow_ref = expected_workflow_ref(args.repository, args.workflow_path, args.workflow_branch)
        group_path = '/orgs/{}/actions/runner-groups/{}'.format(
            urllib.parse.quote(args.org, safe=''), args.runner_group_id)
        group = api_get(group_path, token)
        if group.get('id') != args.runner_group_id or group.get('name') != args.runner_group_name:
            raise RuntimeError('Runner group ID/name does not match the requested group')
        if group.get('visibility') != 'selected':
            raise RuntimeError('Runner group visibility must be selected')
        restricted_to_workflows = group.get('restricted_to_workflows')
        if not isinstance(restricted_to_workflows, bool):
            raise RuntimeError('Runner group response has no workflow restriction state')
        if restricted_to_workflows:
            workflows = group.get('selected_workflows')
            if not isinstance(workflows, list) or workflow_ref not in workflows:
                raise RuntimeError('Runner group does not authorize the exact direct branch workflow ref')

        repositories = list_group_repositories(args.org, args.runner_group_id, token)
        selected_rows = [row for row in repositories if row['id'] == args.repository_id]
        if len(selected_rows) != 1:
            raise RuntimeError('Runner group must select repository ID {}'.format(args.repository_id))
        selected = selected_rows[0]
        if selected.get('full_name', '').casefold() != args.repository.casefold():
            raise RuntimeError('Selected repository ID resolves to a different repository')
        if not isinstance(selected.get('private'), bool):
            raise RuntimeError('Selected repository response has no public/private classification')
        if not selected['private'] and group.get('allows_public_repositories') is not True:
            raise RuntimeError('Runner group does not authorize this public repository')
    except (ValueError, RuntimeError) as error:
        print(json.dumps({'policy_ready': False, 'error': str(error)}, sort_keys=True), file=sys.stderr)
        return 1

    print(json.dumps({
        'policy_ready': True,
        'runner_group': {'id': args.runner_group_id, 'name': args.runner_group_name},
        'repository': {'id': args.repository_id, 'full_name': args.repository},
        'workflow_ref': workflow_ref,
        'workflow_pin_kind': 'direct workflow on refs/heads branch',
    }, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
