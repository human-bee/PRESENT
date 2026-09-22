# Room templates — milestone 5

Based exclusively on `2cd569fca3c4363ca2dfa37c9327faa59d5f5d8f` (`codex/present-cloud-base-20260921`). No shared coordinator files changed.

## Minimal integration

In `server/index.ts`, instantiate once and dispatch behind the existing local-request/origin gate (and the RoomOS authorization gate if present):

```ts
import { join } from 'node:path';
import { createTemplateRequestHandler } from './template-routes';
import { TemplateCatalog } from './templates/catalog';
import { installTemplateRecords } from './templates/install';
import { getCanvasRecords, getTldrawRoom } from './room-store';

const handleTemplates = createTemplateRequestHandler({
  catalog: new TemplateCatalog(join(process.cwd(), '.data', 'templates')),
  readRoom: getCanvasRecords,
  installRoom: (id, records) => installTemplateRecords(getTldrawRoom(id), records),
});
// Inside the gated async request handler, before static fallback:
if (await handleTemplates(req, res)) return;
```

The route generates a cryptographically random 128-bit destination room ID, never accepts a destination ID from a client, and waits for the native commit before returning it. `installTemplateRecords` verifies that the destination exactly matches the pristine native snapshot before replacing its default page in one transaction. It rejects used rooms. If RoomOS has an atomic create/reserve-room API, use that in `installRoom` to formally reserve the generated ID and reject even an existing pristine room. The baseline lacks that API; random collisions are cryptographically negligible. Canvas `mutateCanvas` is not a substitute because it rejects page creation.

In `src/app.tsx`, mount the picker in the appropriate existing overlay/panel:

```tsx
import { TemplatePicker } from './templates/template-picker';
<TemplatePicker roomId={roomId}
  onInstalled={id => { location.assign(`/r/${id}`); }} />
```

The component imports its own scoped CSS using existing paper/lime/ink tokens. The host owns positioning and open/close controls. Installation opens an actual native room, with editable notes and working paused timers; it is not a blob download. No provider or workflow engine is involved.

## Contracts

- `exportRoomTemplate(records, name)`: serializable version-1 template plus safe ordinal notices; source IDs never appear in notices.
- `parseRoomTemplate(unknown)`: validate the envelope and native schemas, then sanitize again. Never trust a file because it claims version 1.
- `instantiateRoomTemplate(template, { id?, now? })`: fresh page, shape and binding IDs; remaps parents and both binding endpoints. No cross-instance aliasing. Injectable IDs/time support deterministic local tests.
- `GET /api/templates`: built-in and saved summaries.
- `GET /api/templates/:id`: sanitized export contract.
- `POST /api/templates` with `{ roomId, name }`: save a sanitized server-side room snapshot; returns `{ id, template }`, including omission/reset reasons.
- `POST /api/templates/:id/instantiate` with `{}`: atomic installation, returns `{ roomId, notices }` only after success.

`TemplateRoutePorts` isolates coordinator-owned room access and installation. Route registration must inherit authorization; catalog storage is server-local, not a multi-tenant ACL system. Scope `TemplateCatalog` directories per authorized audience in a shared deployment. Do not publish a global catalog across tenants. Files use exclusive creation and private filesystem modes. Up to 100 user templates plus three built-ins are allowed. No request accepts a filesystem path.

## Privacy and supported arrangements

Built-ins: focus (one note + 25-minute timer), retrospective (six notes + 15-minute timer), brainstorm (nine notes + 5-minute timer).

| Native type | Retained | Reset / omitted |
| --- | --- | --- |
| Note | Placement, rotation, size, style/color | Rich text, URL, editor identity, all metadata |
| Timer | Placement, dimensions, duration clamped to 1 second–24 hours | Paused at full duration; generic title, empty creator, new timestamp; all other data omitted |
| Geo | Placement, dimensions, enumerated styles | Text, URL, metadata |
| Arrow | Placement, endpoint geometry, enumerated styles | Text and metadata; bindings remapped only when both endpoints survive |
| Page | Membership/order | Generic names and fresh IDs |
| Other widget, asset, image, ink, group, frame, text, nested shape | Nothing | Unsupported or missing-parent reason for canvas shapes; no executable HTML copied |

Poll/task-board instruments in this baseline are custom sandbox widgets, not typed native instruments. They are deliberately omitted; cloning their arbitrary state/HTML would undermine the privacy contract. New native types require a reviewed explicit whitelist. All document metadata, transcript, conversation, identity, permissions, execution history, votes, results, secrets and assets are excluded. Source labels/titles are never inferred to be safe. A deliberately entered template name is the only user text preserved; the UI explains this. Layout and timer settings themselves remain user-selected reusable information.

Reasons are `content-reset`, `unsupported`, `missing-parent`, `missing-endpoint`, `invalid`. Picker shows reset/omission counts before use and grouped reasons after saving. A room with no reusable shapes cannot be saved. No auto-run on installation.

## Bounds and verification

500 candidate records, 240 KB sanitized template, 10,000 source records and 4 KB HTTP request bodies. Template files are schema checked and re-sanitized when loaded. Oversized requests fail before JSON parsing. There is no remote import URL.

Run just this focused suite and typecheck:

```sh
node --import tsx --test tests/room-template.test.ts
npm run typecheck
```

The direct Node loader avoids the `tsx` CLI's IPC socket, which this cloud sandbox blocks. The HTTP handler test uses in-memory request/response streams and a real temporary native room store, so no listening ports or providers are required.

`server/templates/benchmark.ts` exports `runTemplateBenchmark()`. The focused suite runs its fixed 100-object workload (90 notes, 10 timers), three warmups and 20 measured instantiations with deterministic IDs/time. Enforced boundaries: template <120 KB, instance <150 KB, p95 <250 ms, total <5 seconds. Timing varies by host; fixture and generated content are deterministic. Observed cloud run: template 46,235 bytes; instance 46,112 bytes; p95 6.36 ms; total 93.34 ms. All five tests passed: privacy, binding/ID remap, hostile imports/bounds, save/reopen/native installation, benchmark.

No browser visual verification performed. UI typechecked; the coordinator must mount it to review in the integrated RoomOS interface. No live provider calls, deployment, merge, settings changes or external messages.
