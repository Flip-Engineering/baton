// Query failures returned by the TypeScript analysis producers.
export class Refusal extends Error {
  constructor(condition, limits = []) {
    super(condition);
    this.name = 'Refusal';
    this.condition = condition;
    this.limits = limits;
  }
}
