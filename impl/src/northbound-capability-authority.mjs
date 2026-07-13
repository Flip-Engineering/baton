const TOKENS = Object.freeze({ web: Object.freeze({}), mcp: Object.freeze({}) });

export function northboundCapabilityToken(transport) {
  if (!Object.hasOwn(TOKENS, transport)) throw new TypeError('unknown northbound capability transport');
  return TOKENS[transport];
}

export function hasNorthboundCapabilityAuthority(transport, token) {
  return Object.hasOwn(TOKENS, transport) && TOKENS[transport] === token;
}
