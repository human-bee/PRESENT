'use client';

import { useEffect, useRef } from 'react';
import type { InterviewEnvelope } from '@present/contracts/interviews';
import { briefRequest } from './api';

function visibleInViewport(element: HTMLElement) {
  if (element.offsetParent === null || element.closest('details:not([open])') || document.querySelector('dialog[open]')) return false;
  const box = element.getBoundingClientRect();
  let top = Math.max(0,box.top), bottom = Math.min(innerHeight,box.bottom), left = Math.max(0,box.left), right = Math.min(innerWidth,box.right);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top,bounds.top); bottom = Math.min(bottom,bounds.bottom); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left,bounds.left); right = Math.min(right,bounds.right); }
  }
  return box.width > 0 && box.height > 0 && bottom > top && right > left;
}

export function useRenderTraces(interview: InterviewEnvelope, token: string, scene: string) {
  const acknowledged = useRef(new Set<string>());
  useEffect(() => {
    if (scene === 'meet') return;
    let active = true;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!active) return;
      for (const trace of interview.pipeline) {
        const patches = trace.patches.filter((patch) => patch.accepted);
        if (trace.state !== 'complete' || !trace.savedAt || !patches.length) continue;
        const visible = patches.some((patch) => Array.from(document.querySelectorAll<HTMLTextAreaElement>(`#ob-document [data-brief-field="${patch.field}"]`))
          .some((element) => visibleInViewport(element) && (element.value || element.textContent || '').includes(patch.text)));
        if (!visible) continue;
        const widgets = trace.widgetTargets.filter((target) => Array.from(document.querySelectorAll<HTMLElement>(`[data-widget="${target}"]`)).some(visibleInViewport));
        const key = `${trace.id}:${interview.role}:${widgets.join(',')}`;
        if (acknowledged.current.has(key)) continue;
        acknowledged.current.add(key);
        void briefRequest(`/api/interviews/${interview.id}`, token, { action: 'trace-rendered', id: trace.id, widgets }).catch(() => acknowledged.current.delete(key));
      }
    }));
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [interview.id, interview.pipeline, interview.role, scene, token]);
}
