// MXD: comment threads for a commentable public share — the guest counterpart
// of the in-app comments aside (Open/Resolved tabs, inline-selection quotes,
// replies, resolve, edit/delete of the guest's own comments). Built on the
// share-guest API; guests have no account, so ownership is the per-comment
// token kept in this browser.
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Center,
  Divider,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import {
  IconArrowUp,
  IconDots,
  IconEdit,
  IconMessageOff,
  IconTrash,
} from "@tabler/icons-react";
import { useFocusWithin, useHover } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import CommentEditor from "@/features/comment/components/comment-editor";
import CommentActions from "@/features/comment/components/comment-actions";
import MxdResolveButton from "@/features/comment/components/mxd-resolve-button";
import { IComment } from "@/features/comment/types/comment.types";
import {
  commentAuthorName,
  commentResolverName,
} from "@/features/comment/utils/comment-author";
import classes from "@/features/comment/components/comment.module.css";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import {
  activeShareCommentIdAtom,
  guestNameAtom,
} from "@/features/share/atoms/share-comments-atom";
import {
  useCreateShareCommentMutation,
  useDeleteShareCommentMutation,
  useResolveShareCommentMutation,
  useShareCommentsQuery,
  useUpdateShareCommentMutation,
} from "@/features/share/queries/share-comment-query";
import { getGuestCommentToken } from "@/features/share/guest-identity";
import GuestNameInput from "@/features/share/components/guest-name-input";
import { scrollToThread } from "@/features/share/hooks/use-share-comments-aside";

type PanelProps = { shareId: string; pageId: string };

export default function SharedCommentsPanel({ shareId, pageId }: PanelProps) {
  const { t } = useTranslation();
  const { comments, isLoading, isError } = useShareCommentsQuery(
    shareId,
    pageId,
  );
  const guestName = useAtomValue(guestNameAtom);
  const [editingName, setEditingName] = useState(false);
  const createMutation = useCreateShareCommentMutation(shareId, pageId);

  const { open, resolved, repliesByParent } = useMemo(() => {
    const top = comments.filter((c) => !c.parentCommentId);
    const byParent = new Map<string, IComment[]>();
    for (const c of comments) {
      if (!c.parentCommentId) continue;
      const list = byParent.get(c.parentCommentId) ?? [];
      list.push(c);
      byParent.set(c.parentCommentId, list);
    }
    return {
      open: top.filter((c) => !c.resolvedAt),
      resolved: top.filter((c) => c.resolvedAt),
      repliesByParent: byParent,
    };
  }, [comments]);

  const post = useCallback(
    async (content: any, parentCommentId?: string) => {
      if (!guestName) {
        notifications.show({ message: t("Add your name to comment") });
        return false;
      }
      const created = await createMutation.mutateAsync({
        guestName,
        content: JSON.stringify(content),
        parentCommentId,
      });
      if (!parentCommentId) scrollToThread(created.id);
      return true;
    },
    [guestName, createMutation, t],
  );

  const renderThread = (comment: IComment) => (
    <Thread
      key={comment.id}
      comment={comment}
      replies={repliesByParent.get(comment.id) ?? []}
      shareId={shareId}
      pageId={pageId}
      onReply={(content) => post(content, comment.id)}
    />
  );

  if (isLoading) return null;
  if (isError) {
    return (
      <Text size="sm" c="dimmed">
        {t("Error loading comments.")}
      </Text>
    );
  }

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box mb="xs">
        {!guestName || editingName ? (
          <GuestNameInput
            initialValue={guestName}
            autoFocus={editingName}
            onDone={() => setEditingName(false)}
          />
        ) : (
          <Text size="xs" c="dimmed">
            {t("Commenting as")} <b>{guestName}</b> ·{" "}
            <Anchor
              component="button"
              size="xs"
              onClick={() => setEditingName(true)}
            >
              {t("Change")}
            </Anchor>
          </Text>
        )}
      </Box>

      <Tabs
        defaultValue="open"
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <Tabs.List justify="center">
          <Tabs.Tab
            value="open"
            leftSection={
              <Badge size="sm" variant="light" color="blue">
                {open.length}
              </Badge>
            }
          >
            {t("Open")}
          </Tabs.Tab>
          <Tabs.Tab
            value="resolved"
            leftSection={
              <Badge size="sm" variant="light" color="green">
                {resolved.length}
              </Badge>
            }
          >
            {t("Resolved")}
          </Tabs.Tab>
        </Tabs.List>

        <ScrollArea style={{ flex: "1 1 auto" }} scrollbarSize={5} type="scroll">
          <Box pb="xs">
            <Tabs.Panel value="open" pt="xs">
              {open.length === 0 ? (
                <EmptyState
                  text={t(
                    "No open comments. Select any text on the page to comment on it, or leave a general comment below.",
                  )}
                />
              ) : (
                open.map(renderThread)
              )}
            </Tabs.Panel>
            <Tabs.Panel value="resolved" pt="xs">
              {resolved.length === 0 ? (
                <EmptyState text={t("No resolved comments.")} />
              ) : (
                resolved.map(renderThread)
              )}
            </Tabs.Panel>
          </Box>
        </ScrollArea>
      </Tabs>

      <PageComposer
        guestName={guestName}
        isLoading={createMutation.isPending}
        onSave={(content) => post(content)}
      />
    </Box>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Center py="xl" px="sm">
      <Stack align="center" gap="xs">
        <IconMessageOff
          size={32}
          stroke={1.5}
          color="var(--mantine-color-dimmed)"
        />
        <Text size="sm" c="dimmed" ta="center">
          {text}
        </Text>
      </Stack>
    </Center>
  );
}

function Thread({
  comment,
  replies,
  shareId,
  pageId,
  onReply,
}: {
  comment: IComment;
  replies: IComment[];
  shareId: string;
  pageId: string;
  onReply: (content: any) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [activeId] = useAtom(activeShareCommentIdAtom);
  const resolverName = comment.resolvedAt
    ? commentResolverName(comment, t)
    : null;

  return (
    <Paper
      shadow="sm"
      radius="md"
      p="sm"
      mb="sm"
      withBorder
      data-comment-id={comment.id}
      className={clsx(activeId === comment.id && classes["focused-thread"])}
    >
      <CommentItem comment={comment} shareId={shareId} pageId={pageId} />
      {replies.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          shareId={shareId}
          pageId={pageId}
        />
      ))}
      {resolverName && (
        <Text size="xs" c="dimmed">
          {t("Resolved by {{name}}", { name: resolverName })}
        </Text>
      )}
      {!comment.resolvedAt && (
        <>
          <Divider my={4} />
          <ReplyComposer onSave={onReply} />
        </>
      )}
    </Paper>
  );
}

function CommentItem({
  comment,
  shareId,
  pageId,
}: {
  comment: IComment;
  shareId: string;
  pageId: string;
}) {
  const { t } = useTranslation();
  const { hovered, ref } = useHover();
  const guestName = useAtomValue(guestNameAtom);
  const [isEditing, setIsEditing] = useState(false);
  const editContentRef = useRef<any>(null);
  const createdAtAgo = useTimeAgo(comment.createdAt);
  const updateMutation = useUpdateShareCommentMutation(shareId, pageId);
  const deleteMutation = useDeleteShareCommentMutation(shareId, pageId);
  const resolveMutation = useResolveShareCommentMutation(shareId, pageId);

  const authorName = commentAuthorName(comment, t);
  const ownerToken = getGuestCommentToken(comment.id);
  const isTopLevel = !comment.parentCommentId;

  const saveEdit = async () => {
    if (!ownerToken || !editContentRef.current) {
      setIsEditing(false);
      return;
    }
    await updateMutation.mutateAsync({
      commentId: comment.id,
      guestToken: ownerToken,
      content: JSON.stringify(editContentRef.current),
    });
    editContentRef.current = null;
    setIsEditing(false);
  };

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t("Are you sure you want to delete this comment?"),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        ownerToken &&
        deleteMutation.mutate({ commentId: comment.id, guestToken: ownerToken }),
    });

  const toggleResolved = () => {
    if (!guestName) {
      notifications.show({ message: t("Add your name to comment") });
      return;
    }
    resolveMutation.mutate({
      commentId: comment.id,
      resolved: comment.resolvedAt == null,
      guestName,
    });
  };

  const jumpToSelection = () => {
    const el = document.querySelector(
      `.comment-mark[data-comment-id="${comment.id}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("comment-highlight");
    setTimeout(() => el.classList.remove("comment-highlight"), 3000);
  };

  return (
    <Box ref={ref} pb="xs">
      <Group wrap="nowrap">
        {comment.creator ? (
          <CustomAvatar
            size="sm"
            avatarUrl={comment.creator.avatarUrl}
            name={comment.creator.name}
          />
        ) : (
          <Avatar size="sm" radius="xl" color="gray">
            {(comment.guestName ?? "?").charAt(0).toUpperCase()}
          </Avatar>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={500} lineClamp={1}>
              {authorName}
            </Text>
            <Group
              gap={0}
              wrap="nowrap"
              style={{ visibility: hovered ? "visible" : "hidden" }}
            >
              {isTopLevel && (
                <MxdResolveButton
                  isResolved={comment.resolvedAt != null}
                  loading={resolveMutation.isPending}
                  onToggle={toggleResolved}
                />
              )}
              {ownerToken && (
                <Menu shadow="md" width={180}>
                  <Menu.Target>
                    <ActionIcon
                      variant="default"
                      style={{ border: "none" }}
                      aria-label={t("Comment menu")}
                    >
                      <IconDots size={18} stroke={2} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconEdit size={14} />}
                      onClick={() => setIsEditing(true)}
                    >
                      {t("Edit comment")}
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={confirmDelete}
                    >
                      {t("Delete comment")}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </Group>
          <Text size="xs" fw={500} c="dimmed">
            {createdAtAgo}
            {comment.editedAt ? ` · ${t("edited")}` : ""}
          </Text>
        </div>
      </Group>

      {isTopLevel && comment.selection && (
        <Box
          className={classes.textSelection}
          onClick={jumpToSelection}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              jumpToSelection();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={t("Jump to comment selection")}
        >
          <Text size="sm">{comment.selection}</Text>
        </Box>
      )}

      {!isEditing ? (
        <CommentEditor defaultContent={comment.content} editable={false} />
      ) : (
        <>
          <CommentEditor
            defaultContent={comment.content}
            editable={true}
            autofocus={true}
            onUpdate={(content: any) => {
              editContentRef.current = content;
            }}
            onSave={saveEdit}
          />
          <CommentActions
            onSave={saveEdit}
            isLoading={updateMutation.isPending}
            onCancel={() => {
              editContentRef.current = null;
              setIsEditing(false);
            }}
            isCommentEditor={true}
          />
        </>
      )}
    </Box>
  );
}

function useComposer(onSave: (content: any) => Promise<boolean> | void) {
  const [content, setContent] = useState<any>(null);
  const editorRef = useRef<any>(null);

  const save = useCallback(async () => {
    if (!content) return;
    try {
      const ok = await onSave(content);
      if (ok === false) return;
      setContent(null);
      editorRef.current?.clearContent();
    } catch {
      // mutation already surfaced the error; keep the draft
    }
  }, [content, onSave]);

  return { editorRef, setContent, save };
}

function ReplyComposer({
  onSave,
}: {
  onSave: (content: any) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { ref, focused } = useFocusWithin();
  const { editorRef, setContent, save } = useComposer(onSave);

  return (
    <div ref={ref}>
      <CommentEditor
        ref={editorRef}
        onUpdate={setContent}
        onSave={save}
        editable={true}
        placeholder={t("Reply...")}
      />
      {focused && <CommentActions onSave={save} />}
    </div>
  );
}

function PageComposer({
  guestName,
  isLoading,
  onSave,
}: {
  guestName: string;
  isLoading: boolean;
  onSave: (content: any) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { ref, focused } = useFocusWithin();
  const { editorRef, setContent, save } = useComposer(onSave);

  return (
    <div
      ref={ref}
      style={{
        flex: "0 0 auto",
        borderTop: "1px solid var(--mantine-color-default-border)",
        paddingTop: "var(--mantine-spacing-sm)",
        paddingBottom: 16,
        position: "relative",
      }}
    >
      <Group wrap="nowrap" align="flex-start" gap="xs">
        <Avatar size="sm" radius="xl" color="gray" style={{ marginTop: 10 }}>
          {(guestName || "?").charAt(0).toUpperCase()}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CommentEditor
            ref={editorRef}
            onUpdate={setContent}
            onSave={save}
            editable={true}
            placeholder={t("Add a comment...")}
            surface="muted"
          />
        </div>
      </Group>
      {focused && (
        <ActionIcon
          variant="filled"
          radius="xl"
          size="sm"
          aria-label={t("Send comment")}
          onClick={save}
          onMouseDown={(e) => e.preventDefault()}
          loading={isLoading}
          style={{ position: "absolute", right: 8, bottom: 22 }}
        >
          <IconArrowUp size={16} />
        </ActionIcon>
      )}
    </div>
  );
}
