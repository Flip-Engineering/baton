// Development dependency resolution for the domain tests.
//
// The packaged adapter owns its dependency imports. These tests exercise the
// real Ajv 8.17.1 and Zod 4.3.6 packages from explicit paths, so each helper
// reports the path and version it resolved. The paths below are host state and
// development evidence only; a packaged run resolves from the staged package.

export const HOST_AJV_2020 = '/Users/wahargis/.claude/plugins/marketplaces/thedotmack/node_modules/ajv/dist/2020.js';
export const HOST_AJV_PACKAGE = '/Users/wahargis/.claude/plugins/marketplaces/thedotmack/node_modules/ajv/package.json';
export const HOST_ZOD_PACKAGE_DIR = '/Users/wahargis/node_modules/zod';

export async function loadAjv2020() {
  const specifier = process.env.BATON_CONTEXT_AJV ?? HOST_AJV_2020;
  const module = await import(specifier);
  return { constructor: module.default ?? module, specifier };
}

export async function loadAjvVersion() {
  const manifest = process.env.BATON_CONTEXT_AJV_PACKAGE ?? HOST_AJV_PACKAGE;
  const document = JSON.parse(await (await import('node:fs/promises')).readFile(manifest, 'utf8'));
  return { version: document.version, manifest };
}

export function zodPackageDir() {
  return process.env.BATON_CONTEXT_ZOD_DIR ?? HOST_ZOD_PACKAGE_DIR;
}

export async function loadZod() {
  return import(`${zodPackageDir()}/index.js`);
}
