import { value } from "./dep";
import { extra } from "./added";

export function describe(): string {
  return `value=${value} extra=${extra}`;
}
