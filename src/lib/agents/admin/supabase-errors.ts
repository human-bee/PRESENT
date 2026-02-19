type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

const asSupabaseError = (value: unknown): SupabaseErrorLike | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as SupabaseErrorLike;
};

const normalize = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const messageMentions = (message: string, needle: string): boolean => {
  if (!needle) return false;
  if (message.includes(`'${needle}'`)) return true;
  if (message.includes(`"${needle}"`)) return true;
  if (message.includes(`public.${needle}`)) return true;
  const tokenPattern = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(needle)}([^a-z0-9_]|$)`);
  return tokenPattern.test(message);
};

export const isMissingRelationError = (error: unknown, relation?: string): boolean => {
  const parsed = asSupabaseError(error);
  if (!parsed) return false;
  const code = normalize(parsed.code);
  const message = normalize(parsed.message);
  const relationNeedle = normalize(relation);

  if (code === '42p01') {
    if (!relationNeedle) return true;
    return messageMentions(message, relationNeedle);
  }

  if (!message.includes('does not exist') || !message.includes('relation')) {
    return false;
  }
  if (!relationNeedle) return true;
  return messageMentions(message, relationNeedle);
};

export const isMissingColumnError = (error: unknown, column?: string): boolean => {
  const parsed = asSupabaseError(error);
  if (!parsed) return false;
  const code = normalize(parsed.code);
  const message = normalize(parsed.message);
  const columnNeedle = normalize(column);

  if (code === '42703') {
    if (!columnNeedle) return true;
    return messageMentions(message, columnNeedle);
  }

  if (code === 'pgrst204' && message.includes('column')) {
    if (!columnNeedle) return true;
    return messageMentions(message, columnNeedle);
  }

  if (!message.includes('does not exist') || !message.includes('column')) {
    return false;
  }
  if (!columnNeedle) return true;
  return messageMentions(message, columnNeedle);
};
