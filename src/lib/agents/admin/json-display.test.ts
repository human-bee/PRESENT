import { formatJsonForDisplay, maskSensitiveJson } from './json-display';

describe('json-display', () => {
  it('masks sensitive keys and bearer tokens', () => {
    const masked = maskSensitiveJson({
      token: 'abc',
      nested: {
        authorization: 'Bearer test-token',
      },
      plain: 'hello',
    });

    expect(masked).toEqual({
      token: '[masked]',
      nested: {
        authorization: '[masked-bearer]',
      },
      plain: 'hello',
    });
  });

  it('formats pretty and raw JSON output', () => {
    const sample = { ok: true, value: 1 };
    expect(formatJsonForDisplay(sample, { mode: 'raw', maskSensitive: false })).toBe('{"ok":true,"value":1}');
    expect(formatJsonForDisplay(sample, { mode: 'pretty', maskSensitive: false })).toContain('\n');
  });
});
