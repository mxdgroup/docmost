# MXD fork — security notes

The fork adds unauthenticated, anonymous-facing surface that upstream Docmost
does not have (editable public links, guest comments). This records the threat
model, the second-review findings and how each was resolved, and the residual
risks an operator should know before enabling the feature flags.

Public edit and comment capabilities are available by default. Operators can
disable them using `SHARE_EDIT_ENABLED=false` and
`SHARE_GUEST_COMMENTS_ENABLED=false`. Existing links are never upgraded to
edit by this change; a page editor must explicitly select **Can edit**.

## Trust boundaries

- **Anonymous edit session** (`SHARE_COLLAB` token → Hocuspocus websocket):
  the token carries no user id; the ws auth branch
  (`authentication.extension.ts`) re-validates the share, mode, page scope,
  page-level restrictions, token expiry, and the sharing kill switch on every
  connection and **before every incoming message**. The awaited
  `beforeHandleMessage` hook runs before Yjs applies updates, including initial
  SyncStep2 uploads. Share updates/deletes also close matching active sessions
  through the Redis document owner. No reconnect or token expiry is required
  for write revocation. A browser heartbeat updates idle UI if notification
  delivery fails; it is not an authorization mechanism.
- **Guest comment** (`@Public()` endpoints under `/shares/comments`): gated by
  `validateGuestCommentAccess` (same ladder as the mint path); body content is
  sanitized server-side against an allowlist before persistence.
- **Read-only share session** (2026-09-14): a `comment`-mode share can mint the
  same `SHARE_COLLAB` token, but ws auth derives the session capability from the
  share's *current* mode and flags (`shareCollabSessionMode`) and sets
  `connectionConfig.readOnly` for comment shares — the token never carries
  capability. Guests use the live doc only to anchor inline comments (Yjs
  relative positions). Verified adversarially: a hand-built provider on a
  comment-share token writes locally, the server drops it; the same write on an
  edit share lands (control).
- **Guest comment ownership**: edit/delete of a guest comment requires the
  per-comment secret returned once at create time. Only a sha256 hash is stored,
  in `mxd_guest_comment_tokens` (NOT on `comments`, whose rows are
  `selectAll`-ed into public responses); compared with `timingSafeEqual`. Member
  comments have no token, so guests can never edit/delete them.
- **Guest resolve** (`/shares/comments/resolve`): any guest on a commentable
  link can resolve/re-open any top-level thread on pages the share covers
  (product decision). Every guest action re-runs `validateGuestCommentAccess`
  against the comment's *own* page, never a client-supplied page id.
- **Commenter accounts** (2026-09-15, `/shares/commenter/*`): optional
  sign-in so a share visitor comments under their own name. A commenter is a
  row in `mxd_share_commenters` (email + name). It is **not** a Docmost user and
  has no workspace or space membership.
  - **Sign-in** is an emailed single-use link. The token is 32 random bytes;
    only its sha256 is stored. It expires in 24 hours and is consumed
    atomically, so a second use fails.
  - **Session** is an httpOnly SameSite=Lax cookie `mxdCommenterToken` holding a
    JWT with `type: share_commenter`. It is honored only by the public share
    comment endpoints. `JwtStrategy` and collab auth accept only their own
    types, verified e2e: users/me, spaces and pages/info all return 401.
  - **request-link** is enumeration-safe (same response either way) and runs
    the full guest-comment access ladder, so it only works from a live,
    commentable share. The return path must match `/share/<key>/p/<slug>`
    (no open redirect). It is capped at 3 links per email per 15 minutes, plus
    the per-IP throttle.
  - **Claiming guest comments** on sign-in requires the per-comment ownership
    token for each comment, so a signed-in commenter cannot take over anyone
    else's comments.
  - **Commenter emails** are never returned by the public comment listing.
    Only member reads (`/comments`) include them.
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

Public page loading now requires the requested share key or ID, checks its
scope, and never discovers a replacement share from a page ID. This includes
linked-page previews and SEO metadata. Deleting and recreating a share does not
revive the old URL. Legacy URLs without a share key no longer resolve.

- Deleting a share invalidates token minting, guest HTTP mutations and active
  collaboration sessions. Lowering its mode immediately rejects further edits.
- Restricting/deleting/moving a page outside the share or disabling sharing is
  rechecked before subsequent messages and HTTP mutations.
- Shared body content uses the normal Yjs persistence/history pipeline. A
  signed temporary guest ID supplies distinct caret labels and a persisted
  `pages.last_updated_by_guest` label; no fake users or workspace memberships.
- Title changes use a narrowly scoped public endpoint with the same edit check.
- Attachment uploads reuse the existing upload service, with share checks
  before upload and before publishing the result. Guest replacements are staged
  under a fresh storage key so revocation during streaming cannot overwrite the
  old file. Other-page attachment IDs are rejected. Live attachment reads check
  the current share against the attachment's actual owner page and use no-store.
- The attachment creator FK remains enforced but allows NULL for guests. This
  is a deliberate non-destructive constraint relaxation in the fork migration,
  needed because the original column required a real user. Image rollback keeps
  this nullable constraint; schema rollback refuses to fabricate owners or
  delete guest uploads.
- Share records currently have no scheduled expiry field. Collaboration JWTs
  expire after ten minutes and expiry is enforced on active messages; the client
  renews its session before that deadline. Share deletion is link revocation.

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
   **Since 2026-09-14 this applies to every share by default**: new links are
   created as `comment` and a one-off migration lifted all existing `view`
   links to `comment`. Lower a link to "Can view" (page ⋯ → Public link access)
   if the page carries internal-only comment threads.
7. **Commenter sign-in proves control of an inbox, nothing more.** Anyone can
   create a commenter account for any address they can receive mail at; the
   display name is self-chosen (shown to the team with the email on hover and
   an "external" tag). It does not prove affiliation with a client.
6. **Guest ownership is browser-held.** Losing local storage loses the ability
   to edit/delete one's own guest comments (they remain; a space admin can
   delete them). Anyone with the link can resolve threads — resolution is a
   workflow signal, not an access control.
