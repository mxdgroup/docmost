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
  guestName: string;
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
  guestToken: string;
  content: string;
}): Promise<IComment> {
  const req = await api.post<IComment>("/shares/comments/update", data);
  return req.data;
}

export async function deleteShareComment(data: {
  shareId: string;
  commentId: string;
  guestToken: string;
}): Promise<void> {
  await api.post("/shares/comments/delete", data);
}

export async function resolveShareComment(data: {
  shareId: string;
  commentId: string;
  resolved: boolean;
  guestName: string;
}): Promise<IComment> {
  const req = await api.post<IComment>("/shares/comments/resolve", data);
  return req.data;
}
