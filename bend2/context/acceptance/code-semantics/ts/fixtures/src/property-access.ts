/**
 * Property-access coverage fixture: quoted literal access is indexed; computed and
 * any-typed accesses are not.
 */

export interface Model {
  load(id: string): string;
  save(id: string): void;
}

export class DiskModel implements Model {
  load(id: string): string {
    return `loaded:${id}`;
  }
  save(id: string): void {
    void id;
  }
}

export function quotedAccess(d: Model): string {
  return d["load"]("quoted");
}

export function computedAccess(d: Model, k: "load"): string {
  return d[k]("keyed");
}

export function anyCastAccess(d: Model): void {
  (d as any).save("anyCast");
}
