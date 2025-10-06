import { sanitizeHtml } from '../sanitizeSchema';

describe('sanitizeHtml', () => {
  it('returns empty string when input is nullish', () => {
    // @ts-expect-error intentional null
    expect(sanitizeHtml(null)).toBe('');
  });

  it('preserves safe markup', () => {
    expect(sanitizeHtml('<p>Hello</p>')).toBe('<p>Hello</p>');
  });
});
