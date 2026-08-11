import { User } from '@docmost/db/types/entity.types';

// The authenticated caller context the data-platform services operate under.
// Populated by the controller from the request (or by the share-scoped path for
// public callers). Keeping it explicit — rather than reaching into request
// internals — keeps the services unit-testable and makes the authorization
// scope a first-class argument, not an ambient assumption.
export interface MxdContext {
  workspaceId: string;
  // The acting user, or null for an anonymous public-share actor.
  userId: string | null;
  // The full authenticated user, needed for space/page authorization checks.
  // Null for anonymous/public-share callers (that path is authorized separately).
  user?: User | null;
  // Guest display name when userId is null (public share editor).
  guestName?: string | null;
  // How deep in an automation chain this operation is. A user action starts at
  // 0/undefined; each automation-triggered write increments it. The executor
  // stops once it reaches the cap — the primary loop guard (roadmap §40).
  automationDepth?: number;
}

// Emitted by the record service after a create/update so the automation executor
// (a decoupled @OnEvent listener) can react without a circular dependency.
export const MXD_RECORD_CHANGED = 'mxd.record.changed';

export interface MxdRecordChangedEvent {
  ctx: MxdContext;
  tableId: string;
  recordId: string;
  triggerType: 'record_created' | 'record_updated';
  changedFieldIds: string[];
}
