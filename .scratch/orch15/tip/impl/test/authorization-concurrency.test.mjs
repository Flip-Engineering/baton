import test from 'node:test';
import assert from 'node:assert/strict';
import { BatonApplication } from '../src/application.mjs';

const principal = { actor: 'test:caller', principalId: 'caller', sessionId: 'session' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('concurrent application requests cannot inherit another request authorization override', async () => {
  const app = Object.create(BatonApplication.prototype);
  app.repoId = 'repo';
  app.authorize = async () => false;
  const started = deferred();
  const release = deferred();
  app._commandDispatch = async (name) => {
    if (name === 'permitted') { started.resolve(); await release.promise; }
    await app._authorize(name, principal, 'run');
    return name;
  };
  const permitted = app.command('permitted', {}, principal, null, { authorize: async () => true });
  await started.promise;
  await assert.rejects(app.command('unrelated', {}, principal), { code: 'application_unauthorized' });
  await assert.rejects(app.command('explicitly-denied', {}, principal, null,
    { authorize: async () => false }), { code: 'application_unauthorized' });
  release.resolve();
  assert.equal(await permitted, 'permitted');
  await assert.rejects(app.command('later', {}, principal), { code: 'application_unauthorized' });
});
