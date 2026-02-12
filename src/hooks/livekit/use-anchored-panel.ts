import * as React from 'react';

type AnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type UseAnchoredPanelOptions = {
  isCoarsePointer?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
};

type AnchoredPanelControls = {
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  setButtonNode: (node: HTMLButtonElement | null) => void;
  anchor: AnchorRect | null;
  panelStyle: React.CSSProperties | null;
  updateAnchor: () => void;
};

export function useAnchoredPanel({
  isCoarsePointer = false,
  onOpen,
  onClose,
}: UseAnchoredPanelOptions = {}): AnchoredPanelControls {
  const [isOpen, setIsOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<AnchorRect | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties | null>(null);

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const updateAnchor = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const node = buttonRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const openPanel = React.useCallback(() => {
    setIsOpen(true);
    onOpen?.();
    updateAnchor();
  }, [onOpen, updateAnchor]);

  const closePanel = React.useCallback(() => {
    setIsOpen(false);
    setPanelStyle(null);
    onClose?.();
  }, [onClose]);

  const setButtonNode = React.useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (node && isOpen) {
        updateAnchor();
      }
    },
    [isOpen, updateAnchor],
  );

  React.useEffect(() => {
    if (!isOpen) return;
    const handleViewportChange = () => updateAnchor();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateAnchor]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        buttonRef.current?.focus?.();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        (target && panelRef.current?.contains(target)) ||
        (target && buttonRef.current?.contains(target))
      ) {
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, closePanel]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined') return;
    const currentAnchor = anchor;
    const panel = panelRef.current;
    if (!currentAnchor || !panel) return;

    const panelRect = panel.getBoundingClientRect();
    const verticalGap = isCoarsePointer ? 20 : 16;

    let top = currentAnchor.top - panelRect.height - verticalGap;
    if (top < 12) {
      top = Math.min(currentAnchor.bottom + verticalGap, window.innerHeight - panelRect.height - 12);
    }

    let left = currentAnchor.right - panelRect.width;
    if (left < 12) left = 12;
    const maxLeft = window.innerWidth - panelRect.width - 12;
    if (left > maxLeft) left = Math.max(12, maxLeft);

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 1000,
    });
  }, [anchor, isCoarsePointer, isOpen]);

  return {
    isOpen,
    openPanel,
    closePanel,
    panelRef,
    setButtonNode,
    anchor,
    panelStyle,
    updateAnchor,
  };
}
