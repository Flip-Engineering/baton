// Minimal LSP over stdio for the one-shot clangd adapter.
// JSON-RPC framing: Content-Length headers separated by \r\n\r\n, body UTF-8.

export class LspConnection {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    this.exit = null;
    this.stderr = [];
    child.stdout.on('data', (d) => this.onData(d));
    child.on('close', (code, signal) => {
      this.closed = true;
      this.exit = { code, signal };
      for (const w of this.waiters.splice(0)) w();
    });
    child.stderr.on('data', (d) => this.stderr.push(d));
  }

  onData(d) {
    this.buffer = Buffer.concat([this.buffer, d]);
    // A complete frame needs its header terminator before parsing.
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) return; // malformed header: retained protocol evidence
      const length = Number(match[1]);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer
        .subarray(headerEnd + 4, total)
        .toString('utf-8');
      this.buffer = this.buffer.subarray(total);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return; // malformed body: retained protocol evidence
      }
      this.onMessage?.(message);
      for (const wake of this.waiters.splice(0)) wake();
    }
  }

  send(method, params) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }), 'utf-8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
    return this.nextId - 1;
  }

  notify(method, params) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, params }), 'utf-8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  nextId = 1;
  onMessage = null;

  stderrText() {
    return Buffer.concat(this.stderr).toString('utf-8');
  }

  // Resolves when a new message arrives or the connection closes. No timers:
  // silence never resolves to success or failure by itself.
  nextEvent() {
    return new Promise((resolvePromise) => {
      this.waiters.push(() => resolvePromise());
    });
  }

  kill() {
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

export function spawnLsp(argv, { spawnFn }) {
  const child = spawnFn(argv[0], argv.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new LspConnection(child);
}
