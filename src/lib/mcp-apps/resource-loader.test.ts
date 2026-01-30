import { resolveToolResourceUri } from './resource-loader';

describe('resolveToolResourceUri', () => {
  it('prefers nested ui.resourceUri', () => {
    const tool = {
      _meta: {
        ui: { resourceUri: 'ui://present/app.html' },
        'ui/resourceUri': 'ui://legacy/app.html',
      },
    };
    expect(resolveToolResourceUri(tool as any)).toBe('ui://present/app.html');
  });

  it('falls back to flat ui/resourceUri', () => {
    const tool = {
      _meta: {
        'ui/resourceUri': 'ui://legacy/app.html',
      },
    };
    expect(resolveToolResourceUri(tool as any)).toBe('ui://legacy/app.html');
  });
});
