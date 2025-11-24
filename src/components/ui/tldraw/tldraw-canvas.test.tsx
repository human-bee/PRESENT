import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { customShapeUtil, customShape, TldrawCanvasProps, TldrawCanvas } from './tldraw-canvas'; // Assuming customShape type is exported
import { Editor, TLBaseShape } from '@tldraw/tldraw';

const mockUpdateShapes = jest.fn();
const mockEditor = {
  updateShapes: mockUpdateShapes,
} as unknown as Editor;

jest.mock('@tldraw/tldraw', () => {
  class BaseBoxShapeUtil<T> {
    static type = '';
    static props = {} as any;
    editor?: any;
    getDefaultProps(): any {
      return {};
    }
    component(): any {
      return null;
    }
    indicator(): any {
      return null;
    }
  }

  return {
    BaseBoxShapeUtil,
    HTMLContainer: ({ children }: any) => <>{children}</>,
    T: {
      number: {},
      string: {},
      boolean: {},
      optional: (value: any) => value,
    },
    Editor: class {},
    TLBaseShape: {} as any,
    createShapeId: (id: string) => id,
    toRichText: (value: any) => value,
    useEditor: () => mockEditor,
    useValue: (fn: any) => fn(),
    TLUiOverrides: {},
    TldrawUiToastsProvider: ({ children }: any) => <>{children}</>,
  };
});

jest.mock('@tldraw/sync', () => ({
  useSyncDemo: () => ({ store: null, status: 'disconnected' }),
  RemoteTLStoreWithStatus: {} as any,
}));

// --- Mocks ---

// Mock ResizeObserver
// Avoid TS-only types in Jest parse
/** @type {ResizeObserverCallback | null} */
let mockResizeObserverCallback = null;
let observedElement: Element | null = null;
const mockObserve = jest.fn((element: Element) => {
  observedElement = element;
});
const mockDisconnect = jest.fn();
const mockUnobserve = jest.fn();

global.ResizeObserver = jest.fn((callback) => {
  mockResizeObserverCallback = callback;
  return {
    observe: mockObserve,
    disconnect: mockDisconnect,
    unobserve: mockUnobserve,
  };
});

function setMeasuredSize(element: Element, width: number, height: number) {
  const target = element as HTMLElement;
  const descriptors: Array<[string, number]> = [
    ['scrollWidth', width],
    ['offsetWidth', width],
    ['clientWidth', width],
    ['scrollHeight', height],
    ['offsetHeight', height],
    ['clientHeight', height],
  ];
  for (const [key, value] of descriptors) {
    Object.defineProperty(target, key, {
      configurable: true,
      value,
    });
  }
}

// Mock editor
// mockUpdateShapes/mocked editor defined above for useEditor stub

// Helper function to render the shape component
// This is tricky because customShapeUtil.component is a class method, not a standalone React component.
// Tldraw's rendering mechanism invokes it. We need to simulate that.

// A simplified way to "render" the component method for testing its React hooks logic.
// We'll create an instance of customShapeUtil and manually call its component method.
// The customShapeUtil instance needs the mock editor.
const shapeUtilInstance = new customShapeUtil();
shapeUtilInstance.editor = mockEditor; // Manually assign the mock editor

interface TestShapeComponentProps {
  shape: customShape;
}

// This TestWrapper will allow us to test the React hooks inside the component method
const TestShapeRenderer: React.FC<TestShapeComponentProps> = ({ shape }) => {
  return shapeUtilInstance.component(shape);
};

const defaultTestShape: customShape = {
  id: 'shape:test1',
  type: 'custom',
  x: 0,
  y: 0,
  props: {
    w: 300,
    h: 200,
    customComponent: <div>Test Content</div>,
    name: 'Test custom Shape',
  },
  // Add other required TLBaseShape props if necessary (parentId, index, rotation, isLocked, etc.)
  parentId: 'page:1',
  index: 'a1',
  rotation: 0,
  isLocked: false,
  opacity: 1,
  meta: {},
};

describe('customShapeUtil.component - ResizeObserver Logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockObserve.mockClear();
    mockDisconnect.mockClear();
    mockUpdateShapes.mockClear();
    mockResizeObserverCallback = null;
    observedElement = null;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    cleanup(); // Unmount components
  });

  it('observes content element on mount and disconnects on unmount', () => {
    const { unmount } = render(<TestShapeRenderer shape={defaultTestShape} />);
    expect(mockObserve).toHaveBeenCalledTimes(1);
    // Element observed would be the one with contentRef, which is tricky to assert directly here
    // but mockObserve being called implies an element was passed.

    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('calls updateShapes on resize after debounce', () => {
    render(<TestShapeRenderer shape={defaultTestShape} />);
    expect(mockResizeObserverCallback).not.toBeNull();

    // Simulate a resize event
    act(() => {
      if (mockResizeObserverCallback) {
        if (observedElement) {
          setMeasuredSize(observedElement, 400, 250);
        }
        mockResizeObserverCallback(
          [
            {
              contentRect: {
                width: 400,
                height: 250,
                x: 0,
                y: 0,
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        );
      }
    });

    // Should not have been called yet due to debounce
    expect(mockUpdateShapes).not.toHaveBeenCalled();

    // Advance timers past the debounce period (150ms in component)
    act(() => {
      jest.advanceTimersByTime(150);
      jest.runOnlyPendingTimers();
    });

    expect(mockUpdateShapes).toHaveBeenCalledTimes(1);
    expect(mockUpdateShapes).toHaveBeenCalledWith([
      { id: defaultTestShape.id, type: 'custom', props: { w: 400, h: 250 } },
    ]);
  });

  it('does not call updateShapes if resize is below threshold', () => {
    render(
      <TestShapeRenderer
        shape={{ ...defaultTestShape, props: { ...defaultTestShape.props, w: 300, h: 200 } }}
      />,
    );
    expect(mockResizeObserverCallback).not.toBeNull();

    // Simulate a small resize event (original w:300, h:200)
    act(() => {
      if (mockResizeObserverCallback) {
        if (observedElement) {
          setMeasuredSize(observedElement, 300.5, 200.5);
        }
        mockResizeObserverCallback(
          [
            {
              contentRect: {
                width: 300.5,
                height: 200.5,
                x: 0,
                y: 0,
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        );
      }
    });

    act(() => {
      jest.advanceTimersByTime(150);
      jest.runOnlyPendingTimers();
    });

    expect(mockUpdateShapes).not.toHaveBeenCalled();
  });

  it('debounces multiple resize events', () => {
    render(<TestShapeRenderer shape={defaultTestShape} />);
    expect(mockResizeObserverCallback).not.toBeNull();

    // Simulate multiple rapid resizes
    act(() => {
      if (mockResizeObserverCallback) {
        if (observedElement) {
          setMeasuredSize(observedElement, 350, 220);
        }
        mockResizeObserverCallback(
          [
            {
              contentRect: {
                width: 350,
                height: 220,
                x: 0,
                y: 0,
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        ); // t = 0
        jest.advanceTimersByTime(50); // t = 50ms
        if (observedElement) {
          setMeasuredSize(observedElement, 400, 250);
        }
        mockResizeObserverCallback(
          [
            {
              contentRect: {
                width: 400,
                height: 250,
                x: 0,
                y: 0,
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        ); // t = 50ms
        jest.advanceTimersByTime(50); // t = 100ms
        if (observedElement) {
          setMeasuredSize(observedElement, 420, 260);
        }
        mockResizeObserverCallback(
          [
            {
              contentRect: {
                width: 420,
                height: 260,
                x: 0,
                y: 0,
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        ); // t = 100ms
      }
    });

    act(() => {
      jest.advanceTimersByTime(150); // Advance past the last debounce timeout (100 + 150 = 250ms from start)
      jest.runOnlyPendingTimers();
    });

    expect(mockUpdateShapes).toHaveBeenCalledTimes(1);
    // It should be called only once with the first meaningful measurement
    expect(mockUpdateShapes).toHaveBeenCalledWith([
      { id: defaultTestShape.id, type: 'custom', props: { w: 400, h: 250 } },
    ]);
  });
});
