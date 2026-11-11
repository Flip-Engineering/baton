// CDP runtime lane: ephemeral loopback inspector endpoint discovery from the recorded
// target stderr.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". Launch uses an
// ephemeral loopback inspector port; the endpoint is read from the owned child's actual
// stderr. Inspector discovery watches the private target stderr with a filesystem-event
// subscription registered before a catch-up read. It records byte offsets, handles
// partial and coalesced appends, and refuses file replacement, truncation or watch
// failure. No timer establishes inspector readiness: this module schedules nothing and
// every decision comes from an observed file event or an explicit caller scan.
//
// Descriptor identity (security follow-up S3): the watched identity is the open
// descriptor's own fstat identity, and every observation pass re-stats the path and
// requires that it still resolves to that same descriptor before any byte is read
// through it. A path that now names another inode, a missing path, a truncation below
// the consumed offset and a watch failure are each their own refusal, delivered through
// `onFailure` as endpointWatchFailed, endpointReplaced or endpointTruncated.
//
// Endpoint secrecy: the parsed endpoint is delivered to the caller and is never
// included in a refusal detail.

import { closeSync, fstatSync, openSync, readSync, statSync, watch } from 'node:fs';

// The banner Node prints for --inspect/--inspect-brk. The match requires the
// terminating newline, so a banner split across appends is not reported until its line
// is complete.
const BANNER = /Debugger listening on (ws:\/\/[^\s]+)\r?\n/;

const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function parseInspectorBanner(text) {
  if (typeof text !== 'string') return null;
  const match = BANNER.exec(text);
  if (match === null) return null;
  let url;
  try {
    url = new URL(match[1]);
  } catch {
    return null;
  }
  const port = Number.parseInt(url.port, 10);
  if (!Number.isSafeInteger(port) || port <= 0) return null;
  if (!LOOPBACK_HOSTS.includes(url.hostname)) return null;
  return { url: match[1], host: url.hostname, port, uuid: url.pathname.replace(/^\//, '') };
}

export class EndpointRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'EndpointRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

// Watch one recorded stderr file. `onEndpoint` receives the parsed endpoint once.
// `onFailure` receives an EndpointRefusal for a refused watch. Both may be called from a
// file event, so callers must not assume a timer context.
export function watchTargetStderr({ path, onEndpoint, onFailure, offset = 0 }) {
  let fd;
  let opened;
  try {
    fd = openSync(path, 'r');
    opened = fstatSync(fd);
  } catch (error) {
    const failure = new EndpointRefusal('endpointWatchFailed',
      `the recorded stderr file is unavailable: ${error.code ?? 'unknown'}`);
    if (typeof onFailure === 'function') onFailure(failure);
    return { stop: () => {}, scan: () => {}, position: () => offset, text: () => '', failure: () => failure };
  }
  const identity = { dev: opened.dev, ino: opened.ino };
  let position = offset;
  let text = '';
  let reported = false;
  let stopped = false;
  let watcher = null;
  let failure = null;

  const fail = (condition, detail) => {
    if (failure !== null || stopped) return;
    failure = new EndpointRefusal(condition, detail);
    stop();
    if (typeof onFailure === 'function') onFailure(failure);
  };

  const readAppended = (size) => {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (position < size) {
      const wanted = Math.min(chunk.length, size - position);
      const got = readSync(fd, chunk, 0, wanted, position);
      if (got <= 0) break;
      text += chunk.subarray(0, got).toString('utf8');
      position += got;
    }
  };

  // One observation pass. Called from a filesystem event and available to the caller for
  // an explicit re-check. The path must still name the watched descriptor.
  const scan = () => {
    if (stopped || failure !== null) return;
    let current;
    try {
      current = statSync(path);
    } catch (error) {
      fail('endpointWatchFailed', `the recorded stderr path is unavailable: ${error.code ?? 'unknown'}`);
      return;
    }
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
      fail('endpointReplaced', 'the recorded stderr path no longer names the watched file');
      return;
    }
    let descriptor;
    try {
      descriptor = fstatSync(fd);
    } catch (error) {
      fail('endpointWatchFailed', `the watched descriptor is unusable: ${error.code ?? 'unknown'}`);
      return;
    }
    if (descriptor.dev !== identity.dev || descriptor.ino !== identity.ino) {
      fail('endpointReplaced', 'the watched descriptor identity changed');
      return;
    }
    if (descriptor.size < position) {
      fail('endpointTruncated', `size ${descriptor.size} is below the consumed offset ${position}`);
      return;
    }
    try {
      readAppended(descriptor.size);
    } catch (error) {
      fail('endpointWatchFailed', error.code ?? 'read failed');
      return;
    }
    if (reported) return;
    const endpoint = parseInspectorBanner(text);
    if (endpoint !== null) {
      reported = true;
      if (typeof onEndpoint === 'function') onEndpoint(endpoint);
    }
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
        // A watcher that cannot be closed is already unusable; the refusal, if any, is
        // the retained evidence.
      }
      watcher = null;
    }
    try {
      closeSync(fd);
    } catch {
      // The descriptor is released by process exit if this close fails.
    }
  }

  try {
    // The subscription is registered before the catch-up read so an append between the
    // two is observed rather than missed.
    watcher = watch(path, { persistent: true }, () => scan());
    watcher.on('error', (error) => fail('endpointWatchFailed', `the watcher reported ${error.code ?? 'an error'}`));
  } catch (error) {
    fail('endpointWatchFailed', `the watcher could not be registered: ${error.code ?? 'unknown'}`);
    return { stop, scan: () => {}, position: () => position, text: () => text, failure: () => failure };
  }
  scan();

  return {
    stop,
    scan,
    position: () => position,
    text: () => text,
    failure: () => failure,
  };
}
