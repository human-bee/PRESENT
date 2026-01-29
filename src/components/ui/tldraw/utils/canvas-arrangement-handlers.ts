import type { Editor } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';
import { getSelectedCustomShapes } from './canvas-selection-shared';
import { createLogger } from '@/lib/utils';

interface ArrangementHandlersDeps {
  editor: Editor;
}

export function createCanvasArrangementHandlers({ editor }: ArrangementHandlersDeps): CanvasEventMap {
  const logger = createLogger('CanvasArrangementHandlers');
  const lastArrangeRef = new Map<string, { ts: number; signature: string }>();
  const activePresetRef = { preset: '', detail: null as Record<string, any> | null };

  const shouldSkip = (key: string, signature: string, detail: Record<string, any>) => {
    if (detail?.force) {
      lastArrangeRef.set(key, { ts: Date.now(), signature });
      return false;
    }
    const cooldownMs =
      typeof detail?.cooldownMs === 'number' && Number.isFinite(detail.cooldownMs)
        ? Math.max(0, detail.cooldownMs)
        : 800;
    if (cooldownMs <= 0) {
      lastArrangeRef.set(key, { ts: Date.now(), signature });
      return false;
    }
    const last = lastArrangeRef.get(key);
    const now = Date.now();
    if (last && last.signature === signature && now - last.ts < cooldownMs) {
      return true;
    }
    lastArrangeRef.set(key, { ts: now, signature });
    return false;
  };

  const resolveTargets = (detail: Record<string, any>) => {
    const selectionOnly = Boolean(detail.selectionOnly);
    let targets = getSelectedCustomShapes(editor);

    if (!selectionOnly || targets.length === 0) {
      targets = (editor.getCurrentPageShapes() as any[]).filter((shape) => shape.type === 'custom');
    }

    const componentTypes = Array.isArray(detail.componentTypes)
      ? detail.componentTypes.filter((t: unknown) => typeof t === 'string')
      : undefined;
    if (componentTypes && componentTypes.length > 0) {
      const typeSet = new Set(componentTypes.map((t) => String(t)));
      targets = targets.filter((shape) => typeSet.has(String(shape.props?.name || '')));
    }

    const componentIds = Array.isArray(detail.componentIds)
      ? detail.componentIds.filter((t: unknown) => typeof t === 'string')
      : undefined;
    if (componentIds && componentIds.length > 0) {
      const idSet = new Set(componentIds.map((t) => String(t)));
      targets = targets.filter((shape) => idSet.has(String(shape.props?.customComponent || '')));
    }

    return targets;
  };

  const resolveParticipantIdentity = (shape: any) => {
    const state = shape?.props?.state || {};
    const direct = shape?.props?.participantIdentity;
    const fromState = (state as Record<string, unknown>).participantIdentity;
    return String(direct || fromState || '').trim();
  };

  const getActiveSpeakerIdentity = (detail: Record<string, any>) => {
    const explicit =
      (typeof detail.speakerIdentity === 'string' && detail.speakerIdentity) ||
      (typeof detail.participantId === 'string' && detail.participantId) ||
      (typeof detail.identity === 'string' && detail.identity);
    if (explicit) return explicit;

    if (typeof window === 'undefined') return '';
    const roomName = typeof detail.roomName === 'string' ? detail.roomName : '';
    if (roomName) {
      const map = (window as any).__presentActiveSpeakerByRoom as
        | Record<string, { participantId?: string; name?: string }>
        | undefined;
      const scoped = map ? map[roomName] : undefined;
      if (scoped?.participantId) return scoped.participantId;
    }
    const snapshot = (window as any).__presentActiveSpeaker as
      | { participantId?: string; name?: string }
      | undefined;
    return snapshot?.participantId || '';
  };

  const handleArrangeGrid: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const spacing = typeof detail.spacing === 'number' ? detail.spacing : 24;
      const targets = resolveTargets(detail);

      if (!targets.length) return;

      const cols =
        typeof detail.cols === 'number' && Number.isFinite(detail.cols)
          ? Math.max(1, Math.floor(detail.cols))
          : Math.ceil(Math.sqrt(targets.length));
      const rows = Math.ceil(targets.length / cols);
      const sizes = targets.map((shape) => ({ w: shape.props?.w ?? 300, h: shape.props?.h ?? 200 }));
      const maxW = Math.max(...sizes.map((s) => s.w));
      const maxH = Math.max(...sizes.map((s) => s.h));
      const viewport = editor.getViewportPageBounds();
      const totalW = cols * maxW + (cols - 1) * spacing;
      const totalH = rows * maxH + (rows - 1) * spacing;
      const left = viewport ? viewport.midX - totalW / 2 : 0;
      const top = viewport ? viewport.midY - totalH / 2 : 0;

      const updates: any[] = [];
      for (let i = 0; i < targets.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = left + col * (maxW + spacing);
        const y = top + row * (maxH + spacing);
        updates.push({ id: targets[i].id, type: targets[i].type as any, x, y });
      }

      editor.updateShapes(updates as any);
    } catch (error) {
      logger.warn('arrange_grid error', error);
    }
  };

  const handleArrangeSidebar: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const spacing = typeof detail.spacing === 'number' ? detail.spacing : 16;
      const padding = typeof detail.padding === 'number' ? detail.padding : 24;
      const side = detail.side === 'left' ? 'left' : 'right';
      const targets = resolveTargets(detail);

      if (!targets.length) return;

      const sizes = targets.map((shape) => ({ w: shape.props?.w ?? 300, h: shape.props?.h ?? 200 }));
      const maxW = Math.max(...sizes.map((s) => s.w));
      const viewport = editor.getViewportPageBounds();
      const minX = viewport ? viewport.minX : 0;
      const maxX = viewport ? viewport.maxX : maxW + padding;
      const startX = side === 'left' ? minX + padding : maxX - maxW - padding;
      let y = viewport ? viewport.minY + padding : padding;

      const updates: any[] = [];
      for (let i = 0; i < targets.length; i++) {
        const shape = targets[i];
        const height = shape.props?.h ?? 200;
        updates.push({ id: shape.id, type: shape.type as any, x: startX, y });
        y += height + spacing;
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      logger.warn('arrange_sidebar error', error);
    }
  };

  const handleArrangeSpeaker: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const spacing = typeof detail.spacing === 'number' ? detail.spacing : 16;
      const padding = typeof detail.padding === 'number' ? detail.padding : 24;
      const side = detail.side === 'left' ? 'left' : 'right';

      const hasComponentTypes =
        Array.isArray(detail.componentTypes) && detail.componentTypes.filter((t: unknown) => typeof t === 'string').length > 0;
      const targets = resolveTargets(
        hasComponentTypes ? detail : { ...detail, componentTypes: ['LivekitParticipantTile'] },
      );
      if (!targets.length) return;

      const speakerIdentity = getActiveSpeakerIdentity(detail);
      const speakerShapeId =
        typeof detail.speakerShapeId === 'string' && detail.speakerShapeId.trim().length > 0
          ? detail.speakerShapeId.trim()
          : null;
      const speakerComponentId =
        typeof detail.speakerComponentId === 'string' && detail.speakerComponentId.trim().length > 0
          ? detail.speakerComponentId.trim()
          : null;

      const speaker =
        (speakerShapeId ? targets.find((shape) => shape.id === speakerShapeId) : undefined) ||
        (speakerComponentId
          ? targets.find((shape) => String(shape.props?.customComponent || '') === speakerComponentId)
          : undefined) ||
        (speakerIdentity
          ? targets.find((shape) => resolveParticipantIdentity(shape) === speakerIdentity)
          : undefined) ||
        targets[0];

      const others = targets.filter((shape) => shape.id !== speaker.id);
      const signature = [
        speakerIdentity || speakerComponentId || speakerShapeId || speaker.id,
        side,
        targets.length,
      ].join('|');
      if (shouldSkip('arrangeSpeaker', signature, detail)) return;

      const viewport = editor.getViewportPageBounds();
      if (!viewport) return;

      const updates: any[] = [];

      if (others.length > 0) {
        const sizes = others.map((shape) => ({ w: shape.props?.w ?? 300, h: shape.props?.h ?? 200 }));
        const maxW = Math.max(...sizes.map((s) => s.w));
        const startX = side === 'left' ? viewport.minX + padding : viewport.maxX - maxW - padding;
        let y = viewport.minY + padding;
        for (const shape of others) {
          const height = shape.props?.h ?? 200;
          updates.push({ id: shape.id, type: shape.type as any, x: startX, y });
          y += height + spacing;
        }
      }

      const speakerWidth = speaker.props?.w ?? 320;
      const speakerHeight = speaker.props?.h ?? 240;
      let speakerX = viewport.midX - speakerWidth / 2;
      if (others.length > 0) {
        const sidebarWidth = Math.max(...others.map((shape) => shape.props?.w ?? 300));
        const availableMinX = side === 'left' ? viewport.minX + sidebarWidth + padding * 2 : viewport.minX + padding;
        const availableMaxX = side === 'left' ? viewport.maxX - padding : viewport.maxX - sidebarWidth - padding * 2;
        speakerX = Math.min(Math.max(speakerX, availableMinX), availableMaxX - speakerWidth);
      }
      const speakerY = viewport.midY - speakerHeight / 2;
      updates.push({ id: speaker.id, type: speaker.type as any, x: speakerX, y: speakerY });

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      logger.warn('arrange_speaker error', error);
    }
  };

  const normalizePreset = (value: unknown) => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!raw) return '';
    if (raw === 'gallery' || raw === 'grid' || raw === 'tiles') return 'gallery';
    if (raw === 'speaker' || raw === 'spotlight' || raw === 'focus') return 'speaker';
    if (raw === 'sidebar' || raw === 'filmstrip') return 'sidebar';
    if (raw === 'presenter' || raw === 'presentation' || raw === 'screen') return 'presenter';
    if (raw === 'canvas' || raw === 'board' || raw === 'whiteboard') return 'canvas';
    return raw;
  };

  const handleApplyViewPreset: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const preset = normalizePreset(detail.preset ?? detail.view ?? detail.mode);
      if (!preset) return;

      const componentTypes = Array.isArray(detail.componentTypes)
        ? detail.componentTypes.filter((t: unknown) => typeof t === 'string')
        : undefined;

      const signature = [
        preset,
        componentTypes?.join(',') || '',
        Array.isArray(detail.componentIds) ? detail.componentIds.join(',') : '',
        detail.side || '',
      ]
        .filter(Boolean)
        .join('|');

      if (shouldSkip('applyViewPreset', signature, detail)) return;

      const baseDetail = { ...detail };
      if (!componentTypes || componentTypes.length === 0) {
        baseDetail.componentTypes = ['LivekitParticipantTile'];
      }

      if (preset === 'gallery') {
        activePresetRef.preset = preset;
        activePresetRef.detail = baseDetail;
        handleArrangeGrid(new CustomEvent('tldraw:arrangeGrid', { detail: baseDetail }));
        return;
      }

      if (preset === 'sidebar') {
        if (!baseDetail.side) baseDetail.side = 'right';
        activePresetRef.preset = preset;
        activePresetRef.detail = baseDetail;
        handleArrangeSidebar(new CustomEvent('tldraw:arrangeSidebar', { detail: baseDetail }));
        return;
      }

      if (preset === 'presenter') {
        const shapes = editor.getCurrentPageShapes() as any[];
        const screenShare = shapes.find(
          (shape) => shape.type === 'custom' && shape.props?.name === 'LivekitScreenShareTile',
        );
        baseDetail.componentTypes = ['LivekitScreenShareTile', 'LivekitParticipantTile'];
        if (screenShare?.id) {
          baseDetail.speakerShapeId = screenShare.id;
        }
        if (!baseDetail.side) baseDetail.side = 'right';
        activePresetRef.preset = preset;
        activePresetRef.detail = baseDetail;
        handleArrangeSpeaker(new CustomEvent('tldraw:arrangeSpeaker', { detail: baseDetail }));
        return;
      }

      if (preset === 'speaker') {
        if (!baseDetail.side) baseDetail.side = 'right';
        activePresetRef.preset = preset;
        activePresetRef.detail = baseDetail;
        handleArrangeSpeaker(new CustomEvent('tldraw:arrangeSpeaker', { detail: baseDetail }));
        return;
      }

      if (preset === 'canvas') {
        activePresetRef.preset = preset;
        activePresetRef.detail = baseDetail;
        if ((editor as any).zoomToFit) {
          (editor as any).zoomToFit();
        } else {
          const bounds = editor.getCurrentPageBounds();
          if (bounds && (editor as any).zoomToBounds) {
            (editor as any).zoomToBounds(bounds, { animation: { duration: 320 } });
          }
        }
      }
    } catch (error) {
      logger.warn('apply_view_preset error', error);
    }
  };

  const handleActiveSpeakerChanged: EventListener = (event) => {
    try {
      const snapshot = (event as CustomEvent).detail || {};
      const preset = activePresetRef.preset;
      const detail = activePresetRef.detail || {};
      if (!preset || (preset !== 'speaker' && preset !== 'presenter')) return;
      if (detail.followActiveSpeaker === false) return;
      const speakerIdentity = snapshot?.participantId;
      if (!speakerIdentity || typeof speakerIdentity !== 'string') return;
      const nextDetail = {
        ...detail,
        speakerIdentity,
        cooldownMs: typeof detail.cooldownMs === 'number' ? detail.cooldownMs : 450,
      };
      handleArrangeSpeaker(new CustomEvent('tldraw:arrangeSpeaker', { detail: nextDetail }));
    } catch (error) {
      logger.warn('active_speaker_preset error', error);
    }
  };

  const handleAlignSelected: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const axis: 'x' | 'y' = detail.axis || 'x';
      const mode: string = detail.mode || (axis === 'x' ? 'center' : 'middle');

      const targets = getSelectedCustomShapes(editor);
      if (!targets.length) return;

      const withBounds = targets
        .map((shape) => ({ shape, bounds: editor.getShapePageBounds(shape.id as any) }))
        .filter((entry): entry is { shape: any; bounds: any } => Boolean(entry.bounds));

      if (!withBounds.length) return;

      const minX = Math.min(...withBounds.map((entry) => entry.bounds.x));
      const maxX = Math.max(...withBounds.map((entry) => entry.bounds.x + entry.bounds.w));
      const minY = Math.min(...withBounds.map((entry) => entry.bounds.y));
      const maxY = Math.max(...withBounds.map((entry) => entry.bounds.y + entry.bounds.h));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const updates: any[] = [];
      for (const { shape, bounds } of withBounds) {
        if (axis === 'x') {
          if (mode === 'left') updates.push({ id: shape.id, type: shape.type, x: minX });
          else if (mode === 'right') updates.push({ id: shape.id, type: shape.type, x: maxX - bounds.w });
          else updates.push({ id: shape.id, type: shape.type, x: centerX - bounds.w / 2 });
        } else {
          if (mode === 'top') updates.push({ id: shape.id, type: shape.type, y: minY });
          else if (mode === 'bottom') updates.push({ id: shape.id, type: shape.type, y: maxY - bounds.h });
          else updates.push({ id: shape.id, type: shape.type, y: centerY - bounds.h / 2 });
        }
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      logger.warn('align_selected error', error);
    }
  };

  const handleDistributeSelected: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const axis: 'x' | 'y' = detail.axis || 'x';
      const targets = getSelectedCustomShapes(editor);
      if (targets.length < 3) return;

      const items = targets
        .map((shape) => ({ shape, bounds: editor.getShapePageBounds(shape.id as any) }))
        .filter((entry): entry is { shape: any; bounds: any } => Boolean(entry.bounds));

      if (items.length < 3) return;

      items.sort((a, b) => (axis === 'x' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
      const first = items[0];
      const last = items[items.length - 1];
      const span = axis === 'x' ? last.bounds.x - first.bounds.x : last.bounds.y - first.bounds.y;
      const step = span / (items.length - 1);

      const updates: any[] = [];
      for (let i = 1; i < items.length - 1; i++) {
        const targetPos = axis === 'x' ? first.bounds.x + step * i : first.bounds.y + step * i;
        if (axis === 'x') updates.push({ id: items[i].shape.id, type: items[i].shape.type, x: targetPos });
        else updates.push({ id: items[i].shape.id, type: items[i].shape.type, y: targetPos });
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      logger.warn('distribute_selected error', error);
    }
  };

  return {
    'tldraw:arrangeGrid': handleArrangeGrid,
    'tldraw:arrangeSidebar': handleArrangeSidebar,
    'tldraw:arrangeSpeaker': handleArrangeSpeaker,
    'tldraw:applyViewPreset': handleApplyViewPreset,
    'present:active-speaker-changed': handleActiveSpeakerChanged,
    'tldraw:alignSelected': handleAlignSelected,
    'tldraw:distributeSelected': handleDistributeSelected,
  };
}
