export interface UserShape {
  email: string;
  display_name: string;
  total_cents: number;
}

export class User {
  constructor(readonly shape: UserShape) {}
}
