import type { Editor } from '@tldraw/tldraw';

export const runtimeSelectionListenOptions = {
  scope: 'session' as const,
  source: 'all' as const,
};

export function resolveRuntimeSelection(editor: Pick<Editor, 'getSelectedShapes'>) {
  const selectedShape = editor
    .getSelectedShapes()
    .find((shape) => shape.type === 'runtime_card' || shape.type === 'runtime_widget');

  const nodeId =
    selectedShape && 'nodeId' in selectedShape.props && typeof selectedShape.props.nodeId === 'string'
      ? selectedShape.props.nodeId
      : null;

  return {
    shapeId: selectedShape?.id ?? null,
    nodeId,
  };
}

export function subscribeToRuntimeSelection(
  editor: Pick<Editor, 'getSelectedShapes' | 'store'>,
  onRuntimeSelectionChange: (selection: { shapeId: string | null; nodeId: string | null }) => void,
) {
  const publishSelection = () => {
    onRuntimeSelectionChange(resolveRuntimeSelection(editor));
  };

  publishSelection();
  return editor.store.listen(() => publishSelection(), runtimeSelectionListenOptions);
}
