// MXD: fork-owned resolve/re-open for members (POST /comments/resolve).
// Upstream's resolution UI is EE-licensed and unlicensed on this deployment.
import {
  InfiniteData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { resolveComment } from "@/features/comment/services/comment-service";
import {
  IComment,
  IResolveComment,
} from "@/features/comment/types/comment.types";
import { RQ_KEY } from "@/features/comment/queries/comment-query";
import { IPagination } from "@/lib/types.ts";

export function useMxdResolveCommentMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (data: IResolveComment) => resolveComment(data),
    onSuccess: (updated: IComment, variables) => {
      const cache = queryClient.getQueryData(RQ_KEY(variables.pageId)) as
        | InfiniteData<IPagination<IComment>>
        | undefined;
      if (cache) {
        queryClient.setQueryData(RQ_KEY(variables.pageId), {
          ...cache,
          pages: cache.pages.map((page) => ({
            ...page,
            items: page.items.map((c) => (c.id === updated.id ? updated : c)),
          })),
        });
      }
      notifications.show({
        message: variables.resolved
          ? t("Comment resolved")
          : t("Comment re-opened"),
      });
    },
    onError: () => {
      notifications.show({
        message: t("Failed to update comment"),
        color: "red",
      });
    },
  });
}
