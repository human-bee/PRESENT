import { isMissingColumnError } from './supabase-errors';

describe('isMissingColumnError', () => {
  it('detects PostgREST schema-cache missing column errors', () => {
    const error = {
      code: 'PGRST204',
      message: "Could not find the 'model' column of 'agent_trace_events' in the schema cache",
    };
    expect(isMissingColumnError(error)).toBe(true);
    expect(isMissingColumnError(error, 'model')).toBe(true);
    expect(isMissingColumnError(error, 'provider')).toBe(false);
  });

  it('matches exact column tokens (provider vs provider_path)', () => {
    const error = {
      code: 'PGRST204',
      message: "Could not find the 'provider_path' column of 'agent_trace_events' in the schema cache",
    };
    expect(isMissingColumnError(error, 'provider')).toBe(false);
    expect(isMissingColumnError(error, 'provider_path')).toBe(true);
  });
});
