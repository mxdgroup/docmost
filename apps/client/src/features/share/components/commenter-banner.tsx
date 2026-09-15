// MXD: strip at the bottom of a commentable share page. Guests keep
// commenting exactly as before; this just offers optional sign-in so their
// comments carry their name.
import { useEffect, useRef, useState } from "react";
import { Anchor, Button, Group, Text } from "@mantine/core";
import { IconUserCircle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useShareIdentity } from "@/features/share/hooks/use-share-identity";
import {
  useSignOutCommenterMutation,
  useVerifyCommenterMutation,
} from "@/features/share/queries/share-commenter-query";
import { getAllGuestCommentTokens } from "@/features/share/guest-identity";
import CommenterSignInModal from "@/features/share/components/commenter-sign-in-modal";

const SIGN_IN_PARAM = "commenterSignIn";

// Completes sign-in when the page is opened from the emailed link. The token
// is stripped from the address bar before anything else happens.
function useCommenterSignInFromUrl() {
  const { t } = useTranslation();
  const verify = useVerifyCommenterMutation();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get(SIGN_IN_PARAM);
    if (!token) return;
    handled.current = true;
    url.searchParams.delete(SIGN_IN_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);

    verify
      .mutateAsync({ token, guestComments: getAllGuestCommentTokens() })
      .then(({ commenter, claimed }) => {
        notifications.show({
          message:
            claimed === 1
              ? t("Signed in as {{name}}. Your earlier comment moved to your account.", {
                  name: commenter.name,
                })
              : claimed > 1
                ? t("Signed in as {{name}}. {{count}} earlier comments moved to your account.", {
                    name: commenter.name,
                    count: claimed,
                  })
                : t("Signed in as {{name}}.", { name: commenter.name }),
        });
      })
      .catch(() => {
        notifications.show({
          message: t("This sign-in link is invalid or has expired. Request a new one."),
          color: "red",
        });
      });
  }, []);
}

export default function CommenterBanner({
  shareId,
  pageId,
  sharePath,
}: {
  shareId: string;
  pageId: string;
  sharePath: string;
}) {
  const { t } = useTranslation();
  const identity = useShareIdentity();
  const signOut = useSignOutCommenterMutation();
  const [modalOpen, setModalOpen] = useState(false);
  useCommenterSignInFromUrl();

  return (
    <>
      <Group
        h="100%"
        px="md"
        justify="center"
        gap="sm"
        wrap="nowrap"
        data-testid="commenter-banner"
      >
        <IconUserCircle size={18} stroke={1.5} style={{ flexShrink: 0 }} />
        {identity.signedIn ? (
          <>
            <Text size="sm" lineClamp={1}>
              {t("Commenting as")} <b>{identity.commenter?.name}</b>
              <Text span size="sm" c="dimmed" visibleFrom="sm">
                {" "}
                ({identity.commenter?.email})
              </Text>
            </Text>
            <Anchor
              component="button"
              size="sm"
              onClick={() => signOut.mutate()}
              style={{ flexShrink: 0 }}
            >
              {t("Sign out")}
            </Anchor>
          </>
        ) : (
          <>
            <Text size="sm" lineClamp={2}>
              {t("You're commenting as a guest.")}{" "}
              <Text span size="sm" c="dimmed" visibleFrom="sm">
                {t("Sign in or create an account to comment under your name (optional).")}
              </Text>
            </Text>
            <Button
              size="compact-sm"
              variant="light"
              onClick={() => setModalOpen(true)}
              style={{ flexShrink: 0 }}
            >
              {t("Sign in")}
            </Button>
          </>
        )}
      </Group>
      <CommenterSignInModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        shareId={shareId}
        pageId={pageId}
        sharePath={sharePath}
        defaultName={identity.guestName}
      />
    </>
  );
}
