import { BatonSandbox } from './vendor/baton-sandbox.mjs';

/**
 * Adapts the existing Baton sandbox/mutator lease integration to bag workers.
 * The adapter deliberately owns only worker lifecycle; Baton still owns task
 * admission, completion, and Git integration authority.
 */
export class BeeMutatorAdapter {
  constructor({ sandbox = null, host = 'atari-homelab', remoteRoot = '/mnt/nvme4tb/bug-bounty-workers/repository' } = {}) {
    this.sandbox = sandbox ?? new BatonSandbox({ host, remoteRoot });
  }

  async create(role, spec = {}) {
    return this.sandbox.create({ worker_id: role, ...spec });
  }

  async execute(lease, argv, timeoutSeconds = 300) {
    return this.sandbox.execute(lease, argv, timeoutSeconds);
  }

  async release(lease) {
    return this.sandbox.release(lease);
  }

  async reconcile() {
    return this.sandbox.reconcile();
  }
}
