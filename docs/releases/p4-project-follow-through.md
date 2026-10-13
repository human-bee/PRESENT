# Existing-project follow-through

Selected-project work starts from a committed byte-identified snapshot in an isolated workspace. A completed card now offers **Review project changes**, displays the exact derived diff, and requires **I reviewed this exact diff** before **Apply reviewed changes**. The server accepts only the job, snapshot and change identities; it derives files and paths from the saved completed job, never from browser-supplied patch text.

Both `/api/projects/review` and `/api/projects/apply` require current signed tools authority and the initiating participant. A canonical completed card and its artifact must still link to that private job. The registered source selection, original commit, current index, completed workspace files and private baseline are checked again before apply. Human source edits, staged changes, a changed selection, revoked authority or altered card/artifact linkage fail closed. The same card can continue in its original workspace and apply a cumulative follow-up when the original source still matches the prior approved result.

Apply supports bounded additions and edits to regular UTF-8 text files. Truncated diffs, binary content, deletions, executable mode changes, symbolic links, hard links and reversals of earlier applied paths require separate manual review. Source files retain their original permissions. The source index and commit are left for the user's explicit Git workflow.

Apply writes a private `applying` receipt before any source write, checks each file immediately before replacing it, then records `applied` after a final authorization check. Writes are individually durable, not a whole-repository atomic transaction. An interruption, authority loss or crash can retain a partial application. Such receipts and crash locks block automatic retry and require explicit operator reconciliation; no rollback, data reset, refund or automatic overwrite is performed. An unrelated human edit after a successful apply also blocks replay.

New workspaces keep a trusted baseline identity outside the worker's writable cwd. Inspection rejects a changed Git config or baseline, links in Git metadata and external object stores before invoking Git. Hooks, fsmonitor, global/system Git config, external diff and text conversion are disabled where applicable. Historical workspaces without this baseline remain saved and fail closed; a new authorized card is required. No stored work or original source is deleted.

The private project registry supports an explicit `include` array of committed source paths. Selection identity includes that array. Snapshot limits now reject selections exceeding 100 files or 8 MiB instead of silently taking an initial slice. Explicit missing, unsafe or oversized paths reject the selection. Private names, dependency directories and linked content remain excluded.

## Verification and genuine story

Provider-free verification covers original-source preservation, exact approval identities, replay, cumulative follow-up, human edits and index divergence, late file changes, current signed routes and revocation, private Git configuration, unknown historical baselines, truncated/binary changes, explicit bounded selection and a durable turn fence. The matched Chromium UI test checks the exact diff, disabled Apply until explicit review and the successful apply readback. These fixtures are not genuine model-execution evidence.

The root owner runs `tests/live/project-follow-through.mjs` against a separate clean committed full repository under `.release`. Its selected slice is the existing `game-state.ts` and `common.ts` source. The demonstrated task aligns `shuffleOrder` IDs with the shared record ID contract, adds real Node tests, then continues with deterministic shuffle and 52-card coverage. The harness uses the actual signed room, Sol 6.1/high, observed command receipts, explicit review/apply UI, independent tests in the original isolated source, exact same-thread/workspace hashes, browser reload and disk readback.

```sh
PATH=/Users/bsteinher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/present-playwright-164 \
PRESENT_LIVE_PROJECT_STORY=1 \
PRESENT_PROJECT_STORY_SOURCE=/absolute/path/inside/.release/to/clean-source \
PRESENT_PROJECT_STORY_PROOF_DIRECTORY=/private/tmp/new-private-proof \
node --import tsx tests/live/project-follow-through.mjs
```

At each turn the harness saves the exact diff to `turn-N-review.json` and waits up to60seconds before any Apply click. The root inspects that concrete diff and writes `turn-N-approval.json` containing its exact `changeId` and `diffHash`. Missing or mismatched approval stops before source writes.

Keep `PRESENT_E2E_BROWSER_CHANNEL` unset. The harness creates a private invite profile and starts its own loopback server. It sets all four explicit fence inputs: `PRESENT_PROJECT_STORY_BUDGET_FILE`, `PRESENT_PROJECT_STORY_ROOM`, `PRESENT_PROJECT_STORY_CARD`, and `PRESENT_PROJECT_STORY_MAX_TURNS=2`. Immediately before each actual `turn/start`, a synchronous durable reservation binds the room/card/source snapshot and exact confirmed model hash. Reservations survive process restart; exhaustion or mismatch rejects before provider dispatch. Failed reservations are not refunded. The fence is inactive without explicit operator configuration and exposes no reset route.

Never rerun a paid harness against the same proof directory. `node --import tsx tests/live/project-follow-through.mjs --readback` with the same source/proof variables performs zero-turn readback of retained summary, fence, actual source hashes and disk artifacts. Summaries retain causal phase times, exact model, hashed commands/thread/workspace and source hashes, not account secrets or raw prompts/provider outputs. Genuine execution and applied-test claims are valid only after this separately authorized run succeeds; these changes alone do not establish usage or retention.
