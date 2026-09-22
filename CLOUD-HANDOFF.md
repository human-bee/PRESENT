# PRESENT parallel source baseline

This source-only snapshot comes from native PRESENT commit 9c16247b. It contains application code and tests, with no user room data, credentials, recordings or original Git history. Root main in the upstream repository is a different older runtime. Work only from this branch.

Install with npm ci. Use a focused test and npm run typecheck. Do not run opt-in live/provider tests. Node 22.12+ is required. There are concurrent workers: honor the file ownership in your task prompt and do not revert others.

A coordinator is integrating the newer RoomOS activity branch separately. Do not edit server/index.ts, server/room-store.ts, src/app.tsx or src/voice/use-voice.ts unless your lane specifically owns the file. Export typed integration interfaces and document the small wiring needed. Commit your own files to a new work branch based on this snapshot. Return the exact commit SHA or a downloadable patch. Do not merge or deploy.
