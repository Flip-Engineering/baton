// resolve hook used by pw_resolve.mjs: /opt/node22/lib/node_modules/playwright/<x> -> $ACP_PW_DIR/<x>
const ABS = '/opt/node22/lib/node_modules/playwright/';
export async function resolve(spec, ctx, next) {
  const dir = process.env.ACP_PW_DIR;
  const s = spec.startsWith('file://') ? spec.slice(7) : spec;
  if (dir && s.startsWith(ABS)) return next('file://' + dir.replace(/\/?$/, '/') + s.slice(ABS.length), ctx);
  return next(spec, ctx);
}
