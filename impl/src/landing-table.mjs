/** The issue number a path, a contribution or a context-package branch names, or null:
 * `issue428-…`, `impl/src/issue296-x.mjs`, `issue:428` (the branch name the root's `--issue`
 * admission writes) and a `#428` reference are the same fact spelled four ways. */
export function issueNumberOf(value) {
  const text = `${value}`;
  const hash = text.match(/#(\d{1,6})\b/u);
  if (hash) return Number(hash[1]);
  const named = text.match(/(?:^|[/\-_])issue[-_:]?(\d{1,6})(?=[\-_.]|$)/u);
  return named ? Number(named[1]) : null;
}
