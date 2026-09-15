// MXD: react-query layer for guest comments on a public share page. Guests have
// no realtime socket, so the thread list polls while the tab is visible.
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  createShareComment,
  deleteShareComment,
  getShareComments,
  resolveShareComment,
  updateShareComment,
} from "@/features/share/services/share-comment-service";
import { IComment } from "@/features/comment/types/comment.types";
import { IPagination } from "@/lib/types.ts";
import {
  forgetGuestCommentToken,
  saveGuestCommentToken,
} from "@/features/share/guest-identity";

const POLL_MS = 15_000;

export const SHARE_COMMENTS_KEY = (shareId: string, pageId: string) => [
  "share-comments",
  shareId,
  pageId,
];

type CommentsCache = InfiniteData<IPagination<IComment>>;

function mapItems(
  cache: CommentsCache | undefined,
  fn: (items: IComment[]) => IComment[],
): CommentsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({ ...page, items: fn(page.items) })),
  };
}

function errorMessage(err: any, fallback: string): string {
  return err?.response?.data?.message ?? fallback;
}

export function useShareCommentsQuery(shareId: string, pageId: string) {
  const query = useInfiniteQuery({
    queryKey: SHARE_COMMENTS_KEY(shareId, pageId),
    queryFn: ({ pageParam }) =>
      getShareComments({ shareId, pageId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta?.hasNextPage ? lastPage.meta.nextCursor : undefined,
    enabled: !!shareId && !!pageId,
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  const comments = useMemo<IComment[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return { comments, isLoading: query.isLoading, isError: query.isError };
}

export function useCreateShareCommentMutation(shareId: string, pageId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const key = SHARE_COMMENTS_KEY(shareId, pageId);

  return useMutation({
    mutationFn: (data: Omit<Parameters<typeof createShareComment>[0], "shareId" | "pageId">) =>
      createShareComment({ shareId, pageId, ...data }),
    onSuccess: (created) => {
      const { guestToken, ...comment } = created;
      saveGuestCommentToken(comment.id, guestToken);
      queryClient.setQueryData<CommentsCache>(key, (cache) => {
        if (!cache?.pages.length) return cache;
        const exists = cache.pages.some((p) =>
          p.items.some((c) => c.id === comment.id),
        );
        if (exists) return cache;
        const last = cache.pages.length - 1;
        return {
          ...cache,
          pages: cache.pages.map((page, i) =>
            i === last ? { ...page, items: [...page.items, comment] } : page,
          ),
        };
      });
    },
    onError: (err) => {
      notifications.show({
        message: errorMessage(err, t("Error creating comment")),
        color: "red",
      });
    },
  });
}

function useReplaceInCache(shareId: string, pageId: string) {
  const queryClient = useQueryClient();
  return (updated: IComment) =>
    queryClient.setQueryData<CommentsCache>(
      SHARE_COMMENTS_KEY(shareId, pageId),
      (cache) =>
        mapItems(cache, (items) =>
          items.map((c) => (c.id === updated.id ? updated : c)),
        ),
    );
}

export function useUpdateShareCommentMutation(shareId: string, pageId: string) {
  const { t } = useTranslation();
  const replace = useReplaceInCache(shareId, pageId);
  return useMutation({
    mutationFn: (data: { commentId: string; guestToken?: string; content: string }) =>
      updateShareComment({ shareId, ...data }),
    onSuccess: replace,
    onError: (err) => {
      notifications.show({
        message: errorMessage(err, t("Failed to update comment")),
        color: "red",
      });
    },
  });
}

export function useResolveShareCommentMutation(shareId: string, pageId: string) {
  const { t } = useTranslation();
  const replace = useReplaceInCache(shareId, pageId);
  return useMutation({
    mutationFn: (data: { commentId: string; resolved: boolean; guestName?: string }) =>
      resolveShareComment({ shareId, ...data }),
    onSuccess: (updated, variables) => {
      replace(updated);
      notifications.show({
        message: variables.resolved
          ? t("Comment resolved")
          : t("Comment re-opened"),
      });
    },
    onError: (err) => {
      notifications.show({
        message: errorMessage(err, t("Failed to update comment")),
        color: "red",
      });
    },
  });
}

export function useDeleteShareCommentMutation(shareId: string, pageId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (data: { commentId: string; guestToken?: string }) =>
      deleteShareComment({ shareId, ...data }),
    onSuccess: (_data, { commentId }) => {
      forgetGuestCommentToken(commentId);
      // replies cascade server-side; drop them locally too
      queryClient.setQueryData<CommentsCache>(
        SHARE_COMMENTS_KEY(shareId, pageId),
        (cache) =>
          mapItems(cache, (items) =>
            items.filter(
              (c) => c.id !== commentId && c.parentCommentId !== commentId,
            ),
          ),
      );
      notifications.show({ message: t("Comment deleted") });
    },
    onError: (err) => {
      notifications.show({
        message: errorMessage(err, t("Failed to delete comment")),
        color: "red",
      });
    },
  });
}
