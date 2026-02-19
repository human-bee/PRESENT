# Fairy CLI

`fairy` is a control-plane CLI for the server-first fairy pipeline.

It does not create a second execution engine. All mutations still flow through:

1. `POST /api/steward/runCanvas`
2. `agent_tasks` queue
3. conductor/router
4. stewards
5. canvas action envelopes

## Run

```bash
npm run fairy:cli -- <group> <action> [options]
```

## Command groups

```bash
# Sessions
npm run fairy:cli -- sessions create --room canvas-123
npm run fairy:cli -- sessions use <session-id>
npm run fairy:cli -- sessions list
npm run fairy:cli -- sessions inspect
npm run fairy:cli -- sessions send --task fairy.intent --message "Draw a bunny"

# Tools
npm run fairy:cli -- tools list
npm run fairy:cli -- tools call fairy.intent --args '{"message":"Draw a bunny"}'
npm run fairy:cli -- tools call dispatch_to_conductor --args '{"task":"canvas.quick_text","params":{"text":"FOREST_READY."}}'

# Subagents
npm run fairy:cli -- subagents spawn --count 3 --message "Draw a forest scene"
npm run fairy:cli -- subagents list
npm run fairy:cli -- subagents wait <spawn-id>
npm run fairy:cli -- subagents cancel <spawn-id> --reason "operator stop"

# Trace
npm run fairy:cli -- trace open
npm run fairy:cli -- trace timeline --limit 300
npm run fairy:cli -- trace correlate --taskId <task-id>

# Smoke helpers
npm run fairy:cli -- smoke run full
npm run fairy:cli -- smoke showcase-loop
npm run fairy:cli -- smoke correlate
```

## Global options

```bash
--json
--baseUrl=http://127.0.0.1:3000
--token=<bearer-token>    # or FAIRY_CLI_BEARER_TOKEN
--session=<session-id>
```

## Exit codes

1. `0`: applied/succeeded
2. `10`: queued
3. `20`: failed
4. `30`: timeout
5. `40`: auth/config issues
