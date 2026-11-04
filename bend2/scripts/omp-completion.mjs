import { spawnSync } from 'node:child_process';

export function registerCompletionRequestTool(pi, env = process.env) {
  const executable = env.BATON_COORDINATOR;
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('Baton coordinator executable is unavailable in the OMP session.');
  }
  const stopHook = env.BATON_STOP_HOOK;
  if (typeof stopHook !== 'string' || stopHook.length === 0) {
    throw new Error('Baton stop hook executable is unavailable in the OMP session.');
  }

  pi.on('session_stop', () => {
    const result = spawnSync(stopHook, ['--stop-hook'], {
      input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }),
      encoding: 'utf8',
      maxBuffer: Infinity,
      env,
    });
    if (result.error) {
      return { decision: 'block', reason: `Baton completion gate failed: ${result.error.message}` };
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || `Baton exited with status ${result.status}`).trim();
      return { decision: 'block', reason: `Baton completion gate failed: ${detail}` };
    }
    const decision = (result.stdout || '').trim();
    if (!decision) return { continue: true };
    try {
      const response = JSON.parse(decision);
      if (response.decision === 'block') {
        return { decision: 'block', reason: response.reason || 'Baton requires more work before completion.' };
      }
    } catch (error) {
      return { decision: 'block', reason: `Baton completion gate returned invalid JSON: ${error.message}` };
    }
    return { continue: true };
  });

  pi.registerTool({
    name: 'baton_completion_request',
    label: 'Request assignment completion',
    description: 'Submit a completion summary to the recorded coordinator for review.',
    promptSnippet: 'Use baton_completion_request when the assigned work is ready for coordinator review.',
    promptGuidelines: ['For an open Baton assignment, call baton_completion_request with the completion summary and evidence before ending the work.'],
    parameters: pi.zod.object({
      summary: pi.zod.string().describe('Completion summary and evidence for the assigned work'),
    }),
    async execute(_id, { summary }) {
      const result = spawnSync(executable, ['completion-request', '--text', summary], {
        encoding: 'utf8',
        maxBuffer: Infinity,
        env,
      });
      if (result.error) {
        return { isError: true, content: [{ type: 'text', text: result.error.message }] };
      }
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || `Baton exited with status ${result.status}`).trim();
        return { isError: true, content: [{ type: 'text', text: detail }] };
      }
      return { content: [{ type: 'text', text: result.stdout.trim() }] };
    },
  });
}

export default function ompCompletion(pi) {
  registerCompletionRequestTool(pi);
}
