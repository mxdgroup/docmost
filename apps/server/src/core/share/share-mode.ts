// MXD fork: public-share capability model.
//
// A share's `mode` is a single ordered capability — every check in the
// system (HTTP, websocket auth, comment endpoints, client) must resolve
// capabilities through these helpers so the semantics can never drift
// across layers. `edit` implies `comment` implies `view`. A missing/null
// mode (legacy rows, defensive default) is `view`.
export enum ShareMode {
  VIEW = 'view',
  COMMENT = 'comment',
  EDIT = 'edit',
}

const MODE_RANK: Record<ShareMode, number> = {
  [ShareMode.VIEW]: 0,
  [ShareMode.COMMENT]: 1,
  [ShareMode.EDIT]: 2,
};

export function normalizeShareMode(
  mode: string | null | undefined,
): ShareMode {
  switch (mode) {
    case ShareMode.COMMENT:
      return ShareMode.COMMENT;
    case ShareMode.EDIT:
      return ShareMode.EDIT;
    default:
      return ShareMode.VIEW;
  }
}

export function shareModeAllows(
  mode: string | null | undefined,
  required: ShareMode,
): boolean {
  return MODE_RANK[normalizeShareMode(mode)] >= MODE_RANK[required];
}

// Anonymous live (collab websocket) session a share grants, or null for none.
// The single source of truth for both the token mint and websocket auth, and
// consistent with guest-comment access: each mode rides its own kill switch.
//   edit    + SHARE_EDIT_ENABLED           -> 'writable'
//   comment + SHARE_GUEST_COMMENTS_ENABLED -> 'readonly' (to anchor comments)
//   anything else                          -> null
export function shareCollabSessionMode(
  mode: string | null | undefined,
  flags: { shareEditEnabled: boolean; guestCommentsEnabled: boolean },
): 'writable' | 'readonly' | null {
  switch (normalizeShareMode(mode)) {
    case ShareMode.EDIT:
      return flags.shareEditEnabled ? 'writable' : null;
    case ShareMode.COMMENT:
      return flags.guestCommentsEnabled ? 'readonly' : null;
    default:
      return null;
  }
}
