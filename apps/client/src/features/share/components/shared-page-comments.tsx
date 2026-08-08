// MXD: guest comment thread for comment/edit-mode public shares.
// Deliberately standalone (not the authenticated comment feature): guests
// get plain-text composition — the server enforces the content allowlist
// either way — and can read the full thread. Guests cannot edit, resolve,
// or delete anything (no guest identity to authorize against).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";

interface GuestComment {
  id: string;
  content: any;
  guestName: string | null;
  parentCommentId: string | null;
  createdAt: string;
  creator?: { name: string } | null;
}

function commentText(content: any): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "text" && node.text) parts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (node.type === "paragraph") parts.push("\n");
  };
  walk(content);
  return parts.join("").trim();
}

function textToDoc(text: string) {
  return {
    type: "doc",
    content: text
      .split("\n")
      .filter((line) => line.trim().length)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
  };
}

export default function SharedPageComments({
  shareId,
  pageId,
}: {
  shareId: string;
  pageId: string;
}) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<GuestComment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(
    () => localStorage.getItem("mxdGuestName") ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.post("/shares/comments", {
        shareId,
        pageId,
        limit: 100,
      });
      const items = res.data?.items ?? res.data ?? [];
      setComments(items);
    } catch {
      // listing failures are non-fatal (e.g. mode downgraded)
    }
  }, [shareId, pageId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!draft.trim() || !guestName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("mxdGuestName", guestName.trim());
      await api.post("/shares/comments/create", {
        shareId,
        pageId,
        guestName: guestName.trim(),
        content: JSON.stringify(textToDoc(draft)),
        ...(replyTo ? { parentCommentId: replyTo } : {}),
      });
      setDraft("");
      setReplyTo(null);
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? t("Could not post your comment"),
      );
    } finally {
      setBusy(false);
    }
  };

  const threads = useMemo(() => {
    const top = comments.filter((c) => !c.parentCommentId);
    const byParent = new Map<string, GuestComment[]>();
    comments
      .filter((c) => c.parentCommentId)
      .forEach((c) => {
        const list = byParent.get(c.parentCommentId!) ?? [];
        list.push(c);
        byParent.set(c.parentCommentId!, list);
      });
    return { top, byParent };
  }, [comments]);

  const renderComment = (c: GuestComment, isReply = false) => {
    const name = c.guestName
      ? `${c.guestName} (${t("guest")})`
      : (c.creator?.name ?? t("Unknown"));
    return (
      <Paper key={c.id} p="sm" ml={isReply ? "xl" : 0} withBorder radius="md">
        <Group gap="xs" mb={4}>
          <Avatar size="sm" color={c.guestName ? "gray" : "blue"}>
            {name.charAt(0).toUpperCase()}
          </Avatar>
          <Text size="sm" fw={500}>
            {name}
          </Text>
          <Text size="xs" c="dimmed">
            {new Date(c.createdAt).toLocaleString()}
          </Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {commentText(c.content)}
        </Text>
        {!isReply && (
          <Button
            variant="subtle"
            size="compact-xs"
            mt={4}
            onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
          >
            {replyTo === c.id ? t("Cancel reply") : t("Reply")}
          </Button>
        )}
      </Paper>
    );
  };

  return (
    <Stack gap="sm" my="xl" px="md">
      <Divider label={t("Comments")} labelPosition="left" />
      {threads.top.map((c) => (
        <Stack key={c.id} gap="xs">
          {renderComment(c)}
          {(threads.byParent.get(c.id) ?? []).map((r) =>
            renderComment(r, true),
          )}
        </Stack>
      ))}
      <Paper p="sm" withBorder radius="md">
        <Text size="sm" fw={500} mb="xs">
          {replyTo ? t("Reply to comment") : t("Leave a comment")}
        </Text>
        <TextInput
          size="xs"
          mb="xs"
          placeholder={t("Your name")}
          value={guestName}
          onChange={(e) => setGuestName(e.currentTarget.value)}
          maxLength={50}
        />
        <Textarea
          size="sm"
          autosize
          minRows={2}
          placeholder={t("Write a comment…")}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
        {error && (
          <Text size="xs" c="red" mt={4}>
            {error}
          </Text>
        )}
        <Group justify="flex-end" mt="xs">
          <Button
            size="compact-sm"
            onClick={submit}
            loading={busy}
            disabled={!draft.trim() || !guestName.trim()}
          >
            {t("Post")}
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}
