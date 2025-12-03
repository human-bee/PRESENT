'use client';

import { useCallback, useRef, useEffect, useMemo } from 'react';
import type { LinearIssue, LinearStatus, DropIndicator, PendingUpdate } from '@/lib/linear/types';

const DEBUG_DND = process.env.NODE_ENV !== 'production';
const dndLog = (...args: unknown[]) => {
  if (DEBUG_DND) console.log(...args);
};

export interface UseKanbanDragDropOptions {
  issues: LinearIssue[];
  effectiveStatuses: LinearStatus[];
  draggedIssue: string | null;
  dropIndicator: DropIndicator | null;
  activeDropColumn: string | null;
  onStateChange: (updates: Partial<{
    draggedIssue: string | null;
    dropIndicator: DropIndicator | null;
    activeDropColumn: string | null;
    issues: LinearIssue[];
    pendingUpdates: PendingUpdate[];
    updateMessage: string;
  }>) => void;
}

export interface UseKanbanDragDropReturn {
  draggedIssueRef: React.RefObject<string | null>;
  dropIndicatorRef: React.RefObject<DropIndicator | null>;
  boardRef: { current: HTMLDivElement | null };
  handleDragStart: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  handleDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>, columnId: string) => void;
  handleDragOverCard: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>, newStatus: string) => void;
  handleBoardDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleBoardDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  setDropIndicator: (indicator: DropIndicator | null) => void;
  queueStatusChange: (issueId: string, newStatus: string) => void;
}

export function useKanbanDragDrop(options: UseKanbanDragDropOptions): UseKanbanDragDropReturn {
  const { 
    issues, 
    effectiveStatuses, 
    draggedIssue, 
    dropIndicator, 
    activeDropColumn,
    onStateChange 
  } = options;

  const draggedIssueRef = useRef<string | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const boardRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);

  useEffect(() => {
    draggedIssueRef.current = draggedIssue;
  }, [draggedIssue]);

  useEffect(() => {
    dropIndicatorRef.current = dropIndicator;
  }, [dropIndicator]);

  const setDropIndicator = useCallback((indicator: DropIndicator | null) => {
    dropIndicatorRef.current = indicator;
    onStateChange({ dropIndicator: indicator });
  }, [onStateChange]);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, issueId: string) => {
    dndLog('[Kanban] Drag Start:', issueId);
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-kanban-issue', issueId);
    dropIndicatorRef.current = null;
    onStateChange({ draggedIssue: issueId, activeDropColumn: null, dropIndicator: null });
  }, [onStateChange]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    dndLog('[Kanban] Drag End');
    e.stopPropagation();
    onStateChange({ draggedIssue: null, activeDropColumn: null, dropIndicator: null });
  }, [onStateChange]);

  const handleBoardDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (boardRef.current && e.target !== boardRef.current) {
      return;
    }
    if (!draggedIssueRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (activeDropColumn || dropIndicator) {
      dndLog('[Kanban] Board Drag Over (Clearing State)');
      setDropIndicator(null);
      onStateChange({ activeDropColumn: null, dropIndicator: null });
    }
  }, [activeDropColumn, dropIndicator, setDropIndicator, onStateChange]);

  const handleBoardDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (boardRef.current && e.target !== boardRef.current) {
      return;
    }
    if (!draggedIssueRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    dndLog('[Kanban] Board Drop (Cancelled)');
    setDropIndicator(null);
    onStateChange({ draggedIssue: null, activeDropColumn: null, dropIndicator: null });
  }, [setDropIndicator, onStateChange]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, columnId: string) => {
    if (!draggedIssueRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    if (activeDropColumn !== columnId) {
      dndLog('[Kanban] Column Drag Over:', columnId);
      onStateChange({ activeDropColumn: columnId });
    }

    const cards = Array.from(e.currentTarget.querySelectorAll('[data-issue-id]'));

    if (cards.length === 0) {
      if (dropIndicator) {
        setDropIndicator(null);
      }
      return;
    }

    const elementAfter = cards.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = e.clientY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null as Element | null });

    if (elementAfter.element) {
      const targetId = elementAfter.element.getAttribute('data-issue-id');
      if (targetId && targetId !== draggedIssueRef.current) {
        if (dropIndicator?.targetId !== targetId || dropIndicator?.position !== 'before') {
          setDropIndicator({ targetId, position: 'before' });
        }
      }
    } else {
      const lastCard = cards[cards.length - 1];
      const targetId = lastCard.getAttribute('data-issue-id');
      if (targetId && targetId !== draggedIssueRef.current) {
        if (dropIndicator?.targetId !== targetId || dropIndicator?.position !== 'after') {
          setDropIndicator({ targetId, position: 'after' });
        }
      }
    }
  }, [activeDropColumn, dropIndicator, setDropIndicator, onStateChange]);

  const handleDragOverCard = useCallback((e: React.DragEvent<HTMLDivElement>, issueId: string) => {
    if (!draggedIssueRef.current) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (issueId === draggedIssueRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    dndLog('[Kanban] Card Drag Over:', { targetId: issueId, position });
    setDropIndicator({ targetId: issueId, position });
  }, [setDropIndicator]);

  const queueStatusChange = useCallback((issueId: string, newStatus: string) => {
    const dragged = issues.find((i) => i.id === issueId);
    if (!dragged) {
      console.warn('[Kanban] Status change failed: Issue not found', issueId);
      return;
    }

    const statusObj = effectiveStatuses.find((s: any) =>
      typeof s === 'string'
        ? s === newStatus
        : s.name === newStatus || s.id === newStatus,
    );
    if (!statusObj) {
      console.error('[Kanban] Status not found:', newStatus);
      onStateChange({ updateMessage: `❌ Error: Status "${newStatus}" not found` });
      return;
    }

    const statusId = typeof statusObj === 'string' ? statusObj : statusObj.id || newStatus;
    const statusName = typeof statusObj === 'string' ? statusObj : statusObj.name || statusObj.id || newStatus;

    const updatedIssues = issues.filter((i) => i.id !== issueId);
    updatedIssues.push({ ...dragged, status: statusName, statusId });

    const updateRequest: PendingUpdate = {
      id: Date.now(),
      issueId: dragged.id,
      issueIdentifier: dragged.identifier,
      fromStatus: dragged.status,
      toStatus: statusName,
      statusId,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };

    onStateChange({
      issues: updatedIssues,
      pendingUpdates: [updateRequest], // Will be merged with existing
      updateMessage: `📝 Queued update: ${dragged.identifier} → ${newStatus}`,
    });
  }, [issues, effectiveStatuses, onStateChange]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, newStatus: string) => {
    const currentDraggedIssue = draggedIssueRef.current;
    dndLog('[Kanban] Drop on Column/Card:', { newStatus, draggedIssue: currentDraggedIssue });
    if (!currentDraggedIssue) return;

    e.preventDefault();
    e.stopPropagation();

    const dragged = issues.find((i) => i.id === currentDraggedIssue);
    if (!dragged) {
      console.warn('[Kanban] Drop failed: No dragged issue found');
      setDropIndicator(null);
      onStateChange({ draggedIssue: null, activeDropColumn: null, dropIndicator: null });
      return;
    }

    // Calculate new index
    const canon = (str: string) => str.toLowerCase().replace(/\s+/g, '');
    let updatedIssues = [...issues];
    const currentIndex = updatedIssues.findIndex(i => i.id === dragged.id);

    let newIndex = updatedIssues.length;
    const currentIndicator = dropIndicatorRef.current;

    if (currentIndicator) {
      const targetIndex = updatedIssues.findIndex(i => i.id === currentIndicator.targetId);
      if (targetIndex !== -1) {
        newIndex = currentIndicator.position === 'before' ? targetIndex : targetIndex + 1;
        if (currentIndex < newIndex) {
          newIndex -= 1;
        }
      }
    } else {
      const columnIssues = updatedIssues.filter((i) => {
        const candidates = [i.statusId, i.status].filter(Boolean).map((val: any) => canon(String(val)));
        return candidates.includes(canon(newStatus));
      });
      if (columnIssues.length > 0) {
        const lastIssue = columnIssues[columnIssues.length - 1];
        const lastIndex = updatedIssues.findIndex(i => i.id === lastIssue.id);
        newIndex = lastIndex + 1;
        if (currentIndex < newIndex) {
          newIndex -= 1;
        }
      }
    }

    // Remove dragged issue
    updatedIssues.splice(currentIndex, 1);

    // Update status
    const statusObj = effectiveStatuses.find((s: any) =>
      typeof s === 'string'
        ? s === newStatus
        : s.name === newStatus || s.id === newStatus,
    );
    const statusId = typeof statusObj === 'string' ? statusObj : (statusObj as any)?.id || newStatus;
    const statusName = typeof statusObj === 'string' ? statusObj : (statusObj as any)?.name || (statusObj as any)?.id || newStatus;

    const updatedDragged = { ...dragged, status: statusName, statusId };

    // Insert at new position
    updatedIssues.splice(Math.max(0, Math.min(newIndex, updatedIssues.length)), 0, updatedDragged);

    // Create pending update
    const hasStatusChanged = canon(String(dragged.status || '')) !== canon(String(statusName || ''));
    
    let pendingUpdate: PendingUpdate | undefined;
    if (hasStatusChanged) {
      pendingUpdate = {
        id: Date.now(),
        issueId: dragged.id,
        issueIdentifier: dragged.identifier,
        fromStatus: dragged.status,
        toStatus: statusName,
        statusId,
        timestamp: new Date().toISOString(),
        status: 'pending',
      };
    }

    const updateMessage = hasStatusChanged
      ? `📝 Queued: ${dragged.identifier} → ${statusName}`
      : `✅ Reordered: ${dragged.identifier}`;

    onStateChange({
      issues: updatedIssues,
      draggedIssue: null,
      activeDropColumn: null,
      dropIndicator: null,
      updateMessage,
      ...(pendingUpdate ? { pendingUpdates: [pendingUpdate] } : {}),
    });

    setDropIndicator(null);
  }, [issues, effectiveStatuses, setDropIndicator, onStateChange]);

  return {
    draggedIssueRef,
    dropIndicatorRef,
    boardRef,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragOverCard,
    handleDrop,
    handleBoardDragOver,
    handleBoardDrop,
    setDropIndicator,
    queueStatusChange,
  };
}
