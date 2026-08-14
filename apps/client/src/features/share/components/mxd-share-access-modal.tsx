import {
  Alert,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useShareForPageQuery,
  useUpdateShareMutation,
} from "@/features/share/queries/share-query.ts";
import { ShareMode } from "@/features/share/types/share.types.ts";
import { isShareEditEnabled, isShareGuestCommentsEnabled } from "@/lib/config.ts";

// MXD fork — public-link access level (view / comment / edit).
//
// WHY THIS EXISTS AS ITS OWN MODAL: the Share dialog Docmost renders is the
// Enterprise component (apps/client/src/ee/page-permission/page-share-modal.tsx,
// with its Access/Publish tabs). The fork must never modify or import EE code
// (enforced by the ee-clean-room CI job), and the core share-modal.tsx we
// originally patched is not mounted on this build — so the mode control there
// never appeared. This is the fork-owned, AGPL-core surface for the same
// setting. It talks to the same core share API the EE dialog uses.
//
// The SERVER is the enforcement point: shares.mode gates the anonymous
// collab/comment paths regardless of what this UI shows. The flags below only
// decide which options are offered.
interface Props {
  pageId: string;
  opened: boolean;
  onClose: () => void;
}

export default function MxdShareAccessModal({ pageId, opened, onClose }: Props) {
  const { t } = useTranslation();
  const { data: share, isLoading } = useShareForPageQuery(pageId);
  const updateShareMutation = useUpdateShareMutation();

  const modeOptions = useMemo(() => {
    const options = [{ label: t("Can view"), value: "view" }];
    if (isShareGuestCommentsEnabled() || isShareEditEnabled()) {
      options.push({ label: t("Can comment"), value: "comment" });
    }
    if (isShareEditEnabled()) {
      options.push({ label: t("Can edit"), value: "edit" });
    }
    return options;
  }, [t]);

  const shareMode: ShareMode = (share?.mode as ShareMode) ?? "view";
  // level > 0 means this page only INHERITS a parent's share — the mode belongs
  // to the share, so it must be changed on the page that owns it.
  const isInherited = !!share && share.level > 0;

  const handleModeChange = async (value: string) => {
    if (!share) return;
    try {
      await updateShareMutation.mutateAsync({
        shareId: share.id,
        mode: value as ShareMode,
      });
    } catch {
      // query invalidation reverts the UI
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Public link access")}
      size="lg"
      padding="xl"
    >
      {isLoading ? (
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      ) : !share ? (
        <Text size="sm" c="dimmed">
          {t(
            "This page isn't shared publicly yet. Publish it from the Share dialog first.",
          )}
        </Text>
      ) : (
        <Stack gap="sm">
          {isInherited && (
            <Alert color="gray" variant="light">
              <Text size="sm">
                {t(
                  "This page inherits its public link from a parent page. Change the access level on that parent — it applies to every page under it.",
                )}
              </Text>
            </Alert>
          )}

          <Group justify="space-between" wrap="nowrap" gap="xl">
            <div>
              <Text size="sm">{t("Anyone with the link")}</Text>
              <Text size="xs" c="dimmed">
                {shareMode === "edit"
                  ? t("Can edit this page in real time")
                  : shareMode === "comment"
                    ? t("Can read and leave comments")
                    : t("Can view this page")}
              </Text>
            </div>
            <SegmentedControl
              size="xs"
              data={modeOptions}
              value={shareMode}
              onChange={handleModeChange}
              disabled={isInherited || updateShareMutation.isPending}
            />
          </Group>

          {shareMode !== "view" && (
            <Text size="xs" c="dimmed">
              {t(
                "Treat this link like a password — anyone who has it gets this access. Rotate the link if it leaks.",
              )}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
