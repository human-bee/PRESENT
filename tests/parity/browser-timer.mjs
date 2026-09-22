// Serialized into the browser; observes the real rendered widget and native shape state.
export function installTimerProbe({ target, objectId }) {
  const editor = window.__presentEditor ?? window.__present?.tldrawEditor ?? window.editor;
  const stamp = () => ({ epochMs: performance.timeOrigin + performance.now(), monotonicMs: performance.now() });
  const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
  const actuallyVisible = element => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      if (parent === element) continue;
      const clip = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (bounds.left < clip.left - 1 || bounds.right > clip.right + 1)) return false;
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1)) return false;
    }
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return !!hit && (hit === element || element.contains(hit));
  };
  const read = () => {
    const shape = editor.getCurrentPageShapes().find(value => target === 'old' ? value.props.customComponent === objectId : value.id === `shape:${objectId}`);
    if (!shape) return null;
    const element = document.querySelector(`[data-shape-id="${shape.id}"]`);
    const bounds = element?.getBoundingClientRect();
    const state = target === 'old' ? shape.props.state : shape.props.data;
    const duration = target === 'old' ? state.configuredDuration ?? state.initialMinutes * 60 + (state.initialSeconds ?? 0) : state.durationMs / 1000;
    const running = target === 'old' ? state.isRunning ?? state.autoStart : state.endsAt !== null;
    const remaining = target === 'old' ? state.timeLeft ?? duration : state.endsAt === null ? state.remainingMs / 1000 : Math.max(0, (state.endsAt - Date.now()) / 1000);
    const timeElement = element ? [...element.querySelectorAll('*')].find(node => node.children.length === 0 && /^\d{1,2}:\d{2}$/.test(node.textContent?.trim() ?? '') && actuallyVisible(node)) : null;
    const displayedTime = timeElement?.textContent.trim() ?? null;
    const displayedSeconds = displayedTime ? displayedTime.split(':').reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0) : null;
    const timeVisible = !!timeElement;
    const timeConsistent = displayedSeconds !== null && Math.abs(displayedSeconds - Math.ceil(remaining)) <= (running ? 1 : 0);
    return { shapeId: shape.id, shape: canonicalize(shape), state: canonicalize(state), stateJson: JSON.stringify(canonicalize(state)), duration, running, remaining, timeVisible, displayedTime, displayedSeconds, timeConsistent,
      title: target === 'old' ? state.title : shape.props.title, text: element?.textContent ?? '', visible: !!bounds && bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight,
      controls: element ? [...element.querySelectorAll('button')].map(button => ({ text: button.textContent?.trim(), label: button.getAttribute('aria-label'), disabled: button.disabled, visible: actuallyVisible(button) })) : [] };
  };
  window.__timerParity = {
    marks: {}, read, stamp,
    arm(id, expected, timeoutMs = 10000) {
      const mark = { id, expected, armed: stamp() }; this.marks[id] = mark;
      const observe = () => {
        const value = read();
        const timeShown = value?.timeVisible && value.timeConsistent;
        const controlShown = value?.controls.some(control => control.visible && !control.disabled && (control.text === (expected.running ? 'Pause' : 'Start')));
        const correct = value?.visible && timeShown && controlShown && value.duration === expected.duration && value.running === expected.running
          && (expected.remaining === undefined || Math.abs(value.remaining - expected.remaining) < 0.001)
          && (expected.title === undefined || value.title === expected.title);
        if (correct) { mark.firstVisible = stamp(); mark.usable = stamp(); mark.value = value; mark.done = true; }
        else if (performance.now() - mark.armed.monotonicMs < timeoutMs) requestAnimationFrame(observe);
        else { mark.done = true; mark.error = 'Timer rendered/state/control timeout'; mark.value = value; }
      };
      requestAnimationFrame(observe);
    },
    commit(id) { this.marks[id].inputCommit = stamp(); },
    async dispatch(id, roomId, tool, params) {
      this.commit(id);
      const value = await window.__presentToolDispatcherExecute({ id, roomId, type: 'tool_call', payload: { tool, params }, timestamp: Date.now(), source: 'parity-control' });
      this.marks[id].dispatchReturned = stamp(); this.marks[id].dispatchResult = value;
    },
    async operation(id, roomId, operation) {
      this.commit(id);
      const response = await fetch(`/api/room/${roomId}/operation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'Parity control', requestId: id, operation }) });
      this.marks[id].dispatchReturned = stamp(); this.marks[id].dispatchResult = { status: response.status, body: await response.json() };
      if (!response.ok) throw new Error(`Room operation returned ${response.status}`);
    },
  };
}
