// MXD: "comment on this selection" popup for a share guest. The selection's Yjs
// relative positions come from ReadonlyBubbleMenu (same atoms the in-app
// read-only flow uses); the server applies the highlight to the live doc, so
// it appears here — and for everyone — via the collab connection.
import { useState } from "react";
import { Dialog, Stack, Text } from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
  readOnlyCommentDataAtom,
  showReadOnlyCommentPopupAtom,
} from "@/features/comment/atoms/comment-atom";
import CommentEditor from "@/features/comment/components/comment-editor";
import CommentActions from "@/features/comment/components/comment-actions";
import { useShareIdentity } from "@/features/share/hooks/use-share-identity";
import { useCreateShareCommentMutation } from "@/features/share/queries/share-comment-query";
import { useOpenShareComments } from "@/features/share/hooks/use-share-comments-aside";
import GuestNameInput from "@/features/share/components/guest-name-input";

export default function GuestCommentDialog({
  shareId,
  pageId,
}: {
  shareId: string;
  pageId: string;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<any>(null);
  const [, setShowPopup] = useAtom(showReadOnlyCommentPopupAtom);
  const [selectionData, setSelectionData] = useAtom(readOnlyCommentDataAtom);
  const identity = useShareIdentity();
  const createMutation = useCreateShareCommentMutation(shareId, pageId);
  const openComments = useOpenShareComments();

  const close = () => {
    setShowPopup(false);
    // @ts-ignore -- jotai infers this upstream atom as read-only without strictNullChecks
    setSelectionData(null);
  };

  const clickOutsideRef = useClickOutside(() => {
    if (document.querySelector("#mention, #emoji-command")) return;
    close();
  });

  const save = async () => {
    if (!selectionData || !content || !identity.canPost) return;
    try {
      const created = await createMutation.mutateAsync({
        guestName: identity.guestNameForRequest,
        content: JSON.stringify(content),
        selection: selectionData.selectedText,
        yjsSelection: selectionData.yjsSelection,
      });
      close();
      openComments(created.id);
    } catch {
      // error notification shown by the mutation; keep the draft open
    }
  };

  return (
    <Dialog
      opened={true}
      onClose={close}
      ref={clickOutsideRef}
      size="lg"
      radius="md"
      w={320}
      zIndex={400}
      position={{ bottom: 24, right: 24 }}
      withCloseButton
      withBorder
      aria-label={t("Add comment")}
    >
      <Stack gap="xs">
        {selectionData?.selectedText && (
          <Text size="xs" c="dimmed" lineClamp={2} pr="lg">
            “{selectionData.selectedText}”
          </Text>
        )}
        {!identity.canPost ? (
          <GuestNameInput autoFocus />
        ) : (
          <Text size="sm" fw={500}>
            {identity.displayName}
          </Text>
        )}
        {identity.canPost && (
          <>
            <CommentEditor
              onUpdate={setContent}
              onSave={save}
              placeholder={t("Write a comment")}
              editable={true}
              autofocus={true}
            />
            <CommentActions onSave={save} isLoading={createMutation.isPending} />
          </>
        )}
      </Stack>
    </Dialog>
  );
}
