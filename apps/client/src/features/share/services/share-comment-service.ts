// MXD: anonymous comment API for commentable public share links.
import api from "@/lib/api-client";
import { IComment } from "@/features/comment/types/comment.types";
import { YjsSelection } from "@/features/comment/atoms/comment-atom";
import { IPagination } from "@/lib/types.ts";

export type GuestCreatedComment = IComment & { guestToken: string };

export async function getShareComments(params: {
  shareId: string;
  pageId: string;
  cursor?: string;
}): Promise<IPagination<IComment>> {
  const req = await api.post("/shares/comments", { ...params, limit: 100 });
  return req.data;
}

export async function createShareComment(data: {
  shareId: string;
  pageId: string;
  // omitted when signed in with a commenter account
  guestName?: string;
  content: string;
  parentCommentId?: string;
  selection?: string;
  yjsSelection?: YjsSelection;
}): Promise<GuestCreatedComment> {
  const req = await api.post<GuestCreatedComment>(
    "/shares/comments/create",
    data,
  );
  return req.data;
}

export async function updateShareComment(data: {
  shareId: string;
  commentId: string;
  guestToken?: string;
  content: string;
}): Promise<IComment> {
  const req = await api.post<IComment>("/shares/comments/update", data);
  return req.data;
}

export async function deleteShareComment(data: {
  shareId: string;
  commentId: string;
  guestToken?: string;
}): Promise<void> {
  await api.post("/shares/comments/delete", data);
}

export async function resolveShareComment(data: {
  shareId: string;
  commentId: string;
  resolved: boolean;
  guestName?: string;
}): Promise<IComment> {
  const req = await api.post<IComment>("/shares/comments/resolve", data);
  return req.data;
}

// Commenter accounts (optional sign-in for share-link commenters).
export interface ShareCommenter {
  id: string;
  name: string;
  email: string;
}

export async function getShareCommenter(): Promise<ShareCommenter | null> {
  const req = await api.post<{ commenter: ShareCommenter | null }>(
    "/shares/commenter/me",
  );
  return req.data.commenter;
}

export async function requestCommenterSignInLink(data: {
  shareId: string;
  pageId: string;
  email: string;
  name?: string;
  returnPath: string;
}): Promise<void> {
  await api.post("/shares/commenter/request-link", data);
}

export async function verifyCommenterSignIn(data: {
  token: string;
  guestComments: { commentId: string; guestToken: string }[];
}): Promise<{ commenter: ShareCommenter; claimed: number }> {
  const req = await api.post<{ commenter: ShareCommenter; claimed: number }>(
    "/shares/commenter/verify",
    data,
  );
  return req.data;
}

export async function signOutCommenter(): Promise<void> {
  await api.post("/shares/commenter/sign-out");
}
