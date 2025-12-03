import { useMemo } from 'react';
import { useComponentRegistration } from '@/lib/component-registry';
import type { PromotableItem, PromotableRegistry } from '@/lib/promotion-types';

type UsePromotableOptions = {
  messageId: string;
  componentType: string;
  contextKey?: string;
  props?: Record<string, unknown>;
  updateCallback?: (patch: Record<string, unknown>) => void;
};

/**
 * Registers promotable content for a component and keeps it synced in the ComponentRegistry.
 */
export function usePromotable(
  items: PromotableItem[] | null | undefined,
  options: UsePromotableOptions,
) {
  const {
    messageId,
    componentType,
    contextKey = 'canvas',
    props = {},
    updateCallback,
  } = options;

  const sanitizedItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is PromotableItem => Boolean(item && item.id && item.type))
      .map((item) => ({
        ...item,
        data: item.data ?? {},
        label: item.label || item.id,
      }));
  }, [items]);

  const promotable: PromotableRegistry = useMemo(
    () => ({ items: sanitizedItems }),
    [sanitizedItems],
  );

  const mergedProps = useMemo(
    () => ({
      ...props,
      promotable,
    }),
    [props, promotable],
  );

  useComponentRegistration(messageId, componentType, mergedProps, contextKey, updateCallback);
}
