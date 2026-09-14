// MXD: asks a share guest for the display name shown with their comments.
import { useState } from "react";
import { ActionIcon, TextInput } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSetAtom } from "jotai";
import { guestNameAtom } from "@/features/share/atoms/share-comments-atom";
import { setGuestName } from "@/features/share/guest-identity";

export const GUEST_NAME_MAX = 50;

export default function GuestNameInput({
  initialValue = "",
  autoFocus,
  onDone,
}: {
  initialValue?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const setName = useSetAtom(guestNameAtom);
  const [value, setValue] = useState(initialValue);

  const save = () => {
    const name = value.trim().slice(0, GUEST_NAME_MAX);
    if (!name) return;
    setGuestName(name);
    setName(name);
    onDone?.();
  };

  return (
    <TextInput
      size="xs"
      label={t("Your name")}
      description={t("Shown next to your comments")}
      placeholder={t("e.g. Alex Smith")}
      value={value}
      maxLength={GUEST_NAME_MAX}
      autoFocus={autoFocus}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
      rightSection={
        <ActionIcon
          size="sm"
          variant="filled"
          aria-label={t("Save name")}
          disabled={!value.trim()}
          onClick={save}
        >
          <IconCheck size={14} />
        </ActionIcon>
      }
    />
  );
}
