// Northbound capability authority: a stable per-transport proof carried in the application
// command context. The token is a fixed opaque string (not caller-supplied) so the check is
// valid even when the mcp-stdio host and the application facade are loaded from two copies of
// the package (the MP18 stdio factory resolves `baton/impl` to the installed package while the
// host script runs from the worktree) — object-identity tokens would diverge across module
// instances and refuse every context.
const TOKENS = Object.freeze({ web: 'northbound:web', mcp: 'northbound:mcp' });

export function northboundCapabilityToken(transport) {
  if (!Object.hasOwn(TOKENS, transport)) throw new TypeError('unknown northbound capability transport');
  return TOKENS[transport];
}

export function hasNorthboundCapabilityAuthority(transport, token) {
  return Object.hasOwn(TOKENS, transport) && TOKENS[transport] === token;
}
