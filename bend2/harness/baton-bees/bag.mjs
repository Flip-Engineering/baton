import { BeeBus } from './bus.mjs';
import { BeeMutatorAdapter } from './mutator.mjs';

export const DEFAULT_LANES = [
  'source-to-runtime chain',
  'runtime replay and authority',
  'negative controls and duplicate exclusion',
  'persistence and cleanup',
  'independent reviewer'
];

export function planBag({ count = 5, basePrompt = '', lanes = DEFAULT_LANES, prefix = 'BEE' } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 32) throw new RangeError('count must be 1..32');
  return Array.from({ length: count }, (_, index) => {
    const role = `${prefix}_${index + 1}`;
    const lane = lanes[index % lanes.length];
    return {
      role,
      lane,
      prompt: [
        basePrompt.trim(),
        '',
        `You are ${role} in a self-organizing bag of bees.`,
        `Primary lane: ${lane}.`,
        'Read the shared bus before claiming work; avoid duplicate lanes; challenge unsupported claims.',
        'Use Baton authority for task admission and completion. Post bounded results, controls, and cleanup.',
        'Do not claim success without exact evidence.'
      ].filter(Boolean).join('\n')
    };
  });
}

export async function startBag({ busDir, count = 5, basePrompt = '', sandboxSpec = {}, adapter = null } = {}) {
  const workers = planBag({ count, basePrompt });
  const bus = new BeeBus({ dir: busDir });
  await bus.ensure();
  for (const worker of workers) await bus.join(worker.role, { lane: worker.lane });
  const mutator = adapter ?? new BeeMutatorAdapter();
  const leases = [];
  for (const worker of workers) {
    try {
      leases.push(await mutator.create(worker.role, sandboxSpec));
    } catch (error) {
      await bus.send({ from: 'coordinator', to: worker.role, kind: 'error', text: error.message });
    }
  }
  return { workers, bus, mutator, leases };
}
