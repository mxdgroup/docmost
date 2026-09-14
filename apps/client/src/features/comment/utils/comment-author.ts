import type { TFunction } from "i18next";
import { IComment } from "@/features/comment/types/comment.types";

// MXD: a comment's author is a member (creator) or a share guest (guestName).
export function commentAuthorName(comment: IComment, t: TFunction): string {
  if (comment.creator?.name) return comment.creator.name;
  if (comment.guestName) return `${comment.guestName} (${t("guest")})`;
  return t("Unknown");
}

export function commentResolverName(
  comment: IComment,
  t: TFunction,
): string | null {
  if (comment.resolvedBy?.name) return comment.resolvedBy.name;
  if (comment.resolvedByGuestName) {
    return `${comment.resolvedByGuestName} (${t("guest")})`;
  }
  return null;
}
