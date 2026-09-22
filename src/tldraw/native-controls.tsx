import { useEffect } from 'react';
import { useActions, useTools, useEditor, DefaultColorStyle, DefaultSizeStyle, DefaultFontStyle, DefaultTextAlignStyle, DefaultHorizontalAlignStyle, DefaultVerticalAlignStyle, DefaultFillStyle, DefaultDashStyle, GeoShapeGeoStyle, type Editor, type TLShapeId } from 'tldraw';
import { nativeControlSchema, type NativeControl } from '../../shared/native-controls';

export type CanvasUiMode = 'compact' | 'full' | 'hidden';
const styles = { color: DefaultColorStyle, size: DefaultSizeStyle, font: DefaultFontStyle, textAlign: DefaultTextAlignStyle, align: DefaultHorizontalAlignStyle, verticalAlign: DefaultVerticalAlignStyle, fill: DefaultFillStyle, dash: DefaultDashStyle, geo: GeoShapeGeoStyle };
const handlers = new WeakMap<Editor, (input: NativeControl) => Promise<unknown>>();
export async function controlNativeCanvas(editor: Editor | null, input: unknown) {
  const handler = editor && handlers.get(editor);
  if (!handler) throw new Error('Native canvas controls are still loading.');
  return handler(nativeControlSchema.parse(input));
}
export function NativeControls({ mode, setMode }: { mode: CanvasUiMode; setMode: (mode: CanvasUiMode) => void }) {
  const editor = useEditor(), actions = useActions(), tools = useTools();
  useEffect(() => {
    handlers.set(editor, async input => {
      if (input.command === 'discover') return { mode,
        actions: Object.values(actions).map(a => ({ id: a.id, label: a.label, shortcut: a.kbd })),
        tools: Object.values(tools).map(t => ({ id: t.id, label: t.label, shortcut: t.kbd })),
        styles: Object.fromEntries(Object.entries(styles).map(([key, style]) => [key, style.values])),
        selection: editor.getSelectedShapeIds(), pageId: editor.getCurrentPageId() };
      if (input.command === 'ui') {
        if (!['compact', 'full', 'hidden'].includes(input.value ?? '')) throw new Error('Choose compact, full or hidden.');
        setMode(input.value as CanvasUiMode); return { mode: input.value };
      }
      if (input.ids) {
        if (input.ids.some(id => !editor.getCurrentPageShapeIds().has(id as TLShapeId))) throw new Error('Read canvas again: a target is missing from this page.');
        editor.setSelectedShapes(input.ids as TLShapeId[]);
      }
      const id = input.id ?? '';
      if (input.command === 'style') {
        const style = styles[id as keyof typeof styles];
        if (!style || !style.values.includes(input.value as never)) throw new Error('Discover valid native styles first.');
        if (!input.ids?.length) throw new Error('Supply explicit shape ids for style changes.');
        editor.markHistoryStoppingPoint('agent native style');
        editor.setStyleForSelectedShapes(style, style.validate(input.value));
      } else if (input.command === 'tool') {
        if (!tools[id]) throw new Error('Discover native tools first.');
        tools[id].onSelect('unknown');
      } else {
        if (!actions[id]) throw new Error('Discover native actions first.');
        if (!input.ids) throw new Error('Supply exact target ids, or an empty list for a page/UI action.');
        await actions[id].onSelect('unknown');
      }
      return { invoked: id, selection: editor.getSelectedShapeIds(), tool: editor.getCurrentToolId(), completion: 'Native handler invoked; dialogs, clipboard permissions and exports may require human interaction.' };
    });
    return () => { handlers.delete(editor); };
  }, [editor, actions, tools, mode, setMode]);
  return null;
}
