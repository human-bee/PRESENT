import { normalizeIssues } from './normalizers';
import { linearKanbanSchema } from './types';

describe('normalizeIssues', () => {
  it('preserves issue descriptions for downstream widget consumers', () => {
    const normalized = normalizeIssues(
      [
        {
          id: 'issue-1',
          identifier: 'PRE-1',
          title: 'Add description support',
          description: 'Render the real issue description in the modal.',
          status: 'Todo',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      ],
      [],
    );

    expect(normalized).not.toBe('RATE_LIMITED');
    expect(normalized).toEqual([
      expect.objectContaining({
        description: 'Render the real issue description in the modal.',
      }),
    ]);

    expect(() =>
      linearKanbanSchema.parse({
        issues: normalized,
      }),
    ).not.toThrow();
  });
});
