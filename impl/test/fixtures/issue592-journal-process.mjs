import { join } from 'node:path';
import { DeliveryJournal } from '../../src/delivery-journal.mjs';
import { CoordinationStore } from '../../src/coordination-store.mjs';

const [root, boundary, operation] = process.argv.slice(2);
const journal = new DeliveryJournal({
  root, repoId: 'journal-test', deploymentId: 'deployment-test',
  onPersistenceBoundary(name) { if (name === boundary) process.kill(process.pid, 'SIGKILL'); },
});
if (operation === 'checkpoint') journal.checkpoint();
else if (operation === 'import') {
  const store = new CoordinationStore(join(root, 'coordination'));
  store.claimWriterLease();
  const wait = store.waitForCommit.bind(store);
  store.waitForCommit = async (...args) => {
    const result = await wait(...args);
    if (boundary === 'import_commit') process.kill(process.pid, 'SIGKILL');
    return result;
  };
  await journal.importPending(store);
  store.releaseWriterLease();
} else journal.prepare({
  dispatchId: 'crashed', recipient: { kind: 'root' }, generation: 'generation-1',
  requestKey: 'native-crashed', itemKeys: ['obligation-crashed'], input: 'crash test input',
});
journal.close();
