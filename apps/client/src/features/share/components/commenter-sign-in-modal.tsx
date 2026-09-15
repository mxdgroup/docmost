// MXD: optional sign-in for share-link commenters (email magic link). Signing
// in only changes how comments are attributed — it grants no Docmost access.
import { useState } from "react";
import { Button, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useRequestCommenterLinkMutation } from "@/features/share/queries/share-commenter-query";

export default function CommenterSignInModal({
  opened,
  onClose,
  shareId,
  pageId,
  sharePath,
  defaultName,
}: {
  opened: boolean;
  onClose: () => void;
  shareId: string;
  pageId: string;
  sharePath: string;
  defaultName?: string;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [name, setName] = useState(defaultName ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const request = useRequestCommenterLinkMutation();

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    if (!validEmail) return;
    await request.mutateAsync({
      shareId,
      pageId,
      email: email.trim(),
      name: name.trim() || undefined,
      returnPath: sharePath,
    });
    setSentTo(email.trim());
  };

  const close = () => {
    setSentTo(null);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title={t("Sign in to comment")} centered>
      {sentTo ? (
        <Stack gap="sm">
          <Text size="sm">
            {t("Check your inbox. We sent a sign-in link to")} <b>{sentTo}</b>.
          </Text>
          <Text size="xs" c="dimmed">
            {t(
              "Open it on this device. It works once and stays valid for 24 hours. Comments you've already posted from this browser will move to your account.",
            )}
          </Text>
          <Button variant="default" onClick={close}>
            {t("Done")}
          </Button>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit().catch(() => {});
          }}
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t(
                "Comment under your own name instead of as a guest. No password: we'll email you a sign-in link. This doesn't give access to anything else.",
              )}
            </Text>
            <TextInput
              label={t("Email")}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
              autoFocus
              maxLength={254}
            />
            <TextInput
              label={t("Your name")}
              description={t("Used if this is your first time signing in")}
              placeholder={t("e.g. Alex Smith")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={50}
            />
            <Button type="submit" loading={request.isPending} disabled={!validEmail}>
              {t("Email me a sign-in link")}
            </Button>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
