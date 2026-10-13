# PRESENT P0 dependency and runtime decisions

Researched live on 2026-10-12 Pacific, implemented in the isolated release checkout starting at `7593c498025ce2f8fc41070d601aa6597e53caf9`. The research used public npm registry metadata, official release/migration documentation, the native code in `present-essence`/`present-room-os`, and the installed Codex runtime. No provider settings, keys, existing product installations, deployments, commits, or remote branches were changed by this lane.

## Accepted package set

All 28 direct package declarations were checked against current registry metadata. The complete before/after/source table is [p0-package-diff-list.md](p0-package-diff-list.md); machine-readable metadata is [p0-dependency-register.json](p0-dependency-register.json), and the actual installed tree is [p0-installed-direct-dependencies.json](p0-installed-direct-dependencies.json).

| Family | Accepted exact version | Reason |
| --- | --- | --- |
| tldraw, assets, sync, sync-core, tlschema | 5.5.2 together | Canvas, store, persistence, collaboration, and licensing fixes; keep the entire record/wire family aligned. |
| React, React DOM, their type packages | 19.3.0 together | Stable current release, within tldraw's supported React peer range. |
| LiveKit client / server SDK | 2.22.4 / 2.19.1 | Signal/reconnect, renegotiation, RPC, track behavior, and token-validation fixes. These packages have independent release numbers. |
| MCP client / server / core | 2.3.1 together | Current stable split SDK; remove the old monolithic SDK. |
| MCP Node adapter / Apps | 2.1.1 / 2.0.3 | Current stable adapters matching split SDK peers. |
| Vite / TypeScript | 8.3.4 / 7.0.2 | Current stable Rolldown/Oxc build and native TypeScript compiler. |
| Zod / Biome / Playwright | 4.6.7 / 2.5.15 / 1.64.0 | Current stable schema, source checking, and browser acceptance tooling. |
| dotenv / image-size / ipaddr.js / ws | 18.0.7 / 2.0.4 / 2.5.0 / 8.22.0 | Current stable direct runtime dependencies. |
| tsx / @types/ws | 4.23.15 / 8.18.2 | Current stable runner and matching WS type major. |
| @types/node | 24.19.2 | Latest Node 24 type line, intentionally matched to the supported Node 24 LTS runtime rather than registry default 26.x. |

Official sources: [tldraw 5.5 changes](https://tldraw.dev/releases/v5.5.0), [5.5.2 patch](https://github.com/tldraw/tldraw/releases/tag/v5.5.2), [React 19.3](https://react.dev/blog/2026/09/09/react-19-3), [LiveKit client changelog](https://github.com/livekit/client-sdk-js/blob/main/CHANGELOG.md), [server SDK changelog](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/CHANGELOG.md), [MCP 2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1), [MCP Apps 2.0.3](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v2.0.3), [Vite migration](https://vite.dev/guide/migration), [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Zod 4.6.7](https://github.com/colinhacks/zod/releases/tag/v4.6.7), [Biome changelog](https://biomejs.dev/internals/changelog/), [Playwright 1.64](https://github.com/microsoft/playwright/releases/tag/v1.64.0), [dotenv changelog](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md). Each exact package version also has its primary registry source in the package table.

## Actual migrations and acceptance

**tldraw:** Update all five declared family packages atomically and regenerate copied assets. Relevant 5.5 changes include finite camera-coordinate rejection, independent query-history counters, removed debug flags, a new oversized-message close reason, typography behavior, and fixes for interrupted gestures, persistence, reconnect, and Unicode chunk splitting. The release does not justify resetting PRESENT's records. A real 5.4 snapshot was generated using the existing old installation and then restored, edited, and reloaded under 5.5.2. Both objects, including the untouched timer identity/data, survived. The immutable fixture and regression test are `tests/fixtures/dependencies/native-tldraw-5.4.json` and `tests/tldraw-upgrade.test.ts`. Browser peer/reload and current asset verification remain integrated acceptance responsibilities.

**MCP:** Migrate every SDK object consumer together. Client/transport imports now come from `@modelcontextprotocol/client`; server imports from `server`; raw protocol schema constants from `core`; Node HTTP transport from `node`. Remove the old positional result-schema argument to `callTool`, wrap fixture input schemas with `z.object`, and use `extra.mcpReq.signal` for bridge cancellation. V2 list methods aggregate pages, so the client now makes one list call with `listMaxPages: 5` and strict capabilities, retaining the discovery bound. Profile allowlists, canonical linkage, actor binding, replay identity, CSP, and sandbox behavior remain in place. The loopback SDK integration fixture passed six tests. [SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html), [Apps migration](https://apps.extensions.modelcontextprotocol.io/api/documents/migrate-to-v2.html).

**Vite/TypeScript:** Migrate the explicit JSX transform from `esbuild` to `oxc`; keep the intentional `es2022` browser target. TypeScript 7 is a stable native compiler with no JavaScript compiler API. PRESENT does not import that API, so it needs no compatibility package. Existing explicit `strict`, `types`, `moduleResolution: Bundler`, and `noEmit` settings avoid the common TypeScript 6/7 transition changes. A catalog loop needed an explicit return annotation because native inference diagnosed a circular inference site. Build and typecheck pass. Do not translate upstream speed claims into a measured PRESENT speedup. [TypeScript 6 transition](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

**LiveKit/React:** The new DOM types allow string echo-cancellation values while LiveKit's audio-capture type remains narrower. The microphone helper now returns the precise boolean/device fields it actually creates, without a type cast or behavioral change. Preserve explicit device selection. New LiveKit server token verification requires expiration; release acceptance must exercise real join, reconnect, tracks, and received remote media. React 19.3 changes transition scheduling and DOM form behavior; verify caret/IME, peer text, widget state, and overlays through actual browser scenarios.

**dotenv:** V18 removes vault support and preload registration; native code uses explicit `config({ path, quiet: true })` and has no removed preload/vault usage. Keep that call, existing operator env files, and no-overwrite semantics. No fast-parser opt-in is introduced.

**Tooling:** Biome remains a current stable source checker; its upgrade is not a claim that existing broad lint debt was fixed. Playwright 1.64 adds native WebMCP access and improved video recording. Existing tests still need actual browser acceptance; new tooling alone is not WebMCP or performance proof. Reinstall a version-matched browser when the test harness uses a managed Playwright browser; an explicitly selected Chrome executable must be recorded in results.

## Current model and executor choice

Live `model/list` on installed Codex 0.162.1 was queried without starting an inference turn. The saved result is [p0-codex-model-catalog.json](p0-codex-model-catalog.json). It reports GPT-6.1 Sol as the account default, GPT-6 Luna and GPT-6 Astra available, reasoning efforts per model, and their priority tiers. Spark is absent. The catalog, not a bundled example, controls availability and supported options. [Official app-server discovery](https://learn.chatgpt.com/docs/app-server#list-models-modellist).

Add `sol` for `gpt-6.1-sol`; use it for ordinary coding/work execution. Use `luna` with `gpt-6-luna` for bounded tasks and keep `codex` with `gpt-6-astra` for demanding visual or reasoning work. New work defaults to Sol; omitted workspace Sol effort defaults to high. The picker exposes current choices, and model/effort/Fast checks use the account's returned catalog. API planning remains an explicit operator transport choice with its own project model discovery and supported API effort list. Subscription availability does not establish API project access, and an API `/models` entry does not certify a specific tier/latency. [Sol API card](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Luna API card](https://developers.openai.com/api/docs/models/gpt-6-luna).

Keep the actual isolated Codex executor. Its workspace tools, permission profile, source files, causal turn IDs, execution receipts, and cancellation/recovery checks are separate from bounded semantic decisions. No classifier replaces file/command execution.

## Decisions API policy

The live official HTTP contract remains `POST https://api.typesafe.ai/v1/systemone`; no new `/decisions` endpoint was invented. Use Choice for known handlers and closed arguments, Noul for independent boolean judgments, Score for rubric positions. Code performs arithmetic, candidate extraction, source copying, policy, and execution. Independent questions can share one request, and code consumes only the selected branch. [HTTP contract](https://docs.typesafe.ai/api), [function dispatch cookbook](https://docs.typesafe.ai/cookbooks/function_calling).

Pin `jev-1.13.0`, which official current docs identify as stable and accepted even if model listing only shows aliases. Require that exact response model and Choice answer type, preserve question identity, validate probability keys/sum/selected maximum and reported confidence, and retain abstention/fallback plus the existing shared routing timeout. Request/response byte and question bounds now apply. Results include a server-created request ID, request hash, version, question IDs, and threshold provenance. No API key or raw request is added to logs. [Current models](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence).

The existing 0.9 gates are conservative initial policy, not a newly measured calibration claim. Before advertising automation accuracy or a speed gain, replay a labeled PRESENT corpus containing discussion, negation, compound actions, quoted instructions, missing/competing arguments, existing-object edits, candidate omissions, stale state, and option-order permutations. Report accepted-action precision, abstention/fallback rates, per-route errors, p50/p95/p99 routing time, timeout/error rate, and input budget. Compare Jev against the same current Luna/Cerebras questions and against deterministic handling where suitable. Jev's documented numeric, indirection, adversarial, order, and generation caveats make these cases necessary. [Jev 1.13 caveats](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

The skill's old migration-guide URL now returns 404 and is absent from the current live index. Current API, primitive, SDK/changelog, model, and cookbook pages were read instead. SDK 0.6 changes Score criteria to an ordered sequence. PRESENT's existing bounded HTTP adapter avoids adding an unnecessary SDK dependency.

## Stored-data and licensing implications

No files or rooms are deleted or reset. Stored job schemas retain legacy Spark/Terra IDs. Fresh work requests accept current Sol/Luna/Astra only; old executor IDs are refused explicitly. `executionState.model` is an additive, optional server-only field. Resume reads the saved thread's exact model and checks it against the selected model and recorded affinity before resume/turn dispatch. Unknown or mismatched historical models fail honestly and retain the task/files. A follow-up retains the previous exact model. Artifact model provenance comes from the recorded exact execution model; historical output without that evidence reports `null` rather than claiming the new Luna model. Saved retired or unavailable UI preferences stay visible and block fresh submission until an explicit current choice; no saved preference or thread is remapped.

The tldraw family has a custom development license except some MIT core packages such as tlschema. Public/production use still needs an appropriate tldraw agreement/key; upgrading the family does not grant that right or remove enforcement. Its current patch specifically repairs blob-URL domain validation. Include the upstream license when distributing the software. [Current license](https://github.com/tldraw/tldraw/blob/v5.5.2/LICENSE.md), [licensing docs](https://tldraw.dev/community/license). New split MCP core/client/server/Node packages are Apache-2.0 rather than the old monolith's MIT; Apps remains MIT. Preserve applicable licenses/notices in distribution. Other package licenses are recorded individually in the registry snapshot.

## Verification state

- Node 24.19.0 was verified from the bundled runtime; the Homebrew `node@24` path misleadingly reported Node 25.2.1 and was not used for final acceptance.
- Exact dependencies installed; `npm ls --depth=0` saved. Final install audit reported zero vulnerabilities. This is a registry audit result, not a security audit.
- Affected model/work/voice/Decisions/MCP tests: 59 passed, zero failed. Native old-snapshot migration: one passed.
- Build/typecheck passed under Node 24.19.0. Vite's build reported 3.52 seconds, main JS 738.52 KB gzip, lazy LiveKit 145.93 KB gzip. These are one-host observations, not a paired speedup or cold-load certification.
- Expected SPA module-directive and ineffective dynamic-import warnings remain. Integrated browser, physical/received audio, WAN, live inference calibration, and deployment acceptance are separate work lanes.

Logs are saved in `/private/tmp/present-p0-research`: `affected-tests-node24.log`, `build-node24.log`, `tldraw-upgrade.log`, and `install-final-retry.log`. No live TypeSafe or model generation call was performed by this lane.

## Stack-aware CI

Native QA runs on the phase branches and PRs targeting prior phase branches.
The release-story browser profile is separate from ordinary UI, signed access
and production profiles. CI clears provider credentials and uses an absent
operator dotenv file. Hosted staging checks remain attached to their actual
deployment branch or explicit dispatch, since a phase push does not deploy that
service. Node 24 is explicit with current patch discovery.

GitHub-hosted runner actions are pinned to verified current release commits:
[checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-node 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), and
[upload-artifact 7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).
Their vendor READMEs were checked. The Node 24 action runtime is supported by
current hosted runners; setup-node's removed dummy token is irrelevant because
this workflow configures no package registry authentication. Artifact paths
include the release profile's disposable result directory.
