import type { Editor } from '@tldraw/tldraw';
import { attachMermaidBridge } from '../mermaid-bridge';
import type { LiveKitBus } from '../types';

jest.mock('nanoid', () => ({ nanoid: () => 'mock-id' }));
jest.mock(
  '@tldraw/tldraw',
  () => ({
    createShapeId: (value: string) => value,
    Editor: class {},
  }),
  { virtual: true },
);
jest.mock('@/components/TO BE REFACTORED/tool-dispatcher', () => ({
  normalizeMermaidText: (text: string) => text,
  getMermaidLastNode: () => null,
}));

describe('mermaid-bridge', () => {
  it('registers bus listeners and cleans up on dispose', () => {
    const editor = {
      getShape: jest.fn(),
      updateShapes: jest.fn(),
      createShape: jest.fn(),
      getViewportPageBounds: jest.fn(() => ({ midX: 0, midY: 0 })),
    } as unknown as Editor;

    const off = jest.fn();
    const bus: LiveKitBus = {
      send: jest.fn(),
      on: jest.fn().mockReturnValue(off),
    };

    const cleanup = attachMermaidBridge({
      editor,
      bus,
      lastTimestampsRef: { current: new Map() },
    });

    expect(bus.on).toHaveBeenCalledWith('update_component', expect.any(Function));

    cleanup();
    expect(off).toHaveBeenCalled();
  });
});
