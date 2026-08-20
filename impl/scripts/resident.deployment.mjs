// The campaign resident deployment: `baton serve impl/scripts/resident.deployment.mjs`.
// Declares the fleet's exact routes so waves.run compositions (the #74 pattern, #147 dogfood)
// can name heavyweight and cheap seats through the resident's admission.
// #228 (operator-ordered migration, 2026-08-15): the fleet rides OhMyPi as the member
// harness — deepseek/glm as FIRST-CLASS omp providers, no anthropic-compat translation.
// The previous explicit compat routes (harness deepseek/glm) orphaned claude-code member
// processes and died cause-lessly at ~2h; these are the same seats on the native surface.
import { openConvergedBaton } from '../src/index-converged.mjs';

export async function createBatonDeployment() {
  return openConvergedBaton({
    repo: process.cwd(),
    advanced: {
      routes: [
        { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
        { harness: 'omp', model: 'deepseek/deepseek-v4-pro[1m]', effort: 'high' },
        { harness: 'omp', model: 'glm/glm-5.2', effort: 'high' },
        { harness: 'omp', model: 'glm/glm-5.3', effort: 'high' },
      ],
      verification: Object.freeze({ command: 'true', arguments: [] }),
    },
  });
}
