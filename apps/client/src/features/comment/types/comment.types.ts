import { IUser } from "@/features/user/types/user.types";
import { QueryParams } from "@/lib/types.ts";

export interface IComment {
  id: string;
  content: string;
  selection?: string;
  type?: string;
  creatorId: string;
  pageId: string;
  parentCommentId?: string;
  resolvedById?: string;
  resolvedAt?: Date;
  workspaceId: string;
  createdAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
  // MXD: null for guest comments posted from a public share link.
  creator: IUser | null;
  resolvedBy?: IUser | null;
  // MXD: display name of the share guest who wrote / resolved this comment.
  guestName?: string | null;
  resolvedByGuestName?: string | null;
  yjsSelection?: {
    anchor: any;
    head: any;
  };
}

export interface ICommentData {
  id: string;
  pageId: string;
  parentCommentId?: string;
  content: any;
  selection?: string;
}

export interface IResolveComment {
  commentId: string;
  pageId: string;
  resolved: boolean;
}

export interface ICommentParams extends QueryParams {
  pageId: string;
}
