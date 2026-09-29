/** Project a selection through a single changed span. Pending local patches are already
 * overlaid by the sandbox state bridge; focus alone must not hide canonical peer edits. */
export function reconcileTextInput(input: Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'selectionEnd' | 'selectionDirection' | 'setSelectionRange'>, next: string) {
  const previous = input.value;
  if (previous === next) return;
  let prefix = 0, suffix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  const move = (position: number) => position < prefix ? position : position >= previous.length - suffix ? position + next.length - previous.length : next.length - suffix;
  const start = move(input.selectionStart), end = move(input.selectionEnd), direction = input.selectionDirection;
  input.value = next;
  input.setSelectionRange(Math.max(0, start), Math.max(0, end), direction);
}
