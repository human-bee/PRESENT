# Native release story

Run against a fixed source revision with Node 24. These commands produce separate
receipts; a provider-free browser pass does not establish human speech or real
coding acceptance.

## Provider-free browser and bounded benchmark

```sh
PATH=/Users/bsteinher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/present-playwright-164 PRESENT_E2E_BROWSER_CHANNEL= \
  npx playwright test --config tests/release-playwright.config.ts
```

This config owns loopback port 4440, creates temporary storage, clears provider
credentials, ignores operator dotenv files, and refuses an existing server. Two
fresh contexts type a note, make a peer correction, drag and release it, run and
pause a shared timer, compare the independent native disk snapshot, and reload
both contexts. `release-story.json` and screenshots are retained under the
printed temporary results directory. The receipt includes the data directory,
source identity, Node/browser versions and disk snapshot hash.

Use the Chromium revision installed by this checkout's Playwright version, with
the browser channel unset. Chrome 155 supplied incorrect locator coordinates
inside scaled opaque iframes with Playwright 1.64; the unchanged mobile, poll,
and room stories passed on its matched Chromium 156.0.8078.4 (revision 1248).
This runtime requirement preserves the product's existing canvas zoom behavior.

The benchmark has 20 real keyboard samples each for initiator and peer DOM
observation. One host monotonic `performance.now` clock measures from immediately
before the Playwright keyboard command through observed text. Results include
browser automation and assertion polling overhead. They describe two contexts
on one loopback host, not network transport alone, acoustic response, physical
screen pixels, physical devices or provider time. Raw samples and p50/p95/max
are retained regardless of whether they meet a desired threshold.

## Actual coding with same-card continuation

Start a separate configured server on coordinator-owned port 4442. The harness
must receive the exact absolute `PRESENT_DATA_DIRECTORY` used by that server.
Do not use a user preview or alter its stored provider preference.

```sh
PATH=/Users/bsteinher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
PRESENT_E2E_URL=http://127.0.0.1:4442 \
PRESENT_DATA_DIRECTORY=/absolute/disposable/server-data \
PRESENT_WORK_PROOF_DIRECTORY=/absolute/new/proof-directory \
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/present-playwright-164 \
PRESENT_E2E_BROWSER_CHANNEL= PRESENT_WORK_PROVIDER=sol \
PRESENT_WORK_MODEL=gpt-6.1-sol PRESENT_LIVE_WORK=1 \
  node tests/live/native-work.mjs
```

The initial request and correction use real Work request/Start work and Work
follow-up/Continue work browser controls. The harness observes the effective UI
provider and requires it to match the requested provider. The server discovers
the authenticated subscription and model availability. Exact saved model,
workspace, thread and card identity must survive continuation. The harness
reads actual file hashes, correlates successful `node --test math.test.mjs`
command receipts with the private rollout without copying it, verifies rendered
artifacts in both peers, compares canonical room records with disk, and reloads
both peers.

Actions and response collection are bounded. `progress.json` records the start
click and response stages; an accepted response saved while the click settles
does not count as a successful browser click. Both must succeed.

`PRESENT_LIVE_WORK=1` opts into a maximum of two real subscription turns. Without
it the harness fails before network or browser work. The proof directory's
`budget.json` is durable and blocks duplicate paid runs. Never delete a budget to
force a rerun. Keep provider, exact model, server URL and data location unchanged.

Use the same environment and `--preflight` for account/model discovery without a
model turn. Use `--continue-followup` only when the budget is exactly one and the
initial saved job exists, or `--readback` when the budget is exactly two. Readback
starts no model turns. An uncertain dispatched request remains reserved even
when the harness fails; inspect its exact existing job before deciding how to
recover. A historical initial receipt retains its original file hashes after
the follow-up changes those files.

When an interrupted initial harness left a budget of exactly one, a completed
durable job, and no summary, use the same environment with `--recover-initial`.
It starts no browser and no model turns. It requires exactly one job in the
budget room, matches provider/model affinity, inspects real workspace files and
test output in the exact private turn, and saves the original actor and job.
The recovery receipt explicitly says the original full browser action receipt
is unavailable. It is preparation for `--continue-followup`, not a complete
initial UI acceptance receipt. Recovery refuses an existing summary and never
changes the budget.

## Voice acceptance boundary

The existing `tests/e2e/voice-live.spec.ts` captures received TTS and provider
receipts; its macOS say/file microphone is synthetic. A real paid provider plus
synthetic input does not establish actual human microphone ingress. Human voice,
received-audio listening review and peer/disk proof remain the coordinator's
explicitly gated acceptance. Do not rename synthetic ingress as physical input.
