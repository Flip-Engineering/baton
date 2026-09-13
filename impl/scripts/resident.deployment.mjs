// Example resident: `baton serve impl/scripts/resident.deployment.mjs`.
// Native routes are starting choices, not a required swarm roster. Embedders can supply their
// own routes and verifier; ordinary deployment admission checks each selected route.
import { openConvergedBaton } from '../src/index-converged.mjs';

export async function createBatonDeployment({ repo = process.cwd(), routes, verification } = {}) {
  return openConvergedBaton({
    repo,
    advanced: {
      routes: routes ?? [
        { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        { harness: 'claude-code', provider: 'claude', model: 'claude-sonnet-4-6', effort: 'high' },
        { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' },
        { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' },
      ],
      // Omission selects the repository's actual test command. A no-op command provides no
      // verification evidence for a contribution. A caller may choose a relevant check.
      ...(verification === undefined ? {} : { verification }),
    },
  });
}
