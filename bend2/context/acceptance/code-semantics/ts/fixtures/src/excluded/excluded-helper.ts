/**
 * Excluded fixture: this file sits under a directory excluded by tsconfig.json.
 * The program must honor config selection: this file is not a program root and
 * its declarations are not visible to resolution.
 */

export function excludedHelper(): number {
  return 99;
}
