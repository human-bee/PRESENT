import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import CanvasPage from './page';

jest.mock('./CanvasPageClient', () => ({
  __esModule: true,
  default: () => <div data-testid="canvas-page-client">canvas-page-client</div>,
}));

jest.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <div data-testid="error-boundary">{children}</div>,
}));

describe('/canvas route', () => {
  it('renders the legacy canvas client directly', () => {
    render(<CanvasPage />);

    expect(screen.getByTestId('error-boundary')).toBeTruthy();
    expect(screen.getByTestId('canvas-page-client')).toBeTruthy();
    expect(document.querySelector('.legacy-canvas-shell')).toBeNull();
    expect(document.querySelector('.legacy-canvas-shell__banner')).toBeNull();
  });
});
