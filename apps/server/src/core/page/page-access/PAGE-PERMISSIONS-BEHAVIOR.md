# Page-permission management — behavior spec (clean-room)

MXD fork (plan Units 8–9). Written from Docmost's public documentation of the
Page Permissions feature and this repo's AGPL-core enforcement plumbing
(`PagePermissionRepo`, `page-access.service.ts`). The EE implementation
(`apps/client/src/ee/page-permission`, private server EE) was **not consulted**
— enforced by the `ee-clean-room` CI job. Implementations work from THIS spec.

## Model (already in AGPL core)

- `page_access` — one row per restricted page (`access_level = 'restricted'`,
  unique `page_id`). Deleting it un-restricts the page (members cascade).
- `page_permissions` — members of a `page_access`: exactly one of
  `user_id`/`group_id`, `role ∈ {writer, reader}` ("Can edit"/"Can view").
- Inheritance is positional: a page is effectively restricted when ANY
  ancestor (or itself) has a `page_access` row; access requires permission on
  ALL restricted ancestors, and the nearest restricted ancestor's highest
  role decides edit rights (`canUserEditPage`). No new inheritance code —
  enforcement already consumes this shape everywhere (page reads, search,
  collab auth, shares, exports, notifications).

## Behaviors

1. **Restrict**: actor with edit rights on the page creates the `page_access`
   row and is seeded as a `writer` member — the invariant "a restricted page
   always has ≥1 writer" holds from birth. Restricting an already-restricted
   page is a no-op returning current state (idempotent).
2. **Open (unrestrict)**: allowed for a `writer` member of the restriction or
   a space admin. Deletes the `page_access` row (members cascade); the page
   reverts to space-level permissions. Idempotent.
3. **List members**: any user who can access the page may view the member
   list (paginated, users + groups with roles).
4. **Add member**: writer member or space admin adds users/groups with a
   role. Duplicate adds update the role instead of erroring.
5. **Change role**: writer member or space admin. Demoting the LAST writer
   (member-level) is rejected — the restriction must keep ≥1 writer.
6. **Remove member**: writer member or space admin. Removing the last writer
   is rejected. Members may remove themselves (walk-away) unless they are the
   last writer.
7. **Sharing interplay**: restricted pages cannot be publicly shared, and
   existing shares of a page stop resolving when a restriction appears above
   it (already enforced in core — `hasRestrictedAncestor` checks in the share
   paths).
8. **Space admins** always retain management rights over restrictions in
   their space (they may not be members; membership checks are for
   non-admins).
9. **Audit**: every mutation emits an audit event (restrict/unrestrict/
   member-added/member-removed/role-updated) with actor, page, and target.
10. **Staleness**: permission changes take effect on the next page load /
    websocket (re)connect — same acceptance as share revocation. Open collab
    sessions are not force-killed.
