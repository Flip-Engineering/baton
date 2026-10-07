/**
 * Provider-direct probe for the C engine: drives external LLVM clang/clangd
 * 20.1.8 over the C fixture tree. This probe is acceptance tooling; it contains
 * no provider production code. AST and CFG facts are recomputed from the
 * provider on every run; nothing is ingested from retained research evidence.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { locate } from "../lib/util.mjs";

function runClang(clangPath, fixtureRoot, relativeFile, extraArgs) {
  const result = spawnSync(
    clangPath,
    ["-std=gnu89", "-Wall", "-Iinclude", ...extraArgs, relativeFile],
    { cwd: fixtureRoot, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  return {
    status: result.status,
    stdout: result.stdout ? result.stdout.toString("utf8") : "",
    stderr: result.stderr ? result.stderr.toString("utf8") : "",
  };
}

/** Minimal JSON-RPC client for one clangd session over stdio. */
class LspClient {
  constructor(command, args, cwd) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    this.child = spawn(this.command, this.args, { cwd: this.cwd });
    this.pending = new Map();
    this.responses = [];
    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stderr.on("data", () => {});
    return new Promise((resolve, reject) => {
      this.child.once("error", reject);
      this.child.once("spawn", resolve);
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (match === null) {
        return;
      }
      const length = Number(match[1]);
      if (this.buffer.length < headerEnd + 4 + length) {
        return;
      }
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const resolve = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve(message);
      } else {
        this.responses.push(message);
      }
    }
  }

  notify(method, params) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`clangd request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  #send(payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.child.stdin.write(Buffer.concat([head, body]));
  }

  async stop() {
    if (this.child === undefined || this.child.exitCode !== null) {
      return;
    }
    try {
      await this.request("shutdown", null, 5000);
      this.notify("exit");
    } catch {
      this.child.kill("SIGKILL");
    }
  }
}

function walkAst(node, visitor, parent = null) {
  if (node === null || typeof node !== "object") {
    return;
  }
  visitor(node, parent);
  const inner = node.inner;
  if (Array.isArray(inner)) {
    for (const child of inner) {
      walkAst(child, visitor, node);
    }
  }
}

function findFunction(tu, name) {
  const candidates = [];
  walkAst(tu, (node) => {
    if (node.kind === "FunctionDecl" && node.name === name) {
      candidates.push(node);
    }
  });
  if (candidates.length === 0) {
    return null;
  }
  const hasBody = (node) => (node.inner ?? []).some((child) => child.kind === "CompoundStmt");
  const inMainFile = (node) => node.loc?.includedFrom === undefined;
  return (
    candidates.find((node) => hasBody(node) && inMainFile(node)) ??
    candidates.find(hasBody) ??
    candidates.find(inMainFile) ??
    candidates[0]
  );
}

function functionBodyNode(fn) {
  return (fn.inner ?? []).find((child) => child.kind === "CompoundStmt") ?? null;
}

function sourceTextRange(text, node) {
  const range = node.range;
  if (range === undefined || range.begin.offset === undefined) {
    return null;
  }
  return text.slice(range.begin.offset, range.end.offset + (range.end.tokLen ?? 0));
}

function functionBodyText(text, fn) {
  if (fn.body === undefined) {
    return "";
  }
  const begin = fn.body.range.begin.offset;
  const end = fn.body.range.end.offset + (fn.body.range.end.tokLen ?? 1);
  return text.slice(begin, end);
}

/** Collect CallExprs inside one function body (no nested-function bodies in C). */
function collectCalls(tu, fn, text) {
  const calls = [];
  const body = functionBodyNode(fn);
  if (body === null) {
    return calls;
  }
  const begin = body.range.begin.offset;
  const end = body.range.end.offset + (body.range.end.tokLen ?? 1);
  walkAst(tu, (node, parent) => {
    if (node.kind !== "CallExpr") {
      return;
    }
    const offset = node.range?.begin?.offset;
    if (typeof offset !== "number" || offset < begin || offset > end) {
      return;
    }
    const callee = Array.isArray(node.inner) ? node.inner[0] : null;
    let resolvedName = null;
    let resolvedKind = null;
    let direct = false;
    if (callee !== null && (callee.kind === "DeclRefExpr" || callee.kind === "MemberExpr")) {
      const referenced = callee.referencedDecl ?? callee.memberDecl ?? null;
      if (referenced !== null) {
        resolvedName = referenced.name ?? null;
        resolvedKind = referenced.kind ?? null;
        direct = resolvedKind === "FunctionDecl";
      }
    }
    const argumentRefs = [];
    const arguments = Array.isArray(node.inner) ? node.inner.slice(1) : [];
    for (const argument of arguments) {
      walkAst(argument, (sub) => {
        if (sub.kind === "DeclRefExpr" && sub.referencedDecl !== undefined) {
          argumentRefs.push({
            name: sub.referencedDecl.name ?? null,
            kind: sub.referencedDecl.kind ?? null,
          });
        }
      });
    }
    const argumentTypes = (node.type !== undefined ? [node.type.qualType] : []);
    calls.push({
      offset,
      line: node.range?.begin?.line ?? null,
      col: node.range?.begin?.col ?? null,
      calleeKind: callee?.kind ?? null,
      resolvedName,
      resolvedKind,
      direct,
      callType: node.type?.qualType ?? null,
      parentKind: parent?.kind ?? null,
      argumentTypes,
      argumentRefs,
      sourceText: sourceTextRange(text, node),
    });
  });
  return calls.sort((a, b) => a.offset - b.offset);
}

/** Collect IfStmt conditions with resolved MemberExpr operands inside one function. */
function collectGuards(tu, fn, text) {
  const guards = [];
  const body = functionBodyNode(fn);
  if (body === null) {
    return guards;
  }
  const begin = body.range.begin.offset;
  const end = body.range.end.offset + (body.range.end.tokLen ?? 1);
  walkAst(tu, (node) => {
    if (node.kind !== "IfStmt") {
      return;
    }
    const offset = node.range?.begin?.offset;
    if (typeof offset !== "number" || offset < begin || offset > end) {
      return;
    }
    const cond = node.cond;
    const operands = [];
    walkAst(cond, (sub) => {
      if (sub.kind === "MemberExpr") {
        const member = sub.memberDecl ?? sub.referencedDecl ?? null;
        operands.push({
          kind: sub.kind,
          memberName: member?.name ?? null,
          memberKind: member?.kind ?? null,
          type: sub.type?.qualType ?? null,
          offset: sub.range?.begin?.offset ?? null,
        });
      }
      if (sub.kind === "DeclRefExpr") {
        operands.push({
          kind: sub.kind,
          memberName: sub.referencedDecl?.name ?? null,
          memberKind: sub.referencedDecl?.kind ?? null,
          type: sub.type?.qualType ?? null,
          offset: sub.range?.begin?.offset ?? null,
        });
      }
    });
    const thenReturns = [];
    if (node.then !== undefined) {
      walkAst(node.then, (sub) => {
        if (sub.kind === "ReturnStmt") {
          thenReturns.push({
            offset: sub.range?.begin?.offset ?? null,
            sourceText: sourceTextRange(text, sub),
          });
        }
      });
    }
    guards.push({
      offset,
      conditionText: cond !== undefined ? sourceTextRange(text, cond) : null,
      conditionSpelling: node.cond?.type?.qualType ?? null,
      operands,
      thenReturns,
    });
  });
  return guards.sort((a, b) => a.offset - b.offset);
}

function parseCfgDump(dumpText, functionName) {
  const lines = dumpText.split("\n");
  // Section the dump per function: a header line names the function signature.
  const sectionStarts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && lines[i].includes(functionName) && lines[i].includes("(")) {
      sectionStarts.push(i);
    }
  }
  if (sectionStarts.length === 0) {
    return [];
  }
  const start = sectionStarts[0];
  const end = sectionStarts.length > 1 ? sectionStarts[1] : lines.length;
  const blocks = [];
  let current = null;
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i];
    const blockMatch = /^\s*\[B(\d+)(?:\s*\((ENTRY|EXIT)\))?\]\s*$/.exec(line);
    if (blockMatch !== null) {
      current = {
        id: Number(blockMatch[1]),
        role: blockMatch[2] ?? null,
        statements: [],
        terminator: null,
        preds: [],
        succs: [],
      };
      blocks.push(current);
      continue;
    }
    if (current === null) {
      continue;
    }
    const stmtMatch = /^\s*(\d+):\s(.*)$/.exec(line);
    if (stmtMatch !== null) {
      current.statements.push(stmtMatch[2]);
      continue;
    }
    const terminatorMatch = /^\s*T:\s(.*)$/.exec(line);
    if (terminatorMatch !== null) {
      current.terminator = terminatorMatch[1];
      continue;
    }
    const predsMatch = /^\s*Preds\s*\((\d+)\):\s*(.*)$/.exec(line);
    if (predsMatch !== null) {
      current.preds = (predsMatch[2].match(/B\d+/g) ?? []).map((token) => Number(token.slice(1)));
      continue;
    }
    const succsMatch = /^\s*Succs\s*\((\d+)\):\s*(.*)$/.exec(line);
    if (succsMatch !== null) {
      current.succs = (succsMatch[2].match(/B\d+/g) ?? []).map((token) => Number(token.slice(1)));
    }
  }
  return blocks;
}

/** DeclRefExpr occurrences and simple assignments inside one function body. */
function collectRefs(tu, fn) {
  const refs = [];
  const assignments = [];
  const body = functionBodyNode(fn);
  if (body === null) {
    return { refs, assignments };
  }
  walkAst(tu, (node, parent) => {
    if (node.kind === "DeclRefExpr" && node.referencedDecl !== undefined) {
      refs.push({
        name: node.referencedDecl.name ?? null,
        kind: node.referencedDecl.kind ?? null,
        offset: node.range?.begin?.offset ?? null,
        parentKind: parent?.kind ?? null,
      });
    }
    if (
      node.kind === "BinaryOperator" &&
      (node.opcode === "=" || node.opcode === "*=" || node.opcode === "+=") &&
      Array.isArray(node.inner) &&
      node.inner[0]?.kind === "DeclRefExpr"
    ) {
      assignments.push({
        target: node.inner[0].referencedDecl?.name ?? null,
        opcode: node.opcode,
        offset: node.range?.begin?.offset ?? null,
      });
    }
  });
  return { refs, assignments };
}

export async function createCProbe(options = {}) {
  for (const name of ["clangPath", "clangdPath"]) {
    if (typeof options[name] !== "string" || !path.isAbsolute(options[name])) {
      throw new Error(`an absolute ${name} is required`);
    }
  }
  const clangPath = path.resolve(options.clangPath);
  const clangdPath = path.resolve(options.clangdPath);
  const fixtureRoot = path.resolve(options.fixtureRoot);

  const providerVersions = {};
  const clangVersion = spawnSync(clangPath, ["--version"], { encoding: "utf8" });
  providerVersions.clang = clangVersion.stdout.split("\n")[0] ?? null;
  const clangdVersion = spawnSync(clangdPath, ["--version"], { encoding: "utf8" });
  providerVersions.clangd = clangdVersion.stdout.split("\n")[0] ?? null;

  function readFixture(relativeFile) {
    return fs.readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
  }

  function astDump(relativeFile) {
    const run = runClang(clangPath, fixtureRoot, relativeFile, ["-fsyntax-only", "-Xclang", "-ast-dump=json"]);
    if (run.status !== 0) {
      return { error: `clang ast-dump failed: ${run.stderr.slice(0, 2000)}` };
    }
    try {
      return { tu: JSON.parse(run.stdout), stderr: run.stderr };
    } catch (error) {
      return { error: `ast-dump json parse failed: ${String(error)}` };
    }
  }

  function signatureCase(caseSpec) {
    const text = readFixture(caseSpec.file);
    const dump = astDump(caseSpec.file);
    if (dump.error !== undefined) {
      return dump;
    }
    const fn = findFunction(dump.tu, caseSpec.functionName);
    if (fn === null) {
      return { error: `function not found: ${caseSpec.functionName}` };
    }
    const parameters = (fn.inner ?? [])
      .filter((child) => child.kind === "ParmVarDecl")
      .map((param) => ({
        name: param.name ?? null,
        type: param.type?.qualType ?? null,
      }));
    return {
      provider: providerVersions,
      fixture: caseSpec.file,
      functionName: caseSpec.functionName,
      qualType: fn.type?.qualType ?? null,
      parameters,
      variadic: (fn.type?.qualType ?? "").includes("..."),
      offset: fn.range?.begin?.offset ?? null,
      sourceText: sourceTextRange(text, fn),
    };
  }

  function callsCase(caseSpec) {
    const text = readFixture(caseSpec.file);
    const dump = astDump(caseSpec.file);
    if (dump.error !== undefined) {
      return dump;
    }
    const fn = findFunction(dump.tu, caseSpec.functionName);
    if (fn === null) {
      return { error: `function not found: ${caseSpec.functionName}` };
    }
    return {
      provider: providerVersions,
      fixture: caseSpec.file,
      functionName: caseSpec.functionName,
      calls: collectCalls(dump.tu, fn, text),
    };
  }

  function guardsCase(caseSpec) {
    const text = readFixture(caseSpec.file);
    const dump = astDump(caseSpec.file);
    if (dump.error !== undefined) {
      return dump;
    }
    const fn = findFunction(dump.tu, caseSpec.functionName);
    if (fn === null) {
      return { error: `function not found: ${caseSpec.functionName}` };
    }
    return {
      provider: providerVersions,
      fixture: caseSpec.file,
      functionName: caseSpec.functionName,
      guards: collectGuards(dump.tu, fn, text),
    };
  }

  function declCase(caseSpec) {
    const dump = astDump(caseSpec.file);
    if (dump.error !== undefined) {
      return dump;
    }
    let found = null;
    walkAst(dump.tu, (node) => {
      if (found === null && node.kind === caseSpec.declKind && node.name === caseSpec.declName) {
        found = {
          kind: node.kind,
          name: node.name,
          type: node.type?.qualType ?? null,
          id: node.id ?? null,
          offset: node.range?.begin?.offset ?? null,
          file: node.loc?.includedFrom?.file ?? caseSpec.file,
        };
      }
    });
    if (found === null) {
      return { error: `declaration not found: ${caseSpec.declKind} ${caseSpec.declName}` };
    }
    return { provider: providerVersions, fixture: caseSpec.file, declaration: found };
  }

  function cfgCase(caseSpec) {
    const run = runClang(clangPath, fixtureRoot, caseSpec.file, [
      "--analyze",
      "-o",
      "/dev/null",
      "-Xanalyzer",
      "-analyzer-checker=debug.DumpCFG",
      "-Xanalyzer",
      "-analyzer-output=text",
    ]);
    const dumpText = run.stdout.length > 0 ? run.stdout : run.stderr;
    const blocks = parseCfgDump(dumpText, caseSpec.functionName);
    return {
      provider: providerVersions,
      fixture: caseSpec.file,
      functionName: caseSpec.functionName,
      status: run.status,
      blocks,
      raw: dumpText,
    };
  }

  function refsCase(caseSpec) {
    const dump = astDump(caseSpec.file);
    if (dump.error !== undefined) {
      return dump;
    }
    const fn = findFunction(dump.tu, caseSpec.functionName);
    if (fn === null) {
      return { error: `function not found: ${caseSpec.functionName}` };
    }
    const collected = collectRefs(dump.tu, fn);
    return {
      provider: providerVersions,
      fixture: caseSpec.file,
      functionName: caseSpec.functionName,
      refs: collected.refs.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0)),
      assignments: collected.assignments.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0)),
    };
  }

  async function clangdCase(caseSpec) {
    const client = new LspClient(clangdPath, ["--background-index=0", "--function-arg-placeholders=0"], fixtureRoot);
    try {
      await client.start();
      const rootUri = `file://${fixtureRoot}`;
      const init = await client.request("initialize", {
        processId: null,
        rootUri,
        capabilities: {
          textDocument: {
            publishDiagnostics: { versionSupport: true },
            callHierarchy: { dynamicRegistration: false },
          },
        },
      });
      client.notify("initialized", {});
      const absolute = path.join(fixtureRoot, caseSpec.file);
      const uri = `file://${absolute}`;
      const text = readFixture(caseSpec.file);
      client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "c", version: 1, text },
      });
      const located = locate(text, caseSpec.locate, caseSpec.occurrence ?? 0);
      if (located === null) {
        return { error: `subject not found: ${caseSpec.locate}` };
      }
      const position = { line: located.line, character: located.column };
      const capabilities = init.result?.capabilities ?? {};
      const result = {
        provider: providerVersions,
        fixture: caseSpec.file,
        located: { line: located.line, column: located.column, text: located.text },
        capabilities: {
          callHierarchyProvider: capabilities.callHierarchyProvider ?? null,
          definitionProvider: capabilities.definitionProvider ?? null,
          referencesProvider: capabilities.referencesProvider ?? null,
        },
      };
      if (caseSpec.request === "definition") {
        const response = await client.request("textDocument/definition", {
          textDocument: { uri }, position,
        });
        result.definition = Array.isArray(response.result)
          ? response.result.map((loc) => {
              const localPath = decodeURIComponent(loc.uri.startsWith("file://") ? loc.uri.slice(7) : loc.uri);
              return {
                file: path.relative(fixtureRoot, localPath),
                line: loc.range.start.line,
                column: loc.range.start.character,
              };
            })
          : response.result;
      } else if (caseSpec.request === "references") {
        const response = await client.request("textDocument/references", {
          textDocument: { uri }, position, context: { includeDeclaration: true },
        });
        result.references = (response.result ?? []).map((loc) => ({
          file: path.relative(fixtureRoot, decodeURIComponent(loc.uri.slice(7))),
          line: loc.range.start.line,
          column: loc.range.start.character,
        }));
      } else if (caseSpec.request === "outgoingCalls") {
        const prepare = await client.request("textDocument/prepareCallHierarchy", {
          textDocument: { uri }, position,
        });
        const items = prepare.result ?? [];
        result.callHierarchyItems = items.length;
        if (items.length > 0) {
          const outgoing = await client.request("callHierarchy/outgoingCalls", { item: items[0] });
          if (outgoing.error !== undefined) {
            result.outgoingError = outgoing.error;
          } else {
            result.outgoing = (outgoing.result ?? []).map((entry) => ({
              name: entry.to.name,
              kind: entry.to.kind,
              fromRanges: entry.fromRanges.map((range) => ({
                line: range.start.line,
                column: range.start.character,
              })),
            }));
          }
        }
      } else if (caseSpec.request === "diagnostics") {
        const deadline = Date.now() + 15000;
        let published = null;
        while (Date.now() < deadline) {
          published = client.responses.find(
            (message) => message.method === "textDocument/publishDiagnostics" && message.params?.uri === uri,
          );
          if (published !== undefined) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        result.diagnostics = published !== undefined
          ? published.params.diagnostics.map((d) => ({
              code: d.code ?? null,
              source: d.source ?? null,
              severity: d.severity ?? null,
              line: d.range.start.line,
              column: d.range.start.character,
              message: d.message,
            }))
          : null;
        result.diagnosticsVersion = published?.params?.version ?? null;
      }
      return result;
    } finally {
      await client.stop();
    }
  }

  return {
    providerIdentity: {
      clang: clangPath,
      clangd: clangdPath,
      versions: providerVersions,
      fixtureRoot,
    },
    readFixtureText: readFixture,
    astDump,
    extractors: {
      signature: signatureCase,
      calls: callsCase,
      guards: guardsCase,
      decl: declCase,
      cfg: cfgCase,
      refs: refsCase,
      clangd: clangdCase,
    },
  };
}
