import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { MxdAutomationRule } from "../mxd-data.api";
import {
  useMxdAutomationMutations,
  useMxdAutomations,
  useMxdFields,
} from "../queries/mxd-data-query";
import { MxdActionBuilder, MxdAction } from "./mxd-action-builder";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

const TRIGGERS = [
  { value: "record_created", label: "When a row is created" },
  { value: "record_updated", label: "When a row is updated" },
  { value: "field_changed", label: "When a field changes" },
];

interface Draft {
  ruleId?: string;
  name: string;
  triggerType: string;
  triggerFieldId?: string;
  actions: MxdAction[];
  enabled: boolean;
}

function triggerSummary(rule: MxdAutomationRule, fieldName: (id: string) => string) {
  const t = rule.trigger?.type;
  if (t === "record_created") return "on row create";
  if (t === "record_updated") return "on row update";
  if (t === "field_changed")
    return `when ${fieldName(rule.trigger?.fieldId)} changes`;
  return t ?? "";
}

// Automations manager: trigger → actions rules run server-side. Actions reuse the
// shared builder (no openUrl — automations run without a browser).
export function MxdAutomationsModal({ tableId, opened, onClose }: Props) {
  const rulesQuery = useMxdAutomations(tableId, opened);
  const fields = useMxdFields(tableId).data ?? [];
  const settable = fields.filter(
    (f) => !["formula", "lookup", "rollup", "relation", "button"].includes(f.type),
  );
  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? id;
  const { create, update, remove } = useMxdAutomationMutations(tableId);

  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!opened) setDraft(null);
  }, [opened]);

  const startNew = () =>
    setDraft({
      name: "Automation",
      triggerType: "record_created",
      actions: [],
      enabled: true,
    });
  const startEdit = (r: MxdAutomationRule) =>
    setDraft({
      ruleId: r.id,
      name: r.name,
      triggerType: r.trigger?.type ?? "record_created",
      triggerFieldId: r.trigger?.fieldId,
      actions: (r.actions as MxdAction[]) ?? [],
      enabled: r.enabled,
    });

  const draftValid =
    !!draft &&
    draft.actions.length > 0 &&
    (draft.triggerType !== "field_changed" || !!draft.triggerFieldId);

  const saveDraft = async () => {
    if (!draft || !draftValid) return;
    const trigger: Record<string, any> = { type: draft.triggerType };
    if (draft.triggerType === "field_changed") trigger.fieldId = draft.triggerFieldId;
    const payload = {
      name: draft.name,
      trigger,
      actions: draft.actions,
      enabled: draft.enabled,
    };
    try {
      if (draft.ruleId) await update.mutateAsync({ ruleId: draft.ruleId, ...payload });
      else await create.mutateAsync(payload);
      setDraft(null);
    } catch {
      /* surfaced by hooks */
    }
  };

  const rules = rulesQuery.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Automations"
      size="lg"
      centered
    >
      {draft ? (
        <Stack>
          <TextInput
            label="Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
          />
          <Select
            label="Trigger"
            value={draft.triggerType}
            data={TRIGGERS}
            onChange={(v) =>
              setDraft({ ...draft, triggerType: v ?? "record_created" })
            }
            comboboxProps={{ withinPortal: true }}
          />
          {draft.triggerType === "field_changed" && (
            <Select
              label="Field"
              placeholder="Pick a field"
              value={draft.triggerFieldId ?? null}
              data={settable.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) => setDraft({ ...draft, triggerFieldId: v ?? undefined })}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          <MxdActionBuilder
            tableId={tableId}
            actions={draft.actions}
            onChange={(actions) => setDraft({ ...draft, actions })}
          />
          <Switch
            label="Enabled"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveDraft}
              disabled={!draftValid}
              loading={create.isPending || update.isPending}
            >
              Save automation
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Rules run when their trigger fires.
            </Text>
            <Button
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={startNew}
            >
              New automation
            </Button>
          </Group>
          <Divider />
          {rulesQuery.isLoading ? (
            <Group justify="center" my="md">
              <Loader size="sm" />
            </Group>
          ) : rules.length === 0 ? (
            <Text size="sm" c="dimmed">
              No automations yet.
            </Text>
          ) : (
            <Stack gap="xs">
              {rules.map((r) => (
                <Group key={r.id} justify="space-between" wrap="nowrap">
                  <div>
                    <Group gap={6}>
                      <Text size="sm" fw={500}>
                        {r.name}
                      </Text>
                      {!r.enabled && (
                        <Badge size="xs" color="gray">
                          off
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {triggerSummary(r, fieldName)} ·{" "}
                      {(r.actions ?? []).length} action(s)
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Switch
                      size="xs"
                      checked={r.enabled}
                      onChange={(e) =>
                        update.mutate({ ruleId: r.id, enabled: e.currentTarget.checked })
                      }
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Edit"
                      onClick={() => startEdit(r)}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete"
                      onClick={() => remove.mutate(r.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}
