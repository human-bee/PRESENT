import { createShapePropsMigrationSequence, createTLSchema, defaultBindingSchemas, defaultShapeSchemas, type TLBaseShape } from '@tldraw/tlschema';
import type { JsonObject } from '@tldraw/utils';
import { T } from '@tldraw/validate';

export type PresentWidgetProps = {
  w: number; h: number; kind: 'timer' | 'widget'; title: string; data: JsonObject;
  pinned: boolean; createdBy: string; createdAt: number; expiresAt: number | null;
};
declare module '@tldraw/tlschema' { interface TLGlobalShapePropsMap { 'present-widget': PresentWidgetProps } }
export type PresentWidgetShape = TLBaseShape<'present-widget', PresentWidgetProps>;

const finite = T.number.check(value => { if (!Number.isFinite(value)) throw new Error('Expected a finite number.'); });
const dimension = finite.check(value => { if (value < 1 || value > 4000) throw new Error('Widget dimensions must be between 1 and 4000.'); });
export const presentWidgetShapeProps = {
  w: dimension, h: dimension, kind: T.literalEnum('timer', 'widget'),
  title: T.string.check(value => { if (value.length > 200) throw new Error('Widget title is too long.'); }),
  data: T.jsonDict().check(value => {
    const check = (item: unknown, depth = 0) => {
      if (depth > 12) throw new Error('Widget data is too deep.');
      if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe widget data key.');
        check(child, depth + 1);
      }
    };
    check(value);
    if (new TextEncoder().encode(JSON.stringify(value)).length > 32_768) throw new Error('Widget data is too large.');
  }),
  pinned: T.boolean, createdBy: T.string, createdAt: finite, expiresAt: finite.nullable(),
};
export const presentWidgetMigrations = createShapePropsMigrationSequence({ sequence: [] });
export const presentSchema = createTLSchema({
  shapes: { ...defaultShapeSchemas, 'present-widget': { props: presentWidgetShapeProps, migrations: presentWidgetMigrations } },
  bindings: defaultBindingSchemas,
});
