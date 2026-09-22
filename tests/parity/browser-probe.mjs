// This function is serialized into each browser; it deliberately imports no application code.
export function installProbe() {
  const editor = window.__presentEditor ?? window.__present?.tldrawEditor ?? window.editor;
  if (!editor) throw new Error('Native tldraw editor is unavailable.');
  const stamp = () => ({ epochMs: performance.timeOrigin + performance.now(), monotonicMs: performance.now() });
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    return value;
  };
  const text = value => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] });
  const visible = id => {
    const element = document.querySelector(`[data-shape-id="${id}"]`);
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0
      && bounds.left < innerWidth && bounds.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none';
  };
  window.__parity = {
    marks: {},
    seed(seedId) {
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      editor.createShapes([
        { id: `shape:${seedId}-research`, type: 'geo', x: 180, y: 240, props: { w: 160, h: 120, geo: 'rectangle', richText: text('Research'), fill: 'semi', color: 'blue' } },
        { id: `shape:${seedId}-launch`, type: 'geo', x: 580, y: 240, props: { w: 160, h: 120, geo: 'rectangle', richText: text('Launch'), fill: 'semi', color: 'green' } },
      ]);
      editor.setCamera({ x: 0, y: 0, z: 1 });
      return editor.getCurrentPageShapes().map(shape => shape.id);
    },
    arm(requestId, initiator) {
      const ids = [`shape:${requestId}-arrow`, `shape:${requestId}-circle`];
      const result = { requestId, armed: stamp(), ids };
      window.__parity.marks[requestId] = result;
      let frames = 0;
      const observe = () => {
        frames += 1;
        const shapes = ids.map(id => editor.getShape(id));
        const visibleIds = ids.filter(visible);
        if (!result.firstVisible && visibleIds.length) result.firstVisible = stamp();
        const correct = shapes[0]?.type === 'arrow' && shapes[0]?.x === 350 && shapes[0]?.y === 300
          && shapes[0]?.props.end.x === 220 && shapes[0]?.props.end.y === 0
          && shapes[1]?.type === 'geo' && shapes[1]?.x === 555 && shapes[1]?.y === 215
          && shapes[1]?.props.w === 210 && shapes[1]?.props.h === 170 && shapes[1]?.props.geo === 'ellipse'
          && shapes.every(shape => shape?.meta.parityRequestId === requestId);
        const selected = !initiator || ids.every(id => editor.getSelectedShapeIds().includes(id));
        if (visibleIds.length === ids.length && correct && selected) {
          result.usable = stamp();
          result.framesObserved = frames;
          result.state = canonicalize(shapes);
          result.stateJson = JSON.stringify(result.state);
          result.selected = selected;
          result.done = true;
        } else if (performance.now() - result.armed.monotonicMs < 5000) requestAnimationFrame(observe);
        else { result.done = true; result.error = 'Five-second visible/selectable/converged-state timeout.'; }
      };
      requestAnimationFrame(observe);
    },
    commit(requestId) {
      const result = window.__parity.marks[requestId];
      result.inputCommit = stamp();
      editor.run(() => {
        editor.createShapes([
          { id: `shape:${requestId}-arrow`, type: 'arrow', x: 350, y: 300, props: { start: { x: 0, y: 0 }, end: { x: 220, y: 0 }, color: 'black', arrowheadEnd: 'arrow' }, meta: { parityRequestId: requestId } },
          { id: `shape:${requestId}-circle`, type: 'geo', x: 555, y: 215, props: { w: 210, h: 170, geo: 'ellipse', fill: 'none', color: 'red' }, meta: { parityRequestId: requestId } },
        ]);
        editor.select(`shape:${requestId}-arrow`, `shape:${requestId}-circle`);
      });
      result.browserApplied = stamp();
    },
    seedReady(seedId) {
      return [`shape:${seedId}-research`, `shape:${seedId}-launch`].every(id => Boolean(editor.getShape(id)) && visible(id));
    },
    read(ids) { return JSON.stringify(canonicalize(ids.map(id => editor.getShape(id)))); },
  };
}
