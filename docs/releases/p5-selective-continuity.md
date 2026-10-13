# P5: selected continuity into a fresh room

A signed room member can open **Invite → Carry only what matters**, preview visible notes or plain Markdown source excerpts, select up to ten items, correct their text, and carry them into a fresh unused room. Leaving the destination blank creates a new owned room; an exact room ID or same-server link uses an existing fresh room the operator can edit. Nothing is selected automatically. The preview can be discarded without changing either room.

This reuses the mounted room-template panel and its empty-room installation transaction. Blank layout templates keep their existing behavior. It adds no app-level onboarding, hidden memory, recurring extraction, provider call, executor continuation, or retention policy.

## Content and authority boundary

The allowlist extracts text from native note/text/geo rich text and `artifact` widgets whose format is `markdown`. It omits unsupported objects, private HTML, widget programs, assets, work cards, document transcript metadata, people metadata, permissions, execution state, job receipts and source authors. Selected excerpts become ordinary native notes with fresh page/shape IDs. Provenance records only the source room/object, digest of the original selected text, kind, whether the preview text was corrected, and copy time. It gives no executor or membership authority.

This is structural filtering, not a semantic privacy detector. A note can itself contain a name or private words. The operator reviews the exact text, removes unwanted selections and edits the preview before copying. A Markdown excerpt is copied as plain text, not executed or restored as an HTML widget.

The server requires a current signed identity, source `read` membership and destination `write` membership. Source viewers can carry text already visible to them into their own editable room; they cannot modify the original. Source/destination must differ. The destination must still match the untouched initial native document. Source digests and current grants are rechecked in the synchronous destination commit callback after the native-store barrier. Changed/deleted source content requires a refreshed preview. Revoked or expired sessions/membership fail closed. Existing destination content is never replaced.

Successful installation flushes native room persistence before HTTP 201. Copied notes use the ordinary native edit/remove and **Save this room** export flows. Deleting a copied note does not delete its original. A copy is independent: later edits/revocation of the original do not retroactively delete the selected text already copied into another room. No broader retention or erasure guarantee is claimed.

## Acceptance

Bundled Node 24.19.0, matched Playwright 1.64.0 Chromium revision 1248, channel unset:

```sh
npm run typecheck
npm run build
node --import tsx --test tests/room-continuity.test.ts tests/room-template.test.ts
PRESENT_CONTINUITY_BROWSER=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/present-playwright-164 node --import tsx --test tests/room-continuity-browser.test.ts
```

The opt-in browser proof launches an isolated production-mode signed server on 127.0.0.1:4457 with fresh temporary room/access directories, absent Codex runtime and cleared provider credentials. It creates two rooms owned by two signed identities and observes both in separate real browser contexts. It proves no automatic selection, discard, corrected decision plus selected Markdown excerpt, current membership, unrelated-content exclusion, fresh IDs/provenance, live second-context convergence, disk persistence, reload, ordinary native correction/export, and the blank-destination new-room option. Actual HTTP checks reject anonymous/unauthorized source, unauthorized target, revoked source/target membership, stale source digest and an occupied destination. Pure tests additionally reject duplicate/unsupported/empty selections and unrecognized execution fields. No private work-job file is created.

Evidence is saved under `/private/tmp/present-p5-continuity` when `PRESENT_CONTINUITY_EVIDENCE_DIRECTORY` is set. This is local signed acceptance. It does not prove deployment on Railway, public editor license validity, authenticated provider execution, or a paid turn. The genuine production-domain tldraw license and actual public-host release checks remain separate launch prerequisites.


Final integrated signed-browser acceptance passed after the 400px spacing correction. Rendered review confirms a visible gap between the 360px native notes. Source-bound receipt and reviewed screenshots are retained in `docs/evidence/p5-20261012`. Earlier approval-review timeouts executed no test; the successful approved final run supersedes the earlier geometry receipt.
