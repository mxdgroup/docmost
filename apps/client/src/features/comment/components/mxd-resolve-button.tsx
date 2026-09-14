// MXD: resolve / re-open toggle for a top-level comment thread. Presentational;
// callers supply the action (member API or share-guest API).
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCircleCheck, IconCircleCheckFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type MxdResolveButtonProps = {
  isResolved: boolean;
  loading?: boolean;
  onToggle: () => void;
};

export default function MxdResolveButton({
  isResolved,
  loading,
  onToggle,
}: MxdResolveButtonProps) {
  const { t } = useTranslation();
  const label = isResolved ? t("Re-open comment") : t("Resolve comment");

  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="default"
        style={{ border: "none" }}
        aria-label={label}
        loading={loading}
        onClick={onToggle}
      >
        {isResolved ? (
          <IconCircleCheckFilled
            size={18}
            color="var(--mantine-color-green-7)"
          />
        ) : (
          <IconCircleCheck size={18} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
