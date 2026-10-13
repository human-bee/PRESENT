# PRESENT native release guidance

This checkout is the supported native room candidate. Read README.md and
docs/releases/p0-2026-10-12.md for source identity and acceptance boundaries.
The preserved legacy/reset checkout is a separate source; do not replace this
entrypoint with archived startup instructions.

Use Node 24 LTS and `npm ci`. Verify the runtime's reported version instead of
assuming a binary directory name establishes it. Preserve existing operator env
files. Use a separate `PRESENT_ENV_FILE` and disposable `PRESENT_DATA_DIRECTORY`
for tests. Never commit credentials, private archives or raw conversation data.

The native browser is in src/, shared contracts in shared/, and the single Node
server in server/. Native tldraw records are authoritative; RoomState is a
projection. Preserve semantic request intent, human edits, request identity,
actor/room/project authority, and exact saved work model/thread/workspace.
Unknown or unavailable execution models require explicit recovery.

Run affected contracts plus typecheck/build for runtime changes. Release changes
also run ordinary, signed access and production browser profiles, the dedicated
release story, and process recovery. Provider tests require explicit opt-in and
their durable call budgets. Real model output, synthetic microphone input,
received audio, physical-device acceptance and hosted deployment are distinct
states; retain precise evidence.

Use current account-visible models: Sol 6.1 for ordinary work, Luna 6 for bounded
tasks and Astra 6 for demanding work. Typed Decisions handles bounded semantic
judgments; Codex executes actual code. Do not silently substitute a saved model
or use retired Spark as a new-work pathway.

Coordinate concurrent writers by owned files. The integration owner serializes
Git commits, pushes and stacked PRs. A local branch or passing test does not
establish deployed state. Deployment/account changes follow current user
authorization; communications to other people require explicit instructions.
