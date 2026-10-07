type Fn = (name: string) => string;

export function invoke(fn: Fn, name: string): string {
  return fn(name);
}

const functionVariable: Fn = (name) => `variable:${name}`;

export function viaVariable(name: string): string {
  return functionVariable(name);
}

const objectHoldingFunction = {
  send: (name: string): string => `object:${name}`,
};

export function viaObjectProperty(name: string): string {
  return objectHoldingFunction.send(name);
}

const handlers: Record<string, Fn> = {
  circle: (name) => `circle:${name}`,
  square: (name) => `square:${name}`,
};

export function viaIndexedAccess(kind: string, name: string): string {
  return handlers[kind](name);
}

export interface Dispatcher {
  send(name: string): string;
}

const dispatcher: Dispatcher = {
  send: (name: string): string => `dispatcher:${name}`,
};

export function viaInterfaceReceiver(name: string): string {
  return dispatcher.send(name);
}
