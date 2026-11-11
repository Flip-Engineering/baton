// Node --import hook for farm jobs (4 Oct): studio scripts import playwright from this container's absolute path
// (/opt/node22/lib/node_modules/playwright/...). Where that path does not exist (the farm's GPU container), person_job.py installs
// playwright into videos/web/node_modules and sets ACP_PW_DIR; this hook maps the absolute imports onto that copy.
import { register } from 'node:module';
register(new URL('./pw_hook.mjs', import.meta.url));
