# TLDraw Agent Template (Vendored)

This directory mirrors the official TLDraw SDK 4.x agent starter kit (`templates/agent`) as of commit `42a4388bc3f2e08c18fd008db09995f60e536804` (2025-11-18).

## Update policy

- Treat this folder as **read-only**. Make upstream changes in the TLDraw repo and re-vendor the entire template instead of editing files inline.
- When updating, run:
  1. `git clone --depth 1 https://github.com/tldraw/tldraw.git /tmp/tldraw-agent-template`
  2. Note the new commit hash (`git rev-parse HEAD`).
  3. Replace the contents of `vendor/tldraw-agent-template/` with `templates/agent` from upstream.
  4. Update this README with the new commit hash and date.
- PRESENT’s canvas agent should **derive contracts and prompts from this template** (see `docs/canvas-agent-progress.md`). Do not add bespoke actions or schemas that the teacher does not expose.

## Usage inside PRESENT

- `scripts/gen-agent-contract.ts` (to be added) will consume the `AgentActionUtil` definitions from here and produce PRESENT’s canonical contract in `generated/agent-contract.json`.
- The parity harness (planned) will be able to run the teacher agent directly so we can diff PRESENT vs. upstream outputs.
- See `AGENTS.md` + `docs/canvas-agent-progress.md` for instructions on how to sync behavior with this template.
