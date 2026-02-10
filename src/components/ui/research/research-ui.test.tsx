import React from 'react';
import { render, screen } from '@testing-library/react';
import { CredibilityBadge, FactCheckBadge, SourceTypeChip } from './research-ui';

describe('research-ui primitives', () => {
  it('maps credibility to semantic tones', () => {
    const { container } = render(<CredibilityBadge level="high" />);
    expect(screen.getByText('High')).toBeTruthy();
    expect(container.firstChild && (container.firstChild as HTMLElement).className).toContain(
      'bg-success-surface',
    );
  });

  it('renders fact check badge when provided', () => {
    render(<FactCheckBadge factCheck={{ status: 'unverified', confidence: 42 }} />);
    expect(screen.getByText(/unverified/i)).toBeTruthy();
  });

  it('renders a neutral source type chip', () => {
    const { container } = render(<SourceTypeChip type="news" />);
    expect(screen.getByText('news')).toBeTruthy();
    expect(container.firstChild && (container.firstChild as HTMLElement).className).toContain(
      'bg-surface-secondary',
    );
  });
});

