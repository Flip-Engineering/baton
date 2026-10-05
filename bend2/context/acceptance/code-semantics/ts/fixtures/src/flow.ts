/**
 * Flow fixture: narrowing, never results, cross-function reassignment limit.
 * Option-dependent diagnostics live in unreachable.ts; this file must stay
 * diagnostic-clean under strict defaults.
 */

interface Circle {
  kind: "circle";
  radius: number;
}
interface Square {
  kind: "square";
  side: number;
}
type Shape = Circle | Square;

export function area(shape: Shape): number {
  if (shape.kind === "circle") {
    return 3 * shape.radius;
  }
  return shape.side * shape.side;
}

export function describeValue(x: string | number | Date): string {
  if (typeof x === "string") {
    return `str:${x.length}`;
  }
  if (x instanceof Date) {
    return x.toISOString();
  }
  return `num:${x.toFixed(1)}`;
}

export function exhaustiveDefault(kind: "a" | "b"): string {
  switch (kind) {
    case "a":
      return "A";
    case "b":
      return "B";
    default: {
      const neverValue: never = kind;
      return neverValue;
    }
  }
}

let shared: string | number = "start";

export function setShared(): void {
  shared = 1;
}

export function crossFunctionLimit(): string {
  if (typeof shared === "string") {
    setShared();
    return shared.length === 0 ? "empty" : `len:${shared.length}`;
  }
  return "unreachable-string";
}

export function annotatedNever(): never {
  throw new Error("stop");
}

const arrowNever = (): never => {
  throw new Error("stop");
};

export function declaredVoidThrow(): void {
  throw new Error("stop");
}

export function afterNeverCall(): number {
  annotatedNever();
  return 1;
}

export function afterArrowNeverCall(): number {
  arrowNever();
  return 2;
}
