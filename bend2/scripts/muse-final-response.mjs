#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function unavailable(code, detail, context = {}) {
  return { status: 'unavailable', diagnostic: { code, detail, ...context } };
}

function envelope(record) {
  return record?.kind === 'record' && record.envelope?.durability === 'durable'
    ? record.envelope
    : null;
}

function sequence(record) {
  const value = envelope(record)?.sequence;
  return Number.isSafeInteger(value) ? value : null;
}

function runRecord(record, sessionId, runId) {
  const value = envelope(record);
  return value?.stream?.kind === 'session'
    && value.stream.id === sessionId
    && value.payload?.kind === 'run'
    && value.payload.run_id === runId;
}

function selectFinalResponse(document, sessionId, runId) {
  if (document?.export_schema_version !== 1 || !Array.isArray(document.events)) {
    return unavailable('exportSchema', 'Muse export schema v1 with an events array is required', {
      observedSchemaVersion: document?.export_schema_version ?? null,
    });
  }

  const records = document.events.filter((record) => runRecord(record, sessionId, runId));
  const terminals = records.filter((record) => {
    const event = envelope(record)?.payload?.event;
    return event?.kind === 'terminal';
  });
  if (terminals.length !== 1) {
    return unavailable('terminalBoundary', 'The run must contain exactly one durable terminal record', {
      terminalCount: terminals.length,
    });
  }

  const terminal = terminals[0];
  const terminalEvent = envelope(terminal).payload.event;
  const terminalSequence = sequence(terminal);
  if (terminalEvent.terminal !== 'completed' || terminalSequence === null) {
    return unavailable('terminalIncomplete', 'The durable run terminal is not an ordered completed boundary', {
      terminal: terminalEvent.terminal ?? null,
      terminalSequence,
    });
  }

  const messages = records.filter((record) => {
    const value = envelope(record);
    const recordSequence = sequence(record);
    return value?.payload?.event?.kind === 'assistant_message_committed'
      && recordSequence !== null
      && recordSequence < terminalSequence;
  }).sort((left, right) => sequence(left) - sequence(right));
  if (messages.length === 0) {
    return unavailable('assistantBoundaryMissing', 'No durable assistant message precedes the completed terminal', {
      terminalSequence,
    });
  }

  const selected = messages.at(-1);
  const selectedSequence = sequence(selected);
  if (messages.filter((record) => sequence(record) === selectedSequence).length !== 1) {
    return unavailable('assistantBoundaryAmbiguous', 'The final durable assistant sequence is not unique', {
      assistantSequence: selectedSequence,
      terminalSequence,
    });
  }

  const event = envelope(selected).payload.event;
  const fields = ['message_id', 'response_id', 'provider_item_id', 'text'];
  const missing = fields.filter((field) => typeof event[field] !== 'string' || event[field].length === 0);
  if (missing.length > 0) {
    return unavailable('assistantBoundaryFields', 'The final durable assistant record lacks required identity or text fields', {
      missing,
      assistantSequence: selectedSequence,
      terminalSequence,
    });
  }

  const bytes = Buffer.from(event.text, 'utf8');
  return {
    status: 'selected',
    source: 'muse-export-v1',
    sessionId,
    runId,
    messageId: event.message_id,
    responseId: event.response_id,
    providerItemId: event.provider_item_id,
    assistantSequence: selectedSequence,
    terminalSequence,
    assistantCandidateCount: messages.length,
    exportSchemaVersion: document.export_schema_version,
    exporterVersion: document.exporter_version ?? null,
    textUtf8Bytes: bytes.length,
    textSha256: createHash('sha256').update(bytes).digest('hex'),
    text: event.text,
  };
}

function exportSession(executable, sessionId, output) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['export', '--session', sessionId, '--out', output], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  const [executable, sessionId, runId, output] = process.argv.slice(2);
  if (!executable || !sessionId || !runId || !output || process.argv.length !== 6) {
    return unavailable('arguments', 'Expected MUSE SESSION RUN OUTPUT arguments');
  }

  const exportPath = `${output}.${process.pid}`;
  let exportProvenance = {};
  try {
    const exported = await exportSession(executable, sessionId, exportPath);
    if (exported.error) {
      return unavailable('exportSpawn', exported.error.message, { executable, sessionId, runId });
    }
    if (exported.code !== 0) {
      return unavailable('exportExit', 'Muse export did not exit successfully', {
        executable,
        sessionId,
        runId,
        exitCode: exported.code,
        signal: exported.signal,
      });
    }
    const source = await readFile(exportPath);
    exportProvenance = {
      exportUtf8Bytes: source.length,
      exportSha256: createHash('sha256').update(source).digest('hex'),
    };
    return { ...selectFinalResponse(JSON.parse(source.toString('utf8')), sessionId, runId),
      ...exportProvenance };
  } catch (error) {
    return unavailable('exportRead', error instanceof Error ? error.message : String(error), {
      executable,
      sessionId,
      runId,
      ...exportProvenance,
    });
  } finally {
    await rm(exportPath, { force: true }).catch(() => {});
  }
}

process.stdout.write(`${JSON.stringify(await main())}\n`);
