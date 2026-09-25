import { composeOwedMessage } from './attention-message.mjs';

/** Claude Code owns input scheduling after this documented channel notification is written. */
export function attachClaudeRootChannel(server, { open, onClose }) {
  const handle = server.handle.bind(server);
  const close = server.close.bind(server);
  let attachment;
  let closing = false;
  server.handle = async (message) => {
    const response = await handle(message);
    if (message.method === 'initialize' && response?.result) {
      response.result.capabilities.experimental = { 'claude/channel': {} };
      response.result.instructions += ' This channel is the deployment root attachment. Read Baton attention notices and reply or guide participants with the ordinary Baton tools.';
    }
    if (message.method === 'notifications/initialized' && !attachment) {
      attachment = open(async ({ obligations }) => {
        await server.notify('notifications/claude/channel', {
          content: obligations.map((row) => composeOwedMessage(row)).join('\n\n'),
          meta: { recipient: 'root' },
        });
      });
      attachment.done.then(() => { if (!closing) onClose(); }, (error) => { if (!closing) onClose(error); });
      await attachment.opened;
    }
    return response;
  };
  server.close = async () => {
    closing = true;
    attachment?.close();
    await attachment?.done.catch(() => {});
    return close();
  };
  return server;
}
