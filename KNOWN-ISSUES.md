# Known issues (MXD fork)

## 1. Share mode (View/Comment/Edit) selector never renders — EE modal shadows our core one

**Status:** OPEN. Server works; UI control missing. Workaround below.
**Found:** 2026-08-14 on production `v0.95.0-mxd.4`.

### Symptom
With `SHARE_EDIT_ENABLED=true` confirmed in `window.CONFIG`, the Share dialog shows only
*Shared to web / Include sub-pages / Search engine indexing*. There is **no View/Comment/Edit
selector**, so editable (or comment-mode) shares cannot be turned on from the UI.

### Root cause
Our fork added the mode `SegmentedControl` to the AGPL core component
`apps/client/src/features/share/components/share-modal.tsx` (a `Popover.Dropdown`).

The dialog actually rendered is the **EE** component
`apps/client/src/ee/page-permission/components/page-share-modal.tsx` (a Modal with
*Access* / *Publish* tabs; publish pane = `apps/client/src/ee/page-permission/components/publish-tab.tsx`).
The core `share-modal.tsx` is effectively dead UI on this build, so our patch never renders.

Note the child-page case is a second, separate wrinkle: a page that *inherits* a parent's share
shows only the inherited link — mode is a property of the share, set on the owning page.

### Constraint
`apps/client/src/ee/**` is Enterprise-licensed; the fork must not modify or import it (enforced by
the `ee-clean-room` CI job). So we cannot just add the control to `publish-tab.tsx`.

### Server side is unaffected
`shares.mode`, the share-collab token path, and authorization all work. Setting `mode='edit'`
out-of-band makes the share editable immediately (verified in production: the public share page
renders the editor with `contenteditable=true`).

### Options to fix
1. **Fork-owned share UI in core** — render our own mode control (page header or a core-owned
   modal), bypassing the EE dialog entirely. Clean-room safe. *Probably the cleanest.*
2. **Route the Share button to core `share-modal.tsx`** when fork flags are on — only viable if the
   mount point can be overridden without touching `ee/**`.
3. **Admin surface** — expose mode on a fork-owned settings page instead of the per-page dialog.

### Workaround (works today)
```sql
update shares set mode='edit' where key='<share-key>';   -- or 'comment' / 'view'
```
On the box: `cd /root/docmost && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "..."'`
Applied 2026-08-14 to share `kd1h73carq` (Daily standup tree) so it is editable via its public link.
