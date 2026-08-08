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
