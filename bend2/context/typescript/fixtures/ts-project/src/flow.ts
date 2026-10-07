export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

export function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}

export function describe(value: string | number): string {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
  return value.toFixed(2);
}

export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

export function afterReturn(): number {
  return 1;
  console.log("unreachable after return");
}

export function alwaysThrows(message: string): never {
  throw new Error(message);
}

export function afterNeverCall(message: string): number {
  alwaysThrows(message);
  return 2;
}

export function definiteAssignment(flag: boolean): number {
  let x: number;
  if (flag) {
    x = 1;
  }
  return x;
}
