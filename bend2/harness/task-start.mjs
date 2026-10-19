#!/usr/bin/env node
// Ordinary task input and setup for issue #716. Native commands own session
// admission, configuration, receiver registration and message authorization.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync,
  statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSettingsFile, routeByName, resolveRouteProfile,
  settingsPathFor } from './project-settings.mjs';

export const help = `usage: baton dispatch TEXT [OPTIONS]
       baton dispatch --stdin [OPTIONS]
       baton dispatch --file UTF8_FILE [OPTIONS]
       baton [DATABASE | --project PATH] dispatch [INPUT] [OPTIONS]
Options:
  --project PATH       Select the registered project (default: current directory).
  --to SESSION         Select an existing conversation in this project.
  --session ID         Alias for --to.
  --continue           Require an existing open assignment for this input.
  --new                Create a fresh session; an explicit session ID must be unused.
  --route NAME         Read a named route from the project's saved settings.
  --harness NAME       Override the selected route's harness.
  --command EXECUTABLE Override the selected harness executable found in PATH.
  --model MODEL        Override the selected route's model.
  --effort EFFORT      Override the selected route's effort.
  --workspace PATH     Select a new session's working directory.
  --output-log PATH    Select its native transcript path.
  --dispatch-id ID     Retain an explicit dispatched message identity.
  --text TEXT          Supply literal task text, including text beginning with --.
New sessions use the named saved route and explicit overrides. An existing
session supplies its recorded route; --route explicitly selects saved values
for configuration. Explicit harness, model and effort override those values.
An existing receiver remains selected until an explicit command changes it.
New sessions resolve codex, omp, muse, dsh or claude through the current PATH.
Full input and setup results are stored in the database and returned with inspect commands.
An existing open assignment receives continuation input automatically. Baton
resolves the sending agent from its recorded launch context. Stops remain
effective; resume ID --lift-stop is the explicit stop-lifting operation.
`;

class TaskFailure extends Error {
  constructor(reason, detail, next, code = 2) {
    super(detail); Object.assign(this, { reason, next, code });
  }
}

function fail(reason, detail, next, code) {
  throw new TaskFailure(reason, detail, next, code);
}

export function parseOptions(argv) {
  const options = {};
  const values = new Map([
    ['--project', 'project'], ['--to', 'session'], ['--session', 'session'], ['--route', 'route'],
    ['--harness', 'harness'], ['--command', 'command'], ['--model', 'model'],
    ['--effort', 'effort'], ['--workspace', 'workspace'], ['--output-log', 'log'],
    ['--dispatch-id', 'id'], ['--task-id', 'id'], ['--sender', 'sender'], ['--text', 'text'], ['--file', 'file'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--') {
      if (i + 2 !== argv.length || options.text !== undefined) {
        fail('taskInputAmbiguous', 'Pass one complete text argument after --.', help);
      }
      options.text = argv[++i]; continue;
    }
    if (values.has(arg)) {
      const name = values.get(arg);
      if (options[name] !== undefined || i + 1 === argv.length) {
        fail('taskOptionInvalid', `${arg} requires one value and may appear once.`, help);
      }
      options[name] = argv[++i];
    } else if (['--stdin', '--continue', '--new'].includes(arg)) {
      const name = arg.slice(2);
      if (options[name]) fail('taskOptionInvalid', `${arg} may appear once.`, help);
      options[name] = true;
    } else if (!arg.startsWith('--') && options.text === undefined) {
      options.text = arg;
    } else fail('taskOptionInvalid', `Unknown task argument: ${arg}`, help);
  }
  if (options.new && options.continue) {
    fail('taskModeAmbiguous', '--new and --continue select different operations.', help);
  }
  const sources = ['text', 'file', 'stdin'].filter((name) => options[name] !== undefined);
  if (sources.length > 1) fail('taskInputAmbiguous', 'Choose text, stdin or one UTF-8 file.', help);
  if (sources.length === 0) {
    if (process.stdin.isTTY) fail('taskInputMissing', 'Task input is required.', help);
    options.stdin = true;
  }
  if (options.continue && !options.session) {
    fail('taskSessionMissing', 'Continuation requires a selected recorded session.',
      'Use dispatch --session ID --continue INPUT; project-sessions PATH lists session identities.');
  }
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'string' && (!value.isWellFormed() || value.includes('\0'))) {
      fail('taskInputInvalid', `${key} contains invalid Unicode or NUL.`, help);
    }
  }
  return options;
}

function utf8(bytes, source) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) { fail('taskInputInvalidUtf8', `${source}: ${error.message}`, 'Supply complete UTF-8 task input.'); }
}

function recordedReceiver(session) {
  const argv = session?.endpointArgv;
  if (!Array.isArray(argv)) return null;
  const position = argv.length - 7;
  if (position < 2 || argv[position] !== 'receive' || argv[position + 1] !== session.id) return null;
  return { command: argv[position + 2], log: argv[position + 6] };
}

function projectResolution(path) {
  const run = spawnSync('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', maxBuffer: Infinity });
  const raw = run.status === 0 ? (run.stdout ?? '').replace(/\n$/, '') : '';
  let common = raw;
  if (raw) { try { common = realpathSync(raw); } catch {} }
  return { common: common || null, rule: common ? 'common-dir' : 'path-prefix',
    argv: ['git', '-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    exitCode: run.status, signal: run.signal, stdout: run.stdout ?? '',
    stderr: run.stderr ?? '', error: run.error?.message ?? null };
}

function executableInPath(harness) {
  const name = { codex: 'codex', omp: 'omp', muse: 'muse', dsh: 'dsh', 'claude-code': 'claude' }[harness];
  for (const directory of (process.env.PATH ?? '/usr/bin:/bin').split(':')) {
    try {
      const path = realpathSync(resolve(directory || '.', name));
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  fail('taskCommandMissing', `The selected harness executable ${name} is absent from PATH.`,
    'Install and authenticate the selected harness, or pass --command with its executable.');
}

function canonicalFile(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

export function startTask(executable, database, argv) {
  const steps = [];
  const requestId = randomUUID();
  const explicitDatabase = Boolean(database);
  let options = null;
  let projectPath, resolution, key, registered;
  let registerProject = true;
  let contextReady = false;
  let recordAttempted = false;
  let requestRecorded = false;
  let actorAttempted = false;
  let sender = null;
  let result = { status: 'refused', steps };
  const call = (args, input, recordStep = true) => {
    const run = spawnSync(executable, args, { encoding: 'utf8', input, maxBuffer: Infinity });
    const step = { argv: [executable, ...args], exitCode: run.status, signal: run.signal,
      stdout: run.stdout ?? '', stderr: run.stderr ?? '', error: run.error?.message ?? null };
    if (recordStep) steps.push(step);
    if (run.error || run.signal || run.status !== 0) {
      fail('taskOperationFailed', JSON.stringify(step),
        'Inspect the retained setup result and recorded session before retrying this task.', 1);
    }
    try { return JSON.parse(step.stdout); }
    catch { fail('taskOperationOutputInvalid', step.stdout, 'Inspect the complete native command output.'); }
  };
  const native = (...args) => call([database, ...args]);
  const selectContext = () => {
    projectPath = realpathSync(resolve(options?.project ?? process.cwd()));
    resolution = projectResolution(projectPath);
    key = resolution.common ?? projectPath;
    const pointer = join(key, 'baton2/database');
    registered = null;
    try { registered = utf8(readFileSync(pointer), pointer); }
    catch (error) {
      if (error.code === 'ENOTDIR' && explicitDatabase) registerProject = false;
      else if (error.code !== 'ENOENT') throw error;
    }
    if (registered === '') fail('taskProjectPointerEmpty', `Project pointer ${pointer} is empty.`,
      'Register the intended database with baton DATABASE project PATH.');
    database = canonicalFile(database || registered || join(key, 'baton2/orchestra.db'));
    if (registered && canonicalFile(registered) !== database) {
      fail('taskProjectDatabaseConflict', 'The explicit database differs from the registered project database.',
        'Use the registered project or select the intended project explicitly.');
    }
    const id = options?.id ?? `dispatch:${randomUUID()}`;
    const sessionId = options?.session ?? `session:${randomUUID()}`;
    result = { ...result, task: id, session: sessionId, requestId, database,
      project: projectPath, projectKey: key, projectResolution: resolution,
      inspect: { request: [executable, database, 'task-input-read', '--current'],
        session: [executable, database, 'session', sessionId],
        input: [executable, database, 'input', id], turns: [executable, database, 'turns', sessionId] } };
    contextReady = true;
  };
  const resolveActor = () => {
    actorAttempted = true;
    if (process.env.BATON_SESSION || process.env.CODEX_THREAD_ID) {
      result.actor = { id: null, source: 'agent-launch-context' };
      const actor = native('agent-current-session');
      if (typeof actor.id !== 'string' || !actor.id.length || !actor.id.isWellFormed() || actor.id.includes('\0')) {
        fail('taskActorInvalid', JSON.stringify(actor), 'Inspect the recorded agent launch context.');
      }
      sender = actor.id;
      result.actor.id = sender;
      if (options?.sender !== undefined && options.sender !== sender) {
        fail('taskSenderContextConflict', 'The supplied sender differs from the recorded agent launch context.',
          'Dispatch through the recorded actor context.');
      }
    } else {
      sender = options?.sender ?? 'operator';
      result.actor = { id: sender, source: options?.sender !== undefined ? 'explicit' : 'operator' };
    }
  };
  const recordInput = () => {
    if (!contextReady) selectContext();
    if (!actorAttempted) resolveActor();
    const request = { id: requestId, messageId: result.task, session: result.session,
      sender, actor: result.actor, input: result.input ?? { source: 'arguments', argv },
      options, argv, project: { path: projectPath, key, resolution }, database };
    recordAttempted = true;
    try {
      mkdirSync(dirname(database), { recursive: true });
      const saved = call([database, 'task-input-record', '-'], JSON.stringify(request) + '\n');
      if (saved.id !== requestId || saved.status !== 'recorded') {
        fail('taskInputRecordInvalid', JSON.stringify(saved), 'Inspect the database request record.', 1);
      }
      requestRecorded = true;
    } catch (error) {
      result.inputRecordError = { reason: error.reason ?? error.code ?? 'taskInputRecordFailed',
        detail: error.message };
      throw error;
    }
  };
  try {
    options = parseOptions(argv);
    if (options.help) return { status: 'help', help };
    let body = options.text;
    result.input = { source: options.text !== undefined ? 'text' : options.file ?? 'stdin' };
    if (body === undefined) {
      const bytes = readFileSync(options.file ?? 0);
      try { body = utf8(bytes, options.file ?? 'stdin'); }
      catch (error) {
        result.input = { source: options.file ?? 'stdin', encoding: 'utf8', bytesHex: bytes.toString('hex') };
        throw error;
      }
    }
    result.input = { source: options.text !== undefined ? 'text' : options.file ?? 'stdin', body };
    recordInput();
    if (!body.length) fail('taskInputEmpty', 'The supplied task is empty.', 'Supply dispatch text with --text, --stdin or --file.');
    const id = result.task;
    const sessionId = result.session;
    const sessions = existsSync(database) ? native('project-sessions', projectPath).sessions : [];
    let selected = sessions.find((session) => session.id === sessionId);
    if (options.session && !selected) {
      // A session in another project is never an unused new identity.
      const all = existsSync(database) ? native('status') : [];
      if (all.some((session) => session.id === sessionId)) {
        fail('taskProjectSessionConflict', `Session ${sessionId} belongs to another project.`,
          'Select a session from project-sessions PATH or create a fresh session.');
      }
      if (options.continue) fail('taskSessionMissing', `Session ${sessionId} is not recorded.`,
        'Select a recorded session from project-sessions PATH.');
    }
    if (selected && options.new) fail('taskSessionExists', `Session ${sessionId} already exists.`,
      'Omit --session to create a fresh session, or select the existing conversation explicitly.');
    if (selected) {
      selected = native('session', sessionId);
      result.currentSession = selected;
    }
    if (selected?.blockedCause === 'terminal-stop') fail('taskSessionStopped',
      `Session ${sessionId} has an explicit stop.`, 'Inspect its stopped input; resume SESSION --lift-stop is the explicit stop-lifting operation.');
    const operatorAssignment = selected && selected.parent === null
      && ['principal-conductor', 'associate-conductor'].includes(selected.role)
      && selected.taskCompletion?.assignmentId && !selected.taskCompletion?.confirmed;
    if (options.continue && !selected?.taskCompletion?.open && !operatorAssignment) {
      fail('taskAssignmentClosed', `Session ${sessionId} has no open assignment.`,
        'Start a new task in the selected conversation by omitting --continue.');
    }
    const continuation = Boolean(options.continue || selected?.taskCompletion?.open || operatorAssignment);
    const kind = continuation ? 'task-continuation' : 'task';
    result.kind = kind;
    const settingsPath = settingsPathFor(key);
    let saved = null;
    if (options.route !== undefined) {
      let read;
      try { read = readSettingsFile(settingsPath); }
      catch (error) { fail('taskSettingsReadFailed', error.message,
        'Use the saved settings path or supply --harness, --model and --effort explicitly.'); }
      if (read.status !== 'decoded') fail(read.reason, read.detail, `Inspect ${settingsPath}.`);
      saved = read.value;
      if (!routeByName(saved, options.route)) fail('taskRouteMissing', `No saved route names ${options.route}.`,
        `Select a named route from ${settingsPath}, or supply --harness, --model and --effort.`);
    }
    const named = saved ? routeByName(saved, options.route) : null;
    const route = Object.fromEntries(['harness', 'model', 'effort'].map((field) => [field,
      options[field] ?? named?.[field] ?? selected?.[field] ?? '']));
    result.route = { ...route, settingsPath: named ? settingsPath : null, name: options.route ?? null,
      sources: Object.fromEntries(['harness', 'model', 'effort'].map((field) => [field,
        options[field] !== undefined ? 'explicit' : named ? 'named-project-route' : 'recorded-session'])) };
    if (!['codex', 'omp', 'muse', 'claude-code', 'dsh'].includes(route.harness) || !route.model || !route.effort) {
      fail('taskRouteIncomplete', 'A supported harness, model and effort must be configured.',
        'Pass --route NAME for a saved project route, or supply --harness, --model and --effort.');
    }
    if (selected && !selected.workspace) fail('taskWorkspaceMissing',
      'The selected conversation has no recorded working directory.',
      'Record its working directory with receiver SESSION COMMAND LOG CWD, then retry.');
    const workspace = realpathSync(resolve(options.workspace ?? selected?.workspace ?? projectPath));
    const workspaceResolution = projectResolution(workspace);
    result.workspaceResolution = workspaceResolution;
    const prefixMember = workspace === projectPath || workspace.startsWith(`${projectPath}/`);
    const member = resolution.common && workspaceResolution.common
      ? workspaceResolution.common === key : prefixMember;
    if (!member) fail('taskWorkspaceProjectConflict',
      'The working directory belongs to a different project.', 'Select a checkout of the task project.');
    if (selected && workspace !== selected.workspace) fail('taskWorkspaceChangeRequiresReceiver',
      'The selected conversation records a different working directory.',
      'Use receiver SESSION COMMAND LOG CWD to relocate it explicitly, then retry the task.');
    const receiver = recordedReceiver(selected);
    const command = options.command ?? receiver?.command ?? (!selected ? executableInPath(route.harness) : undefined);
    result.command = { executable: command ?? null,
      source: options.command !== undefined ? 'explicit' : receiver ? 'recorded-receiver' : selected ? 'recorded-endpoint' : 'PATH' };
    const log = resolve(options.log ?? receiver?.log ??
      join(`${database}.transcripts`, Buffer.from(sessionId).toString('hex'), requestId, 'native.jsonl'));
    result.outputLog = selected && !options.command && options.log === undefined ? receiver?.log ?? null : log;
    let profile = null;
    if (named?.profile) {
      const store = resolveRouteProfile(saved, route.harness, named.profile);
      if (!store) fail('taskProfileMissing', `No ${route.harness} subscription profile names ${named.profile}.`,
        `Correct the named route or its subscriptions in ${settingsPath}.`);
      profile = { label: named.profile, store };
    }
    if (selected && options.log !== undefined && options.command === undefined) fail('taskLogRequiresCommand',
      'An output log override requires the receiver command.', 'Pass --command with --output-log.');
    if (selected && route.harness !== selected.harness && !options.command) fail('taskHarnessChangeRequiresCommand',
      'A changed harness requires its native executable.', 'Pass --command for the selected harness.');
    if (!registered && registerProject) {
      native('project', projectPath);
    }
    if (!selected) {
      mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
      if (sender === 'operator') {
        native('start-setup', sessionId, route.harness, command, route.model, route.effort, workspace, log);
      } else {
        native('join', sessionId, sender, route.harness, route.model, route.effort, workspace);
        native('receiver', sessionId, command, log);
      }
    } else {
      const changed = ['harness', 'model', 'effort'].some((field) => route[field] !== selected[field]);
      if (changed) {
        if (command) mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
        native('configure', sessionId, route.harness, route.model, route.effort,
          command ?? '', log, selected.harness, selected.model, selected.effort);
      }
      if (options.command !== undefined) {
        mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
        native('receiver', sessionId, options.command, log);
      }
    }
    if (profile) native('profile-bind', sessionId, route.harness, profile.label, profile.store);
    const admission = call([database, 'message-batch-file', sender, '-'],
      JSON.stringify([{ id, recipient: sessionId,
        kind, body }]) + '\n')[0];
    result.admission = admission;
    result.currentSession = native('session', sessionId);
    if (admission.admission?.status !== 'admitted') fail('taskAdmissionRefused',
      admission.admission?.cause ?? JSON.stringify(admission), 'Inspect the retained input and session; explicit stops remain effective.');
    result.status = admission.status === 'pending' || admission.wake?.status === 'refused' ? 'pending' : 'admitted';
    result.next = result.status === 'pending' ? 'Inspect the retained wake cause and receiver, then resume the same session.' :
      'Inspect the recorded input and recipient receipt; admission does not establish task completion.';
  } catch (error) {
    result = { ...result, status: result.admission?.admission?.status === 'admitted' ? 'pending' : 'refused',
      error: { reason: error.reason ?? error.code ?? 'taskSetupFailed', detail: error.message,
        next: error.next ?? 'Inspect the retained input and setup result before retrying.' },
      exitCode: error instanceof TaskFailure ? error.code : 1 };
    if (!recordAttempted) {
      try { recordInput(); }
      catch (recordError) {
        result.inputRecordError = { reason: recordError.reason ?? recordError.code ?? 'taskInputRecordFailed',
          detail: recordError.message };
      }
    }
    if (result.session && existsSync(database)) {
      try { result.currentSession = native('session', result.session); }
      catch (inspectionError) { result.sessionInspectionError = inspectionError.message; }
    }
  }
  if (requestRecorded) {
    try { call([database, 'task-input-result', requestId, '-'], JSON.stringify(result) + '\n', false); }
    catch (error) {
      result.resultRecordError = { reason: error.reason ?? error.code ?? 'taskInputResultFailed', detail: error.message };
      result.exitCode = 1;
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , flag, executable, dbFlag, database, ...argv] = process.argv;
  if (flag !== '--baton2' || dbFlag !== '--database') {
    process.stderr.write(help); process.exitCode = 2;
  } else {
    const result = startTask(executable, database, argv);
    process.stdout.write(result.status === 'help' ? result.help : JSON.stringify(result) + '\n');
    process.exitCode = result.exitCode ?? (result.status === 'pending' || result.status === 'refused' ? 2 : 0);
  }
}
