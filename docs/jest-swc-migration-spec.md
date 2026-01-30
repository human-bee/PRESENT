# Jest → SWC Transform Migration

## Why / When
- **Motivation**: Reduce cold-start latency (SWC is ~2-3× faster), align with future ESM/Next 16 defaults, and remove the `ts-jest` dependency on the TypeScript compiler.
- **Timing**: Schedule only after the debate scorecard refactor stabilizes and the queue/agent stack is green, ideally early in a sprint while CI capacity is high. Target a branch cut when we can dedicate ~1‑2 days to babysit CI.
- **Dependencies**: Requires Jest `^30`, `@swc/jest`, Node ≥22, and parity with `tsconfig.test.json` semantics.

## Preconditions
1. Document the current Jest + ts-jest behavior that must be preserved (module resolution, TS transforms, decorators, diagnostics).
2. Verify all test files compile under `tsc --noEmit -p tsconfig.test.json` so type errors are not being masked by ts-jest.
3. Ensure `ts-node`/`tsx` usage in agents is isolated so we do not conflate runtime loaders with the Jest transform rollout.

## High-Level Plan
1. **Dependency Prep**
   - Upgrade `jest`, `@jest/globals`, `jest-environment-jsdom`, `@types/jest`, and install `@swc/jest`.
   - Keep `ts-jest` until the rollout completes for easy rollback.
2. **Config Parity**
   - Mirror `tsconfig.test.json` options inside the SWC config: `module.type = 'commonjs'`, `esModuleInterop`, `emitDecoratorMetadata`, `experimentalDecorators`, `jsx.runtime = 'automatic'`.
   - Audit custom transformers (none today) to confirm we are not silently relying on them.
3. **Pilot Scope**
   - Use Jest's `transform` overrides to apply SWC only to a safe subset (e.g., `src/components/**`) while agent/steward suites continue using ts-jest.
   - Run `npm test --runInBand` plus a steward-heavy suite to confirm no regressions.
4. **Full Cutover**
   - Remove the per-path override, switch the root transform to `@swc/jest`, and drop the `ts-jest` preset.
   - Update docs (`AGENTS.md`, this spec) so new contributors know the canonical setup.
5. **Post-Cutover Hardening**
   - Enable `jest --runTestsByPath` smoke tests in CI for steward-heavy suites to catch interop regressions.
   - Remove `ts-jest` from dependencies once CI stays green for ≥3 days.

## Watch Outs & Mitigations
- **CommonJS / named export shape**: SWC defaults to `esModule` semantics and can strip named exports re-exported via `module.exports`. Mitigation: set `module.type = 'commonjs'` and add `module.export = 'commonjs'` (or convert the affected files to ESM first).
- **Decorator / metadata usage**: If agents or stewards adopt decorators under `experimentalDecorators`, we must enable `jsc.transform.decoratorMetadata`.
- **Babel plugins**: We currently rely on `babel-plugin-transform-remove-console` only in production builds, but confirm SWC does not need to emulate it for tests.
- **Jest mocks**: Re-run the `tests/__mocks__` modules because SWC caches compiled output differently; set `extensionsToTreatAsEsm` if any mocks move to ESM.
- **Source maps**: Ensure `jsc.sourceMaps = 'inline'` so stack traces in LiveKit agent tests remain readable.
- **CI cache churn**: Updating to SWC invalidates Jest cache; add a one-time `npm test --clearCache` to the rollout checklist.

## Rollback Plan
- Keep the ts-jest config in git history (tag this doc and `jest.config.cjs`).
- If any suite fails post-cutover, reapply the ts-jest block and `npm install ts-jest` from lockfile, then open a retro issue before attempting SWC again.

## Communication / Tracking
- Open a GitHub issue titled “Switch Jest Transform to SWC” with this spec linked.
- Checklist items: dependency bump, partial rollout, full rollout, documentation, rollback window closed.
- Post status in #agents-internal before flipping the default so steward owners know to watch their suites.
