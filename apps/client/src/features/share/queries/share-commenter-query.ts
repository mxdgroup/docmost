// MXD: optional commenter-account session on share pages.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  getShareCommenter,
  requestCommenterSignInLink,
  signOutCommenter,
  verifyCommenterSignIn,
} from "@/features/share/services/share-comment-service";

export const SHARE_COMMENTER_KEY = ["share-commenter"];

export function useShareCommenterQuery(enabled: boolean) {
  return useQuery({
    queryKey: SHARE_COMMENTER_KEY,
    queryFn: getShareCommenter,
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useRequestCommenterLinkMutation() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: requestCommenterSignInLink,
    onError: (err: any) => {
      notifications.show({
        message:
          err?.response?.status === 429
            ? t("Too many attempts. Please wait a minute and try again.")
            : t("Could not send the sign-in link"),
        color: "red",
      });
    },
  });
}

export function useVerifyCommenterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verifyCommenterSignIn,
    onSuccess: ({ commenter }) => {
      queryClient.setQueryData(SHARE_COMMENTER_KEY, commenter);
      queryClient.invalidateQueries({ queryKey: ["share-comments"] });
    },
  });
}

export function useSignOutCommenterMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: signOutCommenter,
    onSuccess: () => {
      queryClient.setQueryData(SHARE_COMMENTER_KEY, null);
      queryClient.invalidateQueries({ queryKey: ["share-comments"] });
      notifications.show({ message: t("Signed out. You can keep commenting as a guest.") });
    },
  });
}
