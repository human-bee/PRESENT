'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function BriefDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`ob-dialog ${wide ? 'ob-dialog-wide' : ''}`} aria-labelledby="ob-dialog-title"
    onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ob-dialog-inner"><header><h2 id="ob-dialog-title">{title}</h2><button className="ob-icon-button" aria-label="Close dialog" onClick={onClose}><X /></button></header>
      {children}
    </div>
  </dialog>;
}
