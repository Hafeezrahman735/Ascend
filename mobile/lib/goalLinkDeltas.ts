/**
 * Which tasks to link to and unlink from a goal after an edit.
 *
 * The goal form returns the full selection, but the server is sent only the
 * difference from what was linked when the form opened. Sending the whole set
 * would tell the server to unlink everything absent from it, including
 * completed tasks the picker never showed. When nothing changed, both lists are
 * empty and no request is made.
 */
export function goalLinkDeltas(
  linkedBefore: readonly string[],
  selected: readonly string[],
): { link: string[]; unlink: string[] } {
  const before = new Set(linkedBefore);
  const after = new Set(selected);
  return {
    link: selected.filter((id) => !before.has(id)),
    unlink: linkedBefore.filter((id) => !after.has(id)),
  };
}
