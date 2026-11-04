import { createHash } from "node:crypto";

export type Helper = [string, string, Set<string>, Map<string, number>];

export function content_name(kind: string, text: string): string {
  return kind + "_" + createHash("sha256").update(text).digest("hex");
}

// Generated identifiers are rewritten without changing C strings or comments.
export function c_identifiers(source: string, rename: (name: string) => string): string {
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b[A-Za-z_]\w*\b/g,
    token => /^[A-Za-z_]/.test(token) ? rename(token) : token);
}

function c_layout(source: string): string {
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|^[\t ]+/gm,
    token => /^[\t ]/.test(token) ? "" : token);
}

// Components are processed after their callees. Within a recursive component,
// local emission indices supply its ordering; the unit prefix is omitted.
export function canonical_helpers(helpers: Helper[]): {
  helpers: Helper[]; names: Map<string, string>;
} {
  helpers = helpers.map(([name, text, refs, cids]) => [name, c_layout(text), refs, cids]);
  const index = new Map(helpers.map(([name], i) => [name, i]));
  const edges = helpers.map(([, , refs]) => [...refs].flatMap(name => {
    const id = index.get(name);
    return id === undefined ? [] : [id];
  }));
  const reverse = helpers.map(() => [] as number[]);
  for (let i = 0; i < edges.length; i++) for (const j of edges[i]) reverse[j].push(i);
  const seen = new Uint8Array(helpers.length);
  const finish: number[] = [];
  for (let root = 0; root < helpers.length; root++) {
    if (seen[root]) continue;
    seen[root] = 1;
    const stack: [number, number][] = [[root, 0]];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame[1] === edges[frame[0]].length) {
        finish.push(frame[0]);
        stack.pop();
      } else {
        const child = edges[frame[0]][frame[1]++];
        if (!seen[child]) { seen[child] = 1; stack.push([child, 0]); }
      }
    }
  }
  seen.fill(0);
  const components: number[][] = [];
  for (let at = finish.length - 1; at >= 0; at--) {
    const root = finish[at];
    if (seen[root]) continue;
    const members: number[] = [], stack = [root];
    seen[root] = 1;
    while (stack.length > 0) {
      const id = stack.pop()!;
      members.push(id);
      for (const child of reverse[id]) if (!seen[child]) {
        seen[child] = 1;
        stack.push(child);
      }
    }
    components.push(members);
  }
  const local = (name: string): string => name.match(/(?:arm|spin)_\d+$/)?.[0] ?? name;
  const names = new Map<string, string>();
  for (let at = components.length - 1; at >= 0; at--) {
    const members = components[at].sort((a, b) => {
      const x = local(helpers[a][0]), y = local(helpers[b][0]);
      const x_kind = x.split("_")[0], y_kind = y.split("_")[0];
      if (x_kind !== y_kind) return x_kind < y_kind ? -1 : 1;
      return Number(x.slice(x.lastIndexOf("_") + 1)) - Number(y.slice(y.lastIndexOf("_") + 1));
    });
    const inside = new Map(members.map((id, i) => [helpers[id][0], "__helper_" + i]));
    const bodies = members.map(id => c_identifiers(helpers[id][1],
      name => inside.get(name) ?? names.get(name) ?? name));
    const group = content_name("group", JSON.stringify(bodies));
    members.forEach((id, i) => names.set(helpers[id][0], content_name(
      local(helpers[id][0]).startsWith("arm_") ? "arm" : "spin", JSON.stringify([group, i]))));
  }
  return { names, helpers: helpers.map(([name, text, refs, cids]) => [
    names.get(name)!, c_identifiers(text, name => names.get(name) ?? name),
    new Set([...refs].map(name => names.get(name) ?? name)), cids]) };
}
