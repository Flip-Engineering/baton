import { spawn } from 'node:child_process';

export class BatonSandbox {
  constructor({ host = 'atari-homelab', remoteRoot = '/mnt/nvme4tb/bug-bounty-workers/repository' } = {}) {
    this.host = host;
    this.remoteRoot = remoteRoot;
  }

  request(request, service = 'worker-runtime.py', { signal } = {}) {
    if (!['worker-runtime.py', 'host-bridge.py'].includes(service)) throw new Error('Unknown host service');
    if (!/^[a-zA-Z0-9.-]+$/.test(this.host) || !/^\/mnt\/nvme4tb\/[a-zA-Z0-9/_.-]+$/.test(this.remoteRoot)) {
      throw new Error('Invalid trusted-host configuration');
    }
    return new Promise((resolve, reject) => {
      const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', this.host, 'sudo', '-n',
        '/usr/bin/python3', this.remoteRoot + '/scripts/' + service], { stdio: ['pipe', 'pipe', 'pipe'], signal });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => {
        if (code !== 0) return reject(new Error('Host service refused request: ' + stderr.trim()));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Host returned an invalid receipt')); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  async create(spec) {
    const response = await this.request({ ...spec, operation: 'create' });
    const result = response.result;
    return { worker_id: spec.worker_id, instance: result.instance, owner: result.owner, fence: result.fence, receipt: response };
  }

  operation(lease, operation, arguments_ = {}) {
    return this.request({ ...arguments_, ...lease, receipt: undefined, operation });
  }

  execute(lease, argv, timeout_seconds) {
    return this.operation(lease, 'exec', { argv, timeout_seconds });
  }

  recoverError(lease) { return this.operation(lease, 'recover_error'); }
  release(lease) { return this.operation(lease, 'release'); }
  reconcile() { return this.request({ operation: 'reconcile' }); }
}

