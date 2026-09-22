export type LineChange = { type: 'same' | 'added' | 'removed'; text: string };

/** Bounded line diff. The changed middle is shown without a quadratic LCS matrix. */
export function diffLines(before: string, after: string): LineChange[] {
  const left = before.split('\n');
  const right = after.split('\n');
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  return [
    ...left.slice(0, start).map((text) => ({ type: 'same' as const, text })),
    ...left.slice(start, left.length - end).map((text) => ({ type: 'removed' as const, text })),
    ...right.slice(start, right.length - end).map((text) => ({ type: 'added' as const, text })),
    ...(end ? left.slice(left.length - end).map((text) => ({ type: 'same' as const, text })) : []),
  ];
}

export function safeSourceURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
