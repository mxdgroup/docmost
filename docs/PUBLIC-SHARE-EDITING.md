# Public share editing

After deploying this change, open the page menu → **Public link access** →
**Can edit**. The core share dialog also offers Can view / Can comment / Can edit.
Publish the page first if it has no public link. A share inherited from a parent
must be changed on the parent page. Including subpages grants the same capability
to descendants, except restricted/deleted pages.

Public edit and comment capabilities default to enabled. An explicit
`SHARE_EDIT_ENABLED=false` or `SHARE_GUEST_COMMENTS_ENABLED=false` in deployment
configuration still disables the corresponding capability. Set both to `true`
on the web and standalone collaboration services for all three choices.
Existing links keep their stored permission; this release does not make them editable.

## Deployment

Deploy the web and collaboration services together. Normal production startup
runs the two new fork migrations: guest page attribution and nullable attachment
creators. No workspace users are created for guests. Follow the normal MXD image
release process; this working-tree change alone does not update docs.mxd.digital.
See [security notes](MXD-SECURITY-NOTES.md) for the permission boundaries and migration rollback behavior.

## Acceptance checks

1. Set a test page's link to Can edit. Open its URL in a logged-out browser.
2. Edit text, formatting, title and a table; upload an attachment. Refresh after
   the normal save interval and confirm the content persists.
3. Open a second logged-out session and confirm both clients see live edits and
   distinct Guest labels. Workspace members can edit the same Yjs document.
4. While a guest editor is open, change the share to Can comment, then Can view,
   or delete it. The open session stops editing; reload reflects the new mode.
5. Attempt private-page reads, content writes, title changes, attachment IDs,
   websocket document names and workspace APIs with the public capability.
   All must be denied. Can comment can post comments but cannot modify content.
6. Delete and recreate a link. The old URL/token must remain invalid.

The normal content editor schema, formatting, lists, tables, diagrams, file
uploads and comments are reused. Workspace management, private page search,
private databases and member-only APIs still require workspace authentication.

## Automated verification

Run the server Jest suites matching `public-share-collaboration`,
`authentication.extension`, `persistence.extension`, `share.service`,
`share-mode`, `guest-upload`, `guest-comment`, and `share-commenter.service`.
The websocket suite uses real signed tokens, two clients, Hocuspocus and the
production persistence extension, with database and queue I/O substituted.
Type-check both apps and build the client/server before deployment.

## Local acceptance results (2026-09-17)

Verified against a fresh local Postgres database and Redis-backed application:
logged-out browser text, bold formatting and title edits survived refresh; the
saved body recorded a distinct Guest name. An open guest editor became read-only
when its link was downgraded. HTTP checks passed for guest attachment upload/read,
private-page and private-attachment denial, blocked cross-page overwrites,
comment-only upload/title denial, workspace API denial, collaboration-token type
confusion, and invalid old keys after deleting/recreating a share. Both production
builds and app type checks passed. The websocket suite also verified two guest
clients, Yjs persistence/reload, malicious comment-session writes and live revocation.
These checks used test content locally, not the production example document.
