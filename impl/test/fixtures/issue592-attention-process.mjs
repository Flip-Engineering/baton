import { CoordinationStore } from '../../src/coordination-store.mjs';
import { rootAttentionObligations } from '../../src/attention-obligations.mjs';

const store = new CoordinationStore(process.argv[2]);
store.claimWriterLease();
process.on('message', async ({ id, action, kind, payload, key }) => {
  try {
    let result;
    if (action === 'swarm') result = { event: store.recordSwarm(kind, payload, { actor: 'owner', key }) };
    else if (action === 'driver') result = store.recordDriver(kind, payload, { actor: 'owner', key });
    else if (action === 'read') result = rootAttentionObligations(store.swarm('attention-test'), store.eventsView());
    else throw new Error(`Unknown test action ${action}`);
    if (action !== 'read') {
      // The IPC receipt follows the production commit boundary used by delivery consumers.
      await store.waitForCommit(result.event.seq - 1);
    }
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: { message: error.message, code: error.code } });
  }
});
process.send({ ready: true });
