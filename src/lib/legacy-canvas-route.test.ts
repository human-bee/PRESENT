import {
  canonicalizeLegacyCanvasPathAndQuery,
  buildLegacyCanvasInviteLink,
  canonicalizeLegacyCanvasHref,
} from './legacy-canvas-route';

describe('legacy canvas route helpers', () => {
  it('builds invite links against /canvas', () => {
    expect(buildLegacyCanvasInviteLink('https://present.best', 'canvas-demo-room')).toBe(
      'https://present.best/canvas?room=canvas-demo-room',
    );
  });

  it('canonicalizes root urls onto /canvas while preserving params and hash', () => {
    expect(
      canonicalizeLegacyCanvasHref(
        'https://present.best/?room=canvas-demo-room&id=a642d151-05cc-484f-b62f-c9a52a81a345&share=1#focus',
      ),
    ).toBe(
      'https://present.best/canvas?room=canvas-demo-room&id=a642d151-05cc-484f-b62f-c9a52a81a345&share=1#focus',
    );
  });

  it('does not rewrite urls that are already on /canvas', () => {
    expect(
      canonicalizeLegacyCanvasHref(
        'https://present.best/canvas?room=canvas-demo-room&id=a642d151-05cc-484f-b62f-c9a52a81a345',
      ),
    ).toBeNull();
  });

  it('canonicalizes root path plus legacy query params onto /canvas', () => {
    expect(
      canonicalizeLegacyCanvasPathAndQuery(
        '/',
        new URLSearchParams('id=a642d151-05cc-484f-b62f-c9a52a81a345'),
      ),
    ).toBe('/canvas?id=a642d151-05cc-484f-b62f-c9a52a81a345');
  });

  it('does not rewrite root requests without legacy canvas params', () => {
    expect(
      canonicalizeLegacyCanvasPathAndQuery('/', new URLSearchParams('workspace=abc123')),
    ).toBeNull();
  });
});
