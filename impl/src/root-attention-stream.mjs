import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createInterface } from 'node:readline';

/** Open the operator's explicit native root attachment over the resident transport. */
export function openRootAttention({ baseUrl, socketPath, token, origin, onAttention }) {
  const base = new URL(baseUrl);
  const controller = new AbortController();
  let resolveOpened;
  let rejectOpened;
  const opened = new Promise((resolve, reject) => { resolveOpened = resolve; rejectOpened = reject; });
  const done = new Promise((resolve, reject) => {
    const request = (socketPath ? httpRequest : httpsRequest)({
      ...(socketPath ? { socketPath } : { hostname: base.hostname, port: base.port || 443 }),
      method: 'POST', path: '/v1/root-attention/claude-code', signal: controller.signal,
      headers: { host: base.host, origin, authorization: `Bearer ${token}` },
    }, async (response) => {
      try {
        if (response.statusCode !== 200) {
          const chunks = [];
          for await (const chunk of response) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const error = Object.assign(new Error(body.error?.message ?? 'Root attachment refused'), {
            code: body.error?.code ?? 'root_attachment_refused',
          });
          rejectOpened(error); reject(error); return;
        }
        resolveOpened();
        for await (const line of createInterface({ input: response, crlfDelay: Infinity })) {
          if (line) await onAttention(JSON.parse(line));
        }
        resolve();
      } catch (error) {
        rejectOpened(error);
        if (controller.signal.aborted) resolve();
        else reject(error);
      }
    });
    request.on('error', (error) => {
      rejectOpened(error);
      if (controller.signal.aborted) resolve();
      else reject(error);
    });
    request.end();
  });
  return { opened, done, close: () => controller.abort() };
}
