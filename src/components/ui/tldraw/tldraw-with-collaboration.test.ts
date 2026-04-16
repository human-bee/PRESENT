import {
  resolveRuntimeSelection,
  runtimeSelectionListenOptions,
  subscribeToRuntimeSelection,
} from './runtime/runtime-selection';

describe('runtime selection helpers', () => {
  it('subscribes to TLDraw session-scoped selection updates', () => {
    const unsubscribe = jest.fn();
    const listen = jest.fn().mockReturnValue(unsubscribe);
    const onRuntimeSelectionChange = jest.fn();
    const editor = {
      getSelectedShapes: () => [
        {
          id: 'shape:runtime-widget',
          type: 'runtime_widget',
          props: {
            nodeId: 'widget:artifact_widget',
          },
        },
      ],
      store: {
        listen,
      },
    } as any;

    const dispose = subscribeToRuntimeSelection(editor, onRuntimeSelectionChange);

    expect(onRuntimeSelectionChange).toHaveBeenCalledWith({
      shapeId: 'shape:runtime-widget',
      nodeId: 'widget:artifact_widget',
    });
    expect(listen).toHaveBeenCalledWith(expect.any(Function), runtimeSelectionListenOptions);
    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('ignores non-runtime selections when resolving the inspector target', () => {
    const selection = resolveRuntimeSelection({
      getSelectedShapes: () => [
        {
          id: 'shape:custom',
          type: 'custom',
          props: {},
        },
      ],
    } as any);

    expect(selection).toEqual({
      shapeId: null,
      nodeId: null,
    });
  });
});
