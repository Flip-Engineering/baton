export interface Box {
  width: number;
}

export interface Box {
  height: number;
}

export function measure(width: number): number;
export function measure(width: number, height: number): number;
export function measure(width: number, height?: number): number {
  return width + (height ?? 0);
}

export class Counter {
  value = 0;

  bump(): void {
    this.value += 1;
  }
}

export namespace Counter {
  export const origin = 0;

  export function reset(counter: Counter): void {
    counter.value = origin;
  }
}
