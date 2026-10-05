import { Person } from './barrel';

export function describe(person: Person): string {
  return `${person.shape.email} ${person.shape.total_cents}`;
}
