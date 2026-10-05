// Shared store between the closure hook (registered in the loader chain) and
// the tracker API in closure.mjs. Kept separate so the hook imports no
// tracker state at registration time.

const loaded = [];

export function recordModule(url) {
  if (!loaded.includes(url)) loaded.push(url);
}

export function loadedUrls() {
  return loaded;
}
