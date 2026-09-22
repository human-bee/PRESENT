import { ToolStyles } from './canvas-chrome';
import { GeoShapeGeoStyle, useEditor, useValue } from 'tldraw';
import { Icon, type IconName } from '../icons';

const tools: { id: string; label: string; icon?: IconName; glyph?: string; geo?: 'rectangle' | 'ellipse' }[] = [
  { id: 'select', label: 'Select · V', glyph: '↖' },
  { id: 'hand', label: 'Pan · H', icon: 'move' },
  { id: 'draw', label: 'Draw · D', icon: 'pen' },
  { id: 'eraser', label: 'Erase · E', glyph: '⌫' },
  { id: 'text', label: 'Text · T', glyph: 'T' },
  { id: 'note', label: 'Sticky note · N', icon: 'note' },
  { id: 'geo', geo: 'rectangle', label: 'Rectangle · R', glyph: '□' },
  { id: 'geo', geo: 'ellipse', label: 'Ellipse · O', glyph: '○' },
  { id: 'arrow', label: 'Arrow · A', glyph: '↗' },
  { id: 'frame', label: 'Frame · F', glyph: '▣' },
];

export function ToolRail() {
  const editor = useEditor();
  const active = useValue('tool', () => editor.getCurrentToolId(), [editor]);
  const canUndo = useValue('can-undo', () => editor.getCanUndo(), [editor]);
  const canRedo = useValue('can-redo', () => editor.getCanRedo(), [editor]);
  return <ToolStyles>
    <nav className="tool-rail overlay" aria-label="Canvas tools">
      {tools.map(tool => <button type="button" key={tool.label} title={tool.label} aria-label={tool.label} aria-pressed={active === tool.id} onClick={() => {
        if (tool.geo) editor.setStyleForNextShapes(GeoShapeGeoStyle, tool.geo);
        editor.setCurrentTool(tool.id); editor.focus();
      }}>{tool.icon ? <Icon name={tool.icon} size={17}/> : <span>{tool.glyph}</span>}</button>)}
      <span className="tool-divider"/>
      <button type="button" aria-label="Undo" title="Undo · ⌘Z" disabled={!canUndo} onClick={() => editor.undo()}>↶</button>
      <button type="button" aria-label="Redo" title="Redo · ⇧⌘Z" disabled={!canRedo} onClick={() => editor.redo()}>↷</button>
    </nav>
  </ToolStyles>;
}
