// MXD (plan Unit 9): page-permission management panel — AGPL clean-room UI
// over the /pages/permissions endpoints. See the server-side behavior spec
// (PAGE-PERMISSIONS-BEHAVIOR.md); EE components were not consulted.
import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Popover,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconLock, IconLockOpen, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import { MultiMemberSelect } from "@/features/space/components/multi-member-select.tsx";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { IconGroupCircle } from "@/components/icons/icon-people-circle.tsx";

interface Member {
  id: string;
  type: "user" | "group";
  name: string;
  role: string;
  avatarUrl?: string | null;
  memberCount?: number;
}

export default function PageAccessPanel({
  pageId,
  readOnly,
}: {
  pageId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pickerIds, setPickerIds] = useState<string[]>([]);
  const [pickerRole, setPickerRole] = useState<string>("reader");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.post("/pages/permissions", { pageId, limit: 50 });
      setMembers(res.data?.items ?? []);
      setRestricted(true);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setRestricted(false);
        setMembers([]);
      }
    }
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (path: string, body: any, successMsg?: string) => {
    setBusy(true);
    try {
      await api.post(path, body);
      if (successMsg) notifications.show({ message: successMsg });
      await load();
    } catch (err: any) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Something went wrong"),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  };

  const addMembers = async () => {
    const userIds = pickerIds
      .filter((id) => id.startsWith("user-"))
      .map((id) => id.split("user-")[1]);
    const groupIds = pickerIds
      .filter((id) => id.startsWith("group-"))
      .map((id) => id.split("group-")[1]);
    if (!userIds.length && !groupIds.length) return;
    await call("/pages/permissions/add-members", {
      pageId,
      userIds,
      groupIds,
      role: pickerRole,
    });
    setPickerIds([]);
  };

  if (restricted === null) return null;

  return (
    <Popover width={360} position="bottom" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="compact-sm"
          color="dark"
          variant="subtle"
          leftSection={
            restricted ? (
              <IconLock size={18} stroke={1.5} />
            ) : (
              <IconLockOpen size={18} stroke={1.5} />
            )
          }
        >
          {restricted ? t("Restricted") : t("Access")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Group justify="space-between" mb="xs">
          <div>
            <Text size="sm" fw={500}>
              {restricted ? t("Restricted page") : t("Open page")}
            </Text>
            <Text size="xs" c="dimmed">
              {restricted
                ? t("Only members below can access this page")
                : t("Everyone in the space can access this page")}
            </Text>
          </div>
          {!readOnly && (
            <Button
              size="compact-xs"
              variant={restricted ? "default" : "filled"}
              loading={busy}
              onClick={() =>
                call(
                  restricted
                    ? "/pages/permissions/open"
                    : "/pages/permissions/restrict",
                  { pageId },
                  restricted ? t("Page opened") : t("Page restricted"),
                )
              }
            >
              {restricted ? t("Open") : t("Restrict")}
            </Button>
          )}
        </Group>

        {restricted && (
          <>
            <Divider my="xs" />
            <Stack gap={6}>
              {members.map((m) => (
                <Group key={`${m.type}-${m.id}`} justify="space-between">
                  <Group gap="xs">
                    {m.type === "user" ? (
                      <CustomAvatar
                        avatarUrl={m.avatarUrl}
                        size={22}
                        name={m.name}
                      />
                    ) : (
                      <IconGroupCircle />
                    )}
                    <Text size="sm" lineClamp={1}>
                      {m.name}
                    </Text>
                    {m.type === "group" && (
                      <Badge size="xs" variant="light">
                        {t("group")}
                      </Badge>
                    )}
                  </Group>
                  <Group gap={4}>
                    <Select
                      size="xs"
                      w={110}
                      value={m.role}
                      disabled={readOnly}
                      data={[
                        { value: "writer", label: t("Can edit") },
                        { value: "reader", label: t("Can view") },
                      ]}
                      onChange={(role) =>
                        role &&
                        call("/pages/permissions/update-role", {
                          pageId,
                          [m.type === "user" ? "userId" : "groupId"]: m.id,
                          role,
                        })
                      }
                    />
                    {!readOnly && (
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        onClick={() =>
                          call("/pages/permissions/remove-member", {
                            pageId,
                            [m.type === "user" ? "userId" : "groupId"]: m.id,
                          })
                        }
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
            {!readOnly && (
              <>
                <Divider my="xs" />
                <Stack gap="xs">
                  <MultiMemberSelect value={pickerIds} onChange={setPickerIds} />
                  <Group justify="space-between">
                    <Select
                      size="xs"
                      w={110}
                      value={pickerRole}
                      data={[
                        { value: "writer", label: t("Can edit") },
                        { value: "reader", label: t("Can view") },
                      ]}
                      onChange={(v) => v && setPickerRole(v)}
                    />
                    <Button
                      size="compact-sm"
                      onClick={addMembers}
                      loading={busy}
                      disabled={!pickerIds.length}
                    >
                      {t("Add")}
                    </Button>
                  </Group>
                </Stack>
              </>
            )}
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
