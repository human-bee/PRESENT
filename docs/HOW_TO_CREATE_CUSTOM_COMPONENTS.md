# ✨ Creating custom Components (2025-Q3 Update)

> **One shot, feature-complete, canvas-aware.**  
> This document supersedes older snippets that referred to the LiveKit bus patterns.

---

## 1. Quick-start Checklist

1. **Schema first** – describe props with `zod`
2. **State** – use `useComponentState`
3. **AI updates** – handle a `patch` in a stable callback
4. **Register** – call `useComponentRegistration`
5. **Canvas** – fire the `custom:showComponent` event once on mount

That’s it. 5 steps, <200 lines, instantly update-able by the `ui_update` tool.

---

## 2. Minimal Template

```tsx
import { z } from "zod";
import { useComponentRegistration } from "@/lib/component-registry";
import { useEffect, useCallback } from "react";

export const myWidgetSchema = z.object({
  title: z.string().describe("Widget title"),
  value: z.number().default(0).describe("Initial numeric value"),
});

type MyWidgetProps = z.infer<typeof myWidgetSchema> & {
  __custom_message_id?: string; // injected by custom
};

type MyWidgetState = {
  value: number;
};

export default function MyWidget({
  title,
  value: initialValue,
  __custom_message_id,
}: MyWidgetProps) {
  // 1. Persistent state
  const [state, setState] = usecustomComponentState<MyWidgetState>(
    `my-widget-${title.replace(/\s+/g, "-")}`,
    { value: initialValue }
  );

  // 2. Handle AI patches
  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      if (typeof patch.value === "number") {
        setState({ ...state!, value: patch.value });
      }
    },
    [state, setState]
  );

  // 3. Register so `ui_update` can find us
  useComponentRegistration(
    __custom_message_id || `my-widget-${title}`,
    "MyWidget",
    { title, value: state?.value },
    "default",
    handleAIUpdate
  );

  // 4. Show on canvas the first time we mount (NOT on every re-render!)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("custom:showComponent", {
        detail: {
          messageId: __custom_message_id || `my-widget-${title}`,
          component: <MyWidget title={title} value={state?.value ?? 0} />,
        },
      })
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- UI ---------------- */
  return (
    <div className="rounded-xl p-4 bg-slate-800 text-white w-64">
      <h3 className="text-lg mb-2">{title}</h3>
      <p className="text-4xl font-mono">{state?.value}</p>
    </div>
  );
}
```

---

## 3. Updating via AI

1. `list_components` → grab `messageId`
2. `ui_update("msg…", { "value": 42 })` → component re-renders instantly

---

## 4. Patterns

| Concern               | Pattern                                                                   |
|-----------------------|---------------------------------------------------------------------------|
| Voice commands        | Listen on data channel → call `ui_update`                                 |
| Real-time API streams | `useEffect` + `setState`                                                   |
| Diff visualisation    | Store diffs in `diffHistory` (now automatic) → `<PropertyDiffViewer>`      |
| Collaboration         | Emit/consume `ui_update` via LiveKit bridge (handled by registry internals)|

---

## 5. Deprecations

The following patterns are **obsolete** and should not be used any more:

* Manual `bus.send('ui_update', …)` calls – use `ui_update` tool instead
* Legacy `CanvasSyncAdapter` for simple prop updates – registry handles this now

---

Happy building! 🚀


  - A common pitfall when updating custom components is letting the last component to register overwrite the
    shared update callback in the registry. The symptom is that only one surface (usually the transcript preview)
    reacts to patches while the canvas component stays stale. The fix is to fan out patches to every registered
    instance—track each registration with a token, aggregate their callbacks, and release them on unmount—so every
    clone receives the same update payload synchronously.