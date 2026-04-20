import { render, screen } from '@testing-library/react';
import { CodexRemoteWidget } from './codex-remote-widget';

describe('CodexRemoteWidget', () => {
  it('renders the brokered iframe surface when a frame URL is provided', () => {
    render(
      <CodexRemoteWidget
        title="Remote Codex"
        subtitle="/srv/codex/repos/PRESENT"
        frameUrl="http://127.0.0.1:4101/sessions/cxs_123/proxy/"
      />,
    );

    expect(screen.getByTitle('Remote Codex')).toBeTruthy();
    expect(screen.getByText('/srv/codex/repos/PRESENT')).toBeTruthy();
  });

  it('shows an empty state when no frame URL is configured yet', () => {
    render(<CodexRemoteWidget title="Remote Codex" frameUrl="" />);

    expect(screen.getByText(/no remote codex frame url configured/i)).toBeTruthy();
  });
});
