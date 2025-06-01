import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CanvasSpace } from './canvas-space';
import { TamboShapeUtil, TldrawCanvasProps } from './tldraw-canvas'; // Import props type
import type { Editor, TLShape } from 'tldraw';
import type { TamboThread } from '@tambo-ai/react';

// --- Mocks ---

// Mock nanoid for predictable IDs
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-nanoid-id'),
}));

// Mock useTamboThread
const mockUseTamboThread = jest.fn();
jest.mock('@tambo-ai/react', () => ({
  ...jest.requireActual('@tambo-ai/react'),
  useTamboThread: () => mockUseTamboThread(),
}));

// Mock TldrawCanvas and capture onMount callback
let mockEditorOnMountCallback: ((editor: Editor) => void) | undefined;
const MockTldrawCanvas = jest.fn(({ onMount, shapeUtils }: TldrawCanvasProps) => {
  mockEditorOnMountCallback = onMount;
  // Store shapeUtils to assert later
  (MockTldrawCanvas as any).shapeUtilsPassed = shapeUtils;
  return <div data-testid="mock-tldraw-canvas"></div>;
});

jest.mock('./tldraw-canvas', () => ({
  ...jest.requireActual('./tldraw-canvas'), // Import actual TamboShapeUtil
  TldrawCanvas: (props: TldrawCanvasProps) => MockTldrawCanvas(props),
}));


// Mock Editor instance
const mockCreateShapes = jest.fn();
const mockDeleteShapes = jest.fn();
const mockGetCurrentPageShapes = jest.fn(() => []);
const mockGetViewportPageBounds = jest.fn(() => ({ midX: 500, midY: 300, width: 1000, height: 600 }));

const mockEditor = {
  createShapes: mockCreateShapes,
  deleteShapes: mockDeleteShapes,
  getCurrentPageShapes: mockGetCurrentPageShapes,
  getViewportPageBounds: mockGetViewportPageBounds,
} as unknown as Editor;

// --- Test Suite ---

describe('CanvasSpace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTamboThread.mockReturnValue({ thread: null }); // Default to no thread
    mockEditorOnMountCallback = undefined;
    (MockTldrawCanvas as any).shapeUtilsPassed = undefined;
  });

  const initialThread: TamboThread = {
    id: 'thread-1',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: null,
  };

  it('renders TldrawCanvas with TamboShapeUtil', () => {
    render(<CanvasSpace />);
    expect(screen.getByTestId('mock-tldraw-canvas')).toBeInTheDocument();
    expect(MockTldrawCanvas).toHaveBeenCalled();
    expect((MockTldrawCanvas as any).shapeUtilsPassed).toEqual([TamboShapeUtil]);
  });

  it('provides editor instance via onMount', () => {
    render(<CanvasSpace />);
    expect(mockEditorOnMountCallback).toBeDefined();
    if (mockEditorOnMountCallback) {
      act(() => {
        mockEditorOnMountCallback(mockEditor);
      });
    }
    // Further tests will assume editor is mounted
  });

  describe('with mounted editor', () => {
    beforeEach(() => {
      // Ensure editor is "mounted" for these tests
      render(<CanvasSpace />);
      if (mockEditorOnMountCallback) {
        act(() => {
          mockEditorOnMountCallback(mockEditor);
        });
      }
    });

    it('adds component from new thread message', async () => {
      // 1. Initial render with no thread, editor gets mounted
      mockUseTamboThread.mockReturnValue({ thread: null });
      const { rerender } = render(<CanvasSpace />);
      expect(mockEditorOnMountCallback).toBeDefined(); // Ensure TldrawCanvas called onMount

      act(() => { // Process the onMount callback and editor state update
        if (mockEditorOnMountCallback) {
          mockEditorOnMountCallback(mockEditor);
        }
      });

      // 2. Set up a thread with a message
      const threadWithMessage: TamboThread = {
        ...initialThread,
        id: 'thread-for-message',
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'Test', renderedComponent: <div data-testid="comp-1">Comp1</div>, createdAt: new Date() },
        ],
      };
      mockUseTamboThread.mockReturnValue({ thread: threadWithMessage });

      // 3. Rerender. Now the component has the editor AND the new thread.
      act(() => {
        rerender(<CanvasSpace />);
      });

      // Use waitFor to handle asynchronous nature of useEffects and state updates propagation
      // await screen.findByTestId("comp-1"); // This might not be applicable if comp-1 is not directly rendered by CanvasSpace

      expect(mockCreateShapes).toHaveBeenCalledTimes(1);
      expect(mockCreateShapes).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'tambo-test-nanoid-id', // nanoid is mocked
          type: 'tambo',
          props: expect.objectContaining({
            componentData: expect.objectContaining({
              type: 'tambo-component',
              messageId: 'msg-1',
              props: {}
            }),
            name: 'AI Response',
          }),
        }),
      ]);
    });

    it('adds component from "tambo:showComponent" event', () => {
      const eventData = { messageId: 'event-msg-1', component: <div data-testid="event-comp-1">EventComp1</div> };
      act(() => {
        fireEvent(
          window,
          new CustomEvent('tambo:showComponent', { detail: eventData })
        );
      });

      expect(mockCreateShapes).toHaveBeenCalledTimes(1);
      expect(mockCreateShapes).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'tambo',
          props: expect.objectContaining({
            componentData: expect.objectContaining({
              type: 'tambo-component',
              messageId: 'event-msg-1',
              props: {}
            }),
            name: 'Rendered Component',
          }),
        }),
      ]);
    });

    it('clears canvas on thread change', () => {
      // 1. Initial render, mount editor
      mockUseTamboThread.mockReturnValue({ thread: null });
      const { rerender } = render(<CanvasSpace />);
      act(() => {
        if (mockEditorOnMountCallback) mockEditorOnMountCallback(mockEditor);
      });

      // 2. Introduce first thread (thread-1)
      const thread1: TamboThread = { ...initialThread, id: 'thread-1' };
      mockUseTamboThread.mockReturnValue({ thread: thread1 });
      act(() => {
        rerender(<CanvasSpace />);
      });
      // At this point, previousThreadId should be 'thread-1' internally in CanvasSpace

      // 3. Simulate shapes existing on the canvas for thread-1
      mockGetCurrentPageShapes.mockReturnValue([{ id: 'shape-1' } as TLShape, { id: 'shape-2' } as TLShape]);

      // 4. Switch to a new thread (thread-2)
      const thread2: TamboThread = { ...initialThread, id: 'thread-2' };
      mockUseTamboThread.mockReturnValue({ thread: thread2 });
      act(() => {
        rerender(<CanvasSpace />);
      });

      expect(mockDeleteShapes).toHaveBeenCalledTimes(1);
      expect(mockDeleteShapes).toHaveBeenCalledWith(['shape-1', 'shape-2']);
    });

    it('does not add the same component twice from thread messages', () => {
      // 1. Initial render, mount editor
      mockUseTamboThread.mockReturnValue({ thread: null });
      const { rerender } = render(<CanvasSpace />);
      act(() => {
        if (mockEditorOnMountCallback) mockEditorOnMountCallback(mockEditor);
      });

      // 2. Introduce thread with a message
      const threadWithMessage: TamboThread = {
        ...initialThread,
        id: 'thread-for-dup-message',
        messages: [
          { id: 'msg-duplicate', role: 'assistant', content: 'Test', renderedComponent: <div data-testid="comp-dup">Dup</div>, createdAt: new Date() },
        ],
      };
      mockUseTamboThread.mockReturnValue({ thread: threadWithMessage });
      act(() => {
        rerender(<CanvasSpace />); // First time processing this message
      });

      expect(mockCreateShapes).toHaveBeenCalledTimes(1); // Should be called once for msg-duplicate
      expect(mockCreateShapes).toHaveBeenLastCalledWith([
        expect.objectContaining({ props: expect.objectContaining({ name: 'AI Response' }) }) // Check some detail of the call
      ]);

      // 3. Simulate another update with the same message (e.g., thread object ref changes but messageId is the same)
      // Create a new object for the thread, but keep message content and ID the same.
      const updatedThreadInstanceSameMessage: TamboThread = {
        ...threadWithMessage,
        metadata: { someChange: true } // Ensure it's a new thread object instance
      };
      mockUseTamboThread.mockReturnValue({ thread: updatedThreadInstanceSameMessage });
      act(() => {
        rerender(<CanvasSpace />);
      });

      expect(mockCreateShapes).toHaveBeenCalledTimes(1); // Should still be 1, not called again for 'msg-duplicate'
    });

     it('does not add the same component twice from "tambo:showComponent" event', () => {
      const eventData = { messageId: 'event-msg-dup', component: <div data-testid="event-comp-dup">EventDup</div> };
      act(() => {
        fireEvent(window, new CustomEvent('tambo:showComponent', { detail: eventData }));
      });
      expect(mockCreateShapes).toHaveBeenCalledTimes(1);

      // Fire the same event again
      act(() => {
        fireEvent(window, new CustomEvent('tambo:showComponent', { detail: eventData }));
      });
      expect(mockCreateShapes).toHaveBeenCalledTimes(1); // Should still be 1
    });
  });
});
