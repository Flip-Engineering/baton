#!/usr/bin/env node
// Scripted fake clangd for adapter fixtures. The scenario comes from
// FAKE_CLANGD_SCENARIO; the server speaks real Content-Length LSP framing
// over stdio and never reads the files it is told about. Scenarios:
//   definition-ok      initialize, then answer textDocument/definition
//   definition-error   initialize, then fail textDocument/definition
//   publish-entry      after didOpen, publish one full diagnostic entry
//   publish-empty      after didOpen, publish an explicit empty array
//   publish-versionless after didOpen, publish without a version
//   exit-early         answer initialize, then exit
const scenario = process.env.FAKE_CLANGD_SCENARIO ?? 'definition-ok';

const stdin = process.stdin;
let buffer = Buffer.alloc(0);
let opened = null;

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf-8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function onMessage(message) {
  if (message.method === 'initialize') {
    reply(message.id, { capabilities: {}, serverInfo: { name: 'fake-clangd' } });
    if (scenario === 'exit-early') process.exit(0);
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'textDocument/didOpen') {
    opened = message.params.textDocument;
    if (scenario === 'publish-entry') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: opened.uri,
          version: opened.version,
          diagnostics: [
            {
              message: 'unused variable',
              range: {
                start: { line: 2, character: 6 },
                end: { line: 2, character: 7 },
              },
              severity: 1,
              code: 'unused-variable',
              source: 'clangd',
            },
          ],
        },
      });
    }
    if (scenario === 'publish-empty') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: opened.uri, version: opened.version, diagnostics: [] },
      });
    }
    if (scenario === 'publish-versionless') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: opened.uri, diagnostics: [] },
      });
      // The provider finishes its work and exits; the versionless
      // publication stays retained evidence that cannot complete.
      process.exit(0);
    }
    return;
  }
  if (message.method === 'textDocument/definition') {
    if (scenario === 'definition-error') {
      fail(message.id, -32603, 'boom');
      return;
    }
    reply(message.id, opened ? [{ uri: opened.uri, range: {} }] : null);
    return;
  }
  if (message.id !== undefined) reply(message.id, null);
}

function handleFrame(frame) {
  try {
    onMessage(JSON.parse(frame.toString('utf-8')));
  } catch {
    /* malformed fixture input: ignore */
  }
}

stdin.on('data', (d) => {
  buffer = Buffer.concat([buffer, d]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) return;
    const length = Number(match[1]);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return;
    const body = buffer.subarray(headerEnd + 4, total);
    buffer = buffer.subarray(total);
    handleFrame(body);
  }
});
stdin.on('end', () => process.exit(0));
