import type { TFunction } from "i18next";
import { IComment } from "@/features/comment/types/comment.types";

// MXD: a comment's author is a member (creator), a signed-in share commenter
// (commenter account), or an anonymous share guest (guestName). In the app,
// commenters are tagged "external" so the team can tell a verified client from
// a teammate; on the share page they show as just their name.
type Surface = "app" | "share";

export function commentAuthorName(
  comment: IComment,
  t: TFunction,
  surface: Surface = "app",
): string {
  if (comment.creator?.name) return comment.creator.name;
  if (comment.commenter?.name) {
    return surface === "app"
      ? `${comment.commenter.name} · ${t("external")}`
      : comment.commenter.name;
  }
  if (comment.guestName) return `${comment.guestName} (${t("guest")})`;
  return t("Unknown");
}

export function commentResolverName(
  comment: IComment,
  t: TFunction,
  surface: Surface = "app",
): string | null {
  if (comment.resolvedBy?.name) return comment.resolvedBy.name;
  if (comment.resolvedByCommenter?.name) {
    return surface === "app"
      ? `${comment.resolvedByCommenter.name} · ${t("external")}`
      : comment.resolvedByCommenter.name;
  }
  if (comment.resolvedByGuestName) {
    return `${comment.resolvedByGuestName} (${t("guest")})`;
  }
  return null;
}
