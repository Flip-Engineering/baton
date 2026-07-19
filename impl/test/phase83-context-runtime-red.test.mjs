import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, openBaton } from '../src/index.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, DurableContextSession, StatelessContextBench,
  contextValueDigest,
} from '../src/context-program.mjs';
import {
  RepositoryContextRuntime, defaultRepositoryContextPolicy,
} from '../src/context-runtime.mjs';
import { pathInScopes } from '../src/path-scope.mjs';

const route = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

test('CR83-0: repository Context uses the canonical star, double-star, and question scope dialect', () => {
  assert.equal(pathInScopes('root.mjs', ['*']), true);
  assert.equal(pathInScopes('src/root.mjs', ['*']), false);
  assert.equal(pathInScopes('src/root.mjs', ['src/*.mjs']), true);
  assert.equal(pathInScopes('src/nested/root.mjs', ['src/*.mjs']), false);
  assert.equal(pathInScopes('src/a.mjs', ['src/?.mjs']), true);
  assert.equal(pathInScopes('src/nested/root.mjs', ['src/**']), true);
  assert.equal(pathInScopes('src/root.mjs', ['src/**/*.mjs']), true);
  assert.equal(pathInScopes('src/nested/root.mjs', ['src/**/*.mjs']), true);
  assert.equal(pathInScopes('root.mjs', ['**/*.mjs']), true);
  assert.equal(pathInScopes('nested/root.mjs', ['**/*.mjs']), true);
  assert.equal(pathInScopes('src/root.js', ['src/**/*.mjs']), false);
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase83-context-runtime-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase83@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 83'], { cwd: root });
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.docker'));
  mkdirSync(join(root, 'credentials'));
  writeFileSync(join(root, 'src', 'context-target.mjs'), [
    "export const durableContextMarker = 'context-runtime-restart-proof';",
    '',
  ].join('\n'));
  writeFileSync(join(root, 'glm_key.json'), JSON.stringify({ api_key: 'secret-must-not-project' }));
  writeFileSync(join(root, '.docker', 'config.json'), JSON.stringify({
    auths: { registry: { auth: 'secret-must-not-project' } },
  }));
  writeFileSync(join(root, 'credentials', 'config.json'), JSON.stringify({
    token: 'secret-must-not-project',
  }));
  writeFileSync(join(root, 'src', 'embedded-secret.json'), JSON.stringify({
    api_key: 'secret-must-not-project',
  }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'context fixture'], { cwd: root });
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'candidate.txt', content: 'provider candidate\n', delayMs: 30_000 }],
    },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase83-context-runtime-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

function options(repo, deploymentRoot) {
  return {
    repo,
    advanced: {
      deploymentRoot,
      routes: [route],
      adapters: { codex: adapter() },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

function contextRuntime(repo, artifactRoot) {
  const treeSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo, encoding: 'utf8',
  }).trim();
  return new RepositoryContextRuntime({
    artifactRoot,
    policy: defaultRepositoryContextPolicy(),
    repoId: 'repo-phase83-owned-execution',
    repoRoot: repo,
    treeSha,
  });
}

function sourcePayload(runtime) {
  return {
    repoRoot: runtime.repoRoot,
    treeSha: runtime.treeSha,
    scopes: ['**'],
    policy: runtime.policy,
  };
}

function readBranchSource(runtime, branch) {
  return runtime.bench.readReference({
    kind: 'context_source', ref: branch.ref, digest: branch.digest,
    mediaType: branch.mediaType, itemCount: branch.itemCount,
  });
}

function executableAuthority(path) {
  const resolved = realpathSync(path);
  const stat = statSync(resolved);
  const core = {
    schemaVersion: 1,
    kind: 'baton.context_git_executable',
    path: resolved,
    binaryDigest: createHash('sha256').update(readFileSync(resolved)).digest('hex'),
    bytes: stat.size,
    device: String(stat.dev),
    inode: String(stat.ino),
  };
  return Object.freeze({ ...core, authorityDigest: contextValueDigest(core) });
}

function instrumentedGit(root, sentinelName, sentinelValue) {
  const path = join(root, 'phase83-instrumented-git.mjs');
  const observations = join(root, 'phase83-boundary-observations.jsonl');
  writeFileSync(path, [
    `#!${process.execPath}`,
    "import { execFileSync, spawnSync } from 'node:child_process';",
    "import { appendFileSync } from 'node:fs';",
    `const sentinelName = ${JSON.stringify(sentinelName)};`,
    `const sentinelValue = ${JSON.stringify(sentinelValue)};`,
    `const observations = ${JSON.stringify(observations)};`,
    "const parent = execFileSync('/bin/ps', ['eww', '-p', String(process.ppid)], { encoding: 'utf8' });",
    'appendFileSync(observations, `${JSON.stringify({',
    "  gitChildHasSentinel: process.env[sentinelName] === sentinelValue,",
    '  ownedProcessHasSentinel: parent.includes(`${sentinelName}=${sentinelValue}`),',
    "})}\\n`);",
    "const result = spawnSync('/usr/bin/git', process.argv.slice(2), { env: process.env, stdio: 'inherit' });",
    'if (result.error) throw result.error;',
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n'));
  chmodSync(path, 0o700);
  return { authority: executableAuthority(path), observations };
}

function runtimeSessionAuthority(runtime) {
  const node = { key: 'attempt:root', pathScope: ['**'] };
  const current = {
    goal: {
      runId: 'run-phase83-attestation', repoId: runtime.repoId,
      goalId: 'goal-phase83-attestation', version: 1, digest: '1'.repeat(64),
    },
    plan: {
      repoId: runtime.repoId, planId: `plan:${'2'.repeat(64)}`,
      version: 1, digest: '3'.repeat(64), nodes: [node],
    },
    dispatches: [{
      taskId: 'task-phase83-attestation', binding: { nodeKey: node.key },
    }],
  };
  const task = {
    id: 'task-phase83-attestation', status: 'working', version: 2,
    createdEvent: 10, claimedEvent: 11,
  };
  const sessionState = {
    sessionId: 'context-session-phase83-attestation', state: 'active',
  };
  const coordination = {
    contextSession: () => sessionState,
    task: () => task,
    events: () => [{
      kind: 'driver.recorded',
      payload: {
        kind: 'application.workflow_definition_bound', repoId: runtime.repoId,
        runId: current.goal.runId, planDigest: current.plan.digest,
        definitionDigest: '4'.repeat(64),
      },
    }],
    snapshot: () => ({ context: { sessions: [] } }),
    admitContextSession: () => ({ session: sessionState }),
    admitContextCell: () => { throw new Error('unused Context cell seam'); },
    settleContextCell: () => { throw new Error('unused Context settlement seam'); },
  };
  return {
    authority: { current, nodeKey: node.key, role: 'builder' },
    coordination,
    principal: {
      actor: 'deployment:context', principalId: 'service-context',
      repoId: runtime.repoId, runId: current.goal.runId,
    },
  };
}

test('CR83-3: shutdown closes Context admission before an authorized action can register late',
  async (t) => {
    const repo = repository();
    const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-closing-'));
    const enteredAuthorization = deferred();
    const releaseAuthorization = deferred();
    const originalAuthorize = BatonApplication.prototype._authorize;
    let deployment;
    let intercepted = false;
    t.after(async () => {
      BatonApplication.prototype._authorize = originalAuthorize;
      try { await deployment?.close(); } catch {}
      rmSync(repo, { recursive: true, force: true });
      rmSync(deploymentRoot, { recursive: true, force: true });
    });

    deployment = await openBaton(options(repo, deploymentRoot));
    const workflow = await deployment.workflow('Close Context admission atomically.', {
      team: [
        { role: 'builder', exact: route },
        { role: 'auditor', exact: route },
      ],
    });
    await workflow.approve();
    BatonApplication.prototype._authorize = async function authorizeWithActionBarrier(
      command, principal, runId, subject,
    ) {
      if (!intercepted && command === 'run.status' && subject?.operation === 'act') {
        intercepted = true;
        enteredAuthorization.resolve();
        await releaseAuthorization.promise;
      }
      return originalAuthorize.call(this, command, principal, runId, subject);
    };

    const action = workflow.context().search('context-runtime-restart-proof', {
      role: 'builder',
    });
    const observed = action.then(
      () => ({ completed: true, error: null }),
      (error) => ({ completed: false, error }),
    );
    await enteredAuthorization.promise;
    const closing = deployment.close();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    releaseAuthorization.resolve();

    const outcome = await observed;
    assert.equal(outcome.completed, false);
    assert.ok(['application_closing', 'application_closed'].includes(outcome.error?.code));
    assert.equal((await closing).state, 'closed');
    const events = readFileSync(
      join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
    ).trimEnd().split('\n').map(JSON.parse);
    assert.equal(events.some((event) => event.kind === 'context.cell_admitted'), false,
      'shutdown must not miss a Context cell admitted after its controller snapshot');
  });

test('CR83-4: an executor abort leaves the durable pure cell admitted instead of poisoning it failed',
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'baton-phase83-context-abort-cell-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const environmentDigest = '4'.repeat(64);
    const text = 'durable executor abort authority';
    const bytes = Buffer.from(text);
    const source = [{
      path: 'impl/src/context-runtime.mjs', chunk: 0,
      gitBlobOid: createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`))
        .update(bytes).digest('hex'),
      byteStart: 0, byteEnd: bytes.byteLength, contentDigest: contextValueDigest(text),
      language: 'mjs', text,
    }];
    const bench = new StatelessContextBench({
      artifactRoot: join(root, 'artifacts'), sources: {}, environmentDigest,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    const sourceRef = bench.admitSource(source);
    const manifest = {
      schemaVersion: 1, kind: 'baton.context_manifest', repoId: 'repo-phase83-abort',
      tree: { sha: '1'.repeat(40), source: 'deployment_snapshot' },
      workflow: {
        runId: 'run-phase83-abort', definitionDigest: '2'.repeat(64),
        goal: { goalId: 'goal-phase83-abort', version: 1, digest: '3'.repeat(64) },
        plan: { planId: `plan:${'8'.repeat(64)}`, version: 1, digest: '5'.repeat(64) },
        node: { key: 'attempt:root', digest: '6'.repeat(64) },
        task: {
          taskId: 'task-phase83-abort', version: 2, createdEvent: 10, claimedEvent: 11,
        },
      },
      branches: [{
        name: 'repository', ref: sourceRef.ref, digest: sourceRef.digest,
        mediaType: sourceRef.mediaType, itemCount: sourceRef.itemCount,
        summary: 'one immutable test source',
      }],
      policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
    };
    let cell = null;
    let settlementCalls = 0;
    const coordination = {
      admitContextSession: () => ({
        session: { sessionId: 'context-session-phase83-abort', state: 'active' },
      }),
      contextSession: () => ({ sessionId: 'context-session-phase83-abort', state: 'active' }),
      admitContextCell: ({ sessionId, program }) => {
        cell = {
          cellId: `cell:${program.programDigest}`, sessionId, ordinal: 1,
          state: 'admitted', version: 1, admissionDigest: '7'.repeat(64), program,
        };
        return { cell };
      },
      settleContextCell: () => {
        settlementCalls += 1;
        cell = { ...cell, state: 'failed', version: 2 };
        return { cell };
      },
      contextCell: () => cell,
      contextCellArtifacts: () => null,
      snapshot: () => ({ context: { cells: cell ? [cell] : [] } }),
    };
    const session = new DurableContextSession({
      coordination, bench, manifest,
      principal: {
        actor: 'deployment:context', principalId: 'service-context',
        repoId: 'repo-phase83-abort', runId: 'run-phase83-abort',
      },
      execute: async () => {
        throw Object.assign(new Error('deployment closed the owned executor'), {
          code: 'context_execution_aborted',
        });
      },
    });

    await assert.rejects(session.search('abort authority'),
      (error) => error?.code === 'context_execution_aborted');
    assert.equal(settlementCalls, 0);
    assert.equal(cell.state, 'admitted');
    assert.equal(cell.version, 1);
  });

test('CR83-5: owned execution settles only after exit and abort wins over a posted result',
  async (t) => {
    const repo = repository();
    const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-owned-'));
    t.after(() => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(artifactRoot, { recursive: true, force: true });
    });

    const completedRuntime = contextRuntime(repo, join(artifactRoot, 'completed'));
    const completed = completedRuntime._executeOwned('source', sourcePayload(completedRuntime));
    const completedExecution = [...completedRuntime.executions][0];
    assert.ok(completedExecution, 'the owned execution must be registered before returning');
    let completedExit = false;
    completedExecution.once('exit', () => { completedExit = true; });
    await completed;
    assert.equal(completedExit, true,
      'result delivery cannot resolve the caller before owned execution exit');
    assert.equal(completedRuntime.executions.size, 0,
      'ownership remains registered until the execution exits');

    const abortedRuntime = contextRuntime(repo, join(artifactRoot, 'aborted'));
    const controller = new AbortController();
    const aborted = abortedRuntime._executeOwned(
      'source', sourcePayload(abortedRuntime), controller.signal,
    );
    const abortedExecution = [...abortedRuntime.executions][0];
    assert.ok(abortedExecution, 'the abortable owned execution must be registered');
    let abortedExit = false;
    abortedExecution.once('exit', () => { abortedExit = true; });
    abortedExecution.once('message', () => { controller.abort(); });
    await assert.rejects(aborted, (error) => error?.code === 'context_execution_aborted');
    assert.equal(abortedExit, true, 'abort cannot settle until execution exit confirms reap');
    assert.equal(abortedRuntime.executions.size, 0,
      'aborted execution ownership remains registered until reap');
  });

test('CR83-6: provider-secret sentinels are absent in owned execution and its Git child',
  async (t) => {
    const repo = repository();
    const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-secret-boundary-'));
    const sentinelName = 'BATON_PHASE83_PROVIDER_SECRET_SENTINEL';
    const sentinelValue = 'safe-test-sentinel-never-a-real-secret';
    const prior = process.env[sentinelName];
    t.after(() => {
      if (prior === undefined) delete process.env[sentinelName];
      else process.env[sentinelName] = prior;
      rmSync(repo, { recursive: true, force: true });
      rmSync(artifactRoot, { recursive: true, force: true });
    });

    const runtime = contextRuntime(repo, join(artifactRoot, 'artifacts'));
    const instrumented = instrumentedGit(artifactRoot, sentinelName, sentinelValue);
    runtime.gitAuthority = instrumented.authority;
    process.env[sentinelName] = sentinelValue;
    const produced = await runtime._executeOwned('source', sourcePayload(runtime));
    assert.ok(produced.items.length > 0);
    const fixture = runtimeSessionAuthority(runtime);
    runtime.attachCoordination(fixture.coordination);
    const session = await runtime.openSession({
      authority: fixture.authority, principal: fixture.principal,
    });
    const executing = runtime._executeOwned('execute', {
      artifactRoot: runtime.bench.artifactRoot,
      environmentDigest: runtime.environmentDigest,
      policy: runtime.policy,
      manifest: session.manifest,
      program: {
        schemaVersion: 1, kind: 'baton.context_program',
        expression: { op: 'coverage', input: { op: 'source', branch: 'repository' } },
      },
    });
    const executeProcess = [...runtime.executions][0];
    assert.ok(executeProcess, 'the owned execute process must remain observable while registered');
    const executeEnvironment = execFileSync(
      '/bin/ps', ['eww', '-p', String(executeProcess.pid)], { encoding: 'utf8' },
    );
    assert.equal(executeEnvironment.includes(`${sentinelName}=${sentinelValue}`), false,
      'the owned execute operation must not inherit provider secrets');
    await executing;
    const observations = readFileSync(instrumented.observations, 'utf8')
      .trimEnd().split('\n').map(JSON.parse);
    assert.ok(observations.length >= 3, 'commit, tree, and blob reads must cross the seam');
    assert.equal(observations.every((row) => row.ownedProcessHasSentinel === false), true,
      'the detached owned process must not inherit provider secrets');
    assert.equal(observations.every((row) => row.gitChildHasSentinel === false), true,
      'the immutable Git child must not inherit provider secrets');
  });

test('CR83-7: a public runtime map cannot forge private source-attestation capability',
  async (t) => {
    const repo = repository();
    const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-attestation-map-'));
    t.after(() => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(artifactRoot, { recursive: true, force: true });
    });

    const runtime = contextRuntime(repo, artifactRoot);
    const fixture = runtimeSessionAuthority(runtime);
    runtime.attachCoordination(fixture.coordination);
    const session = await runtime.openSession({
      authority: fixture.authority, principal: fixture.principal,
    });
    const branch = session.index()[0];
    const source = readBranchSource(runtime, branch);
    const genuine = runtime.attestSource({ manifest: session.manifest, branch, source });
    assert.equal(Object.hasOwn(runtime, 'sourceAttestations'), false);

    const inventedSource = source.map((item, index) => (
      index === 0 ? { ...item, path: 'src/invented-by-public-map.mjs' } : item
    ));
    const inventedRef = runtime.bench.admitSource(inventedSource);
    const inventedBranch = {
      ...branch, ref: inventedRef.ref, digest: inventedRef.digest,
      mediaType: inventedRef.mediaType, itemCount: inventedRef.itemCount,
    };
    const inventedManifest = { ...session.manifest, branches: [inventedBranch] };
    const forgedCore = {
      ...genuine,
      sourceRef: inventedBranch.ref,
      sourceDigest: inventedBranch.digest,
      itemCount: inventedBranch.itemCount,
    };
    runtime.sourceAttestations = new Map([[inventedBranch.ref, {
      ...forgedCore, receiptDigest: contextValueDigest(forgedCore),
    }]]);

    assert.throws(() => runtime.attestSource({
      manifest: inventedManifest, branch: inventedBranch, source: inventedSource,
    }), (error) => error?.code === 'context_source_attestation_invalid');
  });

test('CR83-8: invented paths and path or blob substitutions lack producer authority',
  async (t) => {
    const repo = repository();
    const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-substitution-'));
    t.after(() => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(artifactRoot, { recursive: true, force: true });
    });

    const runtime = contextRuntime(repo, artifactRoot);
    const fixture = runtimeSessionAuthority(runtime);
    runtime.attachCoordination(fixture.coordination);
    const session = await runtime.openSession({
      authority: fixture.authority, principal: fixture.principal,
    });
    const branch = session.index()[0];
    const source = readBranchSource(runtime, branch);
    assert.ok(source.length > 0);
    assert.doesNotThrow(() => runtime.attestSource({ manifest: session.manifest, branch, source }));

    const inventedPath = source.map((item, index) => (
      index === 0 ? { ...item, path: 'src/not-in-pinned-tree.mjs' } : item
    ));
    assert.throws(() => runtime.attestSource({
      manifest: session.manifest, branch, source: inventedPath,
    }), (error) => error?.code === 'context_source_attestation_invalid');

    const substitutedBlob = source.map((item, index) => (
      index === 0 ? { ...item, gitBlobOid: 'f'.repeat(40) } : item
    ));
    assert.throws(() => runtime.attestSource({
      manifest: session.manifest, branch, source: substitutedBlob,
    }), (error) => error?.code === 'context_source_attestation_invalid');

    writeFileSync(join(repo, 'src', 'invented-after-commit.mjs'), 'invented worktree path\n');
    writeFileSync(join(repo, 'src', 'context-target.mjs'), 'substituted worktree bytes\n');
    const pinned = await runtime._executeOwned('source', sourcePayload(runtime));
    assert.equal(pinned.items.some((item) => item.path === 'src/invented-after-commit.mjs'), false);
    assert.equal(pinned.items.some((item) => /substituted worktree bytes/u.test(item.text)), false);
    assert.equal(pinned.items.some((item) => /context-runtime-restart-proof/u.test(item.text)), true);
  });

test('CR83-1: ordinary Workflow Context is source-grounded, credential-excluding, and restart-readable',
  async (t) => {
    const repo = repository();
    const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-runtime-deployment-'));
    let deployment;
    t.after(async () => {
      try { await deployment?.close(); } catch {}
      rmSync(repo, { recursive: true, force: true });
      rmSync(deploymentRoot, { recursive: true, force: true });
    });

    deployment = await openBaton(options(repo, deploymentRoot));
    const workflow = await deployment.workflow('Use immutable repository Context.', {
      team: [
        { role: 'builder', exact: route },
        { role: 'auditor', exact: route },
      ],
    });
    await workflow.approve();
    const cell = await workflow.context().search('context-runtime-restart-proof', {
      role: 'builder',
    });
    const output = await cell.output();
    assert.equal(output.items.length, 1);
    assert.equal(output.items[0].path, 'src/context-target.mjs');
    assert.match(output.items[0].text, /context-runtime-restart-proof/u);
    assert.doesNotMatch(JSON.stringify(output), /secret-must-not-project/u);
    const excluded = await workflow.context().search('secret-must-not-project', {
      role: 'builder',
    });
    assert.deepEqual((await excluded.output()).items, []);
    const contextOutline = await workflow.context().outline();
    assert.equal(contextOutline.sourceCoverage.state, 'filtered');
    assert.ok(contextOutline.sourceCoverage.excludedEntries >= 3);
    const contextIndex = await workflow.context().index();
    const sessionItem = contextIndex.section.items.find((item) => (
      item.value?.kind === 'session'
    ));
    assert.equal(sessionItem.value.sourceCoverage[0].complete, true);
    assert.ok(sessionItem.value.sourceCoverage[0].excludedSensitivePaths >= 2);
    assert.equal(existsSync(join(deploymentRoot, 'context')), true);
    assert.ok(readdirSync(join(deploymentRoot, 'context')).some((name) => name.endsWith('.json')));
    const admittedSession = readFileSync(
      join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
    ).trimEnd().split('\n').map(JSON.parse)
      .find((event) => event.kind === 'context.session_admitted');
    assert.equal(admittedSession.payload.schemaVersion, 2);
    assert.equal(admittedSession.payload.sourceAttestations.length, 1);
    assert.equal(admittedSession.payload.sourceAttestations[0].kind,
      'baton.context_source_attestation');
    assert.match(admittedSession.payload.sourceAttestations[0].proofDigest, /^[a-f0-9]{64}$/u);

    await workflow.stop('Prove Context survives the complete Run stop and deployment restart.');
    const runId = workflow.id;
    const cellId = cell.id;
    await deployment.close();
    deployment = await openBaton(options(repo, deploymentRoot));
    const reopened = deployment.open(runId);
    assert.deepEqual(await reopened.context().cell(cellId).output(), output);
    assert.equal((await reopened.context().outline()).cellCount, 2);
  });

test('CR83-2: Run stop fences and reaps an in-flight owned Context execution', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-reap-deployment-'));
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await openBaton(options(repo, deploymentRoot));
  const workflow = await deployment.workflow('Stop owned Context computation exactly.', {
    team: [
      { role: 'builder', exact: route },
      { role: 'auditor', exact: route },
    ],
  });
  await workflow.approve();
  await workflow.context().search('context-runtime-restart-proof', { role: 'builder' });

  const inFlight = workflow.context().search('query-with-no-repository-match', {
    role: 'builder',
  });
  const observed = inFlight.then(
    () => ({ completed: true, error: null }),
    (error) => ({ completed: false, error }),
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const stopped = await workflow.stop('Fence and reap the in-flight Context worker.');
  assert.equal(stopped.outline.phase, 'stopped');
  const outcome = await observed;
  assert.equal(outcome.completed, false);
  assert.ok([
    'context_execution_aborted', 'run_stopping', 'application_run_stopping',
  ].includes(outcome.error?.code));

  const events = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trimEnd().split('\n').map(JSON.parse);
  const cells = events.filter((event) => event.kind === 'context.cell_admitted');
  const stop = events.find((event) => event.kind === 'run.stop_admitted');
  assert.equal(cells.length, 2);
  assert.ok(stop.seq > cells[1].seq, 'stop must fence the already-admitted pure cell');
  assert.equal(events.some((event) => (
    event.kind === 'context.cell_settled'
    && event.payload.cellId === cells[1].payload.cell.cellId
    && event.seq > stop.seq
  )), false, 'a reaped Context worker cannot attach a late result');
  assert.ok(stop.payload.targetContextCellIds.includes(cells[1].payload.cell.cellId));
});

test('CR83-9: narrow write scope retains deployment-authorized repository Context read scope',
  async (t) => {
    const repo = repository();
    const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-context-scope-deployment-'));
    let deployment;
    t.after(async () => {
      try { await deployment?.close(); } catch {}
      rmSync(repo, { recursive: true, force: true });
      rmSync(deploymentRoot, { recursive: true, force: true });
    });

    deployment = await openBaton(options(repo, deploymentRoot));
    const workflow = await deployment.workflow('Audit code and write only one report.', {
      scope: ['reviews/phase83-context-scope.md'],
      team: [
        { role: 'builder', exact: route },
        { role: 'auditor', exact: route },
      ],
    });
    await workflow.approve();
    const cell = await workflow.context().search('context-runtime-restart-proof', {
      role: 'builder',
    });
    const output = await cell.output();
    assert.equal(output.items.length, 1);
    assert.equal(output.items[0].path, 'src/context-target.mjs');

    const events = readFileSync(
      join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
    ).trimEnd().split('\n').map(JSON.parse);
    const proposed = events.find((event) => event.kind === 'plan.version_proposed');
    for (const node of proposed.payload.plan.nodes) {
      assert.deepEqual(node.pathScope, ['reviews/phase83-context-scope.md']);
      assert.deepEqual(node.contextScope, ['**']);
    }
    await workflow.stop('Scope separation evidence captured; reap both workers.');
  });
