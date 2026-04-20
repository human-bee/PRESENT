import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodexRemoteWidget } from './codex-remote-widget';

const componentRegistryUpdateMock = jest.fn().mockResolvedValue(undefined);
const useComponentRegistrationMock = jest.fn();

jest.mock('@present/ui/codex-remote-frame', () => ({
  CodexRemoteFrame: ({
    title,
    subtitle,
    frameUrl,
    toolbar,
  }: {
    title: string;
    subtitle?: string;
    frameUrl: string;
    toolbar?: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
      <iframe title={title} src={frameUrl} />
      {toolbar}
    </div>
  ),
}));

jest.mock('@/lib/component-registry', () => ({
  ComponentRegistry: {
    update: (...args: unknown[]) => componentRegistryUpdateMock(...args),
  },
  useComponentRegistration: (...args: unknown[]) => useComponentRegistrationMock(...args),
}));

describe('CodexRemoteWidget', () => {
  beforeEach(() => {
    componentRegistryUpdateMock.mockClear();
    useComponentRegistrationMock.mockClear();
    global.fetch = jest.fn();
  });

  it('shows the native connect flow when no remote session exists yet', () => {
    render(<CodexRemoteWidget title="Remote Codex" />);

    expect(screen.getByText('Connect Remote Codex')).toBeTruthy();
    expect(screen.getByText(/no manual frame url copy-paste/i)).toBeTruthy();
  });

  it('connects directly through the reset session api and renders the brokered iframe', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessionId: 'cxs_123',
        workspaceSessionId: 'ws_123',
        executorSessionId: 'exec_123',
        status: 'ready',
        frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token/',
        proxyBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token',
        remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        lastHeartbeatAt: '2026-04-20T22:00:00.000Z',
      }),
    });

    render(<CodexRemoteWidget title="Remote Codex" subtitle="/srv/codex/repos/PRESENT" />);

    fireEvent.click(screen.getByText('Connect Remote Codex'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/reset/codex/sessions',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTitle('Remote Codex')).toBeTruthy();
    });
    expect(screen.getByText('/srv/codex/repos/PRESENT')).toBeTruthy();
    expect(componentRegistryUpdateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sessionId: 'cxs_123',
        workspaceSessionId: 'ws_123',
        frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token/',
      }),
    );
  });

  it('disconnects through the server route before clearing widget state', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        deleted: true,
      }),
    });

    render(
      <CodexRemoteWidget
        title="Remote Codex"
        state={{
          title: 'Remote Codex',
          subtitle: '/srv/codex/repos/PRESENT',
          frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token/',
          sessionId: 'cxs_123',
          workspaceSessionId: 'ws_123',
          status: 'ready',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        }}
      />,
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/reset/codex/sessions/cxs_123',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Connect Remote Codex')).toBeTruthy();
    });
    expect(screen.queryByTitle('Remote Codex')).toBeNull();
  });
});
