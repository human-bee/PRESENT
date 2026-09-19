import { meetingSummaryWidgetSchema } from './meeting-summary-schema';
import { normalizeMeetingSummaryState } from './meeting-summary-utils';

describe('meeting summary context profile contract', () => {
  it('accepts only canonical fairy context profiles in widget schema', () => {
    expect(meetingSummaryWidgetSchema.parse({ contextProfile: 'standard' }).contextProfile).toBe(
      'standard',
    );
    expect(meetingSummaryWidgetSchema.parse({ contextProfile: 'balanced' }).contextProfile).toBe(
      'standard',
    );
    expect(() => meetingSummaryWidgetSchema.parse({ contextProfile: 'invalid-profile' })).toThrow();
  });

  it('normalizes aliased context profiles in widget state', () => {
    expect(normalizeMeetingSummaryState({ contextProfile: 'balanced' }).contextProfile).toBe(
      'standard',
    );
    expect(normalizeMeetingSummaryState({ contextProfile: 'archive' }).contextProfile).toBe(
      'archive',
    );
    expect(normalizeMeetingSummaryState({ contextProfile: 'bogus' }).contextProfile).toBeUndefined();
  });
});
