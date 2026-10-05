#!/usr/bin/env node
// Controlled clangd transport for the managed lifecycle cases (group L).
//
// The fixture speaks the LSP subset the coordinator's clangd diagnostics
// lifecycle needs, over stdin/stdout with Content-Length framing. It parses no
// C source, reads no compilation database and touches no project file.
//
//   CLANGD_FIXTURE_SCENARIO  publication timeline name, default "exact"
//   CLANGD_FIXTURE_LOG       optional path; every received and sent frame is
//                            appended there as one JSON line
//
// Timelines are driven by setTimeout. A didOpen schedules its steps and the
// handler returns; later steps never wait for another client frame.

import { appendFileSync, writeSync } from "node:fs";

const VERSION_LINE = "clangd version 20.1.8 (fixture transport)";
const SCENARIO = process.env.CLANGD_FIXTURE_SCENARIO || "exact";
const LOG_PATH = process.env.CLANGD_FIXTURE_LOG || "";
const OTHER_URI = "file:///fixture-other.c";

// Delay before the first timeline step and between steps that do not state
// their own delay.
const STEP_DELAY_MS = 150;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  writeSync(1, VERSION_LINE + "\n");
  process.exit(0);
}

function record(direction, message) {
  if (!LOG_PATH) return;
  appendFileSync(LOG_PATH, JSON.stringify({ direction, message }) + "\n");
}

// writeSync on fd 1 returns after the bytes reach the pipe, so every frame is
// flushed before the next statement runs. process.stdout is not used: its pipe
// writes complete asynchronously on POSIX.
function send(message) {
  const body = JSON.stringify(message);
  writeFrame(body);
  record("send", message);
}

function writeFrame(body) {
  const frame = Buffer.from(
    "Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body,
    "utf8"
  );
  let offset = 0;
  while (offset < frame.length) {
    offset += writeSync(1, frame, offset);
  }
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function publish(uri, version) {
  notify("textDocument/publishDiagnostics", { uri, version, diagnostics: [] });
}

let hoverRequests = 0;

function onHover(id) {
  hoverRequests += 1;
  if (SCENARIO === "failure" && hoverRequests === 1) {
    respondError(id, -32001, "fixture transport failure");
    return;
  }
  respond(id, { contents: { kind: "plaintext", value: "fixture transport" } });
}

// Each step names the delay to apply before it runs.
function timeline(uri, version) {
  switch (SCENARIO) {
    case "no-publication":
    case "failure":
      return [];
    case "idle":
      return [
        {
          delay: STEP_DELAY_MS,
          run: () => notify("clangd/fileStatus", { uri, state: "idle" }),
        },
      ];
    case "wrong-version":
      return [
        { delay: STEP_DELAY_MS, run: () => publish(uri, version + 1) },
        { delay: 200, run: () => publish(uri, version) },
      ];
    case "wrong-uri":
      return [
        { delay: STEP_DELAY_MS, run: () => publish(OTHER_URI, version) },
        { delay: 200, run: () => publish(uri, version) },
      ];
    case "exit-failure":
      return [{ delay: 300, run: () => process.exit(3) }];
    case "exact":
    default:
      return [{ delay: STEP_DELAY_MS, run: () => publish(uri, version) }];
  }
}

function onDidOpen(params) {
  const textDocument = params.textDocument || {};
  const uri = typeof textDocument.uri === "string" ? textDocument.uri : "";
  const version = Number.isInteger(params.version)
    ? params.version
    : textDocument.version;
  let delay = 0;
  for (const step of timeline(uri, version)) {
    delay += step.delay;
    setTimeout(step.run, delay);
  }
}

function handle(message) {
  const method = message.method;
  const id = message.id;
  const params = message.params || {};
  const isRequest = typeof id === "number" || typeof id === "string";
  switch (method) {
    case "initialize":
      respond(id, {
        capabilities: {
          textDocumentSync: 2,
          hoverProvider: true,
          definitionProvider: true,
        },
      });
      return;
    case "initialized":
      return;
    case "textDocument/didOpen":
      onDidOpen(params);
      return;
    case "textDocument/hover":
      if (isRequest) onHover(id);
      return;
    case "textDocument/definition":
      respond(id, []);
      return;
    case "shutdown":
      respond(id, null);
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      // A response frame carries no method; nothing to answer.
      if (method === undefined) return;
      if (isRequest) respondError(id, -32601, "method not found: " + method);
      return;
  }
}

// Stdin is a byte stream; Content-Length counts bytes, so the parse buffer
// holds bytes and the header is read as latin1.
let buffer = Buffer.alloc(0);

function headerBoundary() {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { end: crlf, width: 4 };
  if (lf >= 0) return { end: lf, width: 2 };
  return null;
}

function feed(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const boundary = headerBoundary();
    if (boundary === null) return;
    const header = buffer.subarray(0, boundary.end).toString("latin1");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (match === null) {
      buffer = buffer.subarray(boundary.end + boundary.width);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = boundary.end + boundary.width;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      record("recv-unparsed");
      continue;
    }
    record("recv", message);
    handle(message);
  }
}

process.stdin.on("data", feed);
process.stdin.on("end", () => process.exit(0));
