// The authenticated caller context the data-platform services operate under.
// Populated by the controller from the request (or by the share-scoped path for
// public callers). Keeping it explicit — rather than reaching into request
// internals — keeps the services unit-testable and makes the authorization
// scope a first-class argument, not an ambient assumption.
export interface MxdContext {
  workspaceId: string;
  // The acting user, or null for an anonymous public-share actor.
  userId: string | null;
  // Guest display name when userId is null (public share editor).
  guestName?: string | null;
}
