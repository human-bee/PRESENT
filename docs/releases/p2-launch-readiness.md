# P2 single-operator public launch readiness

[Revision-bound acceptance](../evidence/p2-20261012/acceptance.json) and [rendered unsupported-executor state](../evidence/p2-20261012/planning-only-work.png) retain the tested boundary. The preflight records local process configuration separately from the actual remote health revision.

The signed `/api/agents` response now discovers the selected planning transport and reports workspace execution separately. Fresh signed visitors default to **Sol 6.1**; current choices are Sol (`gpt-6.1-sol`), Luna (`gpt-6-luna`), and Astra (`gpt-6-astra`). An unavailable default stays unavailable until the operator or participant makes an explicit choice. Existing saved model preferences are retained by the UI.

`providers` describes planning model discovery. `planning.transport` is `codex-app-server`, `openai-responses`, or `unsupported`; `planning.catalogVerified` never means a generated result was accepted. Cerebras/voice key presence remains configuration evidence only. `workspace` reports the configured Codex command/auth-file prerequisite, the app-server `account/read` result, and its current model catalog independently of OpenAI Responses planning. A missing executor/account/default Sol model reports `status: unavailable` and `supported: false`. `catalog-verified` means only account/catalog discovery succeeded. `executionVerified` and `planning.generationVerified` remain false: neither endpoint starts a thread or turn, validates a workspace permission profile, executes commands, or certifies provider quality. Discovery is cached for 30 seconds; execution rechecks its own authority and runtime conditions.

The bundled Dockerfile installs Node 24, Git and dependencies. It does **not** install or authenticate Codex. An OpenAI planning key cannot create that executor. A hosted workspace requires an explicitly provisioned supported app-server, a legitimate ChatGPT sign-in, exact available model, and subsequent authorized proof of the isolated workspace profile and actual command/artifact completion. No credentials are copied or created by this phase.

## Operator preflight

Run from the intended checkout with the intended operator environment. The script reads only selected configuration and key presence; it does not load or overwrite `.env.local`, print key values, mutate accounts, deploy, or start a model turn.

```sh
node --import tsx scripts/launch-preflight.ts --offline
node --import tsx scripts/launch-preflight.ts \
  --url https://present-native-production.up.railway.app \
  --revision <exact-40-character-release-commit> \
  --persistent-root /data --replicas 1
```

The online form performs bounded provider account/catalog reads and unauthenticated `/healthz` revision readback. `--offline` omits those checks. `--persistent-root` and `--replicas` record operator-supplied infrastructure evidence; they are not discovery of remote volumes or replicas. The report labels its configuration source as the current process environment. Do not interpret absent local variables as proof that a deployed service lacks them. Exit 2 means requirements or acceptance remain unresolved. The report deliberately does not certify a public launch from configuration presence alone.

The report includes requested/observed revision, source branch, health, private data/access directories, durable mount coverage, single-writer requirement, non-sensitive provider discovery, native build-license key presence, and explicit gaps. Native rooms, access records, assets and workspaces must be preserved and backed up together. Exactly one long-lived writer is supported. A different healthy staging revision is not the requested release.

## Public editor license boundary

A legitimate active tldraw production license for the actual HTTPS hostname is required. The current native build consumes `VITE_TLDRAW_LICENSE_KEY` at build time and Docker declares that build argument. An operator must rebuild after supplying it; a runtime variable or `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` from another application does not establish that the native frontend bundle has the key. This preflight never prints or decodes a supplied key and never claims its presence validates its signature, domain, expiration, license type, or account entitlement.

The supported paths are a permitted 100-day evaluation trial, a commercial license for commercial use, or a discretionary hobby license for noncommercial use with its required watermark. Respect the one-trial limit. See the official [license policy](https://tldraw.dev/community/license) and [client-side key/domain validation documentation](https://tldraw.dev/sdk-features/license-key). No license check, domain rule, watermark or production detection is bypassed. Genuine license provisioning and editor acceptance on actual Railway remain launch blockers.

## Acceptance and next software steps

```sh
node --import tsx --test tests/launch-readiness.test.ts tests/invite-profile.test.ts
npm run build
PRESENT_LAUNCH_BROWSER=1 \
  node --import tsx --test tests/launch-capabilities-browser.test.ts
```

The opt-in browser stories run the real signed production HTTP server and Playwright's matched Chromium on fresh disposable data. Set `PLAYWRIGHT_BROWSERS_PATH` if the installed matched browsers use a separate cache; leave the browser channel unset. They verify the actual Sol default in Settings, create a native work card, fill its request, and assert Start is enabled for the supported controlled Codex account/catalog and disabled with an explicit visible reason for controlled API planning without a workspace executor. Anonymous discovery is denied. Repeated API/browser reads reuse one controlled executor probe. The fixtures reject generation endpoints/turns and use no real provider or credentials. These stories establish capability reporting and control gating, not real account access, provider generation or hosted license acceptance.

The integrated work card now consumes workspace readiness. Start, Continue and Resume stay disabled while discovery is pending or unsupported; Cancel and existing artifacts remain usable. Both local and signed discovery use the same planning/workspace contract. Browser acceptance verifies the actual enabled/disabled controls and explanation. Final integrated units are 316 passed of 321 with zero failures and five explicit opt-ins; three signed capability/recovery browser stories and the production work-card request contract pass. Typecheck/build pass. The remaining steps are a legitimate licensed build, actual hosted executor provisioning and explicit promotion, followed by exact revision, persistent topology, signed editor and real provider acceptance. Sole-user launch does not require another pilot participant, team rollout, event logistics, or a second human. This phase changes no deployed service or account.
