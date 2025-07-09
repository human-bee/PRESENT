# ui_update Tool – Quick Reference (2025)

The **ui_update** tool is how AI (and other agents) change the props of any live component on the canvas.

```ts
ui_update(componentId: string, patch: Record<string, unknown> | string)
```

* Call `list_components` first to get valid `componentId` values.
* If `patch` is a **string** natural-language command, Tambo auto-extracts the parameters via GPT.
* If `patch` is an **object**, it must not be empty (`{}` will be rejected).

## Examples

| Goal | Call |
|------|------|
| Change a 5-minute timer to 7 minutes | `ui_update("msg_timer_123", { initialMinutes: 7 })` |
| Natural-language | `ui_update("msg_timer_123", "make it 7 minutes")` |
| Update document content | `ui_update("doc-editor-my-doc", { content: "# New Heading\n..." })` |

## Circuit Breaker Rules

* Identical updates within **1 s** are ignored.
* Same component cooldown: **5 s** before the next patch.

## Auto Component Selection

If `componentId` is `""` or invalid:
1. If only **one** component exists it’s chosen automatically.
2. If patch mentions timer-like props (`initialMinutes` etc.) UI tries to pick a timer component.
3. Otherwise returns helpful error.

## Error Messages (common)

| Error | Meaning |
|-------|---------|
| `INVALID_COMPONENT_ID` | Provided ID not in registry |
| `EMPTY_PATCH` | Patch object had no keys |
| `NO_COMPONENTS_AVAILABLE` | No components registered yet |
| `COOLDOWN_ACTIVE` | Same component updated too recently |

---

*See `src/lib/tambo.ts` for full implementation.* 