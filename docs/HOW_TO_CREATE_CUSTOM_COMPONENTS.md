# ✨ Creating Custom Components (2025-Q4 Refresh)

> Building a steward as well? Pair this doc with the [Component & Steward Integration Guide](./component-steward-guide.md) for server-side patterns.

---

## 1. Quick-start Checklist

1. **Schema first** – describe props with `zod` for both agents and TypeScript.
2. **Runtime state** – read the injected TLDraw `state` and mirror changes with `updateState`.
3. **Handle patches** – normalize incoming `patch` objects (`duration`, booleans, etc.).
4. **Register** – call `useComponentRegistration` with your `messageId`, type, props, and handler.
5. **Canvas spawn** – emit `custom:showComponent` once to place your widget on the board.

Five steps, <200 lines, and your component is instantly addressable via `create_component` / `update_component`.

---

## 2. Minimal Template

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useComponentRegistration } from '@/lib/component-registry';

export const myWidgetSchema = z.object({
  title: z.string().describe('Widget title'),
  initialValue: z.number().default(0).describe('Initial numeric value'),
});

type RuntimeState = {
  value?: number;
  updatedAt?: number;
};

type MyWidgetProps = z.infer<typeof myWidgetSchema> & {
  __custom_message_id?: string;
  state?: RuntimeState;
  updateState?: (patch: RuntimeState | ((prev: RuntimeState | undefined) => RuntimeState)) => void;
};

export default function MyWidget({
  title,
  initialValue,
  __custom_message_id,
  state,
  updateState,
}: MyWidgetProps) {
  const messageId = useMemo(
    () => __custom_message_id || `my-widget-${title.toLowerCase().replace(/\s+/g, '-')}`,
    [__custom_message_id, title],
  );

  const deriveValue = (candidate?: number) =>
    Number.isFinite(candidate) ? Number(candidate) : initialValue;

  const [value, setValue] = useState(() => deriveValue(state?.value));

  // Sync local state if TLDraw state changes (multi-client updates).
  useEffect(() => {
    setValue((prev) => deriveValue(state?.value ?? prev));
  }, [state?.value]);

  const commitValue = useCallback(
    (next: number) => {
      setValue(next);
      updateState?.((prev = {}) => ({ ...prev, value: next, updatedAt: Date.now() }));
    },
    [updateState],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      if (typeof patch.value === 'number') {
        commitValue(patch.value);
      }
      if (typeof patch.title === 'string') {
        // optional: update title via state or props
      }
    },
    [commitValue],
  );

  useComponentRegistration(
    messageId,
    'MyWidget',
    { title, value },
    'default',
    handleAIUpdate,
  );

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          messageId,
          component: {
            type: 'MyWidget',
            props: { title, initialValue },
          },
        },
      }),
    );
  }, [messageId, title, initialValue]);

  return (
    <div className="rounded-xl p-4 bg-slate-800 text-white w-64">
      <h3 className="text-lg mb-2">{title}</h3>
      <p className="text-4xl font-mono">{value}</p>
      <button
        className="mt-4 px-3 py-2 rounded bg-white/10 hover:bg-white/20"
        onClick={() => commitValue(value + 1)}
      >
        Increment locally
      </button>
    </div>
  );
}
```

---

## 3. Updating via AI

1. `list_components` → grab `messageId`, intent, slot metadata.
2. `update_component({ componentId, patch })` → include `_ops` when possible so reducers can apply the semantic change before merging any residual props. The dispatcher still normalizes convenience fields (`"7m"`, `"started"`).
3. Component’s `handleAIUpdate` fires with the reduced props; call `updateState` if you need to mirror local mutations across clients.

> Tip: use `reserve_component` when the agent wants to guarantee an ID before render – see the integration guide for details.

---

## 4. Patterns

| Concern               | Pattern                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| Voice commands        | Voice agent → `reserve_component` → `create/update_component`            |
| Real-time API streams | `updateState` inside event handlers to keep TLDraw state authoritative  |
| Diff visualisation    | `diffHistory` remains automatic → `<PropertyDiffViewer>`                 |
| Performance           | Enable dispatcher metrics (`NEXT_PUBLIC_TOOL_DISPATCHER_METRICS=true`)   |

---

## 5. Deprecations

The following patterns are **obsolete** and should not be used any more:

* Manual `bus.send('ui_update', …)` calls – issue `update_component`
* Legacy `CanvasSyncAdapter` / `usecustomComponentState` stores – rely on injected TLDraw `state` + `updateState`

---

## 6. Further Reading

- [Component & Steward Integration Guide](./component-steward-guide.md) – shared contracts, perf budgets, testing checklist.
- `tests/timer-perf.e2e.spec.ts` – reference Playwright spec that measures send→paint latency with dispatcher metrics enabled.

---

Happy building! 🚀


  - A common pitfall when updating custom components is letting the last component to register overwrite the
    shared update callback in the registry. The symptom is that only one surface (usually the transcript preview)
    reacts to patches while the canvas component stays stale. The fix is to fan out patches to every registered
    instance—track each registration with a token, aggregate their callbacks, and release them on unmount—so every
    clone receives the same update payload synchronously.
