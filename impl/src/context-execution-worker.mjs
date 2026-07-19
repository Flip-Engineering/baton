import { StatelessContextBench } from './context-program.mjs';
import { produceRepositoryContextSource } from './context-runtime.mjs';

function send(value) {
  process.send(value, (error) => {
    if (error) process.exitCode = 1;
    process.disconnect();
  });
}

process.once('message', (request) => {
  const nonce = request?.nonce;
  try {
    if (request?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(nonce ?? '')) {
      throw Object.assign(new Error('Repository Context worker protocol is invalid'), {
        code: 'context_execution_protocol_invalid',
      });
    }
    let value;
    if (request?.operation === 'source') {
      const { repoRoot, treeSha, scopes, policy, gitAuthority } = request.payload ?? {};
      value = produceRepositoryContextSource(repoRoot, treeSha, scopes, policy, gitAuthority);
    } else if (request?.operation === 'execute') {
      const {
        artifactRoot, environmentDigest, policy, manifest, program,
      } = request.payload ?? {};
      const bench = new StatelessContextBench({
        artifactRoot, sources: {}, environmentDigest, policy,
      });
      value = bench.execute({ manifest, program });
    } else {
      throw Object.assign(new Error('Repository Context worker operation is invalid'), {
        code: 'context_execution_failed',
      });
    }
    send({ schemaVersion: 1, nonce, ok: true, value });
  } catch (error) {
    send({
      schemaVersion: 1,
      nonce,
      ok: false,
      error: {
        message: typeof error?.message === 'string' ? error.message : 'Repository Context worker failed',
        code: typeof error?.code === 'string' ? error.code : 'context_execution_failed',
      },
    });
  }
});
