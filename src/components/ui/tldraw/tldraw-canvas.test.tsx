import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { customShapeUtil, customShape, TldrawCanvasProps, TldrawCanvas } from './tldraw-canvas'; // Assuming customShape type is exported
import { Editor, TLBaseShape } from '@tldraw/tldraw';

// --- Mocks ---

// Mock ResizeObserver
// Avoid TS-only types in Jest parse
/** @type {ResizeObserverCallback | null} */
let mockResizeObserverCallback = null;
const mockObserve = jest.fn();
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

// Mock editor
const mockUpdateShapes = jest.fn();
const mockEditor = {
  updateShapes: mockUpdateShapes,
} as unknown as Editor;

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
    });

    expect(mockUpdateShapes).not.toHaveBeenCalled();
  });

  it('debounces multiple resize events', () => {
    render(<TestShapeRenderer shape={defaultTestShape} />);
    expect(mockResizeObserverCallback).not.toBeNull();

    // Simulate multiple rapid resizes
    act(() => {
      if (mockResizeObserverCallback) {
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

    expect(mockUpdateShapes).not.toHaveBeenCalled(); // Not called yet

    act(() => {
      jest.advanceTimersByTime(150); // Advance past the last debounce timeout (100 + 150 = 250ms from start)
    });

    expect(mockUpdateShapes).toHaveBeenCalledTimes(1);
    // It should be called with the latest dimensions
    expect(mockUpdateShapes).toHaveBeenCalledWith([
      { id: defaultTestShape.id, type: 'custom', props: { w: 420, h: 260 } },
    ]);
  });
});
