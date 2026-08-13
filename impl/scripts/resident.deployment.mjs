// The campaign resident deployment: `baton serve impl/scripts/resident.deployment.mjs`.
// Declares the fleet's exact routes so waves.run compositions (the #74 pattern, #147 dogfood)
// can name heavyweight and cheap seats through the resident's admission (the bare
// `baton serve` default inventory admits deepseek-v4-flash but NOT deepseek-v4-pro[1m] —
// discovered 2026-08-13 when the coordinator member failed admission pre-registration).
import { openBaton } from '../src/index.mjs';

export async function createBatonDeployment() {
  return openBaton({
    repo: process.cwd(),
    advanced: {
      routes: [
        { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        { harness: 'deepseek', model: 'deepseek-v4-pro[1m]', effort: 'high' },
        { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      ],
      verification: Object.freeze({ command: 'true', arguments: [] }),
    },
  });
}
