function scopeError(message) {
  return Object.assign(new TypeError(message), { code: 'path_scope_invalid' });
}

export function pathScopeRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.includes('\0')
    || pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').includes('..')) {
    throw scopeError('path scope pattern is invalid');
  }
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          // A globstar followed by a separator spans zero or more complete
          // path segments. Keeping the separator inside the optional repeat
          // makes `src/**/*.mjs` include both `src/root.mjs` and deeper files.
          expression += '(?:[^/]+/)*';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else expression += '[^/]*';
    } else if (character === '?') expression += '[^/]';
    else if ('.+^${}()|[]\\'.includes(character)) expression += `\\${character}`;
    else expression += character;
  }
  return new RegExp(`${expression}$`, 'u');
}

export function pathMatchesScope(path, pattern) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')
    || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return false;
  return pathScopeRegex(pattern).test(path);
}

export function pathInScopes(path, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  return scopes.some((scope) => pathMatchesScope(path, scope));
}
