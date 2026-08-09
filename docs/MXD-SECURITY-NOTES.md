# MXD fork — security notes

The fork adds unauthenticated, anonymous-facing surface that upstream Docmost
does not have (editable public links, guest comments). This records the threat
model, the second-review findings and how each was resolved, and the residual
risks an operator should know before enabling the feature flags.

All elevated features are **off by default** behind `SHARE_EDIT_ENABLED` and
`SHARE_GUEST_COMMENTS_ENABLED`. With the flags off, the fork is
upstream-equivalent (verified on the release image: edit/mint/guest-comment all
return 403).

## Trust boundaries

- **Anonymous edit session** (`SHARE_COLLAB` token → Hocuspocus websocket):
  the token carries no user id; the ws auth branch
  (`authentication.extension.ts`) re-validates the share, mode, page scope,
  page-level restrictions, and the sharing kill switch on **every** (re)connect.
  Bounded staleness after a revocation = token TTL (10 min).
- **Guest comment** (`@Public()` endpoints under `/shares/comments`): gated by
  `validateGuestCommentAccess` (same ladder as the mint path); body content is
  sanitized server-side against an allowlist before persistence.
- Both surfaces are per-IP throttled (`share-public` throttler). This assumes
  the deployment sits behind a single trusted reverse proxy that overwrites
  `X-Forwarded-For` — our Caddy front does. See residual risks.

## Second-review findings and resolutions

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | P1 | **Mention-notification spoofing**: an anonymous edit session could inject a mention node with an attacker-controlled `creatorId`, spoofing "X mentioned you" emails. | `persistence.extension.ts` now only raises notifications for mentions whose `creatorId` is an actual authenticated contributor of the store window (`authorizedUserMentions()`, unit-tested). Anonymous/forged mentions are dropped. |
| 2 | P1 | **rotate-key was a control that could not revoke**: mint / comment / ws-auth resolve by the immutable `shareId` (exposed via `/shares/page-info`), never by `key`, and old URLs auto-redirect to the new key. | Removed rotate-key entirely (endpoint, service, client button, audit event). **Revocation = delete the share.** Documented in the share model note below. |
| 3 | P2 | **Sanitizer DoS**: guest comment content recursed with no depth/size bound. | `MAX_DEPTH=20` / `MAX_NODES=2000` in the sanitizer; `@MaxLength` on the content (20 KB) and guest-name (100) DTOs. Regression tests for deep + wide adversarial docs. |
| 4 | P2 | **`restrict()` non-transactional**: a failure between the access-row insert and the seed-writer insert could strand a restricted page with zero members. | Both writes wrapped in one `executeTx` transaction. |
| 5 | P3 | **Unconditional audit** on idempotent restrict/open no-ops → false audit trail. | Service returns `{ changed }`; the controller audits only real state changes. |
| 6 | residual | ws auth didn't honor the space-level sharing kill switch on reconnect (mint did). | ws auth now re-checks `isSharingAllowed` on every connect. |

## Revocation & the share-access model

Docmost resolves a public share by **pageId**, not by the URL `key` — the key
is effectively a cosmetic slug, and an old share URL auto-redirects to the
current key. The fork does **not** change this. Consequences an operator must
understand:

- The **only** reliable way to revoke a leaked edit/comment link is to
  **delete the share** (which invalidates minting and guest comments
  immediately). Lowering the mode (edit→comment→view) also removes the elevated
  capability on the next reconnect.
- Restricting the page (page permissions) also cuts off the public share
  entirely (verified: restrict → share stops resolving, minting 403).

## Residual risks (know these before enabling flags)

1. **Edit-mode shares grant anonymous internet users write access** to a live
   page with the full editor schema (attachments, transclusions, comment
   marks). This is a large blast-radius increase over view-only sharing. Enable
   per-page, deliberately, on non-sensitive content.
2. **Throttling relies on a trusted proxy.** With `trustProxy: true`, a
   deployment NOT strictly behind a single proxy that overwrites
   `X-Forwarded-For` could let an attacker spoof the header for a fresh throttle
   bucket per request. Our Caddy front overwrites it; verify before exposing.
3. **Guest-authored strings now flow into notification/email templates** for
   the first time. The templates escape via React-email; a template change
   should re-check escaping of `guestName`/comment text.
4. **Direct Yjs protocol access**: a client with a valid `SHARE_COLLAB` token
   can speak the raw Yjs/websocket protocol, bypassing the client-side editor
   affordance restrictions. The schema is shared with authenticated editors by
   design (content integrity), and the mention-notification guard (#1) blocks
   the notification-spoofing consequence; other node types are inert data.
5. **Public comment listing** returns all comments on a comment/edit-shared
   page, including staff-authored ones, to anonymous visitors — intended for
   the thread view, but means internal comment content on a shared page is
   public. Only share pages whose full comment thread is safe to expose.
