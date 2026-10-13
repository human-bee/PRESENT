# P3: A repeatable planning and review starter

The supported job is a short planning/review session: write an outcome, record a decision, assign an action and owner, correct the action, and return to the same room to report progress. The useful result is an editable brief with that decision and owned action. This is available to a sole operator immediately; additional editors use the existing room/invite controls. Pilot-team recruitment is not a release prerequisite.

`Plan and review` in an empty room creates the existing Meeting brief, a native reminder note, and a paused five-minute timer. The Planning and review dock control explains the workflow and reopens the same marked brief rather than rebuilding the room. The brief is slightly taller so a decision and one owned action fit. Welcome buttons wrap in portrait to keep the starter away from the drawing toolbar. Existing normal iframe inputs edit the brief; no provider or media capture is started by onboarding.

The operator owns decisions. Invited editors can edit, viewers can read, and the existing access layer enforces those roles. The timer starts only with Start. Agents act only on explicit requests, using the current model picker and availability checks. This slice does not change invite authority, agent models, work execution or template mounting.

## Optional local observations

The planning guide has an unchecked-by-default **Keep local review observations** checkbox. Turning it on persists one small aggregate per opaque room ID in this browser's localStorage. Turning it off removes that aggregate. No observation endpoint, upload, participant identity, text, conversation, event timeline, audio, image, or absolute timestamp is added. The existing room still saves its actual native content as before.

| Aggregate | Exact observation rule | Limit |
| --- | --- | --- |
| Joins | Start an observation session while the room is connected. A reconnect within that mounted app does not increment it. | Not total room attendance; collection starts only after opt-in. |
| Returns/reloads | Start a new observation session with an existing aggregate. | Includes reload, not demonstrated retention or voluntary repeat use. |
| Briefs seen | First appearance of a marked planning brief in the browser projection; a return baseline does not count the same brief again. | UI observation, not a durable commit receipt. |
| Text corrections observed | An already nonempty summary, decision or action text changes to another nonempty value. | An observed text transition, not a semantic judgment, unique correction or actor attribution. Typing can create multiple transitions. |
| Actions marked Done | An already observed action status changes from another status to Done. | Participant-reported progress, not proof the work happened. |

Each count saturates at 999. The memory-only comparison baseline is bounded to 32 marked briefs, 128 relevant fields each and bounded text; it is rebuilt on return and never serialized. The aggregate stores only version, those five counts, and at most three first-observation delays. Delays use the browser's monotonic `performance.now`, relative to the observation session in which the event first appears, capped at one day. An already visible brief can produce zero milliseconds. These delays are not generation or network benchmarks.

Usefulness and trust require an operator assessment of concrete results; no rating is inferred from editing or Done. Actual paid execution/cost must come from provider/job/turn receipts, not HTTP counts. This provider-free starter has no paid execution. No synthetic retention, usefulness, completed-work, invoice, or latency target is claimed.

## Acceptance retained

Final isolated acceptance on 2026-10-13 06:43 UTC used bundled Node **24.19.0**, Playwright **1.64.0**, and its managed Chromium **156.0.8078.4**. Two browser tests passed in 12.5 seconds; one focused observation/privacy unit passed, as did typecheck, production build and the five-file scoped recommended lint. The build retains existing upstream `use client`, dynamic-import and large-chunk warnings.

The desktop story starts two fresh independent browser contexts/actors in a real empty room. Normal UI creates the starter, adds a decision and owned action, and the peer corrects the action and marks Done. Both render the corrected value. The canonical three objects match the actual tldraw JSON disk snapshot. Leaving and returning preserves the exact brief; the second context reloads it too. Reopening does not duplicate it. The optional aggregate records one correction and one reported Done; return changes joins from 1 to 2 and returns from 0 to 1 without duplicating prior transitions. Opt-in remains absent in the independent peer, and opt-out clears local storage.

The portrait test uses actual touch events in a fresh 390×844 mobile-emulated context. It opens the starter and guide, opts in, types a summary through the actual iframe, waits for the canonical shared value, reloads and retrieves it. It then opens the observation guide by touch. There are no forced taps, mouse substitutions or injected room state. Reload proof is for confirmed canonical state, not a promise that unacknowledged pending input survives immediate tab closure. These are emulated browser contexts, not physical-device tests.

The desktop receipt's one host-monotonic sample measured 2690.46 ms from navigation/start through starter visibility and 72.28 ms from peer correction command through initiator DOM readback. These include automation and polling overhead on loopback. A single sample is diagnostic evidence, not a percentile or performance claim. Both stories observed zero provider-triggering requests.

The integrated unit suite passed **317/322**, with zero failures and five explicit opt-in skips. Public evidence is retained in `docs/evidence/p3-20261012/acceptance.json`, `planning-review.png`, and `planning-portrait.png`; the receipt binds the checked source objects. Cloud QA runs both the ordinary local profile and the isolated disk-verifying planning profile.

Run from this candidate with the verified bundled Node bin first on PATH:

```sh
node --import tsx --test tests/planning-review.test.ts
npm run typecheck
npm run build
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/present-playwright-164 node node_modules/@playwright/test/cli.js test --config tests/planning-review-playwright.config.ts
```

The focused browser configuration owns port 4448, refuses an existing server, creates isolated temporary data, and points at an absent env file with provider keys cleared. It uses managed Chromium and does not download a browser or use a personal profile. Hosted/deployed acceptance, physical devices, actual repeated-use assessment and provider execution are outside this provider-free receipt; they are not replaced with team-logistics gates.
