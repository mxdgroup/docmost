import { useEffect, useState } from "react";
import {
  ActionIcon,
  Button,
  ColorSwatch,
  Group,
  Modal,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { MxdField } from "../mxd-data.api";
import {
  MXD_SETTABLE_FIELD_TYPES,
  fieldTypeMeta,
} from "../mxd-field-types";
import { useMxdFieldMutations } from "../queries/mxd-data-query";

interface Choice {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  tableId: string;
  field: MxdField | null;
  onClose: () => void;
}

// The named color palette select fields draw their choice colors from — mirrors
// the status node's palette so the look is consistent across the editor.
const CHOICE_COLORS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "red",
  "violet",
  "cyan",
  "pink",
] as const;

const isSelectType = (t: string) => t === "select" || t === "multi_select";

function newId(): string {
  // Stable choice id; crypto.randomUUID is available in all supported browsers.
  return crypto.randomUUID();
}

// Field settings: rename, change type (settable types only), edit select choices,
// or delete. Computed/relation/button fields can be renamed/deleted here but not
// retyped — those need their own configuration flow.
export function MxdFieldSettingsModal({ tableId, field, onClose }: Props) {
  const opened = !!field;
  const { rename, changeType, config: updateConfig, remove } =
    useMxdFieldMutations(tableId);

  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [choices, setChoices] = useState<Choice[]>([]);

  // Reset the form whenever a different field is opened.
  useEffect(() => {
    if (!field) return;
    setName(field.name);
    setType(field.type);
    setChoices(((field.config?.choices as Choice[]) ?? []).map((c) => ({ ...c })));
  }, [field]);

  if (!field) return null;
  const meta = fieldTypeMeta(field.type);
  const canChangeType = !meta.computed && !meta.relation && !meta.button;

  const addChoice = () =>
    setChoices((cs) => [
      ...cs,
      { id: newId(), label: "", color: CHOICE_COLORS[cs.length % CHOICE_COLORS.length] },
    ]);
  const setChoiceLabel = (id: string, label: string) =>
    setChoices((cs) => cs.map((c) => (c.id === id ? { ...c, label } : c)));
  const setChoiceColor = (id: string, color: string) =>
    setChoices((cs) => cs.map((c) => (c.id === id ? { ...c, color } : c)));
  const removeChoice = (id: string) =>
    setChoices((cs) => cs.filter((c) => c.id !== id));

  const pending =
    rename.isPending ||
    changeType.isPending ||
    updateConfig.isPending ||
    remove.isPending;

  const save = async () => {
    const trimmed = name.trim();
    const nameChanged = !!trimmed && trimmed !== field.name;
    const typeChanged = type !== field.type;

    const cleanChoices = isSelectType(type)
      ? choices
          .map((c) => ({
            id: c.id,
            label: c.label.trim() || "Option",
            color: c.color,
          }))
      : undefined;
    const nextConfig = cleanChoices
      ? { ...(field.config ?? {}), choices: cleanChoices }
      : field.config;
    const choicesChanged =
      isSelectType(type) &&
      JSON.stringify((field.config?.choices as Choice[]) ?? []) !==
        JSON.stringify(cleanChoices);

    try {
      if (nameChanged) {
        await rename.mutateAsync({ fieldId: field.id, name: trimmed });
      }
      if (typeChanged) {
        await changeType.mutateAsync({
          fieldId: field.id,
          type,
          config: nextConfig,
          clearIncompatible: true,
        });
      } else if (choicesChanged) {
        await updateConfig.mutateAsync({ fieldId: field.id, config: nextConfig });
      }
      onClose();
    } catch {
      // notifications are surfaced by the mutation hooks
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync(field.id);
      onClose();
    } catch {
      /* surfaced by the hook */
    }
  };

  const showChoices = isSelectType(type);

  return (
    <Modal opened={opened} onClose={onClose} title="Field settings" size="md" centered>
      <Stack>
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />

        {canChangeType ? (
          <Select
            label="Type"
            value={type}
            onChange={(v) => setType(v ?? field.type)}
            data={MXD_SETTABLE_FIELD_TYPES.map((t) => ({
              value: t.key,
              label: t.label,
            }))}
            comboboxProps={{ withinPortal: true }}
          />
        ) : (
          <div>
            <Text size="sm" fw={500}>
              Type
            </Text>
            <Text size="sm" c="dimmed">
              {meta.label} (not changeable here)
            </Text>
          </div>
        )}

        {showChoices && (
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                Options
              </Text>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={addChoice}
              >
                Add option
              </Button>
            </Group>
            {choices.length === 0 && (
              <Text size="xs" c="dimmed">
                No options yet. Add one to let rows pick a value.
              </Text>
            )}
            {choices.map((c) => (
              <Group key={c.id} gap={6} wrap="nowrap">
                <Popover position="bottom-start" withinPortal>
                  <Popover.Target>
                    <ColorSwatch
                      color={`var(--mantine-color-${c.color ?? "gray"}-5)`}
                      size={22}
                      style={{ cursor: "pointer", flex: "0 0 auto" }}
                    />
                  </Popover.Target>
                  <Popover.Dropdown p={6}>
                    <Group gap={6}>
                      {CHOICE_COLORS.map((col) => (
                        <ColorSwatch
                          key={col}
                          color={`var(--mantine-color-${col}-5)`}
                          size={20}
                          style={{ cursor: "pointer" }}
                          onClick={() => setChoiceColor(c.id, col)}
                        />
                      ))}
                    </Group>
                  </Popover.Dropdown>
                </Popover>
                <TextInput
                  size="xs"
                  placeholder="Option label"
                  value={c.label}
                  onChange={(e) => setChoiceLabel(c.id, e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  aria-label="Remove option"
                  onClick={() => removeChoice(c.id)}
                >
                  <IconTrash size={15} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        )}

        <Group justify="space-between" mt="sm">
          <Button variant="subtle" color="red" onClick={doDelete} loading={remove.isPending}>
            Delete field
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={pending && !remove.isPending}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
