'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { briefFields, type BriefField } from '@present/contracts/interviews';
import type { EvidenceSelection } from '@/lib/interviews/evidence';

export function useEvidenceMenu(onShow: (selection: EvidenceSelection) => void) {
  const [menu, setMenu] = useState<(EvidenceSelection & { x: number; y: number }) | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  function open(event: MouseEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-brief-field]');
    const field = target?.dataset.briefField as BriefField;
    if (!target || !briefFields.includes(field)) return;
    let text = window.getSelection()?.toString() || '';
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) text = target.value.slice(target.selectionStart || 0, target.selectionEnd || 0);
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    setMenu({ field, text, x: Math.min(event.clientX || bounds.left + 12, window.innerWidth - 190), y: Math.min(event.clientY || bounds.top + 24, window.innerHeight - 65) });
  }
  return {
    onContextMenu: open,
    element: menu && <div className="ob-evidence-menu-backdrop" onClick={() => setMenu(null)}><div role="menu" aria-label="Selected passage" className="ob-evidence-menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" autoFocus onClick={() => { onShow({ field: menu.field, text: menu.text }); setMenu(null); }}>Show evidence</button>
    </div></div>,
  };
}
