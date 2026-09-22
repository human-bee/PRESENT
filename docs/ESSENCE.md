# Make room

The stable idea across PRESENT's history is a shared place where conversation becomes something people can use while they are still together. A meeting and a game need different things, but they can inhabit the same room.

This build makes five choices:

1. **Enter the space immediately.** A room opens before account setup, model menus, or media permissions. Controls sit at its edge. The canvas has no surrounding dashboard.
2. **Keep human correction immediate.** People can type, move, resize, use, and dismiss what an agent makes. Agent edits preserve concurrent position, dimensions, titles, and state. A changed source invalidates an agent's stale replacement.
3. **Make interfaces disposable.** A widget is a small isolated program with shared state. A new use case can be authored in place without a new route, component registry, specialist agent, queue, or deployment.
4. **Use the right pace.** Direct room operations handle notes and timers. Spark authors small interactive tools. Astra can take longer on a more involved idea. Model completion time is displayed honestly.
5. **Give the room to many hands.** The page's tools expose actual state and changes. Voice, browser agents, and humans share the same object IDs, operations, and results. One active room listener prevents duplicate reactions to the same conversation.

The visual direction is warm paper, quiet ink, a little green, generous empty space, and controls that become precise on selection. Faces stay near the room's edge while the objects can spread out. No invented people or fake activity are seeded into an empty room.

## Possibilities the core already supports

During a standup, an explicit request can create a shared decision note or timer. During an interview, the agent can listen silently and capture requested points. In a tabletop session, a generated encounter tracker, dice tool, or shared vote can become part of the table. A teleprompter can appear for a podcast; a synth or a small generated sequencer can appear during a jam. These are uses of the same shared surface, not separate product modes.

The native milestone now supplies real drawing, native file/media import, agent-created native compositions and isolated Codex workspace work. The next hard problems should earn their place through actual use: authenticated remote rooms, broadly verified visual understanding, shared assistant audio and external integrations. Private objects, recording and durable external actions need explicit user-facing boundaries. They should not quietly arrive inside generated HTML.

## Current interaction contract

One authoritative tldraw document owns the room. Direct native editing and `apply_canvas` transactions operate on that document; the object adapter additionally supports `put`, `patch`, `increment`, `remove`, and `rename`. A widget owns `data.html` and `data.state`. `patch` merges supplied object/data fields; for widget state it merges supplied top-level keys. `increment` is atomic on a numeric widget-state key. Concurrent changes to the same ordinary field use server order. This is not a collaborative text CRDT.

The widget bridge exposes:

```js
present.getState();
present.setState({ question: 'Where next?' });
present.increment('count', 1);
present.participantId;
window.addEventListener('present:state', event => render(event.detail));
```

Votes belong under participant-specific keys. Counters use atomic increments. Timers store an absolute deadline. These keep the actual interaction shared without streaming animation ticks or replacing everybody else's state.
