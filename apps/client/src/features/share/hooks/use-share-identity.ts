// MXD: who is commenting on this share page — a signed-in commenter account,
// or an anonymous guest identified only by the name they typed.
import { useAtomValue } from "jotai";
import { guestNameAtom, shareCommentsContextAtom } from "@/features/share/atoms/share-comments-atom";
import { useShareCommenterQuery } from "@/features/share/queries/share-commenter-query";
import { getGuestCommentToken } from "@/features/share/guest-identity";
import { IComment } from "@/features/comment/types/comment.types";

export function useShareIdentity() {
  const commentsContext = useAtomValue(shareCommentsContextAtom);
  const guestName = useAtomValue(guestNameAtom);
  const { data: commenter } = useShareCommenterQuery(!!commentsContext);

  const signedIn = !!commenter;
  return {
    commenter: commenter ?? null,
    signedIn,
    guestName,
    displayName: commenter?.name ?? guestName,
    canPost: signedIn || !!guestName,
    // Sent with posts/resolves only when anonymous; the server uses the
    // account name for signed-in commenters.
    guestNameForRequest: signedIn ? undefined : guestName,
    ownership(comment: IComment): { owned: boolean; guestToken?: string } {
      const guestToken = getGuestCommentToken(comment.id);
      const ownedByAccount =
        !!commenter && !!comment.commenterId && comment.commenterId === commenter.id;
      return { owned: ownedByAccount || !!guestToken, guestToken };
    },
  };
}
