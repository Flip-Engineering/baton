"""Actionable source-pinned failure receipts and archived diagnostics."""
import fcntl, json, pathlib, re, runpy, subprocess, sys, urllib.parse
import farm


def diagnosis(job, request, reports, raw_error):
    """Attribute missing inputs using the pinned tree, not the latest branch."""
    failures = []
    for report in reports:
        failures.extend(report.get('http_failures', []))
    for log in (job/'logs').glob('*.log'):
        failures.extend(dict(status=int(status),url=url) for status,url in
                        re.findall(r'\[HTTP\]\s+(\d+)\s+(https?://\S+)',log.read_text(errors='replace')))
    assets = {}
    for item in failures:
        parsed = urllib.parse.urlparse(item.get('url',''))
        if item.get('status') != 404 or parsed.hostname not in ('127.0.0.1','localhost','::1'):
            continue
        rel = pathlib.PurePosixPath(urllib.parse.unquote(parsed.path).lstrip('/'))
        if '..' in rel.parts or str(rel) in ('favicon.ico','.'): continue
        git_path = 'videos/'+rel.as_posix()
        if git_path in assets: continue
        query = subprocess.run(['git','-C',str(job/'repo'),'ls-tree',request['commit'],'--',git_path],
                               capture_output=True,text=True)
        tracked = bool(query.stdout.strip()) if query.returncode == 0 else None
        runtime = job/'out'/pathlib.Path(*rel.parts[1:]) if rel.parts[0]=='out' else job/'repo'/git_path
        present = runtime.is_file()
        if tracked is True:
            category='worker_asset_delivery'
            owner='farm'
            action=('Restore this committed path in the pinned checkout and verify the serving root and mounts. '
                    'Retry the same commit; the producer does not need to change this asset.')
        elif tracked is None:
            category='asset_provenance_unverified';owner='farm'
            action='Inspect the pinned Git tree before attributing this missing asset to the producer.'
        else:
            category='missing_baked_dependency' if rel.parts[0]=='out' else 'missing_job_asset'
            owner='producer'
            action=('Provide the asset at this exact path through committed sources or a reproducible preparation step '
                    'and declare required dependencies; post a new job pinned to the corrected commit.')
        assets[git_path]=dict(path=git_path,http_status=404,url_path=parsed.path,
                             tracked_at_pinned_commit=tracked,present_when_diagnosed=present,
                             classification=category,owner=owner,next_action=action)
    errors=[]
    for report in reports:
        detail=report.get('error',{})
        if isinstance(detail,dict):
            name=str(detail.get('name','')).removeprefix('Uncaught ')
            message=str(detail.get('message',''))
            if message and message!='Event': errors.append((name+': '+message).lstrip(': '))
    errors=list(dict.fromkeys(errors))
    log_errors=[]
    for log in sorted((job/'logs').glob('*.log')):
        lines=log.read_text(errors='replace').splitlines()
        matches=[line for line in lines if re.search(r'(?:[A-Za-z]+Error:|ERROR:|Error:|Illegal instruction|Segmentation fault)',line)
                 and not line.startswith('+ ')]
        if matches: log_errors.append(dict(file='logs/'+log.name,error=matches[-1]))
    primary=errors[0] if errors else (log_errors[0]['error'] if log_errors else str(raw_error).splitlines()[0])
    if isinstance(raw_error,subprocess.CalledProcessError) and not errors and not log_errors:
        primary='Command exited with status '+str(raw_error.returncode)+'; see archived command and logs.'
    if assets:
        primary='Missing asset(s): '+', '.join(assets)
    kind='missing_assets' if assets else ('scene_source' if errors else 'worker_or_dependency')
    actions=list(dict.fromkeys(a['next_action'] for a in assets.values()))
    if not actions:
        actions=[('Correct the reported scene error at the pinned source location, then post a job at the corrected commit.'
                  if errors else 'Inspect the archived failing command, logs and dependency manifest before retrying.')]
    if not assets and 'ModuleNotFoundError:' in primary:
        kind='missing_dependency'
        actions=['Declare the missing package in the job dependencies (or the requirements file used by this recipe), then repost. Inspect the archived dependency manifest for installed versions.']
    if any(marker in str(raw_error) for marker in ('GPU kernel','GPU health','GPU driver','GPU allocation')):
        kind='hardware_or_driver';primary=str(raw_error).splitlines()[0]
        actions=['Inspect kernel and UUID health diagnostics before recovery; do not retry on an unhealthy GPU.']
    if isinstance(raw_error,farm.RenderContextError):
        kind='render_context';primary=str(raw_error)
        actions=['Retain the rejected clips and browser diagnostics. Verify the renderer backend and concurrency with the same pinned scene before resuming its checkpoint.']
    return dict(classification=kind,primary_error=primary,missing_assets=list(assets.values()),
                next_actions=actions,browser_error_summary=errors,log_error_summary=log_errors)


def receipt(job, error):
    request = json.loads((job/'request.json').read_text())
    status = json.loads((job/'status.json').read_text())
    reports = []
    context = []
    for path in sorted((job/'out').glob('homelab-*-scene-failure.json')):
        try:
            detail = json.loads(path.read_text())
        except (OSError, ValueError) as parse_error:
            reports.append(dict(diagnostics_file=path.name,diagnostics_parse_error=str(parse_error)))
            continue
        reports.append(detail)
        for browser in detail.get('browser_exceptions', []):
            locations = [browser] + browser.get('stackTrace', {}).get('callFrames', [])
            for loc in locations:
                url = loc.get('url', '')
                rel = urllib.parse.unquote(urllib.parse.urlparse(url).path).lstrip('/')
                source = (job/'repo/videos'/rel).resolve()
                root = (job/'repo/videos').resolve()
                if not source.is_relative_to(root) or not source.is_file():
                    continue
                lines = source.read_text(errors='replace').splitlines()
                line = int(loc.get('lineNumber', 0)) + 1
                context.append(dict(file=source.relative_to(job/'repo').as_posix(),
                                    line=line, column=int(loc.get('columnNumber', 0))+1,
                                    excerpt=[dict(line=i+1, text=lines[i])
                                             for i in range(max(0,line-4),min(len(lines),line+3))]))
    logs = {}
    for path in sorted((job/'logs').glob('*.log')):
        logs[path.name] = '\n'.join(path.read_text(errors='replace').splitlines()[-20:])
    syntax = job/'logs/scene-syntax.log'
    if syntax.exists():
        for rel, number in re.findall(r'^/work/videos/(.+?):([0-9]+)', syntax.read_text(errors='replace'), re.M):
            source=(job/'repo/videos'/rel).resolve();root=(job/'repo/videos').resolve()
            if not source.is_relative_to(root) or not source.is_file():continue
            lines=source.read_text(errors='replace').splitlines();line=int(number)
            context.append(dict(file=source.relative_to(job/'repo').as_posix(),line=line,
                                excerpt=[dict(line=i+1,text=lines[i]) for i in range(max(0,line-4),min(len(lines),line+3))]))
    context=list({(loc['file'],loc['line'],loc.get('column')):loc for loc in context}.values())
    result = dict(schema=2, job_id=request.get('protocol_id',job.name),
                  scene=request.get('scene'), commit=request['commit'],
                  phase=status.get('phase'), kind=status.get('failure_kind','unclassified'),
                  error=str(error), renderer_errors=reports, source_locations=context,
                  log_tails=logs, worker=farm.CONFIG['protocol_worker'],
                  occurred_at=farm.now())
    result.update(diagnosis(job,request,reports,error))
    if isinstance(error,subprocess.CalledProcessError):
        result['failed_command']=dict(argv=error.cmd,exit_code=error.returncode)
    manifest=job/'dependencies.json'
    if manifest.is_file():
        try: result['dependencies']=json.loads(manifest.read_text())
        except (OSError,ValueError) as exc: result['dependencies_parse_error']=str(exc)
    result['declared_dependencies']=request.get('dependencies',{})
    farm.write(job/'failure.json',result)
    return result


def archive(job, report):
    # Separate publication cache/index and lock from success deliveries and leases.
    with open(farm.BASE/'protocol-failure.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        protocol_path = str(farm.HOME/'protocol')
        if protocol_path not in sys.path: sys.path.insert(0, protocol_path)
        module = runpy.run_path(str(farm.HOME/'protocol/pipeline-farm.py'))
        cls = module['Repo']
        cls.__init__.__globals__['CACHE'] = str(farm.BASE/'protocol-failure-cache')
        repo = cls(module['ARCH'],'arch')
        prefix = 'farm/failures/'+report['job_id']
        url = module['ARCH'].removesuffix('.git')+'/tree/main/'+prefix
        report['diagnostics_url'] = url
        farm.write(job/'failure.json',report)
        paths = [job/'failure.json', job/'request.json', job/'status.json',
                 *sorted((job/'logs').glob('*.log')),
                 *sorted((job/'out').glob('homelab-*-scene-failure.json')),job/'dependencies.json']
        paths += [job/'repo'/loc['file'] for loc in report['source_locations']]
        if report.get('scene'):
            paths += [job/'repo/videos/web/scenes'/(report['scene']+suffix) for suffix in ('.html','.js')]
        files = {prefix+'/'+p.relative_to(job).as_posix():p for p in paths if p.is_file()}
        while not repo.commit(repo.head(),files,'farm: archive failure diagnostics for '+report['job_id']):
            pass
        return url


def explain(job, error):
    report = receipt(job,error)
    try:
        archive(job,report)
    except Exception as archive_error:
        # Always return the actual failure to the orchestrator, even if archiving fails.
        report.pop('diagnostics_url', None)
        report['diagnostics_archive_error'] = str(archive_error)
        farm.write(job/'failure.json',report)
    summary = {key:report[key] for key in (
        'job_id','commit','scene','phase','kind','classification','primary_error',
        'missing_assets','next_actions','source_locations','log_error_summary','declared_dependencies')}
    for key in ('diagnostics_url','diagnostics_archive_error'):
        if key in report: summary[key]=report[key]
    if 'diagnostics_archive_error' in report:
        summary['error']=report['error']
        summary['log_tails']=report['log_tails']
    return (report['primary_error']+'\n'+
            json.dumps(summary,ensure_ascii=False,indent=2))
