# PRESENT

A room for people, their agents, and whatever they make together.

This native application now includes RoomOS activities on `codex/room-os-mini`, continuing the `codex/present-essence` milestone. The previous PRESENT checkouts are preserved. The canvas uses real tldraw: human drawing, shared instruments, generated applets and agent changes live in the same native document.

## Run

Requires Node 22.12+ and an installed, signed-in Codex CLI for subscription-backed model work.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:4317**. The root creates a room; its link returns to that room. Entry starts no microphone, camera or model session. `PRESENT_PORT` selects another port. `PRESENT_ENV_FILE=/absolute/path/to/.env.local npm run dev` reuses an environment file without copying credentials. `npm run build && npm start` serves a local production bundle.

## Make room

- **Start an activity.** Choose **Activities** for Debate, Standup, Live room, Planning or Retrospective. Setup creates a native stage immediately, without a model turn. Open the focused room view or move and resize the same stage on the canvas.
- **Follow the conversation.** Each participant can use a personal voice listener; shared microphones stay explicitly unattributed. Bounded context distinguishes preferences, claims, questions and corrections. Subject comparisons automatically bring sourced images onto the main floor. Numerical questions retrieve original source pages and produce a chart only when the exact numbers, units and comparison scope are supported. Quotes and source links stay attached.
- **Unblock a standup.** Newcomer introductions combine person-supplied strengths, read-only Linear team/project context and links to owned agent work. Prepare exact dependent work and let its owner authorize automatic start. Normal spoken completion is interpreted against the current blockers, independently checked, and gated by signed capture provenance and authorization. Ambiguous or retracted statements stay reviewable; no magic phrase or focus selection is required.
- **Bring in an audience.** A Live room has a separate audience link, incoming comments, host moderation, votes, and an on-air/next-up queue. YouTube chat is a read-only connector requiring `YOUTUBE_API_KEY` and an active chat ID. Local moderation does not moderate the external YouTube channel.

- **Draw directly.** The left rail contains selection, pan, pen, eraser, text, sticky notes, rectangles, ellipses, arrows, frames and undo/redo. Native handles move, resize and rotate objects. Selection reveals styles and grouping. Use the bottom-right Fit everything control to frame the room; **F** selects the frame tool.
- **Ask in the composer.** Spark is the default. Requests can draw native shapes, create or change a shared applet, research with source links, generate an image, or start a work card. Selection and viewport provide context. Choose Astra in settings for deeper work. Requested models do not silently fall back.
- **Add an instrument.** The plus opens notes, timers, dice, polls, documents, briefs, task boards, debate tools, cards, audience questions, captions and media. Generated HTML applets can implement additional shared interactions.
- **Meet.** Turn on mic, camera or screen sharing explicitly. LiveKit carries the human call; tiles can be placed on the canvas. Canvas reconnects preserve a healthy media connection.
- **Invite the voice agent.** The sparkle opens the listener. Listen quietly produces text and canvas changes; Talk with me plays responses to that listener. Each participant can use a personal microphone session with attributable speech. A shared microphone mixes call audio and keeps speakers unknown; it cannot overlap personal listeners. Shared captions retain bounded recent room audio text.
- **Let the room follow the activity.** Contextual debate, sourced comparisons, standup dependencies, newcomer context and audience queues share the same native document. Start an activity using its contextual controls. Spoken work starts only for the exact task and dependency already authorized by its owner.
- **Keep working.** Codex work cards retain the human owner, progress, command receipts, changed files and shared result artifacts. Follow-up work continues in the card's saved workspace and thread. Execution is confined to a dedicated local workspace with networking disabled; this is not a grant of access to arbitrary host repositories.
- **Bring context.** Upload images/video, embed a YouTube URL, or import a `.tldr` canvas through settings. Save this room exports a native `.tldr` file. A configured MCP app can expose tools and an interactive view; profiles and permissions are server-owned.
- **Use your browser agent.** Compatible browsers discover native WebMCP tools for the same room. Human editing, typed requests and voice share the authoritative document.

## Architecture

One Node process owns one `TLSocketRoom` per loaded room. The browser uses tldraw sync; REST tools mutate that same store. `RoomState` is a projection, not another writable canvas database. Media has an independent lifecycle. Fast tools apply directly; durable work jobs retain their causal identity and executor receipts.

Native snapshots live in `.data/tldraw/`, media assets in `.data/assets/`, and private work execution state in `.data/work-jobs/`. The original prototype's `.data/rooms/` files are read-only migration inputs. Native snapshots are saved by atomic file replacement after a 150 ms debounce and flushed during normal shutdown. An abrupt process or disk failure can lose that unsaved window. Voice captions are persisted, bounded to 500 entries and 256 KB; old captions are explicitly marked as trimmed.

Generated applets run in opaque iframes with no network or device access. A small bridge provides shared JSON state, participant identity and atomic increments. MCP apps use the Apps SDK in a separate-origin sandbox with explicit server-side profile and session checks. Widget generation receives bounded context without host tools; actual Codex work uses its separate restricted workspace executor.

## Check

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Browser tests use installed Chrome and synthetic media. Live provider/voice proofs are separately bounded because they make real model calls. See [current verification](docs/VERIFICATION.md), [capability status](docs/parity/capability-status.md), [historical intent](docs/HISTORY.md), and [legacy parity research](docs/parity/legacy-capabilities.md).

See [Contextual RoomOS verification and recordings](docs/ROOM-OS-CONTEXT-VERIFICATION.md) for the new activity contracts, live results, connector boundaries, and repeatable acceptance commands.

## Local boundary

This is a local app. It binds loopback and checks Host/Origin; an invite works in another browser on this computer. Public sharing needs authenticated room membership and a deployment that preserves single ownership of each room. Shared room data is visible to participants; hiding a card does not make its content private.

Voice uses `gpt-live-1` WebRTC with a delegated backend. Connection, tool execution and image delivery have saved live proof; the complete combined human conversation remains an acceptance target. Cerebras is optional and reports billing errors explicitly. Physical-device meetings, remote deployment, several older external integrations and universal latency improvement remain unproved. Read the capability report for the precise implemented and missing scope.

The Mini preview is owned by launchd through `node scripts/preview.mjs start|stop|restart|status`. Test runtimes use a separate `PRESENT_DATA_DIRECTORY`; ordinary browser tests default to port 4320, separate from the preview on 4318. See the contextual verification document for exact preview and SSH-forward instructions.
